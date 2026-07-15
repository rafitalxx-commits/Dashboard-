import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncAmazonMessagesFromGmail } from "../backend/amazonMessages/gmailSync.ts";
import {
  createAmazonMessagesRepository,
  type ManualSendMockConfirmation,
} from "../backend/amazonMessages/repository.ts";
import { registerAmazonMessagesRoutes } from "../backend/amazonMessages/routes.ts";
import type {
  AmazonMessagesActor,
} from "../backend/amazonMessages/schema.ts";
import type { GmailFinalDraftSendSource } from "../backend/amazonMessages/gmailClient.ts";

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

const tempDir = mkdtempSync(join(tmpdir(), "amazon-final-send-"));
const repository = createAmazonMessagesRepository({ dataDir: tempDir });
const actor: AmazonMessagesActor = {
  id: "final-send-test",
  name: "Final Send Test",
  role: "ADMIN",
  permissions: ["amazonMessagesSendFinal"],
};

try {
  const previousMode = process.env.AMAZON_MESSAGES_OUTBOUND_MODE;
  const previousValidation = process.env.RUN_REAL_GMAIL_SEND_VALIDATION;
  const previousAllowlist = process.env.AMAZON_MESSAGES_FINAL_SEND_ALLOWED_RECIPIENTS;
  process.env.AMAZON_MESSAGES_OUTBOUND_MODE = "manual_send";
  delete process.env.RUN_REAL_GMAIL_SEND_VALIDATION;
  delete process.env.AMAZON_MESSAGES_FINAL_SEND_ALLOWED_RECIPIENTS;

  let sourceCalls = 0;
  const mockSource: GmailFinalDraftSendSource = {
    async sendExistingDraft(input) {
      sourceCalls += 1;
      assert.ok(input.gmailDraftId.startsWith("gmail-draft-"));
      return {
        draftId: input.gmailDraftId,
        sentMessageId: `sent-message-${sourceCalls}`,
      };
    },
  };

  const ready = await prepareReadyConversation("success");
  const sent = await callFinalizeRoute(
    ready.conversationId,
    buildConfirmation(ready, "idem-final-success"),
    mockSource,
  );
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.body.status, "SENT");
  assert.equal(sent.body.sentMessageId, "sent-message-1");
  assert.equal(sourceCalls, 1);
  const sentDetail = await repository.getConversation(actor, ready.conversationId);
  assert.equal(sentDetail.conversation.workflowStatus, "RESUELTO");
  assert.ok(
    sentDetail.conversation.workflowHistory.some(
      (event) => event.newStatus === "RESUELTO",
    ),
    "final send should append resolved workflow history",
  );

  const repeated = await callFinalizeRoute(
    ready.conversationId,
    buildConfirmation(ready, "idem-final-success"),
    mockSource,
  );
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.body.finalizationId, sent.body.finalizationId);
  assert.equal(sourceCalls, 1, "same idempotency key must not call Gmail twice");

  const duplicate = await callFinalizeRoute(
    ready.conversationId,
    buildConfirmation(ready, "idem-final-duplicate"),
    mockSource,
  );
  assert.equal(duplicate.statusCode, 400);
  assert.match(duplicate.body.message, /Doble envio bloqueado/);
  assert.equal(sourceCalls, 1);

  const noPermissionReady = await prepareReadyConversation("no-permission");
  const noPermission = await callFinalizeRoute(
    noPermissionReady.conversationId,
    buildConfirmation(noPermissionReady, "idem-no-permission"),
    mockSource,
    [],
  );
  assert.equal(noPermission.statusCode, 403);
  assert.match(noPermission.body.message, /amazonMessagesSendFinal/);

  const noConfirmation = await prepareReadyConversation("no-confirmation");
  const noConfirmationResult = await callFinalizeRoute(
    noConfirmation.conversationId,
    {
      ...buildConfirmation(noConfirmation, "idem-no-confirmation"),
      confirmFinalSendMock: false,
    },
    mockSource,
  );
  assert.equal(noConfirmationResult.statusCode, 400);
  assert.match(noConfirmationResult.body.message, /Confirmacion final requerida/);

  const hashMismatch = await prepareReadyConversation("hash-mismatch");
  const hashMismatchResult = await callFinalizeRoute(
    hashMismatch.conversationId,
    {
      ...buildConfirmation(hashMismatch, "idem-hash-mismatch"),
      bodyHash: "different",
    },
    mockSource,
  );
  assert.equal(hashMismatchResult.statusCode, 400);
  assert.match(hashMismatchResult.body.message, /bodyHash distinto/);

  const missingDraft = await preparePendingWithoutGmailDraft("missing-draft");
  const missingDraftResult = await callFinalizeRoute(
    missingDraft.conversationId,
    {
      ...missingDraft,
      gmailDraftId: "missing-draft",
      recipient: "buyer-missing@marketplace.amazon.es",
      subject: "Re: Pedido Amazon missing",
      bodyHash: "missing",
      confirmFinalSendMock: true,
      idempotencyKey: "idem-missing-draft",
      externalSend: false,
    },
    mockSource,
  );
  assert.equal(missingDraftResult.statusCode, 400);
  assert.match(missingDraftResult.body.message, /No existe Gmail Draft|GmailDraftLink/);

  const wrongMode = await prepareReadyConversation("wrong-mode");
  process.env.AMAZON_MESSAGES_OUTBOUND_MODE = "draft_only";
  const wrongModeResult = await callFinalizeRoute(
    wrongMode.conversationId,
    buildConfirmation(wrongMode, "idem-wrong-mode"),
    mockSource,
  );
  assert.equal(wrongModeResult.statusCode, 400);
  assert.match(wrongModeResult.body.message, /requiere manual_send/);
  process.env.AMAZON_MESSAGES_OUTBOUND_MODE = "manual_send";

  const allowlist = await prepareReadyConversation("allowlist");
  process.env.RUN_REAL_GMAIL_SEND_VALIDATION = "true";
  process.env.AMAZON_MESSAGES_FINAL_SEND_ALLOWED_RECIPIENTS = "controlled@example.com";
  const allowlistResult = await callFinalizeRoute(
    allowlist.conversationId,
    buildConfirmation(allowlist, "idem-allowlist"),
    mockSource,
  );
  assert.equal(allowlistResult.statusCode, 400);
  assert.match(allowlistResult.body.message, /allowlist/);
  delete process.env.RUN_REAL_GMAIL_SEND_VALIDATION;
  delete process.env.AMAZON_MESSAGES_FINAL_SEND_ALLOWED_RECIPIENTS;

  const failure = await prepareReadyConversation("failure");
  const failingSource: GmailFinalDraftSendSource = {
    async sendExistingDraft() {
      throw new Error("mock Gmail draft failure");
    },
  };
  const failureResult = await callFinalizeRoute(
    failure.conversationId,
    buildConfirmation(failure, "idem-failure"),
    failingSource,
  );
  assert.equal(failureResult.statusCode, 400);
  assert.match(failureResult.body.message, /mock Gmail draft failure/);
  const failureDetail = await repository.getConversation(actor, failure.conversationId);
  assert.notEqual(failureDetail.conversation.workflowStatus, "CERRADO");
  assert.equal(repository.getPendingReply(actor, failure.conversationId).status, "SEND_FAILED");

  const store = repository.readStoreForTests();
  assert.ok(
    store.auditLogs.some((event) => event.eventType === "final_gmail_draft_sent"),
    "sent finalization should be audited",
  );
  assert.ok(
    store.auditLogs.some(
      (event) =>
        event.eventType === "conversation_workflow_changed" &&
        event.detail.includes("RESUELTO"),
    ),
    "final send should audit resolved workflow transition",
  );
  assert.ok(
    store.auditLogs.some((event) => event.eventType === "final_gmail_draft_failed"),
    "failed finalization should be audited",
  );

  if (previousMode === undefined) delete process.env.AMAZON_MESSAGES_OUTBOUND_MODE;
  else process.env.AMAZON_MESSAGES_OUTBOUND_MODE = previousMode;
  if (previousValidation === undefined) delete process.env.RUN_REAL_GMAIL_SEND_VALIDATION;
  else process.env.RUN_REAL_GMAIL_SEND_VALIDATION = previousValidation;
  if (previousAllowlist === undefined) {
    delete process.env.AMAZON_MESSAGES_FINAL_SEND_ALLOWED_RECIPIENTS;
  } else {
    process.env.AMAZON_MESSAGES_FINAL_SEND_ALLOWED_RECIPIENTS = previousAllowlist;
  }

  console.log("Amazon final Gmail draft send tests passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

process.exit(0);

async function prepareReadyConversation(suffix: string) {
  const conversationId = await createFixtureConversation(suffix);
  const draft = repository.createInternalDraft(actor, conversationId, {
    draftBody: `Respuesta final segura ${suffix}.`,
    status: "LISTO_PARA_REVISAR",
    source: "Gmail readonly",
    externalSend: false,
  });
  repository.reviewInternalDraft(actor, conversationId, {
    status: "APROBADO_MANUALMENTE",
    externalSend: false,
  });
  repository.preparePendingReply(actor, conversationId, {
    draftId: draft.draftId,
    status: "APROBADA_PARA_BORRADOR",
    externalSend: false,
  });
  const payload = repository.buildGmailDraftPayload(actor, conversationId);
  const recorded = repository.recordGmailDraft(actor, conversationId, {
    pendingReplyId: payload.pendingReplyId,
    gmailDraftId: `gmail-draft-${suffix}`,
    gmailThreadId: payload.gmailThreadId,
    recipient: payload.recipient,
    subject: payload.subject,
    bodyHash: payload.bodyHash,
    status: "BORRADOR_GMAIL_CREADO",
  });
  return {
    conversationId,
    pendingReplyId: payload.pendingReplyId,
    gmailDraftId: recorded.gmailDraftLink.gmailDraftId,
    recipient: recorded.gmailDraftLink.recipient,
    subject: recorded.gmailDraftLink.subject,
    bodyHash: recorded.gmailDraftLink.bodyHash,
  };
}

async function preparePendingWithoutGmailDraft(suffix: string) {
  const conversationId = await createFixtureConversation(suffix);
  const draft = repository.createInternalDraft(actor, conversationId, {
    draftBody: `Respuesta sin draft ${suffix}.`,
    status: "LISTO_PARA_REVISAR",
    source: "Gmail readonly",
    externalSend: false,
  });
  repository.reviewInternalDraft(actor, conversationId, {
    status: "APROBADO_MANUALMENTE",
    externalSend: false,
  });
  const pendingReply = repository.preparePendingReply(actor, conversationId, {
    draftId: draft.draftId,
    status: "APROBADA_PARA_BORRADOR",
    externalSend: false,
  });
  return {
    conversationId,
    pendingReplyId: pendingReply.pendingReplyId,
  };
}

async function createFixtureConversation(suffix: string) {
  const unique = `${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await syncAmazonMessagesFromGmail(repository, actor, {
    trigger: "manual",
    config: {
      account: "juanitoopenclaw@gmail.com",
      labelName: "AmazonSeller",
      clientId: "not-used",
      clientSecret: "not-used",
      refreshToken: "not-used",
      maxMessages: 1,
    },
    source: {
      async listLabelMessages() {
        return {
          labelId: "Label_AmazonSeller_FinalSend",
          messages: [
            {
              id: `gmail-${unique}`,
              threadId: `thread-${unique}`,
              historyId: `history-${unique}`,
              rawEmail: [
                `From: Comprador Amazon <buyer-${unique}@marketplace.amazon.es>`,
                "To: juanitoopenclaw@gmail.com",
                `Subject: Amazon final draft ${unique}`,
                "Date: Sun, 28 Jun 2026 18:00:00 +0200",
                `Message-ID: <${unique}@example.test>`,
                "X-Amazon-Marketplace: Amazon ES",
                "X-Space-Notification-Type: BUYER_MESSAGE",
                "",
                "Ha recibido un mensaje.",
                "# 400-0000000-0000:",
                "------------- Message:  -------------",
                `Mensaje comprador para final draft ${unique}.`,
                "------------- Finalizar mensaje -------------",
              ].join("\n"),
            },
          ],
        };
      },
    },
  });
  return repository
    .listConversations(actor)
    .find((item) => item.conversationId.includes(`thread-${suffix}`))!
    .conversationId;
}

function buildConfirmation(
  prepared: {
    conversationId: string;
    pendingReplyId: string;
    gmailDraftId: string;
    recipient: string;
    subject: string;
    bodyHash: string;
  },
  idempotencyKey: string,
): ManualSendMockConfirmation {
  return {
    conversationId: prepared.conversationId,
    pendingReplyId: prepared.pendingReplyId,
    gmailDraftId: prepared.gmailDraftId,
    recipient: prepared.recipient,
    subject: prepared.subject,
    bodyHash: prepared.bodyHash,
    confirmFinalSendMock: true,
    idempotencyKey,
    externalSend: false,
  };
}

async function callFinalizeRoute(
  conversationId: string,
  body: ManualSendMockConfirmation,
  finalDraftSendSource: GmailFinalDraftSendSource,
  permissions = ["amazonMessagesSendFinal"],
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
          permissions,
        };
      },
    },
    { dataDir: tempDir, finalDraftSendSource },
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
