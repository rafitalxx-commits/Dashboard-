import { createHash, timingSafeEqual } from "node:crypto";
import { createAmazonMessagesRepository } from "../amazonMessages/repository.ts";
import type { AmazonMessagesActor } from "../amazonMessages/schema.ts";

type MiddlewareServer = {
  middlewares: {
    use: (path: string, handler: (request: any, response: any) => void) => void;
  };
};

type DashboardTask = {
  id: string;
  title: string;
  detail: string;
  category: string;
  priority: string;
  status: string;
  dueDate: string;
  reminderAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

type TaskRepository = {
  listTasks: () => DashboardTask[];
  createTask: (input: Partial<DashboardTask>, userId: string) => DashboardTask;
  updateTask: (taskId: string, patch: Partial<DashboardTask>) => DashboardTask;
};

type AgentScope =
  | "tasks:read"
  | "tasks:write"
  | "amazon:read"
  | "amazon:draft:write"
  | "amazon:pending-reply:write";

type AgentIdentity = {
  id: string;
  name: string;
  scopes: AgentScope[];
};

type AgentTokenConfig = AgentIdentity & {
  tokenHash: string;
};

type RouteOptions = {
  env: Record<string, string | undefined>;
  tasks: TaskRepository;
  amazonDataDir?: string;
};

const allowedScopes: AgentScope[] = [
  "tasks:read",
  "tasks:write",
  "amazon:read",
  "amazon:draft:write",
  "amazon:pending-reply:write",
];

export function registerAgentApiRoutes(
  server: MiddlewareServer,
  options: RouteOptions,
) {
  const amazonRepository = createAmazonMessagesRepository({
    dataDir: options.amazonDataDir,
  });

  server.middlewares.use("/api/agent", async (request, response) => {
    const auth = authenticateAgent(request, options.env);
    if (!auth.ok) {
      sendJson(response, auth.status, { message: auth.message });
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://local");
      const parts = url.pathname.split("/").filter(Boolean);

      if (request.method === "GET" && parts[0] === "health") {
        sendJson(response, 200, {
          ok: true,
          agent: publicAgent(auth.agent),
          capabilities: allowedScopes,
        });
        return;
      }

      if (parts[0] === "tasks") {
        if (request.method === "GET" && !parts[1]) {
          requireScope(auth.agent, "tasks:read");
          const status = url.searchParams.get("status") ?? undefined;
          const category = url.searchParams.get("category") ?? undefined;
          const assignee = url.searchParams.get("assignee") ?? undefined;
          const query = url.searchParams.get("query") ?? undefined;
          const rows = options.tasks.listTasks?.({ status, category, assignee, query });
          sendJson(
            response,
            200,
            rows ?? options.tasks.listTasks(),
          );
          return;
        }

        if (request.method === "GET" && parts[1] && parts[2] === "team") {
          requireScope(auth.agent, "tasks:read");
          const team = options.tasks.listTeamTasks?.(auth.agent.id) ?? [];
          sendJson(response, 200, team);
          return;
        }

        if (request.method === "GET" && parts[1]) {
          requireScope(auth.agent, "tasks:read");
          const task = options.tasks.getTask(parts[1]);
          if (!task) {
            sendJson(response, 404, { message: "Tarea no encontrada" });
            return;
          }
          sendJson(response, 200, task);
          return;
        }

        if (request.method === "POST" && !parts[1]) {
          requireScope(auth.agent, "tasks:write");
          const payload = await readJsonBody<Partial<DashboardTask>>(request);
          const created = options.tasks.createTask(
            { ...payload, status: payload.status ?? "Pendiente" },
            auth.agent.id,
          );
          sendJson(response, 201, created);
          return;
        }

        if (request.method === "PATCH" && parts[1] && parts[2] === "move") {
          requireScope(auth.agent, "tasks:write");
          const payload = await readJsonBody<{ status: string; position?: number }>(
            request,
          );
          const moved = options.tasks.moveTask(
            parts[1],
            payload.status,
            payload.position,
          );
          sendJson(response, 200, moved);
          return;
        }

        if (request.method === "PATCH" && parts[1]) {
          requireScope(auth.agent, "tasks:write");
          const payload = await readJsonBody<Partial<DashboardTask>>(request);
          const patched = options.tasks.updateTask(parts[1], payload);
          sendJson(response, 200, patched);
          return;
        }

        if (request.method === "POST" && parts[1] && parts[2] === "calendar-event") {
          requireScope(auth.agent, "tasks:write");
          const event = await readJsonBody<{
            title: string;
            startsAt: string;
            endsAt: string;
            location?: string;
            googleEventId?: string;
          }>(request);
          const updated = options.tasks.addCalendarEvent(parts[1], event);
          sendJson(response, 200, updated);
          return;
        }

        if (request.method === "POST" && parts[1] && parts[2] === "notify") {
          requireScope(auth.agent, "tasks:write");
          const body = await readJsonBody<{ channel: "telegram" | "email" }>(request);
          options.tasks.sendNotification(parts[1], body.channel);
          sendJson(response, 202, { accepted: true });
          return;
        }
      }

      if (parts[0] === "amazon" && parts[1] === "draft-requests") {
        const actor = amazonActorFromAgent(auth.agent);

        if (request.method === "GET" && parts[2] === "next") {
          requireScope(auth.agent, "amazon:draft:write");
          const waitMs = Math.min(
            Math.max(Number(url.searchParams.get("wait") ?? 0) * 1000, 0),
            30_000,
          );
          const startedAt = Date.now();
          let draftRequest = amazonRepository.claimNextHermesDraftRequest(actor);
          while (!draftRequest && waitMs > 0 && Date.now() - startedAt < waitMs) {
            await sleep(500);
            draftRequest = amazonRepository.claimNextHermesDraftRequest(actor);
          }
          if (!draftRequest) {
            sendJson(response, 200, { request: null });
            return;
          }
          sendJson(response, 200, {
            request: draftRequest,
            conversation: await amazonRepository.getConversation(
              actor,
              draftRequest.conversationId,
            ),
          });
          return;
        }

        if (request.method === "GET" && parts[2] && !parts[3]) {
          requireScope(auth.agent, "amazon:read");
          sendJson(
            response,
            200,
            amazonRepository.getHermesDraftRequest(actor, parts[2]),
          );
          return;
        }

        if (request.method === "POST" && parts[2] && parts[3] === "complete") {
          requireScope(auth.agent, "amazon:draft:write");
          const payload = await readJsonBody<Record<string, unknown>>(request);
          assertNoExternalSend(payload);
          sendJson(
            response,
            200,
            amazonRepository.completeHermesDraftRequest(actor, parts[2], {
              ...payload,
              externalSend: false,
            }),
          );
          return;
        }

        if (request.method === "POST" && parts[2] && parts[3] === "fail") {
          requireScope(auth.agent, "amazon:draft:write");
          const payload = await readJsonBody<Record<string, unknown>>(request);
          assertNoExternalSend(payload);
          sendJson(
            response,
            200,
            amazonRepository.failHermesDraftRequest(actor, parts[2], {
              ...payload,
              externalSend: false,
            }),
          );
          return;
        }
      }

      if (parts[0] === "amazon" && parts[1] === "conversations") {
        const actor = amazonActorFromAgent(auth.agent);

        if (request.method === "GET" && !parts[2]) {
          requireScope(auth.agent, "amazon:read");
          sendJson(response, 200, amazonRepository.listConversations(actor));
          return;
        }

        if (request.method === "GET" && parts[2] && !parts[3]) {
          requireScope(auth.agent, "amazon:read");
          sendJson(
            response,
            200,
            await amazonRepository.getConversation(actor, parts[2]),
          );
          return;
        }

        if (parts[2] && parts[3] === "draft") {
          if (request.method === "GET") {
            requireScope(auth.agent, "amazon:read");
            sendJson(response, 200, amazonRepository.getInternalDraft(actor, parts[2]));
            return;
          }

          if (request.method === "POST" && !parts[4]) {
            requireScope(auth.agent, "amazon:draft:write");
            const payload = await readJsonBody<Record<string, unknown>>(request);
            assertNoExternalSend(payload);
            sendJson(
              response,
              201,
              amazonRepository.createInternalDraft(actor, parts[2], {
                ...payload,
                source: "AGENT_API",
                externalSend: false,
              }),
            );
            return;
          }

          if (request.method === "PUT" && !parts[4]) {
            requireScope(auth.agent, "amazon:draft:write");
            const payload = await readJsonBody<Record<string, unknown>>(request);
            assertNoExternalSend(payload);
            sendJson(
              response,
              200,
              amazonRepository.updateInternalDraft(actor, parts[2], {
                ...payload,
                source: "AGENT_API",
                externalSend: false,
              }),
            );
            return;
          }

          if (request.method === "POST" && parts[4] === "from-template") {
            requireScope(auth.agent, "amazon:draft:write");
            const payload = await readJsonBody<{ templateId?: string }>(request);
            sendJson(
              response,
              200,
              await amazonRepository.applyTemplateToInternalDraft(actor, parts[2], {
                templateId: payload.templateId,
                externalSend: false,
              }),
            );
            return;
          }

          if (request.method === "POST" && parts[4] === "smart") {
            requireScope(auth.agent, "amazon:draft:write");
            sendJson(
              response,
              201,
              await amazonRepository.generateSmartDraft(actor, parts[2], {
                externalSend: false,
              }),
            );
            return;
          }
        }

        if (parts[2] && parts[3] === "pending-reply" && request.method === "POST") {
          requireScope(auth.agent, "amazon:pending-reply:write");
          const payload = await readJsonBody<Record<string, unknown>>(request);
          assertNoExternalSend(payload);
          sendJson(
            response,
            201,
            amazonRepository.preparePendingReply(actor, parts[2], {
              ...payload,
              externalSend: false,
            }),
          );
          return;
        }
      }

      sendJson(response, 404, { message: "Agent API endpoint no encontrado" });
    } catch (error) {
      sendJson(response, 400, {
        message: error instanceof Error ? error.message : "Error Agent API",
      });
    }
  });
}

function authenticateAgent(
  request: { headers?: Record<string, string | string[] | undefined> },
  env: Record<string, string | undefined>,
):
  | { ok: true; agent: AgentIdentity }
  | { ok: false; status: number; message: string } {
  const configured = agentTokenConfigsFromEnv(env);
  if (!configured.length) {
    return {
      ok: false,
      status: 503,
      message: "Agent API no configurada",
    };
  }

  const allowedIpRules = parseAllowedIpRules(env.DASHBOARD_AGENT_API_ALLOWED_IPS);
  if (allowedIpRules.length) {
    const requestIp = agentRequestIp(request);
    if (!requestIp || !isAllowedAgentIp(requestIp, allowedIpRules)) {
      return {
        ok: false,
        status: 403,
        message: "Origen Agent API no permitido",
      };
    }
  }

  const token = bearerToken(request.headers?.authorization);
  if (!token) {
    return {
      ok: false,
      status: 401,
      message: "Bearer token requerido",
    };
  }

  const tokenHash = sha256(token);
  const agent = configured.find((item) => safeEqual(item.tokenHash, tokenHash));
  if (!agent) {
    return {
      ok: false,
      status: 401,
      message: "Token Agent API no valido",
    };
  }

  return {
    ok: true,
    agent: { id: agent.id, name: agent.name, scopes: agent.scopes },
  };
}

function agentTokenConfigsFromEnv(
  env: Record<string, string | undefined>,
): AgentTokenConfig[] {
  const configs: AgentTokenConfig[] = [];
  const singleToken = env.DASHBOARD_AGENT_API_TOKEN;
  if (singleToken) {
    configs.push({
      id: env.DASHBOARD_AGENT_API_ID ?? "agent-api",
      name: env.DASHBOARD_AGENT_API_NAME ?? "Agent API",
      tokenHash: sha256(singleToken),
      scopes: parseScopes(env.DASHBOARD_AGENT_API_SCOPES),
    });
  }

  for (const entry of (env.DASHBOARD_AGENT_API_TOKENS ?? "").split(";")) {
    const [id, kind, hash, ...scopeParts] = entry.split(":");
    const rawScopes = scopeParts.join(":");
    if (!id || kind !== "sha256" || !hash) continue;
    configs.push({
      id: `agent-${id}`,
      name: id,
      tokenHash: hash,
      scopes: parseScopes(rawScopes),
    });
  }

  return configs;
}

function parseScopes(raw?: string): AgentScope[] {
  const scopes = (raw ?? "tasks:read,tasks:write,amazon:read")
    .split(/[,\s|]+/)
    .filter(Boolean);
  return scopes.filter((scope): scope is AgentScope =>
    allowedScopes.includes(scope as AgentScope),
  );
}

type AllowedIpRule =
  | { kind: "ip"; value: string }
  | { kind: "ipv4-cidr"; base: number; mask: number };

function parseAllowedIpRules(raw?: string): AllowedIpRule[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((item) => parseAllowedIpRule(item))
    .filter((item): item is AllowedIpRule => Boolean(item));
}

function parseAllowedIpRule(raw: string): AllowedIpRule | undefined {
  const value = normalizeIp(raw);
  if (!value) return undefined;
  const cidrMatch = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/.exec(value);
  if (cidrMatch) {
    const base = ipv4ToInt(cidrMatch[1]);
    if (base === undefined) return undefined;
    const prefix = Number(cidrMatch[2]);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return { kind: "ipv4-cidr", base: base & mask, mask };
  }
  return { kind: "ip", value };
}

function isAllowedAgentIp(ip: string, rules: AllowedIpRule[]) {
  const normalized = normalizeIp(ip);
  const ipv4 = ipv4ToInt(normalized);
  return rules.some((rule) => {
    if (rule.kind === "ip") return rule.value === normalized;
    return ipv4 !== undefined && (ipv4 & rule.mask) === rule.base;
  });
}

function ipv4ToInt(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return undefined;
    result = ((result << 8) | octet) >>> 0;
  }
  return result;
}

function agentRequestIp(request: {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}) {
  const socketIp = normalizeIp(request.socket?.remoteAddress);
  if (socketIp && socketIp !== "127.0.0.1" && socketIp !== "::1") {
    return socketIp;
  }
  const headers = request.headers;
  const forwardedFor = firstHeader(headers?.["x-forwarded-for"]);
  const forwardedIp = forwardedFor?.split(",")[0]?.trim();
  return normalizeIp(forwardedIp ?? firstHeader(headers?.["x-real-ip"]) ?? socketIp);
}

function firstHeader(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeIp(value?: string) {
  const ip = (value ?? "").trim();
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip;
}

function amazonActorFromAgent(agent: AgentIdentity): AmazonMessagesActor {
  return {
    id: agent.id,
    name: agent.name,
    role: "AGENTE_IA",
    permissions: [
      "amazonMessages:read",
      ...(agent.scopes.includes("amazon:draft:write")
        ? (["amazonMessages:manage", "amazonMessages:aiDraft"] as const)
        : []),
      ...(agent.scopes.includes("amazon:pending-reply:write")
        ? (["amazonMessages:manage", "amazonMessages:validate"] as const)
        : []),
    ],
  };
}

function requireScope(agent: AgentIdentity, scope: AgentScope) {
  if (!agent.scopes.includes(scope)) {
    throw new Error(`Scope insuficiente: ${scope}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertNoExternalSend(payload: Record<string, unknown>) {
  if (payload.externalSend === true || payload.realDelivery === true) {
    throw new Error("Agent API no permite envio externo");
  }
}

function bearerToken(header?: string | string[]) {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match?.[1]?.trim();
}

function publicAgent(agent: AgentIdentity) {
  return {
    id: agent.id,
    name: agent.name,
    scopes: agent.scopes,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

async function readJsonBody<T>(request: { on: Function }): Promise<T> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", resolve);
    request.on("error", reject);
  });
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function sendJson(
  response: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body: string) => void;
  },
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}
