import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncAmazonMessagesFromGmail } from "../backend/amazonMessages/gmailSync.ts";
import { createAmazonMessagesRepository } from "../backend/amazonMessages/repository.ts";
import type { AmazonMessagesActor } from "../backend/amazonMessages/schema.ts";

const tempDir = mkdtempSync(join(tmpdir(), "amazon-messages-backend-"));
const repository = createAmazonMessagesRepository({ dataDir: tempDir });

const admin: AmazonMessagesActor = {
  id: "admin-test",
  name: "Admin Test",
  role: "ADMIN",
};
const operator: AmazonMessagesActor = {
  id: "operator-test",
  name: "Operator Test",
  role: "OPERADOR",
};
const reader: AmazonMessagesActor = {
  id: "reader-test",
  name: "Reader Test",
  role: "LECTURA",
};

try {
  const conversations = repository.listConversations(operator);
  assert.ok(conversations.length >= 2, "seed conversations should be persisted");

  const detail = await repository.getConversation(operator, conversations[0].conversationId);
  assert.ok(detail.messages.length >= 1, "conversation detail should include messages");

  const template = repository.createTemplate(operator, {
    name: "Factura interna segura",
    category: "invoice",
    language: "es",
    marketplace: "Amazon ES",
    content: "Hola {cliente}, preparamos la factura del pedido {amazon_order_id}.",
    variables: ["{cliente}", "{amazon_order_id}"],
    externalSend: false,
  });
  assert.equal(template.active, true, "created template should be active");
  assert.equal(template.externalSend, false, "templates must remain internal");

  const classification = repository.addClassification(operator, {
    conversationId: conversations[0].conversationId,
    category: "not_received",
    priority: "high",
    confidence: 0.91,
    source: "operator",
  });
  assert.equal(classification.createdBy, operator.id);

  const assignment = repository.assignConversation(operator, {
    conversationId: conversations[0].conversationId,
    operatorId: "Soporte 2",
    status: "assigned",
    timeSpentMinutes: 4,
  });
  assert.equal(assignment.assignedBy, operator.id);

  const stored = repository.readStoreForTests();
  assert.ok(
    stored.auditLogs.some((event) => event.eventType === "template_created"),
    "template creation should be audited",
  );
  assert.ok(
    stored.auditLogs.some((event) => event.eventType === "classification_changed"),
    "classification changes should be audited",
  );
  assert.ok(
    stored.auditLogs.some((event) => event.eventType === "assignment_changed"),
    "assignment changes should be audited",
  );

  assert.throws(
    () =>
      repository.createTemplate(reader, {
        category: "invoice",
        language: "es",
        marketplace: "Amazon ES",
        content: "No permitido",
      }),
    /Permiso insuficiente/,
    "reader should not create templates",
  );

  const operators = repository.getOperators(admin);
  assert.ok(operators.length >= 1, "supervisor/admin should see operator stats");

  assert.throws(
    () => repository.getOperators(reader),
    /Permiso insuficiente/,
    "reader should not see supervisor stats",
  );

  const stats = repository.getStats(operator);
  assert.ok(stats.summary.totalMessages >= 2, "stats should be available");
  assert.ok(
    stats.summary.workflowNew >= 1,
    "workflow stats should include new conversations",
  );

  const workflowConversationId = conversations[0].conversationId;
  const pendingWorkflow = repository.updateConversationWorkflow(
    operator,
    workflowConversationId,
    {
      workflowStatus: "PENDIENTE_REVISAR",
      externalSend: false,
    },
  );
  assert.equal(pendingWorkflow.workflowStatus, "PENDIENTE_REVISAR");

  const inReviewWorkflow = repository.updateConversationWorkflow(
    operator,
    workflowConversationId,
    {
      workflowStatus: "EN_REVISION",
      externalSend: false,
    },
  );
  assert.equal(inReviewWorkflow.workflowStatus, "EN_REVISION");

  const readyWorkflow = repository.updateConversationWorkflow(
    operator,
    workflowConversationId,
    {
      workflowStatus: "LISTO_PARA_RESPONDER",
      externalSend: false,
    },
  );
  assert.equal(readyWorkflow.workflowStatus, "LISTO_PARA_RESPONDER");

  const resolvedWorkflow = repository.updateConversationWorkflow(
    operator,
    workflowConversationId,
    {
      workflowStatus: "RESUELTO",
      reason: "Caso solucionado en test local",
      externalSend: false,
    },
  );
  assert.equal(resolvedWorkflow.workflowStatus, "RESUELTO");
  assert.equal(resolvedWorkflow.closedAt, undefined);
  assert.ok(
    resolvedWorkflow.workflowHistory.some(
      (event) =>
        event.previousStatus === "LISTO_PARA_RESPONDER" &&
        event.newStatus === "RESUELTO" &&
        event.reason === "Caso solucionado en test local",
    ),
    "workflow history should include resolved transition with reason",
  );

  const reopenedWorkflow = repository.updateConversationWorkflow(
    operator,
    workflowConversationId,
    {
      workflowStatus: "EN_REVISION",
      externalSend: false,
    },
  );
  assert.equal(reopenedWorkflow.workflowStatus, "EN_REVISION");
  assert.equal(reopenedWorkflow.closedAt, undefined);

  repository.updateConversationWorkflow(operator, workflowConversationId, {
    workflowStatus: "LISTO_PARA_RESPONDER",
    externalSend: false,
  });
  repository.updateConversationWorkflow(operator, workflowConversationId, {
    workflowStatus: "RESUELTO",
    externalSend: false,
  });
  const closedWorkflow = repository.updateConversationWorkflow(
    operator,
    workflowConversationId,
    {
      workflowStatus: "CERRADO",
      reason: "Archivo definitivo test",
      externalSend: false,
    },
  );
  assert.equal(closedWorkflow.workflowStatus, "CERRADO");
  assert.ok(closedWorkflow.closedAt, "closed timestamp should be persisted");

  assert.throws(
    () =>
      repository.updateConversationWorkflow(operator, workflowConversationId, {
        workflowStatus: "EN_REVISION",
        externalSend: false,
      }),
    /Confirmacion requerida/,
    "closed conversation must not reopen without confirmation",
  );

  const reopenedClosedWorkflow = repository.updateConversationWorkflow(
    operator,
    workflowConversationId,
    {
      workflowStatus: "EN_REVISION",
      confirmClosedReopen: true,
      reason: "Reabrir cierre en test local",
      externalSend: false,
    },
  );
  assert.equal(reopenedClosedWorkflow.workflowStatus, "EN_REVISION");
  const workflowStatsAfterResolved = repository.getStats(operator).summary;
  assert.ok(
    typeof workflowStatsAfterResolved.workflowResolved === "number",
    "workflow stats should include resolved counter",
  );
  assert.ok(
    typeof workflowStatsAfterResolved.workflowClosed === "number",
    "workflow stats should keep closed counter separate",
  );

  const unreviewedConversationId = conversations[1].conversationId;
  assert.throws(
    () =>
      repository.updateConversationWorkflow(operator, unreviewedConversationId, {
        workflowStatus: "RESUELTO",
        externalSend: false,
      }),
    /mensaje sin revisar/,
    "unreviewed conversation needs confirmation before resolving",
  );
  const confirmedUnreviewedResolved = repository.updateConversationWorkflow(
    operator,
    unreviewedConversationId,
    {
      workflowStatus: "RESUELTO",
      confirmUnreviewed: true,
      reason: "Confirmado manualmente en test local",
      externalSend: false,
    },
  );
  assert.equal(confirmedUnreviewedResolved.workflowStatus, "RESUELTO");

  const workflowAssignment = repository.assignConversationWorkflow(
    operator,
    workflowConversationId,
    {
      assignedUser: "Rafa",
      externalSend: false,
    },
  );
  assert.equal(workflowAssignment.assignedUser, "Rafa");
  assert.ok(workflowAssignment.assignedAt, "assignment timestamp should persist");

  assert.throws(
    () =>
      repository.updateConversationWorkflow(operator, workflowConversationId, {
        workflowStatus: "CERRADO",
        externalSend: true as false,
      }),
    /Envio externo deshabilitado/,
    "workflow must reject externalSend=true",
  );

  const draftConversationId = conversations[0].conversationId;
  const createdDraft = repository.createInternalDraft(operator, draftConversationId, {
    draftBody: "Borrador interno de prueba. No enviar.",
    status: "BORRADOR_INTERNO",
    source: "Gmail readonly",
    externalSend: false,
  });
  assert.equal(createdDraft.externalSend, false);
  assert.equal(createdDraft.status, "BORRADOR_INTERNO");

  const templateDraft = await repository.applyTemplateToInternalDraft(
    operator,
    draftConversationId,
    {
      templateId: template.templateId,
      externalSend: false,
    },
  );
  assert.equal(templateDraft.status, "BORRADOR_INTERNO");
  assert.equal(templateDraft.externalSend, false);
  assert.match(templateDraft.draftBody, /pedido/i);

  const readyDraft = repository.updateInternalDraft(operator, draftConversationId, {
    draftBody: "Borrador listo para revisar. No enviar.",
    status: "LISTO_PARA_REVISAR",
    reviewNotes: "Preparado para supervision.",
    externalSend: false,
  });
  assert.equal(readyDraft.reviewStatus, "LISTO_PARA_REVISAR");

  const approvedDraft = repository.reviewInternalDraft(operator, draftConversationId, {
    status: "APROBADO_MANUALMENTE",
    reviewNotes: "Aprobado manualmente para fase segura.",
    externalSend: false,
  });
  assert.equal(approvedDraft.status, "APROBADO_MANUALMENTE");
  assert.equal(approvedDraft.approvedBy, operator.name);
  assert.ok(approvedDraft.approvedAt, "approval timestamp should be persisted");
  assert.ok(
    approvedDraft.reviewHistory.some(
      (event) =>
        event.previousStatus === "LISTO_PARA_REVISAR" &&
        event.newStatus === "APROBADO_MANUALMENTE",
    ),
    "approval should be in review history",
  );

  const pendingReply = repository.preparePendingReply(operator, draftConversationId, {
    externalSend: false,
  });
  assert.equal(pendingReply.externalSend, false);
  assert.equal(pendingReply.status, "RESPUESTA_PREPARADA");
  assert.equal(pendingReply.draftId, approvedDraft.draftId);
  assert.equal(pendingReply.replyBody, approvedDraft.draftBody);
  assert.equal(pendingReply.source, "APPROVED_INTERNAL_DRAFT");
  assert.equal(pendingReply.channel, "INTERNAL_REPLY_PENDING");
  assert.equal(pendingReply.gmailDraftId, undefined);
  assert.equal(pendingReply.amazonMessageActionId, undefined);

  const updatedPendingReply = repository.updatePendingReply(
    operator,
    draftConversationId,
    {
      replyBody: "Respuesta pendiente editada. Sigue sin enviar.",
      status: "PENDIENTE_VALIDACION",
      validationNotes: "Lista para validacion humana.",
      externalSend: false,
    },
  );
  assert.equal(updatedPendingReply.status, "PENDIENTE_VALIDACION");
  assert.match(updatedPendingReply.replyBody, /Sigue sin enviar/);

  const approvedPendingReply = repository.reviewPendingReply(
    operator,
    draftConversationId,
    {
      status: "APROBADA_PARA_BORRADOR",
      validationNotes: "Aprobada para futura creacion de borrador Gmail, no envio.",
      externalSend: false,
    },
  );
  assert.equal(approvedPendingReply.status, "APROBADA_PARA_BORRADOR");
  assert.equal(approvedPendingReply.approvedBy, operator.name);
  assert.ok(approvedPendingReply.approvedAt, "pending reply approval timestamp should persist");
  assert.ok(
    approvedPendingReply.history.some(
      (event) =>
        event.previousStatus === "PENDIENTE_VALIDACION" &&
        event.newStatus === "APROBADA_PARA_BORRADOR",
    ),
    "pending reply approval should be in history",
  );

  assert.throws(
    () =>
      repository.preparePendingReply(operator, draftConversationId, {
        externalSend: true as false,
      }),
    /Envio externo deshabilitado/,
    "pending reply prepare must reject externalSend=true",
  );

  assert.throws(
    () =>
      repository.updatePendingReply(operator, draftConversationId, {
        replyBody: "No permitido",
        externalSend: true as false,
      }),
    /Envio externo deshabilitado/,
    "pending reply update must reject externalSend=true",
  );

  assert.throws(
    () =>
      repository.reviewPendingReply(operator, draftConversationId, {
        status: "RECHAZADA",
        externalSend: true as false,
      }),
    /Envio externo deshabilitado/,
    "pending reply review must reject externalSend=true",
  );

  assert.equal(
    repository.getPendingReply(reader, draftConversationId).pendingReplyId,
    pendingReply.pendingReplyId,
    "reader can read pending replies through read permission",
  );

  assert.throws(
    () => repository.preparePendingReply(reader, draftConversationId, {}),
    /Permiso insuficiente/,
    "reader must not prepare pending replies",
  );

  assert.throws(
    () => repository.preparePendingReply(operator, conversations[1].conversationId, {}),
    /borrador interno aprobado/,
    "pending reply requires an approved internal draft",
  );

  const knowledgeExample = repository.saveApprovedKnowledgeExample(operator, {
    conversationId: draftConversationId,
    draftId: approvedDraft.draftId,
    templateId: template.templateId,
    category: "factura",
    language: "es",
    amazonOrderId: conversations[0].amazonOrderId,
    originalMessage: detail.messages[0].content,
    initialDraft: "Borrador inicial antes de editar.",
    finalResponse: approvedDraft.draftBody,
    humanDiffSummary: "Rafa aprobo el texto con ajuste de tono.",
    quality: "alta",
    confidence: 0.94,
    tags: ["factura", "aprobado", "amazon"],
    externalSend: false,
  });
  assert.equal(knowledgeExample.templateId, template.templateId);
  assert.equal(knowledgeExample.status, "approved");
  assert.equal(knowledgeExample.externalSend, undefined);
  assert.equal(knowledgeExample.approver, operator.name);
  assert.deepEqual(knowledgeExample.tags, ["factura", "aprobado", "amazon"]);

  const filteredKnowledge = repository.listKnowledge(operator, {
    query: "tono",
    category: "factura",
    language: "es",
    templateId: template.templateId,
    approver: operator.name,
  });
  assert.equal(filteredKnowledge.length, 1, "knowledge filters should find approved example");
  assert.equal(filteredKnowledge[0].exampleId, knowledgeExample.exampleId);

  const updatedKnowledgeTags = repository.updateKnowledgeTags(
    operator,
    knowledgeExample.exampleId,
    {
      tags: ["factura", "prioridad"],
      externalSend: false,
    },
  );
  assert.deepEqual(updatedKnowledgeTags.tags, ["factura", "prioridad"]);

  const updatedKnowledgeCategory = repository.updateKnowledgeCategory(
    operator,
    knowledgeExample.exampleId,
    {
      category: "seguimiento",
      externalSend: false,
    },
  );
  assert.equal(updatedKnowledgeCategory.category, "seguimiento");

  const smartDraft = await repository.generateSmartDraft(operator, draftConversationId, {
    externalSend: false,
  });
  assert.equal(smartDraft.source, "SMART_DRAFT");
  assert.equal(smartDraft.status, "BORRADOR_INTERNO");
  assert.equal(smartDraft.reviewStatus, "BORRADOR_INTERNO");
  assert.equal(smartDraft.externalSend, false);
  assert.ok(
    smartDraft.draftBody.includes("TodoElectrico"),
    "smart draft should produce a customer-facing response",
  );
  assert.doesNotMatch(
    smartDraft.draftBody,
    /Validacion pendiente|Referencia interna/,
    "smart draft body should not expose internal review notes to the customer",
  );
  assert.ok(smartDraft.detectedCategory, "smart draft should persist detected category");
  assert.ok(smartDraft.detectedLanguage, "smart draft should persist detected language");
  assert.ok(typeof smartDraft.confidence === "number", "smart draft should persist confidence");
  assert.ok(
    smartDraft.warnings?.some((warning) => warning.includes("No se debe prometer")),
    "smart draft should include mandatory safety warning",
  );
  assert.ok(
    Array.isArray(smartDraft.knowledgeExampleIds),
    "smart draft should persist knowledge sources array",
  );

  await runSmartDraftGenerationCases(operator);

  await assert.rejects(
    () =>
      repository.generateSmartDraft(operator, draftConversationId, {
        externalSend: true as false,
      }),
    /Envio externo deshabilitado/,
    "smart draft must reject externalSend=true",
  );

  assert.throws(
    () =>
      repository.saveApprovedKnowledgeExample(operator, {
        conversationId: draftConversationId,
        draftId: approvedDraft.draftId,
        originalMessage: "No permitido",
        finalResponse: "No permitido",
        externalSend: true as false,
      }),
    /Envio externo deshabilitado/,
    "knowledge examples must reject externalSend=true",
  );

  const changesDraft = repository.reviewInternalDraft(operator, draftConversationId, {
    status: "NECESITA_CAMBIOS",
    reviewNotes: "Ajustar tono antes de usar.",
    externalSend: false,
  });
  assert.equal(changesDraft.status, "NECESITA_CAMBIOS");

  const rejectedDraft = repository.reviewInternalDraft(operator, draftConversationId, {
    status: "RECHAZADO",
    reviewNotes: "No utilizar este borrador.",
    externalSend: false,
  });
  assert.equal(rejectedDraft.status, "RECHAZADO");
  assert.equal(rejectedDraft.rejectedBy, operator.name);
  assert.ok(rejectedDraft.rejectedAt, "rejection timestamp should be persisted");

  assert.throws(
    () =>
      repository.reviewInternalDraft(operator, draftConversationId, {
        status: "APROBADO_MANUALMENTE",
        externalSend: true as false,
      }),
    /Envio externo deshabilitado/,
    "review must reject externalSend=true",
  );

  await assert.rejects(
    () =>
      repository.applyTemplateToInternalDraft(operator, draftConversationId, {
        templateId: template.templateId,
        externalSend: true as false,
      }),
    /Envio externo deshabilitado/,
    "template application must reject externalSend=true",
  );

  const reviewedStore = repository.readStoreForTests();
  assert.ok(
    reviewedStore.auditLogs.some((event) => event.eventType === "internal_draft_reviewed"),
    "manual draft review should be audited",
  );
  assert.ok(
    reviewedStore.auditLogs.some((event) => event.eventType === "internal_template_applied"),
    "internal template application should be audited",
  );
  assert.ok(
    reviewedStore.auditLogs.some(
      (event) => event.eventType === "conversation_workflow_changed",
    ),
    "workflow changes should be audited",
  );
  assert.ok(
    reviewedStore.auditLogs.some((event) => event.eventType === "conversation_assigned"),
    "workflow assignment should be audited",
  );
  assert.ok(
    reviewedStore.auditLogs.some((event) => event.eventType === "knowledge_example_created"),
    "knowledge example creation should be audited",
  );
  assert.ok(
    reviewedStore.auditLogs.some((event) => event.eventType === "knowledge_tags_updated"),
    "knowledge tag updates should be audited",
  );
  assert.ok(
    reviewedStore.auditLogs.some((event) => event.eventType === "knowledge_category_changed"),
    "knowledge category changes should be audited",
  );
  assert.ok(
    reviewedStore.auditLogs.some((event) => event.eventType === "smart_draft_generated"),
    "smart draft generation should be audited",
  );
  assert.ok(
    reviewedStore.auditLogs.some((event) => event.eventType === "pending_reply_prepared"),
    "pending reply preparation should be audited",
  );
  assert.ok(
    reviewedStore.auditLogs.some((event) => event.eventType === "pending_reply_reviewed"),
    "pending reply review should be audited",
  );

  const gmailStatus = repository.getGmailSync(operator);
  assert.equal(gmailStatus.jobEnabled, true, "auto sync job should be enabled");
  assert.equal(gmailStatus.intervalMinutes, 30, "auto sync interval should be 30 min");
  assert.equal(gmailStatus.status, "OK", "initial gmail sync status should be OK");
  assert.ok(gmailStatus.nextSyncAt, "next sync timestamp should be present");

  const syncResult = await syncAmazonMessagesFromGmail(repository, operator, {
    trigger: "manual",
    config: {
      account: "juanitoopenclaw@gmail.com",
      labelName: "AmazonSeller",
      clientId: "test-client",
      clientSecret: "test-secret",
      refreshToken: "test-refresh",
      maxMessages: 20,
    },
    source: {
      async listLabelMessages() {
        return {
          labelId: "Label_AmazonSeller",
          messages: [
            {
              id: "gmail-auto-sync-1",
              threadId: "thread-auto-sync-1",
              historyId: "history-auto-sync-1",
              rawEmail: [
                "From: buyer@example.com",
                "To: juanitoopenclaw@gmail.com",
                "Subject: Mensaje del comprador sobre pedido 123-4567890-1234567 Amazon ES",
                "Date: Sun, 21 Jun 2026 10:00:00 +0200",
                "Message-ID: <gmail-auto-sync-1@example.com>",
                "X-Amazon-Marketplace: Amazon ES",
                "X-Space-Notification-Type: BUYER_MESSAGE",
                "",
                "Hola, necesito informacion del pedido 123-4567890-1234567.",
              ].join("\n"),
            },
          ],
        };
      },
    },
  });
  assert.equal(syncResult.ok, true, "manual gmail sync should finish OK");
  assert.equal(syncResult.scanned, 1, "manual sync should scan one message");
  assert.equal(syncResult.imported, 1, "manual sync should import one conversation");

  const syncedStatus = repository.getGmailSync(operator);
  assert.equal(syncedStatus.status, "OK", "sync status should return to OK");
  assert.equal(syncedStatus.importedCount, 1, "imported counter should persist");
  assert.equal(syncedStatus.history[0]?.status, "OK", "history should persist OK run");
  assert.equal(syncedStatus.history[0]?.externalSend, false, "sync must stay internal");
  assert.ok(
    repository
      .listConversations(operator)
      .some((item) => item.conversationId === "amz-gmail-123-4567890-1234567"),
    "real gmail conversation should be persisted",
  );

  const lockedRun = repository.startGmailSyncRun(operator, { trigger: "manual" });
  const lockedResult = await syncAmazonMessagesFromGmail(repository, operator, {
    trigger: "auto",
    config: {
      account: "juanitoopenclaw@gmail.com",
      labelName: "AmazonSeller",
      clientId: "test-client",
      clientSecret: "test-secret",
      refreshToken: "test-refresh",
      maxMessages: 20,
    },
    source: {
      async listLabelMessages() {
        throw new Error("lock should prevent source call");
      },
    },
  });
  assert.equal(lockedResult.mode, "locked", "overlapping sync should be blocked");
  repository.finishGmailSyncRun(operator, {
    runId: lockedRun.runId,
    trigger: "manual",
    status: "ERROR",
    scanned: 0,
    imported: 0,
    updated: 0,
    duplicates: 0,
    errors: 1,
    processMs: 0,
    message: "test lock released",
  });

  console.log("Amazon Messages backend tests passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

async function runSmartDraftGenerationCases(actor: AmazonMessagesActor) {
  const smartTempDir = mkdtempSync(join(tmpdir(), "amazon-smart-draft-"));
  const smartRepository = createAmazonMessagesRepository({
    dataDir: smartTempDir,
    resolveOrderContext: async (_env, input) => {
      const orderId = input.amazonOrderId ?? input.odooOrderId ?? "";
      const hasTracking = orderId.includes("301-1111111-2222222");
      const hasOrder = Boolean(orderId);
      if (!hasOrder) return undefined;
      return {
        order: {
          id: `SO-${orderId.slice(0, 3)}`,
          odooRef: "#999",
          date: "2026-06-20 18:00",
          client: "Cliente Amazon",
          channel: "Amazon",
          externalRef: orderId,
          fulfillmentBy: "FBM",
          sendcloud: hasTracking
            ? {
                reference: orderId,
                status: "En transito",
                trackingNumber: "SC123456789",
                trackingUrl: "https://tracking.sendcloud.sc/SC123456789",
                carrier: "Sendcloud",
              }
            : undefined,
          deliveryPrinted: false,
          total: 49.9,
          taxTotal: 8.66,
          status: "Pedido confirmado",
          invoiceStatus: "A facturar",
          deliveryStatus: hasTracking ? "En transito" : "Sin dato Sendcloud",
          city: "",
          items: [
            {
              sku: "SKU-TEST",
              name: "Producto test",
              quantity: 1,
              price: 49.9,
              stock: 3,
            },
          ],
        },
        tracking: hasTracking
          ? {
              carrier: "Sendcloud",
              status: "En transito",
              trackingNumber: "SC123456789",
              trackingUrl: "https://tracking.sendcloud.sc/SC123456789",
              lastEvent: "parcel_in_transit",
              updatedAt: "2026-06-20T16:30:00.000Z",
            }
          : undefined,
      };
    },
  });

  try {
    const cases = [
      {
        id: "tracking-found",
        orderId: "301-1111111-2222222",
        language: "es",
        body: "No he recibido mi pedido. Me pueden decir donde esta?",
        expected: /SC123456789|tracking\.sendcloud/i,
      },
      {
        id: "tracking-missing",
        orderId: "302-1111111-2222222",
        language: "es",
        body: "No he recibido mi pedido todavia.",
        expected: /no tenemos un seguimiento confirmado|revis/i,
      },
      {
        id: "invoice",
        orderId: "303-1111111-2222222",
        language: "es",
        body: "Necesito la factura de mi pedido.",
        expected: /factura/i,
      },
      {
        id: "cancel",
        orderId: "304-1111111-2222222",
        language: "es",
        body: "Quiero cancelar mi pedido urgentemente.",
        expected: /cancelarse|preparacion|enviado/i,
      },
      {
        id: "german",
        orderId: "305-1111111-2222222",
        language: "de",
        body:
          "Ha recibido un mensaje.\nMessage:\nIch habe mein Paket nicht erhalten.\nResolver caso\nDerechos de autor 2026 Amazon.",
        expected: /Hallo|Sendung|bestaetigt/i,
      },
      {
        id: "italian",
        orderId: "306-1111111-2222222",
        language: "it",
        body: "Non ho ricevuto il mio pacco.",
        expected: /Buongiorno|spedizione|confermate/i,
      },
      {
        id: "french",
        orderId: "307-1111111-2222222",
        language: "fr",
        body: "Bonjour, je n'ai pas recu ma commande.",
        expected: /Bonjour|expedition|confirme/i,
      },
    ];

    let firstConversationId = "";
    let firstInitialDraft = "";
    for (const item of cases) {
      const imported = await smartRepository.importGmailMessage(actor, {
        gmailMessageId: `smart-${item.id}`,
        gmailThreadId: `thread-${item.id}`,
        rawEmail: smartRawEmail(item.orderId, item.language, item.body),
      });
      assert.equal(imported.status, "imported");
      const draft = await smartRepository.generateSmartDraft(
        actor,
        imported.conversationId,
        { externalSend: false },
      );
      assert.equal(draft.source, "SMART_DRAFT");
      assert.equal(draft.externalSend, false);
      assert.match(draft.draftBody, item.expected, `smart draft case ${item.id}`);
      assert.doesNotMatch(
        draft.draftBody,
        /reembolso confirmado|ya hemos enviado|culpa nuestra/i,
        `smart draft case ${item.id} must stay safe`,
      );
      if (!firstConversationId) {
        firstConversationId = imported.conversationId;
        firstInitialDraft = draft.draftBody;
      }
    }

    const approved = smartRepository.reviewInternalDraft(actor, firstConversationId, {
      status: "APROBADO_MANUALMENTE",
      externalSend: false,
    });
    assert.equal(approved.externalSend, false);
    const knowledge = smartRepository.saveApprovedKnowledgeExample(actor, {
      conversationId: firstConversationId,
      draftId: approved.draftId,
      initialDraft: firstInitialDraft,
      finalResponse: `${firstInitialDraft}\n\nAjuste aprobado por operador.`,
      humanDiffSummary: "El operador aprobo el borrador IA con ajuste menor.",
      externalSend: false,
    });
    assert.equal(knowledge.status, "approved");
    assert.match(knowledge.draftDiff, /ajustes humanos|ajuste menor|aprob/i);
  } finally {
    rmSync(smartTempDir, { recursive: true, force: true });
  }
}

function smartRawEmail(orderId: string, language: string, body: string) {
  return `Message-ID: <${orderId}@example.amazon.com>
X-Space-Notification-Type: BBC_MESSAGE_SENT_TO_MERCHANT
X-Marketplace-ID: A1PA6795UKMFR9
From: "Cliente Amazon" <buyer-${orderId}@marketplace.amazon.de>
To: Juanito <juanitoopenclaw@gmail.com>
Subject: Pedido Amazon ${orderId}
Date: Sat, 20 Jun 2026 18:00:00 +0200

# ${orderId}:
1 / Producto test [ASIN: B0SMART]

------------- Message: -------------

${body}

------------- Finalizar mensaje -------------

Language: ${language}`;
}
