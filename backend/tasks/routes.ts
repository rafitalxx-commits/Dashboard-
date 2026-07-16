import type { Request, Response } from "express";
import type {
  DashboardTask,
  DashboardTaskCategory,
  DashboardTaskPriority,
  DashboardTaskStatus,
} from "../../../../dashboard/src/App";
import type { AgentScope, AgentIdentity } from "./repository";

export type TaskRepository = {
  listTasks: (filters?: {
    status?: DashboardTaskStatus;
    category?: DashboardTaskCategory;
    assignee?: string;
    query?: string;
  }) => Promise<DashboardTask[]>;
  getTask: (taskId: string) => Promise<DashboardTask | undefined>;
  createTask: (
    input: Partial<DashboardTask> & { createdBy: string }
  ) => Promise<DashboardTask>;
  updateTask: (
    taskId: string,
    patch: Partial<DashboardTask>
  ) => Promise<DashboardTask>;
  moveTask: (
    taskId: string,
    status: DashboardTaskStatus,
    position?: number
  ) => Promise<DashboardTask>;
  listTeamTasks: (userId: string) => Promise<DashboardTask[]>;
  addCalendarEvent: (
    taskId: string,
    event: {
      title: string;
      startsAt: string;
      endsAt: string;
      location?: string;
      googleEventId?: string;
    }
  ) => Promise<DashboardTask>;
  sendNotification: (taskId: string, channel: "telegram" | "email") => Promise<void>;
};

export type RouteDependencies = {
  env: Record<string, string | undefined>;
  tasks: TaskRepository;
};

export function registerTasksRoutes({ env, tasks }: RouteDependencies) {
  return function attach(req: Request, res: Response) {
    const auth = authenticateAgent(req.headers?.authorization, env);
    if (!auth.ok) {
      res
        .status(auth.status)
        .json({ message: auth.message })
        .end();
      return;
    }

    if (!req.url?.startsWith("/api/agent/tasks")) {
      return;
    }

    try {
      const url = new URL(req.url, "http://local");
      const rawId = url.pathname.split("/").filter(Boolean)[1];

      if (req.method === "GET" && !rawId) {
        requireScope(auth.agent, "tasks:read");

        const status =
          (url.searchParams.get("status") as DashboardTaskStatus | null) ?? undefined;
        const category = (url.searchParams.get("category") as
          | DashboardTaskCategory
          | null) ?? undefined;
        const assignee = url.searchParams.get("assignee") ?? undefined;
        const query = url.searchParams.get("query") ?? undefined;

        const rows = await tasks.listTasks({ status, category, assignee, query });
        res.status(200).json(rows).end();
        return;
      }

      if (req.method === "GET" && rawId && url.pathname.endsWith("/team")) {
        requireScope(auth.agent, "tasks:read");
        const team = await tasks.listTeamTasks(auth.agent.id);
        res.status(200).json(team).end();
        return;
      }

      if (req.method === "GET" && rawId) {
        requireScope(auth.agent, "tasks:read");
        const task = await tasks.getTask(rawId);
        if (!task) {
          res.status(404).json({ message: "Tarea no encontrada" }).end();
          return;
        }
        res.status(200).json(task).end();
        return;
      }

      if (req.method === "POST" && !rawId) {
        requireScope(auth.agent, "tasks:write");
        const payload = await jsonBody<Partial<DashboardTask>>(req);
        const created = await tasks.createTask({
          ...payload,
          createdBy: auth.agent.id,
        });
        res.status(201).json(created).end();
        return;
      }

      if (req.method === "PATCH" && rawId && url.pathname.includes("/move")) {
        requireScope(auth.agent, "tasks:write");
        const body = await jsonBody<{ status: DashboardTaskStatus; position?: number }>(
          req
        );
        const moved = await tasks.moveTask(rawId, body.status, body.position);
        res.status(200).json(moved).end();
        return;
      }

      if (req.method === "PATCH" && rawId) {
        requireScope(auth.agent, "tasks:write");
        const payload = await jsonBody<Partial<DashboardTask>>(req);
        const patched = await tasks.updateTask(rawId, payload);
        res.status(200).json(patched).end();
        return;
      }

      if (
        req.method === "POST" &&
        rawId &&
        url.pathname.endsWith("/calendar-event")
      ) {
        requireScope(auth.agent, "tasks:write");
        const event = await jsonBody<{
          title: string;
          startsAt: string;
          endsAt: string;
          location?: string;
          googleEventId?: string;
        }>(req);
        const updated = await tasks.addCalendarEvent(rawId, event);
        res.status(200).json(updated).end();
        return;
      }

      if (
        req.method === "POST" &&
        rawId &&
        url.pathname.endsWith("/notify")
      ) {
        requireScope(auth.agent, "tasks:write");
        const body = await jsonBody<{ channel: "telegram" | "email" }>(req);
        await tasks.sendNotification(rawId, body.channel);
        res.status(202).json({ accepted: true }).end();
        return;
      }

      res.status(404).json({ message: "Endpoint de tareas no encontrado" }).end();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error en tareas";
      res.status(400).json({ message }).end();
    }
  };
}

type AuthFailure = { ok: false; status: number; message: string };
type AuthSuccess = { ok: true; agent: AgentIdentity };

type AuthMiddleware = AuthSuccess | AuthFailure;

const VALID_SCOPES = new Set<AgentScope>([
  "tasks:read",
  "tasks:write",
  "amazon:read",
  "amazon:draft:write",
  "amazon:pending-reply:write",
]);

function authenticateAgent(
  authorizationHeader: string | string[] | undefined,
  env: Record<string, string | undefined>
): AuthMiddleware {
  const configured = normalizedAgentConfigs(env);
  if (!configured.length) {
    return {
      ok: false,
      status: 503,
      message: "Agent API no configurada",
    };
  }

  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return {
      ok: false,
      status: 401,
      message: "Bearer token requerido",
    };
  }

  const tokenHash = sha256(token);
  const agent = configured.find((item) => safeCompare(item.tokenHash, tokenHash));
  if (!agent) {
    return {
      ok: false,
      status: 401,
      message: "Token Agent API no valido",
    };
  }

  return {
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      scopes: agent.scopes,
    },
  };
}

function requireScope(agent: AgentIdentity, scope: AgentScope) {
  if (!agent.scopes.includes(scope)) {
    throw new Error(`Scope insuficiente: ${scope}`);
  }
}

function normalizedAgentConfigs(env: Record<string, string | undefined>) {
  const entries: AgentConfig[] = [];

  const single = env.DASHBOARD_AGENT_API_TOKEN;
  if (single) {
    entries.push({
      id: env.DASHBOARD_AGENT_API_ID ?? "agent-api",
      name: env.DASHBOARD_AGENT_API_NAME ?? "Agent API",
      tokenHash: sha256(single),
      scopes: parseScopes(env.DASHBOARD_AGENT_API_SCOPES),
    });
  }

  const multi = env.DASHBOARD_AGENT_API_TOKENS;
  if (multi) {
    for (const entry of multi.split(";")) {
      const [id, kind, hash, ...scopeParts] = entry.split(":");
      const rawScopes = scopeParts.join(":");
      if (!id || kind !== "sha256" || !hash) continue;
      entries.push({
        id: `agent-${id}`,
        name: id,
        tokenHash: hash,
        scopes: parseScopes(rawScopes),
      });
    }
  }

  return entries;
}

function parseScopes(raw?: string): AgentScope[] {
  const scopes = (raw ?? "tasks:read,tasks:write,amazon:read")
    .split(/[,\s|]+/)
    .filter(Boolean);
  return scopes.filter((scope): scope is AgentScope =>
    VALID_SCOPES.has(scope as AgentScope)
  );
}

async function jsonBody<T>(req: Request): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function extractBearerToken(header?: string | string[]): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match?.[1].trim();
}

function sha256(value: string) {
  const hash = globalThis.crypto.subtle.digest(
    "SHA-256",
    Buffer.from(value, "utf8")
  );
  return Buffer.from(await hash).toString("hex");
}

function safeCompare(a: string, b: string) {
  if (a.length !== b.length) return false;
  return timingSafeCompare(a, b);
}

function timingSafeCompare(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left[i] ^ right[i];
  }
  return result === 0;
}

type AgentConfig = {
  id: string;
  name: string;
  tokenHash: string;
  scopes: AgentScope[];
};
