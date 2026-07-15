import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
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

if (process.env.RUN_REAL_GMAIL_SEND_VALIDATION !== "true") {
  throw new Error("RUN_REAL_GMAIL_SEND_VALIDATION=true is required.");
}

const recipient = process.env.AMAZON_MESSAGES_FINAL_SEND_TEST_RECIPIENT;
const allowlist = (process.env.AMAZON_MESSAGES_FINAL_SEND_ALLOWED_RECIPIENTS ?? "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
assert.equal(recipient, "rafitalxx@gmail.com");
assert.ok(allowlist.includes(recipient.toLowerCase()));

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

const tempDir = mkdtempSync(join(tmpdir(), "amazon-final-send-real-"));
const repository = createAmazonMessagesRepository({ dataDir: tempDir });
const actor: AmazonMessagesActor = {
  id: "real-final-send-validation",
  name: "Real Final Send Validation",
  role: "ADMIN",
  permissions: ["amazonMessagesSendFinal"],
};
const unique = new Date().toISOString().replace(/[:.]/g, "-");
const subject = `VALIDACION TECNICA MANUAL_SEND - PRUEBA CONTROLADA ${unique}`;
const bodyText = [
  "VALIDACION TECNICA MANUAL_SEND - PRUEBA CONTROLADA",
  "",
  `Fecha: ${new Date().toISOString()}`,
  "Destinatario controlado autorizado: rafitalxx@gmail.com",
  "Este mensaje valida users.drafts.send desde un Gmail Draft existente.",
].join("\n");
let draftId = "";

try {
  const beforeSent = await searchGmailSent(config, recipient, subject);
  assert.equal(beforeSent, 0, "validation subject must be unique in Sent before running");

  const conversationId = repository.listConversations(actor)[0].conversationId;
  const draft = repository.createInternalDraft(actor, conversationId, {
    draftBody: bodyText,
    status: "LISTO_PARA_REVISAR",
    source: "Gmail readonly",
    externalSend: false,
  });
  repository.reviewInternalDraft(actor, conversationId, {
    status: "APROBADO_MANUALMENTE",
    reviewNotes: "Validacion real controlada autorizada por Rafa.",
    externalSend: false,
  });
  const pendingReply = repository.preparePendingReply(actor, conversationId, {
    draftId: draft.draftId,
    replyBody: bodyText,
    status: "APROBADA_PARA_BORRADOR",
    externalSend: false,
  });

  const gmailDraft = await createGmailApiDraftSource(config).createOrUpdateDraft({
    to: recipient,
    subject,
    bodyText,
  });
  draftId = gmailDraft.id;
  const bodyHash = sha256(bodyText);
  repository.recordGmailDraft(actor, conversationId, {
    pendingReplyId: pendingReply.pendingReplyId,
    gmailDraftId: gmailDraft.id,
    gmailThreadId: gmailDraft.threadId,
    recipient,
    subject,
    bodyHash,
    status: "BORRADOR_GMAIL_CREADO",
  });
  await assertGmailDraftExists(config, gmailDraft.id);

  const confirmation: ManualSendMockConfirmation = {
    conversationId,
    pendingReplyId: pendingReply.pendingReplyId,
    gmailDraftId: gmailDraft.id,
    recipient,
    subject,
    bodyHash,
    confirmFinalSendMock: true,
    idempotencyKey: `real-final-send-${unique}`,
    externalSend: false,
  };

  const previousMode = process.env.AMAZON_MESSAGES_OUTBOUND_MODE;
  process.env.AMAZON_MESSAGES_OUTBOUND_MODE = "manual_send";
  const sent = await callFinalizeRoute(conversationId, confirmation);
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.status, "SENT");
  assert.ok(sent.body.sentMessageId, "sentMessageId must be recorded");
  const sentMessageId = sent.body.sentMessageId as string;

  const idempotent = await callFinalizeRoute(conversationId, confirmation);
  assert.equal(idempotent.statusCode, 200);
  assert.equal(idempotent.body.sentMessageId, sentMessageId);

  if (previousMode === undefined) {
    delete process.env.AMAZON_MESSAGES_OUTBOUND_MODE;
  } else {
    process.env.AMAZON_MESSAGES_OUTBOUND_MODE = previousMode;
  }

  const draftGone = await gmailDraftExists(config, gmailDraft.id);
  assert.equal(draftGone, false, "sent draft should disappear from Drafts");
  const afterSent = await searchGmailSent(config, recipient, subject);
  assert.equal(afterSent, 1, "sent validation message should appear once in Sent");
  draftId = "";

  const detail = await repository.getConversation(actor, conversationId);
  const finalRecord = repository
    .readStoreForTests()
    .manualSendMockFinalizations.find(
      (item) => item.sentMessageId === sentMessageId,
    );
  assert.ok(finalRecord, "final record with sentMessageId must be persisted");
  assert.equal(detail.conversation.workflowStatus, "RESUELTO");

  console.log(
    JSON.stringify(
      {
        ok: true,
        account: config.account,
        recipient,
        conversationId,
        draftId: gmailDraft.id,
        sentMessageId,
        idempotentSentMessageId: idempotent.body.sentMessageId,
        idempotencyPreventedRepeat:
          idempotent.body.finalizationId === sent.body.finalizationId,
        draftDisappeared: !draftGone,
        sentMatches: afterSent,
        subject,
        workflowStatus: detail.conversation.workflowStatus,
        pendingReplyStatus: repository.getPendingReply(actor, conversationId).status,
        note: "Real validation used users.drafts.send once for an allowlisted test recipient.",
      },
      null,
      2,
    ),
  );
} finally {
  if (draftId) {
    await deleteGmailDraft(config, draftId).catch(() => undefined);
  }
  rmSync(tempDir, { recursive: true, force: true });
}

process.exit(0);

async function callFinalizeRoute(
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
  request.url = `/conversations/${conversationId}/finalize`;
  request.headers = {};
  const response = new MockResponse();
  const done = response.done;
  handler!(request, response);
  request.emit("data", Buffer.from(JSON.stringify(body)));
  request.emit("end");
  await done;
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
}

async function assertGmailDraftExists(
  config: ReturnType<typeof gmailDraftConfigFromEnv>,
  id: string,
) {
  assert.equal(await gmailDraftExists(config, id), true);
}

async function gmailDraftExists(
  config: ReturnType<typeof gmailDraftConfigFromEnv>,
  id: string,
) {
  const accessToken = await getAccessToken(config);
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 404) return false;
  assert.equal(response.ok, true, `Gmail draft lookup failed for ${id}`);
  return true;
}

async function searchGmailSent(
  config: ReturnType<typeof gmailDraftConfigFromEnv>,
  to: string,
  mailSubject: string,
) {
  const accessToken = await getAccessToken(config);
  const query = new URLSearchParams({
    q: `in:sent to:${to} subject:"${mailSubject}" newer_than:1d`,
    maxResults: "10",
  });
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  assert.equal(response.ok, true, "Gmail Sent search failed");
  const payload = (await response.json()) as { messages?: unknown[] };
  return payload.messages?.length ?? 0;
}

async function deleteGmailDraft(
  config: ReturnType<typeof gmailDraftConfigFromEnv>,
  id: string,
) {
  const accessToken = await getAccessToken(config);
  await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
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

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
