import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createAmazonMessagesRepository,
  type ManualSendMockConfirmation,
} from "../backend/amazonMessages/repository.ts";
import { registerAmazonMessagesRoutes } from "../backend/amazonMessages/routes.ts";
import { syncAmazonMessagesFromGmail } from "../backend/amazonMessages/gmailSync.ts";
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

const tempDir = mkdtempSync(join(tmpdir(), "amazon-manual-send-mock-"));
const repository = createAmazonMessagesRepository({ dataDir: tempDir });

const finalSender: AmazonMessagesActor = {
  id: "final-sender-test",
  name: "Final Sender Test",
  role: "ADMIN",
  permissions: ["amazonMessagesSendFinal"],
};
const noFinalPermission: AmazonMessagesActor = {
  id: "admin-without-final-send-test",
  name: "Admin Without Final Permission",
  role: "ADMIN",
};

try {
  const prepared = await prepareReadyConversation("mock-main");
  const confirmation = buildConfirmation(prepared, "idem-main-0001");
  const finalization = repository.finalizeManualSendMock(
    finalSender,
    prepared.conversationId,
    confirmation,
  );
  assert.equal(finalization.status, "SENT_MOCK");
  assert.ok(finalization.mockMessageId, "mock service should return a mock message id");

  const repeated = repository.finalizeManualSendMock(
    finalSender,
    prepared.conversationId,
    confirmation,
  );
  assert.equal(repeated.finalizationId, finalization.finalizationId);
  assert.equal(repeated.mockMessageId, finalization.mockMessageId);

  assert.throws(
    () =>
      repository.finalizeManualSendMock(
        finalSender,
        prepared.conversationId,
        buildConfirmation(prepared, "idem-main-0002"),
      ),
    /Doble envio bloqueado/,
    "second idempotency key must not finalize again",
  );

  const noPermission = await prepareReadyConversation("mock-no-permission");
  assert.throws(
    () =>
      repository.finalizeManualSendMock(
        noFinalPermission,
        noPermission.conversationId,
        buildConfirmation(noPermission, "idem-no-permission"),
      ),
    /Permiso insuficiente: amazonMessagesSendFinal/,
    "final mock requires the specific permission",
  );

  const noConfirmation = await prepareReadyConversation("mock-no-confirmation");
  assert.throws(
    () =>
      repository.finalizeManualSendMock(finalSender, noConfirmation.conversationId, {
        ...buildConfirmation(noConfirmation, "idem-no-confirm"),
        confirmFinalSendMock: false,
      }),
    /Confirmacion final manual_send_mock requerida/,
    "strong confirmation is required",
  );

  const bodyHashMismatch = await prepareReadyConversation("mock-bodyhash-mismatch");
  assert.throws(
    () =>
      repository.finalizeManualSendMock(finalSender, bodyHashMismatch.conversationId, {
        ...buildConfirmation(bodyHashMismatch, "idem-bodyhash"),
        bodyHash: "different-body-hash",
      }),
    /bodyHash distinto/,
    "body hash must match PendingReply and Gmail Draft link",
  );

  const missingDraft = await preparePendingWithoutGmailDraft("mock-missing-draft");
  assert.throws(
    () =>
      repository.finalizeManualSendMock(finalSender, missingDraft.conversationId, {
        ...buildConfirmation(
          {
            ...missingDraft,
            gmailDraftId: "missing-draft",
            recipient: "buyer@example.marketplace.amazon.es",
            subject: "Re: Pedido Amazon mock-missing-draft",
            bodyHash: sha256(missingDraft.bodyText),
          },
          "idem-missing-draft",
        ),
      }),
    /No existe Gmail Draft|Gmail Draft registrado no encontrado/,
    "missing Gmail Draft must block final mock",
  );

  const routeMode = await prepareReadyConversation("mock-route-mode");
  const previousMode = process.env.AMAZON_MESSAGES_OUTBOUND_MODE;
  process.env.AMAZON_MESSAGES_OUTBOUND_MODE = "draft_only";
  const modeBlocked = await callFinalizeMockRoute(
    routeMode.conversationId,
    buildConfirmation(routeMode, "idem-route-mode"),
  );
  assert.equal(modeBlocked.statusCode, 400);
  assert.match(modeBlocked.body.message, /manual_send_mock requiere manual_send/);

  process.env.AMAZON_MESSAGES_OUTBOUND_MODE = "manual_send";
  const realDeliveryBlocked = await callFinalizeMockRoute(routeMode.conversationId, {
    ...buildConfirmation(routeMode, "idem-route-real-blocked"),
    externalSend: true as false,
  });
  assert.equal(realDeliveryBlocked.statusCode, 400);
  assert.match(realDeliveryBlocked.body.message, /Envio real bloqueado/);

  const routeOk = await callFinalizeMockRoute(
    routeMode.conversationId,
    buildConfirmation(routeMode, "idem-route-ok-0001"),
  );
  assert.equal(routeOk.statusCode, 200);
  assert.equal(routeOk.body.status, "SENT_MOCK");

  if (previousMode === undefined) {
    delete process.env.AMAZON_MESSAGES_OUTBOUND_MODE;
  } else {
    process.env.AMAZON_MESSAGES_OUTBOUND_MODE = previousMode;
  }

  const store = repository.readStoreForTests();
  assert.ok(
    store.auditLogs.some((event) => event.eventType === "manual_send_mock_sent"),
    "final mock must be audited",
  );
  assert.equal(
    store.conversations.find((item) => item.conversationId === prepared.conversationId)
      ?.workflowStatus,
    "CERRADO",
    "mock finalization should mark the conversation closed/responded",
  );

  console.log("Amazon manual_send_mock tests passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

process.exit(0);

async function prepareReadyConversation(suffix: string) {
  const conversationId = await createFixtureConversation(suffix);
  const draft = repository.createInternalDraft(finalSender, conversationId, {
    draftBody: `Respuesta mock segura ${suffix}.`,
    status: "LISTO_PARA_REVISAR",
    source: "Gmail readonly",
    externalSend: false,
  });
  repository.reviewInternalDraft(finalSender, conversationId, {
    status: "APROBADO_MANUALMENTE",
    reviewNotes: "Aprobado para manual_send_mock.",
    externalSend: false,
  });
  repository.preparePendingReply(finalSender, conversationId, {
    draftId: draft.draftId,
    status: "APROBADA_PARA_BORRADOR",
    externalSend: false,
  });
  repository.reviewPendingReply(finalSender, conversationId, {
    status: "APROBADA_PARA_BORRADOR",
    validationNotes: "Listo para finalizacion mock.",
    externalSend: false,
  });
  const payload = repository.buildGmailDraftPayload(finalSender, conversationId);
  const recorded = repository.recordGmailDraft(finalSender, conversationId, {
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
    bodyText: payload.bodyText,
  };
}

async function preparePendingWithoutGmailDraft(suffix: string) {
  const conversationId = await createFixtureConversation(suffix);
  const draft = repository.createInternalDraft(finalSender, conversationId, {
    draftBody: `Respuesta mock sin draft ${suffix}.`,
    status: "LISTO_PARA_REVISAR",
    source: "Gmail readonly",
    externalSend: false,
  });
  repository.reviewInternalDraft(finalSender, conversationId, {
    status: "APROBADO_MANUALMENTE",
    externalSend: false,
  });
  const pendingReply = repository.preparePendingReply(finalSender, conversationId, {
    draftId: draft.draftId,
    status: "APROBADA_PARA_BORRADOR",
    externalSend: false,
  });
  return {
    conversationId,
    pendingReplyId: pendingReply.pendingReplyId,
    bodyText: pendingReply.replyBody,
  };
}

async function createFixtureConversation(suffix: string) {
  const unique = `${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sync = await syncAmazonMessagesFromGmail(repository, finalSender, {
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
          labelId: "Label_AmazonSeller_ManualSendMock",
          messages: [
            {
              id: `gmail-${unique}`,
              threadId: `thread-${unique}`,
              historyId: `history-${unique}`,
              rawEmail: [
                `From: Comprador Amazon <buyer-${unique}@marketplace.amazon.es>`,
                "To: juanitoopenclaw@gmail.com",
                `Subject: Amazon manual send mock ${unique}`,
                "Date: Sun, 28 Jun 2026 17:00:00 +0200",
                `Message-ID: <${unique}@example.test>`,
                "X-Amazon-Marketplace: Amazon ES",
                "X-Space-Notification-Type: BUYER_MESSAGE",
                "",
                "Ha recibido un mensaje.",
                `# 400-0000000-${suffix.slice(-4).padStart(4, "0")}:`,
                "------------- Message:  -------------",
                `Mensaje comprador para manual_send_mock ${unique}.`,
                "------------- Finalizar mensaje -------------",
              ].join("\n"),
            },
          ],
        };
      },
    },
  });
  assert.equal(sync.ok, true, `fixture sync should import: ${JSON.stringify(sync)}`);
  return repository
    .listConversations(finalSender)
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

async function callFinalizeMockRoute(
  conversationId: string,
  body: ManualSendMockConfirmation & { realDelivery?: boolean },
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
          id: finalSender.id,
          name: finalSender.name,
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

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
