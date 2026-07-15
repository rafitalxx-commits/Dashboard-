import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGmailApiDraftSource,
  gmailDraftConfigFromEnv,
} from "../backend/amazonMessages/gmailClient.ts";
import { syncAmazonMessagesFromGmail } from "../backend/amazonMessages/gmailSync.ts";
import {
  createAmazonMessagesRepository,
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

if (process.env.RUN_REAL_GMAIL_DRAFT_VALIDATION !== "true") {
  throw new Error(
    "Set RUN_REAL_GMAIL_DRAFT_VALIDATION=true to create/update a real Gmail draft.",
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

const tempDir = mkdtempSync(join(tmpdir(), "amazon-gmail-draft-real-"));
const repository = createAmazonMessagesRepository({ dataDir: tempDir });
const actor: AmazonMessagesActor = {
  id: "draft-real-validation",
  name: "Draft Real Validation",
  role: "ADMIN",
};

const unique = new Date().toISOString().replace(/[:.]/g, "-");
const relayRecipient =
  process.env.AMAZON_MESSAGES_GMAIL_DRAFT_TEST_RECIPIENT ??
  `buyer-${unique}@marketplace.amazon.test`;
const subject = `Amazon Messages draft_only validation ${unique}`;

try {
  const sync = await syncAmazonMessagesFromGmail(repository, actor, {
    trigger: "manual",
    config: {
      account: config.account,
      labelName: "AmazonSeller",
      clientId: "not-used",
      clientSecret: "not-used",
      refreshToken: "not-used",
      maxMessages: 1,
    },
    source: {
      async listLabelMessages() {
        return {
          labelId: "Label_AmazonSeller_LocalValidation",
          messages: [
            {
              id: `gmail-draft-validation-${unique}`,
              threadId: `thread-draft-validation-${unique}`,
              historyId: `history-draft-validation-${unique}`,
              rawEmail: [
                `From: Comprador Amazon <${relayRecipient}>`,
                `To: ${config.account}`,
                `Subject: ${subject}`,
                "Date: Sat, 27 Jun 2026 17:00:00 +0200",
                `Message-ID: <draft-validation-${unique}@example.test>`,
                "X-Amazon-Marketplace: Amazon ES",
                "X-Space-Notification-Type: BUYER_MESSAGE",
                "",
                "Mensaje de validacion local para crear un borrador Gmail real desde PendingReply aprobado.",
              ].join("\n"),
            },
          ],
        };
      },
    },
  });
  assert.equal(sync.ok, true, "local sync fixture must import successfully");

  const conversationId = repository
    .listConversations(actor)
    .find((item) => item.conversationId.includes("draft-validation"))!
    .conversationId;

  const draft = repository.createInternalDraft(actor, conversationId, {
    draftBody: `Respuesta de validacion draft_only ${unique}.\n\nNo debe salir como respuesta externa.`,
    status: "LISTO_PARA_REVISAR",
    source: "Gmail readonly",
    externalSend: false,
  });
  repository.reviewInternalDraft(actor, conversationId, {
    status: "APROBADO_MANUALMENTE",
    reviewNotes: "Validacion controlada de draft_only.",
    externalSend: false,
  });
  repository.preparePendingReply(actor, conversationId, {
    draftId: draft.draftId,
    status: "PENDIENTE_VALIDACION",
    externalSend: false,
  });
  repository.reviewPendingReply(actor, conversationId, {
    status: "APROBADA_PARA_BORRADOR",
    validationNotes: "Aprobada para crear borrador Gmail real.",
    externalSend: false,
  });

  const source = createGmailApiDraftSource(config);
  const payload1 = repository.buildGmailDraftPayload(actor, conversationId);
  const created = await source.createOrUpdateDraft({
    to: payload1.recipient,
    subject: payload1.subject,
    bodyText: payload1.bodyText,
  });
  repository.recordGmailDraft(actor, conversationId, {
    pendingReplyId: payload1.pendingReplyId,
    gmailDraftId: created.id,
    gmailThreadId: created.threadId ?? payload1.gmailThreadId,
    recipient: payload1.recipient,
    subject: payload1.subject,
    bodyHash: payload1.bodyHash,
    status: "BORRADOR_GMAIL_CREADO",
  });
  assert.ok(created.id, "real Gmail draft id must be returned");
  await assertGmailDraftExists(config, created.id);

  repository.updatePendingReply(actor, conversationId, {
    replyBody: `${payload1.bodyText}\n\nActualizacion validada ${unique}.`,
    status: "APROBADA_PARA_BORRADOR",
    externalSend: false,
  });
  const payload2 = repository.buildGmailDraftPayload(actor, conversationId);
  assert.equal(payload2.gmailDraftId, created.id, "update must reuse same draft id");
  const updated = await source.createOrUpdateDraft({
    gmailDraftId: payload2.gmailDraftId,
    to: payload2.recipient,
    subject: payload2.subject,
    bodyText: payload2.bodyText,
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
  assert.equal(updated.id, created.id, "updating must not create a duplicate draft");
  await assertGmailDraftExists(config, updated.id);

  const manualSend = await callGmailDraftRouteInMode("manual_send", conversationId);
  assert.equal(manualSend.statusCode, 400);
  assert.match(manualSend.body.message, /manual_send no implementado/);

  const disabled = await callGmailDraftRouteInMode("disabled", conversationId);
  assert.equal(disabled.statusCode, 400);
  assert.match(disabled.body.message, /disabled/);

  console.log(
    JSON.stringify(
      {
        ok: true,
        account: config.account,
        conversationId,
        gmailDraftId: updated.id,
        createdAndUpdatedSameDraft: updated.id === created.id,
        manualSend: manualSend.body.message,
        disabled: disabled.body.message,
        note: "No send endpoint is called by this validation script.",
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

process.exit(0);

async function assertGmailDraftExists(
  config: ReturnType<typeof gmailDraftConfigFromEnv>,
  draftId: string,
) {
  const accessToken = await getAccessToken(config);
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  assert.equal(response.ok, true, `Gmail draft ${draftId} must be readable`);
  const payload = (await response.json()) as { id?: string; message?: { id?: string } };
  assert.equal(payload.id, draftId, "Gmail draft id must match");
  assert.ok(payload.message?.id, "Gmail draft must contain a message id");
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

async function callGmailDraftRouteInMode(mode: string, conversationId: string) {
  const previousMode = process.env.AMAZON_MESSAGES_OUTBOUND_MODE;
  process.env.AMAZON_MESSAGES_OUTBOUND_MODE = mode;
  try {
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
            role: actor.role,
            permissions: [],
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
    request.url = `/conversations/${conversationId}/gmail-draft`;
    request.headers = {};
    const response = new MockResponse();
    const done = response.done;
    handler!(request, response);
    request.emit(
      "data",
      Buffer.from(JSON.stringify({ confirmDraftOnly: true, externalSend: false })),
    );
    request.emit("end");
    await done;
    return { statusCode: response.statusCode, body: JSON.parse(response.body) };
  } finally {
    if (previousMode === undefined) {
      delete process.env.AMAZON_MESSAGES_OUTBOUND_MODE;
    } else {
      process.env.AMAZON_MESSAGES_OUTBOUND_MODE = previousMode;
    }
  }
}
