import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAmazonMessagesRepository } from "../backend/amazonMessages/repository.ts";
import type { AmazonMessagesActor } from "../backend/amazonMessages/schema.ts";

const tempDir = mkdtempSync(join(tmpdir(), "amazon-agent-draft-auto-"));
const syncActor: AmazonMessagesActor = {
  id: "gmail-sync-test",
  name: "Gmail Sync Test",
  role: "ADMIN",
};
const agentActor: AmazonMessagesActor = {
  id: "agent-test",
  name: "Agent Test",
  role: "AGENTE_IA",
  permissions: ["amazonMessages:manage", "amazonMessages:aiDraft"],
};

try {
  const repository = createAmazonMessagesRepository({
    dataDir: tempDir,
    resolveOrderContext: async () => undefined,
  });
  const imported = await repository.importGmailMessage(syncActor, {
    gmailMessageId: "gmail-customer-auto-1",
    rawEmail: `Message-ID: <customer-auto-1@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
From: Cliente <buyer-auto@marketplace.amazon.es>
To: TodoElectrico <juanitoopenclaw@gmail.com>
Subject: Pedido no recibido (Pedido: 403-1234567-1234567)
Date: Wed, 09 Sep 2026 18:00:00 +0200

Hola, mi pedido todavía no ha llegado. ¿Podéis revisarlo?`,
  });
  assert.ok(imported.conversationId);

  const pending = repository.readStoreForTests().draftRequests.at(-1);
  assert.equal(pending?.status, "PENDING");
  assert.equal(pending?.trigger, "AUTO_GMAIL");
  assert.equal(pending?.gmailMessageId, "gmail-customer-auto-1");

  const claimed = repository.claimNextHermesDraftRequest(agentActor);
  assert.equal(claimed?.requestId, pending?.requestId);
  assert.equal(claimed?.status, "IN_PROGRESS");

  const completed = repository.completeHermesDraftRequest(
    agentActor,
    claimed!.requestId,
    {
      draftBody: "Hola, estamos revisando el estado del envío y te responderemos con información confirmada.",
      operatorSummary: "Cliente informa de pedido no recibido.",
      customerLanguage: "es",
      confidence: 0.88,
      warnings: ["Validar tracking antes de prometer una solución"],
      externalSend: false,
    },
  );
  assert.equal(completed.request.status, "COMPLETED");
  assert.equal(completed.draft.source, "HERMES_DRAFT");
  assert.equal(completed.draft.externalSend, false);

  const detail = await repository.getConversation(
    syncActor,
    imported.conversationId!,
  );
  assert.equal(detail.draftRequests[0].status, "COMPLETED");
  assert.equal(repository.getInternalDraft(syncActor, imported.conversationId!).draftBody, completed.draft.draftBody);
  console.log("Amazon automatic agent draft workflow tests passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
