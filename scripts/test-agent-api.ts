import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { registerAgentApiRoutes } from "../backend/agentApi/routes.ts";
import { createAmazonMessagesRepository } from "../backend/amazonMessages/repository.ts";

const tempDir = mkdtempSync(join(tmpdir(), "dashboard-agent-api-"));
const token = "test-hermes-token";

type Handler = (request: any, response: any) => void;

const handlers: Array<{ path: string; handler: Handler }> = [];
const tasks: any[] = [];

registerAgentApiRoutes(
  {
    middlewares: {
      use(path: string, handler: Handler) {
        handlers.push({ path, handler });
      },
    },
  },
  {
    env: {
      DASHBOARD_AGENT_API_TOKENS: `hermes:sha256:${sha256(token)}:tasks:read,tasks:write,amazon:read,amazon:draft:write,amazon:pending-reply:write`,
      DASHBOARD_AGENT_API_ALLOWED_IPS: "77.42.49.79,2a01:4f9:fff1:5f::2,100.64.0.0/10",
    },
    tasks: {
      listTasks: () => tasks,
      createTask: (input, userId) => {
        const task = {
          id: `task-${tasks.length + 1}`,
          title: input.title ?? "",
          detail: input.detail ?? "",
          category: input.category ?? "Operativa",
          priority: input.priority ?? "Media",
          status: input.status ?? "Pendiente",
          dueDate: input.dueDate ?? "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: userId,
        };
        tasks.push(task);
        return task;
      },
      updateTask: (taskId, patch) => {
        const task = tasks.find((item) => item.id === taskId);
        if (!task) throw new Error("Tarea no encontrada");
        Object.assign(task, patch, { updatedAt: new Date().toISOString() });
        return task;
      },
    },
    amazonDataDir: tempDir,
  },
);

try {
  assert.equal(handlers.length, 1, "agent API should register one middleware");

  const unauthorized = await request("GET", "/health");
  assert.equal(unauthorized.status, 401, "missing token should be rejected");

  const blockedIp = await request(
    "GET",
    "/health",
    undefined,
    token,
    "203.0.113.10",
  );
  assert.equal(blockedIp.status, 403, "non-allowlisted IP should be rejected");

  const directSpoof = await request(
    "GET",
    "/health",
    undefined,
    token,
    "77.42.49.79",
    "203.0.113.10",
  );
  assert.equal(
    directSpoof.status,
    403,
    "direct callers must not spoof X-Forwarded-For",
  );

  const tailnetHealth = await request(
    "GET",
    "/health",
    undefined,
    token,
    "100.80.12.34",
  );
  assert.equal(tailnetHealth.status, 200, "tailnet CIDR should be allowed");

  const health = await request("GET", "/health", undefined, token);
  assert.equal(health.status, 200, "valid token should reach health");
  assert.ok(
    health.body.capabilities.includes("amazon:draft:write"),
    "health should expose safe capabilities",
  );

  const createdTask = await request(
    "POST",
    "/tasks",
    { title: "Preparar prueba Hermes", priority: "Alta" },
    token,
  );
  assert.equal(createdTask.status, 201, "agent should create tasks");
  assert.equal(createdTask.body.createdBy, "agent-hermes");

  const conversations = await request("GET", "/amazon/conversations", undefined, token);
  assert.equal(conversations.status, 200, "agent should read Amazon conversations");
  assert.ok(conversations.body.length > 0, "seed conversations should be visible");
  const conversationId = conversations.body[0].conversationId;

  const blockedExternalSend = await request(
    "POST",
    `/amazon/conversations/${conversationId}/draft`,
    {
      draftBody: "No deberia guardarse",
      externalSend: true,
    },
    token,
  );
  assert.equal(
    blockedExternalSend.status,
    400,
    "externalSend=true must be blocked",
  );
  assert.match(blockedExternalSend.body.message, /envio externo/i);

  const draft = await request(
    "POST",
    `/amazon/conversations/${conversationId}/draft`,
    {
      draftBody: "Hola, revisamos tu incidencia y te responderemos con la solucion.",
      status: "BORRADOR_INTERNO",
    },
    token,
  );
  assert.equal(draft.status, 201, "agent should create internal drafts only");
  assert.equal(draft.body.externalSend, false);

  const repository = createAmazonMessagesRepository({ dataDir: tempDir });
  const dashboardActor = {
    id: "operator-test",
    name: "Operador test",
    role: "OPERADOR" as const,
  };
  const draftRequest = repository.createHermesDraftRequest(
    dashboardActor,
    conversationId,
    { externalSend: false },
  );

  const nextDraftRequest = await request(
    "GET",
    "/amazon/draft-requests/next?wait=1",
    undefined,
    token,
  );
  assert.equal(nextDraftRequest.status, 200, "Hermes should claim draft requests");
  assert.equal(nextDraftRequest.body.request.requestId, draftRequest.requestId);
  assert.equal(nextDraftRequest.body.request.status, "IN_PROGRESS");
  assert.equal(
    nextDraftRequest.body.conversation.conversation.conversationId,
    conversationId,
  );

  const completedDraftRequest = await request(
    "POST",
    `/amazon/draft-requests/${draftRequest.requestId}/complete`,
    {
      draftBody: "Hola, hemos revisado tu caso y seguimos pendientes del transporte.",
      operatorSummary: "Caso de transporte, respuesta prudente.",
      customerLanguage: "es",
      confidence: 0.86,
      warnings: ["No prometer reembolso sin validar"],
      externalSend: false,
    },
    token,
  );
  assert.equal(
    completedDraftRequest.status,
    200,
    "Hermes should complete draft requests",
  );
  assert.equal(completedDraftRequest.body.request.status, "COMPLETED");
  assert.equal(completedDraftRequest.body.draft.externalSend, false);
  assert.equal(completedDraftRequest.body.draft.source, "HERMES_DRAFT");

  const blockedExternalCompletion = await request(
    "POST",
    `/amazon/draft-requests/${draftRequest.requestId}/complete`,
    {
      draftBody: "No deberia guardarse",
      externalSend: true,
    },
    token,
  );
  assert.equal(
    blockedExternalCompletion.status,
    400,
    "Hermes completion must not allow externalSend=true",
  );

  const failedRequest = repository.createHermesDraftRequest(
    dashboardActor,
    conversationId,
    { externalSend: false },
  );
  const failedCompletion = await request(
    "POST",
    `/amazon/draft-requests/${failedRequest.requestId}/fail`,
    { errorMessage: "Modelo no disponible", externalSend: false },
    token,
  );
  assert.equal(failedCompletion.status, 200, "Hermes should fail draft requests");
  assert.equal(failedCompletion.body.status, "FAILED");

  const finalRoute = await request(
    "POST",
    `/amazon/conversations/${conversationId}/finalize`,
    { externalSend: true },
    token,
  );
  assert.equal(finalRoute.status, 404, "final send route must not exist in Agent API");

  console.log("Agent API tests passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

async function request(
  method: string,
  url: string,
  body?: unknown,
  bearerToken?: string,
  forwardedFor = "77.42.49.79",
  remoteAddress = "127.0.0.1",
) {
  const handler = handlers[0].handler;
  const payload = body === undefined ? "" : JSON.stringify(body);
  const request = Readable.from(payload ? [Buffer.from(payload)] : []);
  Object.assign(request, {
    method,
    url,
    socket: { remoteAddress },
    headers: {
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      "x-forwarded-for": forwardedFor,
    },
  });

  const responseBody: string[] = [];
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(value: string) {
      responseBody.push(value);
    },
  };

  await handler(request, response);

  const raw = responseBody.join("");
  return {
    status: response.statusCode,
    body: raw ? JSON.parse(raw) : undefined,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
