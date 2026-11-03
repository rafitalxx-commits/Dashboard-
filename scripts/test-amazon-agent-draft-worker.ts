import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  processNextAmazonAgentDraft,
  startAmazonAgentDraftWorker,
} from "../backend/amazonMessages/agentDraftWorker.ts";
import { createAmazonMessagesRepository } from "../backend/amazonMessages/repository.ts";
import type { AmazonMessagesActor } from "../backend/amazonMessages/schema.ts";

const actor: AmazonMessagesActor = {
  id: "juanito-worker-test",
  name: "Juanito Worker Test",
  role: "AGENTE_IA",
  permissions: [
    "amazonMessages:read",
    "amazonMessages:manage",
    "amazonMessages:aiDraft",
  ],
};
const syncActor: AmazonMessagesActor = {
  id: "gmail-sync-test",
  name: "Gmail Sync Test",
  role: "ADMIN",
};

const tempDir = mkdtempSync(join(tmpdir(), "amazon-agent-draft-worker-"));
try {
  const repository = createAmazonMessagesRepository({
    dataDir: tempDir,
    resolveOrderContext: async () => undefined,
  });
  const imported = await repository.importGmailMessage(syncActor, {
    gmailMessageId: "gmail-worker-customer-1",
    rawEmail: `Message-ID: <worker-customer-1@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
From: Cliente <buyer-worker@marketplace.amazon.es>
To: TodoElectrico <juanitoopenclaw@gmail.com>
Subject: Pedido no recibido (Pedido: 403-1234567-1234567)
Date: Thu, 10 Sep 2026 07:00:00 +0200

Hola, mi pedido todavía no ha llegado. ¿Podéis revisarlo?`,
  });
  assert.ok(imported.conversationId);

  const result = await processNextAmazonAgentDraft(repository, actor);
  assert.equal(result.processed, true);
  assert.equal(result.status, "COMPLETED");
  const detail = await repository.getConversation(syncActor, imported.conversationId!);
  assert.equal(detail.draftRequests[0].status, "COMPLETED");
  const draft = repository.getInternalDraft(syncActor, imported.conversationId!);
  assert.equal(draft.status, "BORRADOR_INTERNO");
  assert.equal(draft.reviewStatus, "BORRADOR_INTERNO");
  assert.equal(draft.source, "HERMES_DRAFT");
  assert.equal(draft.externalSend, false);
  assert.ok(draft.draftBody.length > 20);
  const store = repository.readStoreForTests();
  assert.equal(store.gmailDraftLinks.length, 0);
  assert.equal(store.manualSendMockFinalizations.length, 0);

  const idle = await processNextAmazonAgentDraft(repository, actor);
  assert.deepEqual(idle, { processed: false, status: "IDLE" });

  await repository.importGmailMessage(syncActor, {
    gmailMessageId: "gmail-worker-customer-2",
    rawEmail: `Message-ID: <worker-customer-2@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
From: Cliente <buyer-worker-2@marketplace.amazon.es>
To: TodoElectrico <juanitoopenclaw@gmail.com>
Subject: Consulta técnica
Date: Thu, 10 Sep 2026 07:01:00 +0200

Hola, necesito confirmar si el producto es compatible con mi instalación.`,
  });
  const worker = startAmazonAgentDraftWorker(repository, actor, {
    enabled: true,
    intervalMs: 1_000,
    runImmediately: true,
  });
  const deadline = Date.now() + 3_000;
  while (
    repository.readStoreForTests().draftRequests.at(-1)?.status !== "COMPLETED" &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  worker.stop();
  assert.equal(
    repository.readStoreForTests().draftRequests.at(-1)?.status,
    "COMPLETED",
  );

  await repository.importGmailMessage(syncActor, {
    gmailMessageId: "gmail-worker-disabled-1",
    rawEmail: `Message-ID: <worker-disabled-1@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
From: Cliente <buyer-worker-disabled@marketplace.amazon.es>
To: TodoElectrico <juanitoopenclaw@gmail.com>
Subject: Consulta pendiente
Date: Thu, 10 Sep 2026 07:02:00 +0200

Hola, necesito ayuda con mi pedido.`,
  });
  const disabledWorker = startAmazonAgentDraftWorker(repository, actor, {
    enabled: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  disabledWorker.stop();
  assert.equal(
    repository.readStoreForTests().draftRequests.at(-1)?.status,
    "PENDING",
  );

  const failureDir = mkdtempSync(join(tmpdir(), "amazon-agent-draft-failure-"));
  try {
    const failingRepository = createAmazonMessagesRepository({
      dataDir: failureDir,
      resolveOrderContext: async () => {
        throw new Error("Fallo de contexto controlado");
      },
    });
    const conversation = failingRepository
      .listConversations(syncActor)
      .find((item) => item.amazonOrderId);
    assert.ok(conversation);
    const request = failingRepository.createHermesDraftRequest(
      actor,
      conversation!.conversationId,
      { externalSend: false },
    );
    const failed = await processNextAmazonAgentDraft(failingRepository, actor);
    assert.equal(failed.status, "FAILED");
    assert.equal(
      failingRepository.getHermesDraftRequest(actor, request.requestId).status,
      "FAILED",
    );
    assert.equal(
      failingRepository.getHermesDraftRequest(actor, request.requestId).externalSend,
      false,
    );
  } finally {
    rmSync(failureDir, { recursive: true, force: true });
  }
  console.log("Amazon agent draft worker tests passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
