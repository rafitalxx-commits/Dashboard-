import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGmailApiDraftSource,
  gmailDraftConfigFromEnv,
} from "../backend/amazonMessages/gmailClient.ts";
import {
  createAmazonMessagesRepository,
  type ManualSendMockConfirmation,
} from "../backend/amazonMessages/repository.ts";
import { registerAmazonMessagesRoutes } from "../backend/amazonMessages/routes.ts";
import type { AmazonMessagesActor } from "../backend/amazonMessages/schema.ts";

class MockResponse {
  statusCode = 200;
  body = "";
  done: Promise<void>;
  private resolveDone!: () => void;

  constructor() {
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  setHeader() {
    return undefined;
  }

  end(value: string) {
    this.body = value;
    this.resolveDone();
  }
}

if (process.env.RUN_REAL_MANUAL_SEND_MOCK_VALIDATION !== "true") {
  throw new Error(
    "Set RUN_REAL_MANUAL_SEND_MOCK_VALIDATION=true to create/update a real Gmail draft and finalize mock.",
  );
}

const config = gmailDraftConfigFromEnv(process.env);
const missing = [
  ["AMAZON_MESSAGES_GMAIL_DRAFT_ACCOUNT or AMAZON_MESSAGES_GMAIL_ACCOUNT", config.account],
  [
    "AMAZON_MESSAGES_GMAIL_DRAFT_CLIENT_ID or GMAIL_CLIENT_ID or GOOGLE_CLIENT_ID",
    config.clientId,
  ],
  [
    "AMAZON_MESSAGES_GMAIL_DRAFT_CLIENT_SECRET or GMAIL_CLIENT_SECRET or GOOGLE_CLIENT_SECRET",
    config.clientSecret,
  ],
  [
    "AMAZON_MESSAGES_GMAIL_DRAFT_REFRESH_TOKEN or AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN",
    config.refreshToken,
  ],
].filter(([, value]) => !value);

if (missing.length) {
  throw new Error(`Missing OAuth env: ${missing.map(([name]) => name).join(", ")}`);
}

const sourceStore =
  process.env.AMAZON_MESSAGES_VALIDATION_STORE ??
  ".dashboard-data/amazon-messages-store.json";
const tempDir = mkdtempSync(join(tmpdir(), "amazon-manual-send-mock-flow-"));
copyFileSync(sourceStore, join(tempDir, "amazon-messages-store.json"));

const repository = createAmazonMessagesRepository({ dataDir: tempDir });
const actor: AmazonMessagesActor = {
  id: "manual-send-mock-validation",
  name: "Manual Send Mock Validation",
  role: "ADMIN",
  permissions: ["amazonMessagesSendFinal"],
};

const unique = new Date().toISOString().replace(/[:.]/g, "-");
let createdDraftId = "";

try {
  let conversation = undefined as
    | ReturnType<typeof repository.listConversations>[number]
    | undefined;
  for (const item of repository.listConversations(actor)) {
    if (!item.conversationId.startsWith("amz-gmail-")) continue;
    const detail = await repository.getConversation(actor, item.conversationId);
    const hasInboundAmazonRelay = detail.messages.some(
      (message) =>
        message.direction === "inbound" &&
        /@marketplace\.amazon\./i.test(message.sender),
    );
    if (
      hasInboundAmazonRelay &&
      repository.getPendingReply(actor, item.conversationId).status === "SIN_RESPUESTA"
    ) {
      conversation = item;
      break;
    }
  }
  assert.ok(conversation, "a real imported Gmail conversation without active pending reply is required");
  const conversationId = conversation.conversationId;

  const internalDraft = repository.createInternalDraft(actor, conversationId, {
    draftBody: `VALIDACION LOCAL MANUAL_SEND_MOCK ${unique}. NO ENVIAR. Borrador inicial.`,
    status: "LISTO_PARA_REVISAR",
    source: "Gmail readonly",
    externalSend: false,
  });
  repository.reviewInternalDraft(actor, conversationId, {
    status: "APROBADO_MANUALMENTE",
    reviewNotes: "Validacion funcional local manual_send_mock.",
    externalSend: false,
  });
  repository.preparePendingReply(actor, conversationId, {
    draftId: internalDraft.draftId,
    status: "PENDIENTE_VALIDACION",
    externalSend: false,
  });
  repository.reviewPendingReply(actor, conversationId, {
    status: "APROBADA_PARA_BORRADOR",
    validationNotes: "Aprobada para Gmail Draft real y finalizacion mock.",
    externalSend: false,
  });

  const gmailSource = createGmailApiDraftSource(config);
  const payload1 = repository.buildGmailDraftPayload(actor, conversationId);
  const created = await gmailSource.createOrUpdateDraft({
    to: payload1.recipient,
    subject: payload1.subject,
    bodyText: payload1.bodyText,
    threadId: payload1.gmailThreadId,
  });
  createdDraftId = created.id;
  repository.recordGmailDraft(actor, conversationId, {
    pendingReplyId: payload1.pendingReplyId,
    gmailDraftId: created.id,
    gmailThreadId: created.threadId ?? payload1.gmailThreadId,
    recipient: payload1.recipient,
    subject: payload1.subject,
    bodyHash: payload1.bodyHash,
    status: "BORRADOR_GMAIL_CREADO",
  });

  repository.updatePendingReply(actor, conversationId, {
    replyBody: `VALIDACION LOCAL MANUAL_SEND_MOCK ${unique}. NO ENVIAR. Borrador actualizado antes de finalizacion mock.`,
    status: "APROBADA_PARA_BORRADOR",
    externalSend: false,
  });
  const payload2 = repository.buildGmailDraftPayload(actor, conversationId);
  assert.equal(payload2.gmailDraftId, created.id, "Gmail Draft update must reuse same id");
  const updated = await gmailSource.createOrUpdateDraft({
    gmailDraftId: payload2.gmailDraftId,
    to: payload2.recipient,
    subject: payload2.subject,
    bodyText: payload2.bodyText,
    threadId: payload2.gmailThreadId,
  });
  repository.recordGmailDraft(actor, conversationId, {
    pendingReplyId: payload2.pendingReplyId,
    gmailDraftId: updated.id,
    gmailThreadId: updated.threadId ?? payload2.gmailThreadId,
    recipient: payload2.recipient,
    subject: payload2.subject,
    bodyHash: payload2.bodyHash,
    status: "BORRADOR_GMAIL_ACTUALIZADO",
  });
  assert.equal(updated.id, created.id, "Gmail Draft update must not duplicate");
  await assertGmailDraftBody(config, updated.id, payload2.bodyText);

  const confirmation = buildConfirmation({
    conversationId,
    pendingReplyId: payload2.pendingReplyId,
    gmailDraftId: updated.id,
    recipient: payload2.recipient,
    subject: payload2.subject,
    bodyHash: payload2.bodyHash,
  });
  const previousMode = process.env.AMAZON_MESSAGES_OUTBOUND_MODE;
  process.env.AMAZON_MESSAGES_OUTBOUND_MODE = "manual_send";
  const finalized = await callFinalizeMockRoute(conversationId, confirmation);
  assert.equal(finalized.statusCode, 200);
  assert.equal(finalized.body.status, "SENT_MOCK");
  assert.ok(finalized.body.mockMessageId, "mock finalization must include mock message id");

  const idempotent = await callFinalizeMockRoute(conversationId, confirmation);
  assert.equal(idempotent.statusCode, 200);
  assert.equal(idempotent.body.finalizationId, finalized.body.finalizationId);

  const doubleClick = await callFinalizeMockRoute(conversationId, {
    ...confirmation,
    idempotencyKey: `${confirmation.idempotencyKey}-second`,
  });
  assert.equal(doubleClick.statusCode, 400);
  assert.match(doubleClick.body.message, /Doble envio bloqueado/);

  if (previousMode === undefined) {
    delete process.env.AMAZON_MESSAGES_OUTBOUND_MODE;
  } else {
    process.env.AMAZON_MESSAGES_OUTBOUND_MODE = previousMode;
  }

  const detail = await repository.getConversation(actor, conversationId);
  const pendingReply = repository.getPendingReply(actor, conversationId);
  const audit = detail.auditLogs.filter((event) =>
    event.eventType.startsWith("manual_send_mock_"),
  );
  assert.equal(pendingReply.status, "SENT_MOCK");
  assert.equal(detail.conversation.workflowStatus, "CERRADO");
  assert.ok(audit.length >= 3, "manual_send_mock audit trail must be complete");

  const sentMatches = await searchGmailSent(config, payload2.recipient, payload2.subject);
  assert.equal(sentMatches, 0, "Gmail Sent must not contain the validation draft");

  await deleteGmailDraft(config, updated.id);
  createdDraftId = "";

  console.log(
    JSON.stringify(
      {
        ok: true,
        account: config.account,
        conversationId,
        gmailDraftId: updated.id,
        createdAndUpdatedSameDraft: updated.id === created.id,
        finalizationId: finalized.body.finalizationId,
        finalStatus: finalized.body.status,
        idempotencyKey: confirmation.idempotencyKey,
        duplicateBlocked: doubleClick.body.message,
        pendingReplyStatus: pendingReply.status,
        workflowStatus: detail.conversation.workflowStatus,
        auditEvents: audit.map((event) => event.eventType),
        sentMatches,
        draftCleanedUp: true,
        note: "No real final-delivery API was called.",
      },
      null,
      2,
    ),
  );
} finally {
  if (createdDraftId) {
    await deleteGmailDraft(config, createdDraftId).catch(() => undefined);
  }
  rmSync(tempDir, { recursive: true, force: true });
}

process.exit(0);

function buildConfirmation(input: {
  conversationId: string;
  pendingReplyId: string;
  gmailDraftId: string;
  recipient: string;
  subject: string;
  bodyHash: string;
}): ManualSendMockConfirmation {
  return {
    ...input,
    confirmFinalSendMock: true,
    idempotencyKey: `manual-send-mock-${Date.now()}`,
    externalSend: false,
  };
}

async function callFinalizeMockRoute(
  conversationId: string,
  body: ManualSendMockConfirmation,
) {
  let handler:
    | ((request: EventEmitter & { method: string; url: string; headers: object }, response: MockResponse) => void)
    | undefined;
  registerAmazonMessagesRoutes(
    {
      middlewares: {
        use(_path, registered) {
          handler = registered;
        },
      },
    },
    {
      getSessionUser() {
        return {
          id: actor.id,
          name: actor.name,
          role: "admin",
          permissions: ["amazonMessagesSendFinal"],
        };
      },
    },
    { dataDir: tempDir },
  );
  assert.ok(handler, "route handler should be registered");
  const request = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: object;
  };
  request.method = "POST";
  request.url = `/conversations/${conversationId}/finalize-mock`;
  request.headers = {};
  const response = new MockResponse();
  const done = response.done;
  handler!(request, response);
  request.emit("data", Buffer.from(JSON.stringify(body)));
  request.emit("end");
  await done;
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
}

async function assertGmailDraftBody(
  config: ReturnType<typeof gmailDraftConfigFromEnv>,
  draftId: string,
  expectedBody: string,
) {
  const accessToken = await getAccessToken(config);
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  assert.equal(response.ok, true, `Gmail draft ${draftId} must be readable`);
  const payload = (await response.json()) as {
    id?: string;
    message?: { payload?: { body?: { data?: string } } };
  };
  assert.equal(payload.id, draftId);
  const body = decodeBase64Url(payload.message?.payload?.body?.data ?? "");
  assert.equal(body, expectedBody);
}

async function searchGmailSent(
  config: ReturnType<typeof gmailDraftConfigFromEnv>,
  recipient: string,
  subject: string,
) {
  const accessToken = await getAccessToken(config);
  const query = new URLSearchParams({
    q: `in:sent to:${recipient} subject:"${subject}" newer_than:1d`,
    maxResults: "10",
  });
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  assert.equal(response.ok, true, "Gmail Sent search must be readable");
  const payload = (await response.json()) as { messages?: unknown[] };
  return payload.messages?.length ?? 0;
}

async function deleteGmailDraft(
  config: ReturnType<typeof gmailDraftConfigFromEnv>,
  draftId: string,
) {
  const accessToken = await getAccessToken(config);
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  assert.equal(response.ok, true, `Gmail draft ${draftId} cleanup must succeed`);
}

async function getAccessToken(config: ReturnType<typeof gmailDraftConfigFromEnv>) {
  const body = new URLSearchParams({
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
    refresh_token: config.refreshToken!,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "OAuth token refresh failed");
  }
  return payload.access_token;
}

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
