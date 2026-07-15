import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createAmazonMessagesSeedStore } from "./seed.ts";
import type {
  AmazonClassificationRecord,
  AmazonConversationRecord,
  AmazonConversationContextRecord,
  AmazonConversationWorkflowStatus,
  AmazonDraftRequestRecord,
  AmazonGmailSyncHistoryRecord,
  AmazonGmailSyncRunStatus,
  AmazonGmailSyncTrigger,
  AmazonGmailDraftLinkRecord,
  AmazonGmailDraftStatus,
  AmazonInternalDraftRecord,
  AmazonInternalDraftStatus,
  AmazonKnowledgeExampleRecord,
  AmazonManualSendMockRecord,
  AmazonManualSendMockStatus,
  AmazonMessagesActor,
  AmazonMessagesPermission,
  AmazonMessagesRole,
  AmazonMessagesStore,
  AmazonPendingReplyRecord,
  AmazonPendingReplyStatus,
  AmazonOperatorAssignmentRecord,
  AmazonTemplateRecord,
} from "./schema.ts";
import { rolePermissions } from "./schema.ts";
import { parseAmazonEmail } from "../../src/modules/amazonMessages/amazonEmailParser.ts";
import type { ParsedAmazonEmail } from "../../src/modules/amazonMessages/amazonMessagesTypes.ts";
import {
  resolveOdooOrderContext,
  type ResolveOdooOrderContextInput,
  type ResolvedOdooOrderContext,
} from "../odooOrderContext.ts";

type ListFilters = {
  status?: string;
  workflowStatus?: AmazonConversationWorkflowStatus;
  priority?: string;
  category?: string;
  marketplace?: string;
};

type KnowledgeFilters = {
  query?: string;
  order?: string;
  category?: string;
  language?: string;
  templateId?: string;
  approver?: string;
};

type RepositoryOptions = {
  storePath?: string;
  dataDir?: string;
  resolveOrderContext?: (
    env: Record<string, string>,
    input: ResolveOdooOrderContextInput,
  ) => Promise<ResolvedOdooOrderContext | undefined>;
};

export type GmailRawImport = {
  gmailMessageId: string;
  gmailThreadId?: string;
  rawEmail: string;
  historyId?: string;
};

export type GmailSyncFinishInput = {
  runId: string;
  trigger: AmazonGmailSyncTrigger;
  status: Exclude<AmazonGmailSyncRunStatus, "EN_CURSO">;
  scanned: number;
  imported: number;
  updated: number;
  duplicates: number;
  errors: number;
  processMs: number;
  message?: string;
  labelId?: string;
};

export type GmailDraftPayload = {
  conversationId: string;
  pendingReplyId: string;
  gmailDraftId?: string;
  gmailThreadId?: string;
  recipient: string;
  subject: string;
  bodyText: string;
  bodyHash: string;
};

export type GmailDraftRecordInput = {
  pendingReplyId: string;
  gmailDraftId: string;
  gmailThreadId?: string;
  recipient: string;
  subject: string;
  bodyHash: string;
  status: AmazonGmailDraftStatus;
};

export type ManualSendMockConfirmation = {
  conversationId?: string;
  pendingReplyId?: string;
  gmailDraftId?: string;
  recipient?: string;
  subject?: string;
  bodyHash?: string;
  confirmFinalSendMock?: boolean;
  idempotencyKey?: string;
  externalSend?: false;
};

export function createAmazonMessagesRepository(options: RepositoryOptions = {}) {
  const storePath =
    options.storePath ??
    join(
      options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data",
      "amazon-messages-store.json",
    );
  const resolveOrderContext =
    options.resolveOrderContext ?? resolveOdooOrderContext;

  function ensureStore() {
    if (existsSync(storePath)) return;
    mkdirSync(dirname(storePath), { recursive: true });
    writeStore(createAmazonMessagesSeedStore());
  }

  function readStore() {
    ensureStore();
    return normalizeStore(
      JSON.parse(readFileSync(storePath, "utf8")) as AmazonMessagesStore,
    );
  }

  function writeStore(store: AmazonMessagesStore) {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
  }

  function requirePermission(
    actor: AmazonMessagesActor,
    permission: AmazonMessagesPermission,
  ) {
    if (
      !rolePermissions[actor.role].includes(permission) &&
      !actor.permissions?.includes(permission)
    ) {
      throw new Error(`Permiso insuficiente: ${permission}`);
    }
  }

  function appendAudit(
    store: AmazonMessagesStore,
    actor: AmazonMessagesActor,
    input: {
      conversationId?: string;
      entityType: string;
      entityId: string;
      eventType: string;
      detail: string;
    },
  ) {
    store.auditLogs.push({
      auditId: `audit-${Date.now()}-${store.auditLogs.length + 1}`,
      conversationId: input.conversationId,
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: input.eventType,
      actorId: actor.id,
      actorRole: actor.role,
      detail: input.detail,
      createdAt: new Date().toISOString(),
    });
  }

  function recoverStaleHermesDraftRequests(
    store: AmazonMessagesStore,
    actor: AmazonMessagesActor,
  ) {
    const nowMs = Date.now();
    const maxClaimMs = 2 * 60_000;
    let recovered = false;
    for (const request of store.draftRequests) {
      if (request.status !== "IN_PROGRESS") continue;
      const startedAt = new Date(request.claimedAt ?? request.updatedAt).getTime();
      if (!startedAt || nowMs - startedAt < maxClaimMs) continue;
      const now = new Date(nowMs).toISOString();
      request.status = "FAILED";
      request.failedBy = actor.name;
      request.failedAt = now;
      request.updatedBy = actor.name;
      request.updatedAt = now;
      request.errorMessage =
        "Hermes recogio la solicitud pero no devolvio borrador ni fallo dentro del tiempo esperado.";
      request.externalSend = false;
      appendAudit(store, actor, {
        conversationId: request.conversationId,
        entityType: "hermes_draft_request",
        entityId: request.requestId,
        eventType: "hermes_draft_stale_recovered",
        detail: `${request.errorMessage} Solicitud liberada para reintento. external_send=false.`,
      });
      recovered = true;
    }
    return recovered;
  }

  return {
    storePath,
    schemaVersion: 1 as const,
    listConversations(actor: AmazonMessagesActor, filters: ListFilters = {}) {
      requirePermission(actor, "amazonMessages:read");
      const store = readStore();
      return store.conversations.filter((conversation) => {
        if (filters.status && conversation.status !== filters.status) return false;
        if (
          filters.workflowStatus &&
          conversation.workflowStatus !== filters.workflowStatus
        ) {
          return false;
        }
        if (filters.priority && conversation.priority !== filters.priority) return false;
        if (filters.category && conversation.category !== filters.category) return false;
        if (filters.marketplace && conversation.marketplace !== filters.marketplace) {
          return false;
        }
        return true;
      });
    },
    async getConversation(actor: AmazonMessagesActor, conversationId: string) {
      requirePermission(actor, "amazonMessages:read");
      const store = readStore();
      const conversation = store.conversations.find(
        (item) => item.conversationId === conversationId,
      );
      if (!conversation) throw new Error("Conversacion no encontrada");
      const context = conversation.amazonOrderId || conversation.odooOrderId
        ? await resolveOrderContext(process.env as Record<string, string>, {
            amazonOrderId: conversation.amazonOrderId,
            odooOrderId: conversation.odooOrderId,
          })
        : undefined;
      if (context?.order?.id && conversation.odooOrderId !== context.order.id) {
        conversation.odooOrderId = context.order.id;
        conversation.updatedAt = new Date().toISOString();
        writeStore(store);
      }
      return {
        conversation,
        context,
        messages: store.messages.filter((item) => item.conversationId === conversationId),
        attachments: store.attachments.filter(
          (item) => item.conversationId === conversationId,
        ),
        classifications: store.classifications.filter(
          (item) => item.conversationId === conversationId,
        ),
        auditLogs: store.auditLogs.filter(
          (item) => item.conversationId === conversationId,
        ),
        pendingReplies: store.pendingReplies.filter(
          (item) => item.conversationId === conversationId,
        ),
        gmailDraftLinks: store.gmailDraftLinks.filter(
          (item) => item.conversationId === conversationId,
        ),
        assignments: store.operatorAssignments.filter(
          (item) => item.conversationId === conversationId,
        ),
      };
    },
    updateConversationWorkflow(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: {
        workflowStatus?: AmazonConversationWorkflowStatus;
        externalSend?: false;
        reason?: string;
        confirmPendingDraft?: boolean;
        confirmUnreviewed?: boolean;
        confirmClosedReopen?: boolean;
      },
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoWorkflowExternalSend(input);
      const store = readStore();
      const conversation = ensureConversation(store, conversationId);
      const now = new Date().toISOString();
      const previousStatus = conversation.workflowStatus;
      const newStatus = normalizeWorkflowStatus(
        input.workflowStatus,
        conversation.workflowStatus,
      );
      validateWorkflowTransition(store, conversation, newStatus, input);
      conversation.workflowStatus = newStatus;
      conversation.status = legacyStatusFromWorkflow(newStatus);
      conversation.updatedAt = now;
      conversation.lastActivityAt = now;
      conversation.closedAt = newStatus === "CERRADO" ? now : undefined;
      appendWorkflowHistory(
        conversation,
        actor,
        previousStatus,
        newStatus,
        now,
        input.reason,
      );
      appendAudit(store, actor, {
        conversationId,
        entityType: "conversation",
        entityId: conversationId,
        eventType: "conversation_workflow_changed",
        detail: `Workflow conversacion: ${previousStatus} -> ${newStatus}. Actor=${actor.name}. Fecha=${now}. Motivo=${
          input.reason?.trim() || "sin motivo"
        }. external_send=false; sin envio externo.`,
      });
      writeStore(store);
      return conversation;
    },
    assignConversationWorkflow(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: {
        assignedUser?: string;
        externalSend?: false;
      },
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoWorkflowExternalSend(input);
      const store = readStore();
      const conversation = ensureConversation(store, conversationId);
      const now = new Date().toISOString();
      const previousUser = conversation.assignedUser ?? "Sin asignar";
      const assignedUser = required(input.assignedUser, "assignedUser");
      conversation.assignedUser = assignedUser;
      conversation.assignedAt = now;
      conversation.updatedAt = now;
      conversation.lastActivityAt = now;
      appendAudit(store, actor, {
        conversationId,
        entityType: "conversation",
        entityId: conversationId,
        eventType: "conversation_assigned",
        detail: `Asignacion cambiada: ${previousUser} -> ${assignedUser}. external_send=false; sin envio externo.`,
      });
      writeStore(store);
      return conversation;
    },
    getInternalDraft(actor: AmazonMessagesActor, conversationId: string) {
      requirePermission(actor, "amazonMessages:read");
      const store = readStore();
      ensureConversation(store, conversationId);
      return (
        store.internalDrafts.find((item) => item.conversationId === conversationId) ??
        emptyInternalDraft(conversationId)
      );
    },
    createInternalDraft(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: Partial<AmazonInternalDraftRecord>,
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoExternalSend(input);
      const store = readStore();
      ensureConversation(store, conversationId);
      const now = new Date().toISOString();
      const existing = store.internalDrafts.find(
        (item) => item.conversationId === conversationId,
      );
      const previousStatus = existing?.status ?? "SIN_BORRADOR";
      const nextStatus = normalizeDraftStatus(input.status, "BORRADOR_INTERNO");
      const draft: AmazonInternalDraftRecord = existing
        ? {
            ...existing,
            draftBody: requiredDraftBody(input.draftBody, "draftBody"),
            status: nextStatus,
            reviewStatus: nextStatus,
            reviewNotes: input.reviewNotes ?? existing.reviewNotes,
            updatedBy: input.updatedBy ?? actor.name,
            updatedAt: now,
            source: input.source ?? existing.source ?? "Gmail readonly",
            externalSend: false,
          }
        : {
            draftId: input.draftId ?? `draft-${Date.now()}-${store.internalDrafts.length + 1}`,
            conversationId,
            draftBody: requiredDraftBody(input.draftBody, "draftBody"),
            status: nextStatus,
            reviewStatus: nextStatus,
            reviewNotes: input.reviewNotes,
            reviewHistory: [],
            generatedBy: input.generatedBy ?? actor.name,
            generatedAt: input.generatedAt ?? now,
            updatedBy: input.updatedBy ?? actor.name,
            updatedAt: input.updatedAt ?? now,
            source: input.source ?? "Gmail readonly",
            externalSend: false,
          };
      applyDraftReviewFields(draft, actor, previousStatus, nextStatus, now, input.reviewNotes);

      if (existing) {
        Object.assign(existing, draft);
      } else {
        store.internalDrafts.push(draft);
      }

      appendAudit(store, actor, {
        conversationId,
        entityType: "internal_draft",
        entityId: draft.draftId,
        eventType: "internal_draft_generated",
        detail:
          "Borrador interno guardado en backend desde Gmail readonly. external_send=false; sin envio externo.",
      });
      writeStore(store);
      return draft;
    },
    updateInternalDraft(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: Partial<AmazonInternalDraftRecord>,
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoExternalSend(input);
      const store = readStore();
      ensureConversation(store, conversationId);
      const now = new Date().toISOString();
      const existing = store.internalDrafts.find(
        (item) => item.conversationId === conversationId,
      );
      const previousStatus = existing?.status ?? "SIN_BORRADOR";
      const nextStatus = normalizeDraftStatus(
        input.status,
        existing?.status ?? "LISTO_PARA_REVISAR",
      );
      const draft: AmazonInternalDraftRecord = existing
        ? {
            ...existing,
            draftBody:
              input.draftBody === undefined
                ? existing.draftBody
                : requiredDraftBody(input.draftBody, "draftBody"),
            status: nextStatus,
            reviewStatus: nextStatus,
            reviewNotes: input.reviewNotes ?? existing.reviewNotes,
            updatedBy: input.updatedBy ?? actor.name,
            updatedAt: now,
            source: input.source ?? existing.source ?? "Gmail readonly",
            externalSend: false,
          }
        : {
            draftId: input.draftId ?? `draft-${Date.now()}-${store.internalDrafts.length + 1}`,
            conversationId,
            draftBody: requiredDraftBody(input.draftBody, "draftBody"),
            status: nextStatus,
            reviewStatus: nextStatus,
            reviewNotes: input.reviewNotes,
            reviewHistory: [],
            generatedBy: input.generatedBy ?? actor.name,
            generatedAt: input.generatedAt ?? now,
            updatedBy: input.updatedBy ?? actor.name,
            updatedAt: now,
            source: input.source ?? "Gmail readonly",
            externalSend: false,
          };
      applyDraftReviewFields(draft, actor, previousStatus, nextStatus, now, input.reviewNotes);

      if (existing) {
        Object.assign(existing, draft);
      } else {
        store.internalDrafts.push(draft);
      }

      appendAudit(store, actor, {
        conversationId,
        entityType: "internal_draft",
        entityId: draft.draftId,
        eventType: "internal_draft_updated",
        detail:
          "Borrador interno actualizado en backend. external_send=false; sin envio externo.",
      });
      writeStore(store);
      return draft;
    },
    reviewInternalDraft(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: Partial<AmazonInternalDraftRecord>,
    ) {
      requirePermission(actor, "amazonMessages:validate");
      assertNoExternalSend(input);
      const store = readStore();
      ensureConversation(store, conversationId);
      const now = new Date().toISOString();
      const existing = store.internalDrafts.find(
        (item) => item.conversationId === conversationId,
      );
      if (
        !existing ||
        typeof existing.draftBody !== "string" ||
        !existing.draftBody.trim()
      ) {
        throw new Error("No hay borrador interno para revisar");
      }
      const previousStatus = existing.status;
      const nextStatus = normalizeDraftStatus(input.status, existing.status);
      existing.status = nextStatus;
      existing.reviewStatus = nextStatus;
      existing.reviewNotes = input.reviewNotes ?? existing.reviewNotes;
      existing.updatedBy = input.updatedBy ?? actor.name;
      existing.updatedAt = now;
      existing.externalSend = false;
      applyDraftReviewFields(existing, actor, previousStatus, nextStatus, now, input.reviewNotes);

      appendAudit(store, actor, {
        conversationId,
        entityType: "internal_draft",
        entityId: existing.draftId,
        eventType: "internal_draft_reviewed",
        detail: `Revision manual: ${previousStatus} -> ${nextStatus}. external_send=false; sin envio externo.${
          input.reviewNotes ? ` Nota: ${input.reviewNotes}` : ""
        }`,
      });
      writeStore(store);
      return existing;
    },
    getPendingReply(actor: AmazonMessagesActor, conversationId: string) {
      requirePermission(actor, "amazonMessages:read");
      const store = readStore();
      ensureConversation(store, conversationId);
      return (
        store.pendingReplies.find((item) => item.conversationId === conversationId) ??
        emptyPendingReply(conversationId)
      );
    },
    preparePendingReply(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: Partial<AmazonPendingReplyRecord> & { externalSend?: false } = {},
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoPendingReplyExternalSend(input);
      const store = readStore();
      const conversation = ensureConversation(store, conversationId);
      const draft = findApprovedDraftForPendingReply(
        store,
        conversationId,
        input.draftId,
      );
      const now = new Date().toISOString();
      const existing = store.pendingReplies.find(
        (item) => item.conversationId === conversationId,
      );
      const previousStatus = existing?.status ?? "SIN_RESPUESTA";
      const nextStatus = normalizePendingReplyStatus(
        input.status,
        "RESPUESTA_PREPARADA",
      );
      const pendingReply: AmazonPendingReplyRecord = existing
        ? {
            ...existing,
            draftId: draft.draftId,
            replyBody: required(input.replyBody ?? draft.draftBody, "replyBody"),
            status: nextStatus,
            validationNotes: input.validationNotes ?? existing.validationNotes,
            updatedBy: input.updatedBy ?? actor.name,
            updatedAt: now,
            source: "APPROVED_INTERNAL_DRAFT",
            channel: "INTERNAL_REPLY_PENDING",
            externalSend: false,
            attachments: input.attachments ?? existing.attachments ?? [],
            history: existing.history ?? [],
          }
        : {
            pendingReplyId:
              input.pendingReplyId ??
              `pending-reply-${Date.now()}-${store.pendingReplies.length + 1}`,
            conversationId,
            draftId: draft.draftId,
            replyBody: required(input.replyBody ?? draft.draftBody, "replyBody"),
            status: nextStatus,
            validationNotes: input.validationNotes,
            preparedBy: input.preparedBy ?? actor.name,
            preparedAt: input.preparedAt ?? now,
            updatedBy: input.updatedBy ?? actor.name,
            updatedAt: input.updatedAt ?? now,
            source: "APPROVED_INTERNAL_DRAFT",
            channel: "INTERNAL_REPLY_PENDING",
            externalSend: false,
            attachments: input.attachments ?? [],
            history: [],
          };
      applyPendingReplyReviewFields(
        pendingReply,
        actor,
        previousStatus,
        nextStatus,
        now,
        input.validationNotes,
      );

      if (existing) {
        Object.assign(existing, pendingReply);
      } else {
        store.pendingReplies.push(pendingReply);
      }
      conversation.workflowStatus = "LISTO_PARA_RESPONDER";
      conversation.status = legacyStatusFromWorkflow(conversation.workflowStatus);
      conversation.updatedAt = now;
      conversation.lastActivityAt = now;

      appendAudit(store, actor, {
        conversationId,
        entityType: "pending_reply",
        entityId: pendingReply.pendingReplyId,
        eventType: existing ? "pending_reply_updated" : "pending_reply_prepared",
        detail:
          "Respuesta pendiente preparada desde borrador aprobado. external_send=false; sin SP-API y sin respuesta externa.",
      });
      writeStore(store);
      return pendingReply;
    },
    updatePendingReply(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: Partial<AmazonPendingReplyRecord> & { externalSend?: false },
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoPendingReplyExternalSend(input);
      const store = readStore();
      ensureConversation(store, conversationId);
      const existing = ensurePendingReply(store, conversationId);
      const now = new Date().toISOString();
      const previousStatus = existing.status;
      const nextStatus = normalizePendingReplyStatus(
        input.status,
        "PENDIENTE_VALIDACION",
      );
      existing.replyBody = required(input.replyBody ?? existing.replyBody, "replyBody");
      existing.status = nextStatus;
      existing.validationNotes = input.validationNotes ?? existing.validationNotes;
      existing.updatedBy = input.updatedBy ?? actor.name;
      existing.updatedAt = now;
      existing.externalSend = false;
      existing.attachments = input.attachments ?? existing.attachments ?? [];
      applyPendingReplyReviewFields(
        existing,
        actor,
        previousStatus,
        nextStatus,
        now,
        input.validationNotes,
      );
      appendAudit(store, actor, {
        conversationId,
        entityType: "pending_reply",
        entityId: existing.pendingReplyId,
        eventType: "pending_reply_updated",
        detail:
          "Respuesta pendiente actualizada. external_send=false; sin SP-API y sin respuesta externa.",
      });
      writeStore(store);
      return existing;
    },
    reviewPendingReply(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: Partial<AmazonPendingReplyRecord> & { externalSend?: false },
    ) {
      requirePermission(actor, "amazonMessages:validate");
      assertNoPendingReplyExternalSend(input);
      const store = readStore();
      ensureConversation(store, conversationId);
      const existing = ensurePendingReply(store, conversationId);
      const now = new Date().toISOString();
      const previousStatus = existing.status;
      const nextStatus = normalizePendingReplyStatus(input.status, existing.status);
      existing.status = nextStatus;
      existing.validationNotes = input.validationNotes ?? existing.validationNotes;
      existing.updatedBy = input.updatedBy ?? actor.name;
      existing.updatedAt = now;
      existing.externalSend = false;
      applyPendingReplyReviewFields(
        existing,
        actor,
        previousStatus,
        nextStatus,
        now,
        input.validationNotes,
      );
      appendAudit(store, actor, {
        conversationId,
        entityType: "pending_reply",
        entityId: existing.pendingReplyId,
        eventType: "pending_reply_reviewed",
        detail: `Revision respuesta pendiente: ${previousStatus} -> ${nextStatus}. external_send=false; sin SP-API y sin respuesta externa.${
          input.validationNotes ? ` Nota: ${input.validationNotes}` : ""
        }`,
      });
      writeStore(store);
      return existing;
    },
    buildGmailDraftPayload(
      actor: AmazonMessagesActor,
      conversationId: string,
    ): GmailDraftPayload {
      requirePermission(actor, "amazonMessages:gmailDraft");
      const store = readStore();
      ensureConversation(store, conversationId);
      const pendingReply = ensurePendingReply(store, conversationId);
      if (pendingReply.status !== "APROBADA_PARA_BORRADOR") {
        throw new Error("Solo una respuesta pendiente aprobada puede crear borrador Gmail");
      }
      if (!pendingReply.replyBody.trim()) {
        throw new Error("La respuesta pendiente esta vacia");
      }
      const inboundMessage = findOriginalCustomerMessage(store, conversationId);
      if (!inboundMessage) {
        throw new Error("No hay mensaje entrante para construir el borrador Gmail");
      }
      const recipient = extractEmail(
        stringMetadata(inboundMessage.amazonMetadata.buyerAlias) ??
          inboundMessage.sender,
      );
      if (!recipient || !isAmazonRelayRecipient(recipient)) {
        throw new Error("No se encontro alias Amazon valido para crear borrador Gmail");
      }
      const subject = buildReplySubject(inboundMessage.content, pendingReply, store);
      const bodyText = pendingReply.replyBody.trim();
      return {
        conversationId,
        pendingReplyId: pendingReply.pendingReplyId,
        gmailDraftId: pendingReply.gmailDraftId,
        gmailThreadId: inboundMessage.gmailThreadId,
        recipient,
        subject,
        bodyText,
        bodyHash: sha256(bodyText),
      };
    },
    recordGmailDraft(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: GmailDraftRecordInput,
    ) {
      requirePermission(actor, "amazonMessages:gmailDraft");
      const store = readStore();
      const conversation = ensureConversation(store, conversationId);
      const pendingReply = ensurePendingReply(store, conversationId);
      if (pendingReply.pendingReplyId !== input.pendingReplyId) {
        throw new Error("El borrador Gmail no corresponde a la respuesta pendiente activa");
      }
      if (pendingReply.status !== "APROBADA_PARA_BORRADOR") {
        throw new Error("Solo una respuesta pendiente aprobada puede registrar borrador Gmail");
      }
      const now = new Date().toISOString();
      const existing = store.gmailDraftLinks.find(
        (item) => item.pendingReplyId === pendingReply.pendingReplyId,
      );
      const link: AmazonGmailDraftLinkRecord = existing
        ? {
            ...existing,
            gmailDraftId: input.gmailDraftId,
            gmailThreadId: input.gmailThreadId ?? existing.gmailThreadId,
            recipient: input.recipient,
            subject: input.subject,
            bodyHash: input.bodyHash,
            status: "BORRADOR_GMAIL_ACTUALIZADO",
            updatedBy: actor.name,
            updatedAt: now,
            lastError: undefined,
            externalSend: false,
          }
        : {
            linkId: `gmail-draft-link-${Date.now()}-${store.gmailDraftLinks.length + 1}`,
            conversationId,
            pendingReplyId: pendingReply.pendingReplyId,
            gmailDraftId: input.gmailDraftId,
            gmailThreadId: input.gmailThreadId,
            recipient: input.recipient,
            subject: input.subject,
            bodyHash: input.bodyHash,
            status: input.status,
            createdBy: actor.name,
            createdAt: now,
            updatedBy: actor.name,
            updatedAt: now,
            externalSend: false,
          };
      if (existing) {
        Object.assign(existing, link);
      } else {
        store.gmailDraftLinks.push(link);
      }
      pendingReply.gmailDraftId = link.gmailDraftId;
      pendingReply.gmailDraftRecipient = link.recipient;
      pendingReply.gmailDraftSubject = link.subject;
      pendingReply.gmailDraftBodyHash = link.bodyHash;
      pendingReply.gmailDraftCreatedBy ??= link.createdBy;
      pendingReply.gmailDraftCreatedAt ??= link.createdAt;
      pendingReply.gmailDraftUpdatedBy = actor.name;
      pendingReply.gmailDraftUpdatedAt = now;
      pendingReply.updatedBy = actor.name;
      pendingReply.updatedAt = now;
      conversation.updatedAt = now;
      conversation.lastActivityAt = now;
      appendAudit(store, actor, {
        conversationId,
        entityType: "gmail_draft",
        entityId: link.gmailDraftId,
        eventType: existing ? "gmail_draft_updated" : "gmail_draft_created",
        detail:
          "Borrador Gmail real creado/actualizado desde PendingReply aprobado. draft_only=true; sin SP-API y sin respuesta externa.",
      });
      writeStore(store);
      return { pendingReply, gmailDraftLink: link };
    },
    recordGmailDraftFailure(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: {
        pendingReplyId: string;
        recipient: string;
        subject: string;
        bodyHash: string;
        message: string;
      },
    ) {
      requirePermission(actor, "amazonMessages:gmailDraft");
      const store = readStore();
      ensureConversation(store, conversationId);
      const pendingReply = ensurePendingReply(store, conversationId);
      const now = new Date().toISOString();
      const existing = store.gmailDraftLinks.find(
        (item) => item.pendingReplyId === input.pendingReplyId,
      );
      const link: AmazonGmailDraftLinkRecord =
        existing ?? {
          linkId: `gmail-draft-link-${Date.now()}-${store.gmailDraftLinks.length + 1}`,
          conversationId,
          pendingReplyId: input.pendingReplyId,
          gmailDraftId: pendingReply.gmailDraftId ?? "",
          recipient: input.recipient,
          subject: input.subject,
          bodyHash: input.bodyHash,
          status: "ERROR",
          createdBy: actor.name,
          createdAt: now,
          updatedBy: actor.name,
          updatedAt: now,
          externalSend: false,
        };
      link.status = "ERROR";
      link.lastError = input.message;
      link.updatedBy = actor.name;
      link.updatedAt = now;
      if (!existing) store.gmailDraftLinks.push(link);
      appendAudit(store, actor, {
        conversationId,
        entityType: "gmail_draft",
        entityId: input.pendingReplyId,
        eventType: "gmail_draft_failed",
        detail: `Fallo creando/actualizando borrador Gmail: ${input.message}. draft_only=true; sin respuesta externa.`,
      });
      writeStore(store);
      return link;
    },
    finalizeManualSendMock(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: ManualSendMockConfirmation,
    ) {
      requirePermission(actor, "amazonMessagesSendFinal");
      if (input.externalSend === true) {
        throw new Error("Envio real bloqueado en manual_send_mock");
      }
      if (input.confirmFinalSendMock !== true) {
        throw new Error("Confirmacion final manual_send_mock requerida");
      }
      const idempotencyKey = (input.idempotencyKey ?? "").trim();
      if (!idempotencyKey || idempotencyKey.length < 12) {
        throw new Error("Idempotency key requerida para manual_send_mock");
      }
      const store = readStore();
      const conversation = ensureConversation(store, conversationId);
      const pendingReply = ensurePendingReply(store, conversationId);
      if (input.conversationId !== conversationId) {
        throw new Error("Confirmacion no coincide con la conversacion");
      }
      if (input.pendingReplyId !== pendingReply.pendingReplyId) {
        throw new Error("Confirmacion no coincide con la respuesta pendiente");
      }
      const existingForKey = store.manualSendMockFinalizations.find(
        (item) =>
          item.idempotencyKey === idempotencyKey &&
          item.conversationId === conversationId &&
          item.pendingReplyId === pendingReply.pendingReplyId,
      );
      if (existingForKey) return existingForKey;
      const existingActive = store.manualSendMockFinalizations.find(
        (item) =>
          item.pendingReplyId === pendingReply.pendingReplyId &&
          (item.status === "SEND_IN_PROGRESS" ||
            item.status === "SENT_MOCK" ||
            item.status === "SENT"),
      );
      if (existingActive) {
        throw new Error("Doble envio bloqueado por manual_send_mock");
      }
      if (pendingReply.status !== "APROBADA_PARA_BORRADOR") {
        throw new Error("Solo PendingReply aprobado puede finalizar manual_send_mock");
      }
      if (!pendingReply.gmailDraftId) {
        throw new Error("No existe Gmail Draft para finalizar manual_send_mock");
      }
      const link = store.gmailDraftLinks.find(
        (item) =>
          item.pendingReplyId === pendingReply.pendingReplyId &&
          item.gmailDraftId === pendingReply.gmailDraftId,
      );
      if (!link) {
        throw new Error("Gmail Draft registrado no encontrado");
      }
      if (input.gmailDraftId !== link.gmailDraftId) {
        throw new Error("Confirmacion no coincide con Gmail Draft");
      }
      if (input.recipient !== link.recipient || input.subject !== link.subject) {
        throw new Error("Destinatario o asunto cambiaron despues de aprobar");
      }
      const currentBodyHash = sha256(pendingReply.replyBody.trim());
      if (
        input.bodyHash !== link.bodyHash ||
        input.bodyHash !== pendingReply.gmailDraftBodyHash ||
        input.bodyHash !== currentBodyHash
      ) {
        throw new Error("bodyHash distinto entre PendingReply y Gmail Draft");
      }
      const now = new Date().toISOString();
      const confirmationHash = sha256(
        JSON.stringify({
          conversationId,
          pendingReplyId: pendingReply.pendingReplyId,
          gmailDraftId: link.gmailDraftId,
          recipient: link.recipient,
          subject: link.subject,
          bodyHash: link.bodyHash,
          idempotencyKey,
        }),
      );
      const finalization: AmazonManualSendMockRecord = {
        finalizationId: `manual-send-mock-${Date.now()}-${store.manualSendMockFinalizations.length + 1}`,
        conversationId,
        pendingReplyId: pendingReply.pendingReplyId,
        gmailDraftId: link.gmailDraftId,
        gmailThreadId: link.gmailThreadId,
        recipient: link.recipient,
        subject: link.subject,
        bodyHash: link.bodyHash,
        confirmationHash,
        idempotencyKey,
        status: "READY_TO_SEND",
        requestedBy: actor.name,
        requestedAt: now,
        updatedBy: actor.name,
        updatedAt: now,
        externalSend: false,
      };
      store.manualSendMockFinalizations.push(finalization);
      appendAudit(store, actor, {
        conversationId,
        entityType: "manual_send_mock",
        entityId: finalization.finalizationId,
        eventType: "manual_send_mock_ready",
        detail:
          "Finalizacion manual_send_mock preparada con confirmacion fuerte e idempotency key. Sin envio Gmail real y sin SP-API.",
      });
      finalization.status = "SEND_IN_PROGRESS";
      finalization.updatedAt = new Date().toISOString();
      appendAudit(store, actor, {
        conversationId,
        entityType: "manual_send_mock",
        entityId: finalization.finalizationId,
        eventType: "manual_send_mock_in_progress",
        detail:
          "Servicio simulado manual_send_mock iniciado. No se invoca envio Gmail real.",
      });
      finalization.status = "SENT_MOCK";
      finalization.mockMessageId = `mock-gmail-message-${Date.now()}`;
      finalization.updatedAt = new Date().toISOString();
      finalization.updatedBy = actor.name;
      pendingReply.status = "SENT_MOCK";
      pendingReply.updatedAt = finalization.updatedAt;
      pendingReply.updatedBy = actor.name;
      conversation.status = "responded_mock";
      conversation.workflowStatus = "CERRADO";
      conversation.closedAt = finalization.updatedAt;
      conversation.updatedAt = finalization.updatedAt;
      conversation.lastActivityAt = finalization.updatedAt;
      appendAudit(store, actor, {
        conversationId,
        entityType: "manual_send_mock",
        entityId: finalization.finalizationId,
        eventType: "manual_send_mock_sent",
        detail:
          `Finalizacion mock registrada. recipient=${link.recipient}; subject=${link.subject}; gmailDraftId=${link.gmailDraftId}; mockMessageId=${finalization.mockMessageId}; bodyHash=${link.bodyHash}; confirmationHash=${confirmationHash}; idempotencyKey=${idempotencyKey}; sin envio Gmail real.`,
      });
      writeStore(store);
      return finalization;
    },
    beginFinalGmailDraftSend(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: ManualSendMockConfirmation,
    ) {
      requirePermission(actor, "amazonMessagesSendFinal");
      if (input.externalSend === true) {
        throw new Error("Envio real no autorizado por confirmacion");
      }
      if (input.confirmFinalSendMock !== true) {
        throw new Error("Confirmacion final requerida");
      }
      const idempotencyKey = (input.idempotencyKey ?? "").trim();
      if (!idempotencyKey || idempotencyKey.length < 12) {
        throw new Error("Idempotency key requerida");
      }
      const store = readStore();
      const conversation = ensureConversation(store, conversationId);
      const pendingReply = ensurePendingReply(store, conversationId);
      if (input.conversationId !== conversationId) {
        throw new Error("Confirmacion no coincide con la conversacion");
      }
      if (input.pendingReplyId !== pendingReply.pendingReplyId) {
        throw new Error("Confirmacion no coincide con la respuesta pendiente");
      }
      const existingForKey = store.manualSendMockFinalizations.find(
        (item) =>
          item.idempotencyKey === idempotencyKey &&
          item.conversationId === conversationId &&
          item.pendingReplyId === pendingReply.pendingReplyId,
      );
      if (existingForKey) return existingForKey;
      const existingActive = store.manualSendMockFinalizations.find(
        (item) =>
          item.pendingReplyId === pendingReply.pendingReplyId &&
          (item.status === "SEND_IN_PROGRESS" || item.status === "SENT"),
      );
      if (existingActive) {
        throw new Error("Doble envio bloqueado por idempotencia");
      }
      if (conversation.status === "responded" || conversation.workflowStatus === "CERRADO") {
        throw new Error("Conversacion ya respondida o cerrada");
      }
      if (pendingReply.status !== "APROBADA_PARA_BORRADOR") {
        throw new Error("PendingReply no esta aprobado/listo");
      }
      if (!pendingReply.gmailDraftId) {
        throw new Error("No existe Gmail Draft para envio final");
      }
      const link = store.gmailDraftLinks.find(
        (item) =>
          item.pendingReplyId === pendingReply.pendingReplyId &&
          item.gmailDraftId === pendingReply.gmailDraftId,
      );
      if (!link) {
        throw new Error("GmailDraftLink no encontrado");
      }
      if (input.gmailDraftId !== link.gmailDraftId) {
        throw new Error("Confirmacion no coincide con Gmail Draft");
      }
      if (input.recipient !== link.recipient || input.subject !== link.subject) {
        throw new Error("Destinatario o asunto cambiaron despues de aprobar");
      }
      const currentBodyHash = sha256(pendingReply.replyBody.trim());
      if (
        input.bodyHash !== link.bodyHash ||
        input.bodyHash !== pendingReply.gmailDraftBodyHash ||
        input.bodyHash !== currentBodyHash
      ) {
        throw new Error("bodyHash distinto entre PendingReply y Gmail Draft");
      }
      const now = new Date().toISOString();
      const confirmationHash = sha256(
        JSON.stringify({
          conversationId,
          pendingReplyId: pendingReply.pendingReplyId,
          gmailDraftId: link.gmailDraftId,
          recipient: link.recipient,
          subject: link.subject,
          bodyHash: link.bodyHash,
          idempotencyKey,
        }),
      );
      const finalization: AmazonManualSendMockRecord = {
        finalizationId: `final-gmail-draft-${Date.now()}-${store.manualSendMockFinalizations.length + 1}`,
        conversationId,
        pendingReplyId: pendingReply.pendingReplyId,
        gmailDraftId: link.gmailDraftId,
        gmailThreadId: link.gmailThreadId,
        recipient: link.recipient,
        subject: link.subject,
        bodyHash: link.bodyHash,
        confirmationHash,
        idempotencyKey,
        status: "SEND_IN_PROGRESS",
        mode: "GMAIL_DRAFT",
        requestedBy: actor.name,
        requestedAt: now,
        updatedBy: actor.name,
        updatedAt: now,
        externalSend: false,
      };
      store.manualSendMockFinalizations.push(finalization);
      pendingReply.status = "SEND_IN_PROGRESS";
      pendingReply.updatedAt = now;
      pendingReply.updatedBy = actor.name;
      appendAudit(store, actor, {
        conversationId,
        entityType: "final_gmail_draft",
        entityId: finalization.finalizationId,
        eventType: "final_gmail_draft_in_progress",
        detail:
          `Envio final por draft existente preparado. recipient=${link.recipient}; subject=${link.subject}; gmailDraftId=${link.gmailDraftId}; bodyHash=${link.bodyHash}; confirmationHash=${confirmationHash}; idempotencyKey=${idempotencyKey}.`,
      });
      writeStore(store);
      return finalization;
    },
    recordFinalGmailDraftSent(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: {
        finalizationId: string;
        sentMessageId: string;
      },
    ) {
      requirePermission(actor, "amazonMessagesSendFinal");
      const store = readStore();
      const conversation = ensureConversation(store, conversationId);
      const finalization = store.manualSendMockFinalizations.find(
        (item) => item.finalizationId === input.finalizationId,
      );
      if (!finalization) throw new Error("Finalizacion no encontrada");
      if (finalization.status === "SENT") return finalization;
      if (finalization.status !== "SEND_IN_PROGRESS") {
        throw new Error("Finalizacion no esta en progreso");
      }
      const pendingReply = ensurePendingReply(store, conversationId);
      const now = new Date().toISOString();
      finalization.status = "SENT";
      finalization.sentMessageId = input.sentMessageId;
      finalization.updatedAt = now;
      finalization.updatedBy = actor.name;
      pendingReply.status = "SENT";
      pendingReply.amazonMessageActionId = input.sentMessageId;
      pendingReply.updatedAt = now;
      pendingReply.updatedBy = actor.name;
      const previousStatus = conversation.workflowStatus;
      conversation.status = "responded";
      conversation.workflowStatus = "RESUELTO";
      conversation.closedAt = undefined;
      conversation.updatedAt = now;
      conversation.lastActivityAt = now;
      appendWorkflowHistory(
        conversation,
        actor,
        previousStatus,
        "RESUELTO",
        now,
        "Respuesta enviada desde Gmail Draft y conversacion resuelta.",
      );
      appendAudit(store, actor, {
        conversationId,
        entityType: "final_gmail_draft",
        entityId: finalization.finalizationId,
        eventType: "final_gmail_draft_sent",
        detail:
          `Envio final confirmado por Gmail y conversacion marcada como RESUELTO. gmailDraftId=${finalization.gmailDraftId}; sentMessageId=${input.sentMessageId}; recipient=${finalization.recipient}; subject=${finalization.subject}; bodyHash=${finalization.bodyHash}; confirmationHash=${finalization.confirmationHash}; idempotencyKey=${finalization.idempotencyKey}.`,
      });
      appendAudit(store, actor, {
        conversationId,
        entityType: "conversation",
        entityId: conversationId,
        eventType: "conversation_workflow_changed",
        detail: `Workflow conversacion: ${previousStatus} -> RESUELTO. Actor=${actor.name}. Fecha=${now}. Motivo=respuesta enviada desde Gmail Draft.`,
      });
      writeStore(store);
      return finalization;
    },
    recordFinalGmailDraftFailed(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: {
        finalizationId: string;
        message: string;
      },
    ) {
      requirePermission(actor, "amazonMessagesSendFinal");
      const store = readStore();
      ensureConversation(store, conversationId);
      const finalization = store.manualSendMockFinalizations.find(
        (item) => item.finalizationId === input.finalizationId,
      );
      if (!finalization) throw new Error("Finalizacion no encontrada");
      const pendingReply = ensurePendingReply(store, conversationId);
      const now = new Date().toISOString();
      finalization.status = "SEND_FAILED";
      finalization.lastError = input.message;
      finalization.updatedAt = now;
      finalization.updatedBy = actor.name;
      pendingReply.status = "SEND_FAILED";
      pendingReply.updatedAt = now;
      pendingReply.updatedBy = actor.name;
      appendAudit(store, actor, {
        conversationId,
        entityType: "final_gmail_draft",
        entityId: finalization.finalizationId,
        eventType: "final_gmail_draft_failed",
        detail:
          `Fallo en envio final por draft existente: ${input.message}. Conversacion no cerrada.`,
      });
      writeStore(store);
      return finalization;
    },
    listTemplates(actor: AmazonMessagesActor) {
      requirePermission(actor, "amazonMessages:read");
      return readStore().templates;
    },
    createTemplate(
      actor: AmazonMessagesActor,
      input: Partial<AmazonTemplateRecord>,
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoTemplateExternalSend(input);
      const store = readStore();
      const createdAt = new Date().toISOString();
      const template: AmazonTemplateRecord = {
        templateId: input.templateId ?? `tpl-${Date.now()}`,
        name: required(input.name, "name"),
        templateType: "INTERNAL_RESPONSE",
        category: required(input.category, "category"),
        language: required(input.language, "language"),
        marketplace: required(input.marketplace, "marketplace"),
        content: required(input.content, "content"),
        variables: input.variables ?? [],
        active: input.active ?? true,
        archived: input.archived ?? false,
        externalSend: false,
        createdBy: input.createdBy ?? actor.name,
        updatedBy: input.updatedBy ?? actor.name,
        createdAt,
        updatedAt: createdAt,
      };
      store.templates.push(template);
      appendAudit(store, actor, {
        entityType: "template",
        entityId: template.templateId,
        eventType: "template_created",
        detail: `Plantilla creada para ${template.category}/${template.marketplace}`,
      });
      writeStore(store);
      return template;
    },
    async applyTemplateToInternalDraft(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: { templateId?: string; externalSend?: false },
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoWorkflowExternalSend(input);
      const store = readStore();
      const conversation = ensureConversation(store, conversationId);
      const templateId = required(input.templateId, "templateId");
      const template = store.templates.find((item) => item.templateId === templateId);
      if (!template || template.archived || !template.active) {
        throw new Error("Plantilla interna no disponible");
      }
      const context = conversation.amazonOrderId || conversation.odooOrderId
        ? await resolveOrderContext(process.env as Record<string, string>, {
            amazonOrderId: conversation.amazonOrderId,
            odooOrderId: conversation.odooOrderId,
          })
        : undefined;
      if (context?.order?.id) {
        conversation.odooOrderId = context.order.id;
      }
      const now = new Date().toISOString();
      const draftBody = renderTemplateContent(
        template.content,
        conversation,
        context,
      );
      const existing = store.internalDrafts.find(
        (item) => item.conversationId === conversationId,
      );
      const draft: AmazonInternalDraftRecord = existing
        ? {
            ...existing,
            draftBody,
            status: "BORRADOR_INTERNO",
            reviewStatus: "BORRADOR_INTERNO",
            updatedBy: actor.name,
            updatedAt: now,
            source: "Gmail readonly",
            externalSend: false,
          }
        : {
            draftId: `draft-${Date.now()}-${store.internalDrafts.length + 1}`,
            conversationId,
            draftBody,
            status: "BORRADOR_INTERNO",
            reviewStatus: "BORRADOR_INTERNO",
            reviewHistory: [],
            generatedBy: actor.name,
            generatedAt: now,
            updatedBy: actor.name,
            updatedAt: now,
            source: "Gmail readonly",
            externalSend: false,
          };

      if (existing) {
        Object.assign(existing, draft);
      } else {
        store.internalDrafts.push(draft);
      }
      appendAudit(store, actor, {
        conversationId,
        entityType: "internal_template",
        entityId: template.templateId,
        eventType: "internal_template_applied",
        detail: `Plantilla interna aplicada: ${template.name}. external_send=false; sin IA, sin Roger y sin envio externo.`,
      });
      writeStore(store);
      return draft;
    },
    async generateSmartDraft(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: { externalSend?: false } = {},
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoWorkflowExternalSend(input);
      const store = readStore();
      const conversation = ensureConversation(store, conversationId);
      const context = conversation.amazonOrderId || conversation.odooOrderId
        ? await resolveOrderContext(process.env as Record<string, string>, {
            amazonOrderId: conversation.amazonOrderId,
            odooOrderId: conversation.odooOrderId,
          })
        : undefined;
      if (context?.order?.id) {
        conversation.odooOrderId = context.order.id;
      }
      const message = findLatestInboundCustomerMessage(store, conversationId);
      const customerMessageBody = extractCustomerMessageForDraft(
        message?.content ?? "",
      );
      const messageAnalysis = analyzeCustomerMessage(
        customerMessageBody,
        conversation.category,
        conversation.language ?? message?.language,
        conversation.priority,
      );
      const detectedCategory = messageAnalysis.category;
      const detectedLanguage = messageAnalysis.language;
      const languageConfidence = messageAnalysis.languageConfidence;
      const template = selectSmartTemplate(
        store.templates,
        detectedCategory,
        detectedLanguage,
        conversation.marketplace,
      );
      const knowledgeExamples = selectSmartKnowledgeExamples(
        store.knowledgeExamples,
        customerMessageBody,
        detectedCategory,
        detectedLanguage,
      );
      const warnings = buildSmartDraftWarnings({
        conversation,
        detectedLanguage,
        languageConfidence,
        template,
        knowledgeExamples,
        context,
      });
      const fallbackConfidence = smartDraftConfidence({
        languageConfidence,
        template,
        knowledgeExamples,
        warnings,
        context,
      });
      const now = new Date().toISOString();
      const fallbackDraftBody = buildSmartDraftBody({
        conversation,
        messageBody: customerMessageBody,
        detectedCategory,
        detectedLanguage,
        messageAnalysis,
        template,
        knowledgeExamples,
        warnings,
        context,
      });
      const aiDraft = await generateJuanitoAiDraft({
        conversation,
        messageBody: customerMessageBody,
        detectedCategory,
        detectedLanguage,
        messageAnalysis,
        knowledgeExamples,
        warnings,
        context,
        fallbackDraftBody,
      });
      const draftBody = aiDraft?.draftBody ?? fallbackDraftBody;
      const finalWarnings = Array.from(new Set([...warnings, ...(aiDraft?.warnings ?? [])]));
      const confidence = aiDraft?.confidence ?? fallbackConfidence;
      const existing = store.internalDrafts.find(
        (item) => item.conversationId === conversationId,
      );
      const draft: AmazonInternalDraftRecord = existing
        ? {
            ...existing,
            draftBody,
            status: "BORRADOR_INTERNO",
            reviewStatus: "BORRADOR_INTERNO",
            updatedBy: actor.name,
            updatedAt: now,
            source: "SMART_DRAFT",
            templateId: template?.templateId,
            knowledgeExampleIds: knowledgeExamples.map((item) => item.exampleId),
            detectedLanguage: aiDraft?.customerLanguage ?? detectedLanguage,
            detectedCategory,
            confidence,
            warnings: finalWarnings,
            externalSend: false,
          }
        : {
            draftId: `draft-smart-${Date.now()}-${store.internalDrafts.length + 1}`,
            conversationId,
            draftBody,
            status: "BORRADOR_INTERNO",
            reviewStatus: "BORRADOR_INTERNO",
            reviewHistory: [],
            generatedBy: actor.name,
            generatedAt: now,
            updatedBy: actor.name,
            updatedAt: now,
            source: "SMART_DRAFT",
            templateId: template?.templateId,
            knowledgeExampleIds: knowledgeExamples.map((item) => item.exampleId),
            detectedLanguage: aiDraft?.customerLanguage ?? detectedLanguage,
            detectedCategory,
            confidence,
            warnings: finalWarnings,
            externalSend: false,
          };

      if (existing) {
        Object.assign(existing, draft);
      } else {
        store.internalDrafts.push(draft);
      }
      appendAudit(store, actor, {
        conversationId,
        entityType: "internal_draft",
        entityId: draft.draftId,
        eventType: "smart_draft_generated",
        detail: `Smart draft generado${aiDraft ? " por Juanito IA directa" : " por fallback local"}. Plantilla ${
          template?.templateId ?? "sin plantilla"
        }; ejemplos ${
          draft.knowledgeExampleIds?.join(", ") || "sin ejemplos"
        }; confianza ${Math.round(confidence * 100)}%; warnings ${
          finalWarnings.length ? finalWarnings.join(" | ") : "sin warnings"
        }. external_send=false; sin SP-API, sin Odoo, sin Sendcloud y sin envio externo.`,
      });
      writeStore(store);
      return draft;
    },
    createHermesDraftRequest(
      actor: AmazonMessagesActor,
      conversationId: string,
      input: { externalSend?: false } = {},
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoWorkflowExternalSend(input);
      const store = readStore();
      const conversation = ensureConversation(store, conversationId);
      const now = new Date().toISOString();
      recoverStaleHermesDraftRequests(store, actor);
      const active = store.draftRequests.find(
        (item) =>
          item.conversationId === conversationId &&
          (item.status === "PENDING" || item.status === "IN_PROGRESS"),
      );
      if (active) return active;

      const request: AmazonDraftRequestRecord = {
        requestId: `draft-request-${Date.now()}-${store.draftRequests.length + 1}`,
        conversationId,
        status: "PENDING",
        requestedBy: actor.name,
        requestedAt: now,
        updatedBy: actor.name,
        updatedAt: now,
        warnings: [],
        externalSend: false,
      };
      conversation.workflowStatus =
        conversation.workflowStatus === "RESUELTO" ||
        conversation.workflowStatus === "CERRADO"
          ? conversation.workflowStatus
          : "EN_REVISION";
      conversation.status = legacyStatusFromWorkflow(conversation.workflowStatus);
      conversation.updatedAt = now;
      conversation.lastActivityAt = now;
      store.draftRequests.push(request);
      appendAudit(store, actor, {
        conversationId,
        entityType: "hermes_draft_request",
        entityId: request.requestId,
        eventType: "hermes_draft_requested",
        detail:
          "Solicitud de borrador Hermes creada. external_send=false; sin envio externo.",
      });
      writeStore(store);
      return request;
    },
    claimNextHermesDraftRequest(actor: AmazonMessagesActor) {
      requirePermission(actor, "amazonMessages:manage");
      const store = readStore();
      const recovered = recoverStaleHermesDraftRequests(store, actor);
      const request = store.draftRequests
        .filter((item) => item.status === "PENDING")
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0];
      if (!request) {
        if (recovered) writeStore(store);
        return undefined;
      }

      const now = new Date().toISOString();
      request.status = "IN_PROGRESS";
      request.claimedBy = actor.name;
      request.claimedAt = now;
      request.updatedBy = actor.name;
      request.updatedAt = now;
      appendAudit(store, actor, {
        conversationId: request.conversationId,
        entityType: "hermes_draft_request",
        entityId: request.requestId,
        eventType: "hermes_draft_claimed",
        detail:
          "Solicitud de borrador Hermes recogida por agente. external_send=false; sin envio externo.",
      });
      writeStore(store);
      return request;
    },
    getHermesDraftRequest(actor: AmazonMessagesActor, requestId: string) {
      requirePermission(actor, "amazonMessages:read");
      const store = readStore();
      const request = store.draftRequests.find((item) => item.requestId === requestId);
      if (!request) throw new Error("Solicitud de borrador Hermes no encontrada");
      return request;
    },
    completeHermesDraftRequest(
      actor: AmazonMessagesActor,
      requestId: string,
      input: {
        draftBody?: string;
        operatorSummary?: string;
        customerLanguage?: string;
        confidence?: number;
        warnings?: string[];
        externalSend?: boolean;
      },
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoWorkflowExternalSend(input);
      const store = readStore();
      const request = store.draftRequests.find((item) => item.requestId === requestId);
      if (!request) throw new Error("Solicitud de borrador Hermes no encontrada");
      if (request.status !== "IN_PROGRESS") {
        throw new Error("Solicitud de borrador Hermes no esta en curso");
      }

      const conversation = ensureConversation(store, request.conversationId);
      const now = new Date().toISOString();
      const existing = store.internalDrafts.find(
        (item) => item.conversationId === request.conversationId,
      );
      const draftBody = requiredDraftBody(input.draftBody, "draftBody");
      const warnings = Array.isArray(input.warnings) ? input.warnings : [];
      const draft: AmazonInternalDraftRecord = existing
        ? {
            ...existing,
            draftBody,
            status: "BORRADOR_INTERNO",
            reviewStatus: "BORRADOR_INTERNO",
            updatedBy: actor.name,
            updatedAt: now,
            source: "HERMES_DRAFT",
            detectedLanguage: input.customerLanguage ?? existing.detectedLanguage,
            confidence: input.confidence ?? existing.confidence,
            warnings,
            externalSend: false,
          }
        : {
            draftId: `draft-hermes-${Date.now()}-${store.internalDrafts.length + 1}`,
            conversationId: request.conversationId,
            draftBody,
            status: "BORRADOR_INTERNO",
            reviewStatus: "BORRADOR_INTERNO",
            reviewHistory: [],
            generatedBy: actor.name,
            generatedAt: now,
            updatedBy: actor.name,
            updatedAt: now,
            source: "HERMES_DRAFT",
            detectedLanguage: input.customerLanguage ?? conversation.language,
            confidence: input.confidence,
            warnings,
            externalSend: false,
          };
      if (existing) Object.assign(existing, draft);
      else store.internalDrafts.push(draft);

      conversation.workflowStatus =
        conversation.workflowStatus === "RESUELTO" ||
        conversation.workflowStatus === "CERRADO"
          ? conversation.workflowStatus
          : "EN_REVISION";
      conversation.status = legacyStatusFromWorkflow(conversation.workflowStatus);
      conversation.updatedAt = now;
      conversation.lastActivityAt = now;
      request.status = "COMPLETED";
      request.completedBy = actor.name;
      request.completedAt = now;
      request.updatedBy = actor.name;
      request.updatedAt = now;
      request.draftId = draft.draftId;
      request.operatorSummary = input.operatorSummary;
      request.customerLanguage = input.customerLanguage;
      request.confidence = input.confidence;
      request.warnings = warnings;
      request.externalSend = false;
      appendAudit(store, actor, {
        conversationId: request.conversationId,
        entityType: "hermes_draft_request",
        entityId: request.requestId,
        eventType: "hermes_draft_completed",
        detail: `Borrador Hermes guardado como borrador interno. Confianza ${
          input.confidence === undefined ? "sin dato" : Math.round(input.confidence * 100) + "%"
        }; warnings ${warnings.length ? warnings.join(" | ") : "sin warnings"}. external_send=false; sin envio externo.`,
      });
      writeStore(store);
      return { request, draft };
    },
    failHermesDraftRequest(
      actor: AmazonMessagesActor,
      requestId: string,
      input: { errorMessage?: string; warnings?: string[]; externalSend?: boolean } = {},
    ) {
      requirePermission(actor, "amazonMessages:manage");
      assertNoWorkflowExternalSend(input);
      const store = readStore();
      const request = store.draftRequests.find((item) => item.requestId === requestId);
      if (!request) throw new Error("Solicitud de borrador Hermes no encontrada");

      const now = new Date().toISOString();
      request.status = "FAILED";
      request.failedBy = actor.name;
      request.failedAt = now;
      request.updatedBy = actor.name;
      request.updatedAt = now;
      request.errorMessage = input.errorMessage ?? "Hermes no pudo generar el borrador";
      request.warnings = Array.isArray(input.warnings) ? input.warnings : request.warnings;
      request.externalSend = false;
      appendAudit(store, actor, {
        conversationId: request.conversationId,
        entityType: "hermes_draft_request",
        entityId: request.requestId,
        eventType: "hermes_draft_failed",
        detail: `${request.errorMessage}. external_send=false; sin envio externo.`,
      });
      writeStore(store);
      return request;
    },
    listKnowledge(actor: AmazonMessagesActor, filters: KnowledgeFilters = {}) {
      requirePermission(actor, "amazonMessages:read");
      return filterKnowledgeExamples(readStore().knowledgeExamples, filters);
    },
    saveApprovedKnowledgeExample(
      actor: AmazonMessagesActor,
      input: Partial<AmazonKnowledgeExampleRecord> & {
        conversationId?: string;
        draftId?: string;
        externalSend?: false;
      },
    ) {
      requirePermission(actor, "amazonMessages:validate");
      assertNoKnowledgeExternalSend(input);
      const store = readStore();
      const now = new Date().toISOString();
      const conversation = input.conversationId
        ? ensureConversation(store, input.conversationId)
        : undefined;
      const draft =
        input.draftId
          ? store.internalDrafts.find((item) => item.draftId === input.draftId)
          : input.conversationId
            ? store.internalDrafts.find(
                (item) => item.conversationId === input.conversationId,
              )
            : undefined;
      if (input.conversationId && !draft && !input.finalResponse) {
        throw new Error("No hay borrador aprobado para guardar como conocimiento");
      }
      if (draft && draft.status !== "APROBADO_MANUALMENTE") {
        throw new Error("Solo se guardan borradores aprobados manualmente");
      }
      const message = conversation
        ? findOriginalCustomerMessage(store, conversation.conversationId)
        : undefined;
      const template = input.templateId
        ? store.templates.find((item) => item.templateId === input.templateId)
        : undefined;
      const finalResponse = required(
        input.finalResponse ?? draft?.draftBody,
        "finalResponse",
      );
      const initialDraft = input.initialDraft ?? draft?.draftBody ?? finalResponse;
      const example: AmazonKnowledgeExampleRecord = {
        exampleId:
          input.exampleId ??
          `kb-${Date.now()}-${store.knowledgeExamples.length + 1}`,
        conversationId: input.conversationId,
        category: normalizeKnowledgeCategory(
          input.category ?? conversation?.category ?? template?.category,
        ),
        language:
          input.language ??
          conversation?.language ??
          message?.language ??
          template?.language ??
          "es",
        marketplace:
          input.marketplace ??
          conversation?.marketplace ??
          template?.marketplace ??
          "Amazon ES",
        originalMessage: required(
          input.originalMessage ?? message?.content,
          "originalMessage",
        ),
        amazonOrderId: input.amazonOrderId ?? conversation?.amazonOrderId,
        templateId: input.templateId ?? template?.templateId,
        templateName: input.templateName ?? template?.name,
        initialDraft,
        aiDraft: input.aiDraft ?? initialDraft,
        finalResponse,
        draftDiff:
          input.draftDiff ??
          summarizeDraftDiff(initialDraft, finalResponse, input.humanDiffSummary),
        humanDiffSummary:
          input.humanDiffSummary ??
          summarizeDraftDiff(initialDraft, finalResponse),
        approverId: input.approverId ?? actor.id,
        approver: input.approver ?? draft?.approvedBy ?? actor.name,
        approvedAt: input.approvedAt ?? draft?.approvedAt ?? now,
        quality: input.quality ?? "media",
        confidence: clampConfidence(input.confidence ?? 0.8),
        tags: normalizeTags(input.tags),
        status: input.status ?? "approved",
        sku: input.sku,
        createdAt: input.createdAt ?? now,
        updatedAt: now,
      };
      store.knowledgeExamples.unshift(example);
      appendAudit(store, actor, {
        conversationId: example.conversationId,
        entityType: "knowledge_example",
        entityId: example.exampleId,
        eventType: "knowledge_example_created",
        detail: `Ejemplo aprobado guardado: ${example.category}/${example.language}. external_send=false; aprendizaje controlado sin modificar plantillas.`,
      });
      writeStore(store);
      return example;
    },
    updateKnowledgeTags(
      actor: AmazonMessagesActor,
      exampleId: string,
      input: { tags?: string[]; externalSend?: false },
    ) {
      requirePermission(actor, "amazonMessages:validate");
      assertNoKnowledgeExternalSend(input);
      const store = readStore();
      const example = ensureKnowledgeExample(store, exampleId);
      const previousTags = example.tags.join(", ");
      example.tags = normalizeTags(input.tags);
      example.updatedAt = new Date().toISOString();
      appendAudit(store, actor, {
        conversationId: example.conversationId,
        entityType: "knowledge_example",
        entityId: example.exampleId,
        eventType: "knowledge_tags_updated",
        detail: `Etiquetas modificadas: ${previousTags || "sin etiquetas"} -> ${
          example.tags.join(", ") || "sin etiquetas"
        }. external_send=false.`,
      });
      writeStore(store);
      return example;
    },
    updateKnowledgeCategory(
      actor: AmazonMessagesActor,
      exampleId: string,
      input: { category?: string; externalSend?: false },
    ) {
      requirePermission(actor, "amazonMessages:validate");
      assertNoKnowledgeExternalSend(input);
      const store = readStore();
      const example = ensureKnowledgeExample(store, exampleId);
      const previousCategory = example.category;
      example.category = normalizeKnowledgeCategory(input.category);
      example.updatedAt = new Date().toISOString();
      appendAudit(store, actor, {
        conversationId: example.conversationId,
        entityType: "knowledge_example",
        entityId: example.exampleId,
        eventType: "knowledge_category_changed",
        detail: `Categoria conocimiento: ${previousCategory} -> ${example.category}. external_send=false.`,
      });
      writeStore(store);
      return example;
    },
    addClassification(
      actor: AmazonMessagesActor,
      input: Partial<AmazonClassificationRecord>,
    ) {
      requirePermission(actor, "amazonMessages:validate");
      const store = readStore();
      const conversationId = required(input.conversationId, "conversationId");
      const conversation = store.conversations.find(
        (item) => item.conversationId === conversationId,
      );
      if (!conversation) throw new Error("Conversacion no encontrada");
      const classification: AmazonClassificationRecord = {
        classificationId: input.classificationId ?? `cls-${Date.now()}`,
        conversationId,
        category: required(input.category, "category"),
        priority: required(input.priority, "priority"),
        confidence: input.confidence ?? 1,
        source: input.source ?? "operator",
        createdAt: new Date().toISOString(),
        createdBy: actor.id,
      };
      store.classifications.push(classification);
      conversation.category = classification.category;
      conversation.priority = classification.priority;
      conversation.updatedAt = classification.createdAt;
      appendAudit(store, actor, {
        conversationId,
        entityType: "classification",
        entityId: classification.classificationId,
        eventType: "classification_changed",
        detail: `Clasificacion cambiada a ${classification.category}/${classification.priority}`,
      });
      writeStore(store);
      return classification;
    },
    assignConversation(
      actor: AmazonMessagesActor,
      input: Partial<AmazonOperatorAssignmentRecord>,
    ) {
      requirePermission(actor, "amazonMessages:manage");
      const store = readStore();
      const conversationId = required(input.conversationId, "conversationId");
      const operatorId = required(input.operatorId, "operatorId");
      const conversation = store.conversations.find(
        (item) => item.conversationId === conversationId,
      );
      if (!conversation) throw new Error("Conversacion no encontrada");
      const createdAt = new Date().toISOString();
      const assignment: AmazonOperatorAssignmentRecord = {
        assignmentId: input.assignmentId ?? `assign-${Date.now()}`,
        conversationId,
        operatorId,
        assignedBy: actor.id,
        status: input.status ?? "assigned",
        timeSpentMinutes: input.timeSpentMinutes ?? 0,
        createdAt,
        updatedAt: createdAt,
      };
      store.operatorAssignments.push(assignment);
      conversation.assignedUser = operatorId;
      conversation.updatedAt = createdAt;
      appendAudit(store, actor, {
        conversationId,
        entityType: "assignment",
        entityId: assignment.assignmentId,
        eventType: "assignment_changed",
        detail: `Responsable cambiado a ${operatorId}`,
      });
      writeStore(store);
      return assignment;
    },
    getStats(actor: AmazonMessagesActor) {
      requirePermission(actor, "amazonMessages:read");
      const store = readStore();
      const latestSnapshot = [...store.statisticsSnapshots].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )[0];
      return {
        summary: latestSnapshot?.metrics ?? buildStatsFromStore(store),
        snapshot: latestSnapshot,
        alerts: store.alerts,
      };
    },
    getOperators(actor: AmazonMessagesActor) {
      requirePermission(actor, "amazonMessages:supervise");
      const store = readStore();
      const grouped = new Map<
        string,
        {
          operatorId: string;
          assigned: number;
          responded: number;
          validated: number;
          closed: number;
          timeSpentMinutes: number;
        }
      >();
      for (const assignment of store.operatorAssignments) {
        const row =
          grouped.get(assignment.operatorId) ??
          {
            operatorId: assignment.operatorId,
            assigned: 0,
            responded: 0,
            validated: 0,
            closed: 0,
            timeSpentMinutes: 0,
          };
        row.assigned += assignment.status === "assigned" ? 1 : 0;
        row.responded += assignment.status === "responded" ? 1 : 0;
        row.validated += assignment.status === "validated" ? 1 : 0;
        row.closed += assignment.status === "closed" ? 1 : 0;
        row.timeSpentMinutes += assignment.timeSpentMinutes;
        grouped.set(assignment.operatorId, row);
      }
      return Array.from(grouped.values());
    },
    getGmailSync(actor: AmazonMessagesActor) {
      requirePermission(actor, "amazonMessages:read");
      const store = readStore();
      if (recoverStaleGmailSyncRun(store, actor)) {
        writeStore(store);
      }
      return store.gmailSync;
    },
    configureGmailSyncJob(
      actor: AmazonMessagesActor,
      input: { enabled: boolean; intervalMinutes: number },
    ) {
      requirePermission(actor, "amazonMessages:admin");
      const store = readStore();
      const sync = normalizeStore(store).gmailSync!;
      const changed =
        sync.jobEnabled !== input.enabled ||
        sync.intervalMinutes !== Math.max(1, input.intervalMinutes);
      sync.jobEnabled = input.enabled;
      sync.intervalMinutes = Math.max(1, input.intervalMinutes);
      sync.nextSyncAt ??= addMinutesIso(new Date(), sync.intervalMinutes);
      if (changed) {
        appendAudit(store, actor, {
          entityType: "gmail_sync",
          entityId: sync.account,
          eventType: "gmail_sync_job_configured",
          detail: `Auto-sync ${sync.jobEnabled ? "activo" : "inactivo"} cada ${sync.intervalMinutes} min. external_send=false.`,
        });
      }
      writeStore(store);
      return sync;
    },
    startGmailSyncRun(
      actor: AmazonMessagesActor,
      input: { trigger: AmazonGmailSyncTrigger },
    ) {
      requirePermission(actor, "amazonMessages:manage");
      const store = readStore();
      const sync = normalizeStore(store).gmailSync!;
      if (recoverStaleGmailSyncRun(store, actor)) {
        writeStore(store);
      }
      if (sync.status === "EN_CURSO" && sync.inProgressRunId) {
        appendAudit(store, actor, {
          entityType: "gmail_sync",
          entityId: sync.account,
          eventType: "gmail_sync_overlap_blocked",
          detail: `Sync ${input.trigger} bloqueado: ya existe ${sync.inProgressRunId}. external_send=false.`,
        });
        writeStore(store);
        throw new Error("Sincronizacion Gmail ya en curso");
      }
      const now = new Date().toISOString();
      const runId = `gmail-sync-${Date.now()}-${sync.history.length + 1}`;
      sync.status = "EN_CURSO";
      sync.lastStartedAt = now;
      sync.lastTrigger = input.trigger;
      sync.inProgressRunId = runId;
      sync.lastRunId = runId;
      sync.lastError = undefined;
      sync.history.unshift({
        runId,
        trigger: input.trigger,
        status: "EN_CURSO",
        startedAt: now,
        scanned: 0,
        imported: 0,
        updated: 0,
        duplicates: 0,
        errors: 0,
        processMs: 0,
        externalSend: false,
      });
      sync.history = sync.history.slice(0, 20);
      appendAudit(store, actor, {
        entityType: "gmail_sync",
        entityId: sync.account,
        eventType: "gmail_sync_started",
        detail: `Sync Gmail ${input.trigger} iniciado. readonly=true; external_send=false.`,
      });
      writeStore(store);
      return { runId, sync };
    },
    finishGmailSyncRun(actor: AmazonMessagesActor, input: GmailSyncFinishInput) {
      requirePermission(actor, "amazonMessages:manage");
      const store = readStore();
      const sync = normalizeStore(store).gmailSync!;
      const now = new Date().toISOString();
      sync.status = input.status;
      sync.inProgressRunId =
        sync.inProgressRunId === input.runId ? undefined : sync.inProgressRunId;
      sync.lastFinishedAt = now;
      sync.lastRunId = input.runId;
      sync.lastTrigger = input.trigger;
      sync.labelId = input.labelId ?? sync.labelId;
      sync.lastError = input.status === "ERROR" ? input.message : undefined;
      sync.nextSyncAt = addMinutesIso(new Date(), sync.intervalMinutes);
      const historyItem = sync.history.find((item) => item.runId === input.runId);
      const completed: AmazonGmailSyncHistoryRecord = {
        runId: input.runId,
        trigger: input.trigger,
        status: input.status,
        startedAt: historyItem?.startedAt ?? now,
        finishedAt: now,
        scanned: input.scanned,
        imported: input.imported,
        updated: input.updated,
        duplicates: input.duplicates,
        errors: input.errors,
        processMs: input.processMs,
        message: input.message,
        externalSend: false,
      };
      if (historyItem) {
        Object.assign(historyItem, completed);
      } else {
        sync.history.unshift(completed);
      }
      sync.history = sync.history.slice(0, 20);
      appendAudit(store, actor, {
        entityType: "gmail_sync",
        entityId: sync.account,
        eventType:
          input.status === "OK" ? "gmail_sync_completed" : "gmail_sync_failed",
        detail: `Sync Gmail ${input.trigger}: ${input.status}. Leidos ${input.scanned}, importados ${input.imported}, actualizados ${input.updated}, duplicados ${input.duplicates}, errores ${input.errors}. external_send=false.`,
      });
      writeStore(store);
      return sync;
    },
    async importGmailMessage(actor: AmazonMessagesActor, input: GmailRawImport) {
      requirePermission(actor, "amazonMessages:manage");
      const startedAt = Date.now();
      const store = readStore();
      const parsed = parseAmazonEmail(input.rawEmail, input.gmailMessageId);
      const duplicateReason = findDuplicateReason(store, parsed, input);

      if (duplicateReason) {
        const processMs = Date.now() - startedAt;
        updateGmailSync(store, {
          imported: 0,
          duplicate: 1,
          error: 0,
          processMs,
          historyId: input.historyId,
        });
        appendAudit(store, actor, {
          entityType: "gmail_message",
          entityId: input.gmailMessageId,
          eventType: "gmail_duplicate_ignored",
          detail: `Duplicado ignorado por ${duplicateReason}`,
        });
        writeStore(store);
        return {
          status: "duplicate" as const,
          gmailMessageId: input.gmailMessageId,
          reason: duplicateReason,
          processMs,
        };
      }

      const existingConversation = findConversationForParsedEmail(
        store,
        parsed,
        input,
      );
      const conversation =
        existingConversation ??
        createConversationFromParsedEmail(store, parsed, input.gmailThreadId);
      const wasCreated = !existingConversation;
      const orderContext = parsed.amazonOrderId
        ? await resolveOrderContext(process.env as Record<string, string>, {
            amazonOrderId: parsed.amazonOrderId,
            odooOrderId: conversation.odooOrderId,
          })
        : undefined;
      if (orderContext?.order?.id) {
        conversation.odooOrderId = orderContext.order.id;
      }

      store.messages.push({
        messageId: parsed.messageId,
        conversationId: conversation.conversationId,
        gmailMessageId: input.gmailMessageId,
        gmailThreadId: input.gmailThreadId,
        normalizedHash: parsed.normalizedHash,
        sender: parsed.from,
        direction: "inbound",
        content: parsed.cleanBody,
        classification: parsed.operationalQueue,
        language: parsed.language,
        createdAt: parsed.receivedAt,
        amazonMetadata: {
          notificationType: parsed.notificationType,
          marketplaceId: parsed.marketplaceId ?? null,
          amazonOrderId: parsed.amazonOrderId ?? null,
          buyerAlias: parsed.buyerAlias ?? null,
          uid: parsed.uid,
          historyId: input.historyId ?? null,
        },
      });

      conversation.messageCount += 1;
      conversation.lastMessageAt = parsed.receivedAt;
      conversation.updatedAt = new Date().toISOString();

      store.classifications.push({
        classificationId: `cls-${Date.now()}-${store.classifications.length + 1}`,
        conversationId: conversation.conversationId,
        category: categoryFromParsedEmail(parsed),
        priority: parsed.priority,
        confidence: 0.9,
        source: "parser",
        createdAt: new Date().toISOString(),
        createdBy: actor.id,
      });

      for (const attachment of parsed.attachments) {
        store.attachments.push({
          attachmentId: attachment.id,
          conversationId: conversation.conversationId,
          messageId: parsed.messageId,
          originalName: attachment.originalName,
          sanitizedName: attachment.sanitizedName,
          hash: attachment.hash,
          sizeBytes: attachment.sizeBytes,
          mimeType: attachment.mimeType,
          origin: attachment.origin,
          storageStatus: attachment.allowed ? "metadata_only" : "blocked",
          createdAt: attachment.receivedAt,
        });
        appendAudit(store, actor, {
          conversationId: conversation.conversationId,
          entityType: "attachment",
          entityId: attachment.id,
          eventType: "gmail_attachment_detected",
          detail: `Adjunto detectado: ${attachment.sanitizedName}`,
        });
      }

      appendAudit(store, actor, {
        conversationId: conversation.conversationId,
        entityType: "gmail_message",
        entityId: input.gmailMessageId,
        eventType: "gmail_message_read",
        detail: `Correo Gmail leido desde etiqueta ${
          store.gmailSync?.labelName ?? "AmazonSeller"
        }`,
      });
      appendAudit(store, actor, {
        conversationId: conversation.conversationId,
        entityType: "conversation",
        entityId: conversation.conversationId,
        eventType: wasCreated
          ? "gmail_conversation_created"
          : "gmail_conversation_updated",
        detail: wasCreated
          ? "Conversacion creada desde Gmail readonly"
          : "Conversacion actualizada desde Gmail readonly",
      });
      if (orderContext?.order?.id) {
        appendAudit(store, actor, {
          conversationId: conversation.conversationId,
          entityType: "conversation",
          entityId: conversation.conversationId,
          eventType: "odoo_order_context_linked",
          detail: `Pedido Odoo vinculado por Amazon order id ${parsed.amazonOrderId}. Sendcloud solo lectura.`,
        });
      }

      const processMs = Date.now() - startedAt;
      updateGmailSync(store, {
        imported: wasCreated ? 1 : 0,
        updated: wasCreated ? 0 : 1,
        duplicate: 0,
        error: 0,
        processMs,
        historyId: input.historyId,
      });
      writeStore(store);
      return {
        status: wasCreated ? ("imported" as const) : ("updated" as const),
        gmailMessageId: input.gmailMessageId,
        conversationId: conversation.conversationId,
        messageId: parsed.messageId,
        processMs,
      };
    },
    recordGmailSyncError(
      actor: AmazonMessagesActor,
      input: { message: string; processMs?: number },
    ) {
      requirePermission(actor, "amazonMessages:manage");
      const store = readStore();
      updateGmailSync(store, {
        imported: 0,
        duplicate: 0,
        error: 1,
        processMs: input.processMs ?? 0,
        lastError: input.message,
      });
      appendAudit(store, actor, {
        entityType: "gmail_sync",
        entityId: store.gmailSync?.account ?? "gmail",
        eventType: "gmail_import_error",
        detail: input.message,
      });
      writeStore(store);
      return store.gmailSync;
    },
    readStoreForTests: readStore,
  };
}

export function actorFromDashboardUser(user?: {
  id: string;
  name: string;
  role: string;
  permissions: string[];
}): AmazonMessagesActor | undefined {
  if (!user) return undefined;
  return {
    id: user.id,
    name: user.name,
    role: roleFromDashboardUser(user),
    permissions: user.permissions.filter(
      (permission): permission is AmazonMessagesPermission =>
        permission === "amazonMessagesSendFinal",
    ),
  };
}

function roleFromDashboardUser(user: {
  role: string;
  permissions: string[];
}): AmazonMessagesRole {
  if (user.role === "admin" || user.permissions.includes("settings")) return "ADMIN";
  if (user.permissions.includes("orders") && user.permissions.includes("billing")) {
    return "SUPERVISOR";
  }
  if (user.permissions.includes("orders")) return "OPERADOR";
  return "LECTURA";
}

function buildStatsFromStore(store: AmazonMessagesStore) {
  const workflowCounts = countWorkflowStatuses(store.conversations);
  const smartDrafts = store.internalDrafts.filter(
    (draft) => draft.source === "SMART_DRAFT",
  );
  const smartDraftConfidenceTotal = smartDrafts.reduce(
    (total, draft) => total + (draft.confidence ?? 0),
    0,
  );
  return {
    totalMessages: store.messages.length,
    openCases: store.conversations.filter(
      (item) =>
        item.workflowStatus !== "RESUELTO" && item.workflowStatus !== "CERRADO",
    ).length,
    closedCases: workflowCounts.CERRADO,
    workflowNew: workflowCounts.NUEVO,
    workflowPendingReview: workflowCounts.PENDIENTE_REVISAR,
    workflowInReview: workflowCounts.EN_REVISION,
    workflowReadyToReply: workflowCounts.LISTO_PARA_RESPONDER,
    workflowResolved: workflowCounts.RESUELTO,
    workflowClosed: workflowCounts.CERRADO,
    assignedConversations: store.conversations.filter((item) => item.assignedUser).length,
    criticalCases: store.conversations.filter((item) => item.priority === "urgent").length,
    templateUses: store.templates.filter((item) => item.active && !item.archived).length,
    aiUses: store.classifications.filter((item) => item.source === "ai").length,
    gmailImported: store.gmailSync?.importedCount ?? 0,
    gmailUpdated: store.gmailSync?.updatedCount ?? 0,
    gmailDuplicates: store.gmailSync?.duplicateCount ?? 0,
    gmailErrors: store.gmailSync?.errorCount ?? 0,
    gmailPending: store.gmailSync?.pendingCount ?? 0,
    gmailAverageProcessMs: store.gmailSync?.averageProcessMs ?? 0,
    gmailStatus: store.gmailSync?.status === "ERROR" ? 1 : 0,
    smartDraftsGenerated: smartDrafts.length,
    smartDraftAverageConfidence: smartDrafts.length
      ? Math.round((smartDraftConfidenceTotal / smartDrafts.length) * 100)
      : 0,
    smartDraftsWithWarnings: smartDrafts.filter(
      (draft) => (draft.warnings?.length ?? 0) > 0,
    ).length,
    smartDraftsApproved: smartDrafts.filter(
      (draft) => draft.status === "APROBADO_MANUALMENTE",
    ).length,
  };
}

function normalizeStore(store: AmazonMessagesStore): AmazonMessagesStore {
  store.templates = store.templates.map((template) => ({
    ...template,
    name: template.name ?? nameFromTemplateId(template.templateId, template.category),
    templateType: template.templateType ?? "INTERNAL_RESPONSE",
    externalSend: false,
    createdBy: template.createdBy ?? "system",
    updatedBy: template.updatedBy ?? "system",
  }));
  store.conversations = store.conversations.map((conversation) => ({
    ...conversation,
    workflowStatus: normalizeWorkflowStatus(
      conversation.workflowStatus,
      workflowStatusFromLegacyStatus(conversation.status),
    ),
    assignedAt: conversation.assignedAt,
    lastActivityAt:
      conversation.lastActivityAt ??
      conversation.updatedAt ??
      conversation.lastMessageAt ??
      conversation.createdAt,
    workflowHistory: conversation.workflowHistory ?? [],
  }));
  store.internalDrafts ??= [];
  store.internalDrafts = store.internalDrafts.map((draft) => ({
    ...draft,
    reviewStatus: draft.reviewStatus ?? draft.status,
    reviewHistory: draft.reviewHistory ?? [],
    source: draft.source ?? "Gmail readonly",
    knowledgeExampleIds: draft.knowledgeExampleIds ?? [],
    warnings: draft.warnings ?? [],
    confidence: draft.confidence,
  }));
  store.draftRequests ??= [];
  store.draftRequests = store.draftRequests.map((request) => ({
    ...request,
    status: request.status ?? "PENDING",
    warnings: request.warnings ?? [],
    externalSend: false,
  }));
  store.pendingReplies ??= [];
  store.pendingReplies = store.pendingReplies.map((reply) => ({
    ...reply,
    status: normalizePendingReplyStatus(reply.status, "RESPUESTA_PREPARADA"),
    source: "APPROVED_INTERNAL_DRAFT",
    channel: "INTERNAL_REPLY_PENDING",
    externalSend: false,
    attachments: reply.attachments ?? [],
    history: reply.history ?? [],
  }));
  store.gmailDraftLinks ??= [];
  store.gmailDraftLinks = store.gmailDraftLinks.map((link) => ({
    ...link,
    status: normalizeGmailDraftStatus(link.status),
    externalSend: false,
  }));
  store.manualSendMockFinalizations ??= [];
  store.manualSendMockFinalizations = store.manualSendMockFinalizations.map(
    (finalization) => ({
      ...finalization,
      status: normalizeManualSendMockStatus(finalization.status),
      externalSend: false,
    }),
  );
  store.knowledgeExamples ??= [];
  store.knowledgeExamples = store.knowledgeExamples.map((example) => ({
    ...example,
    conversationId: example.conversationId,
    category: normalizeKnowledgeCategory(example.category),
    language: example.language ?? "es",
    marketplace: example.marketplace ?? "Amazon ES",
    originalMessage: example.originalMessage ?? "",
    initialDraft: example.initialDraft ?? example.aiDraft ?? "",
    aiDraft: example.aiDraft ?? example.initialDraft ?? "",
    finalResponse: example.finalResponse ?? "",
    draftDiff:
      example.draftDiff ??
      example.humanDiffSummary ??
      summarizeDraftDiff(example.aiDraft ?? "", example.finalResponse ?? ""),
    humanDiffSummary:
      example.humanDiffSummary ??
      summarizeDraftDiff(example.aiDraft ?? "", example.finalResponse ?? ""),
    approverId: example.approverId,
    approver: example.approver ?? "Sin aprobador",
    approvedAt: example.approvedAt ?? example.createdAt ?? new Date().toISOString(),
    quality: example.quality ?? "media",
    confidence: clampConfidence(example.confidence ?? 0.8),
    tags: normalizeTags(example.tags),
    status: example.status ?? "approved",
    updatedAt: example.updatedAt ?? example.createdAt ?? new Date().toISOString(),
  }));
  if (!store.gmailSync) {
    store.gmailSync = {
      account:
        process.env.AMAZON_MESSAGES_GMAIL_ACCOUNT ?? "juanitoopenclaw@gmail.com",
      labelName: process.env.AMAZON_MESSAGES_GMAIL_LABEL ?? "AmazonSeller",
      status: "OK",
      jobEnabled: true,
      intervalMinutes: 30,
      importedCount: 0,
      updatedCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      pendingCount: 0,
      averageProcessMs: 0,
      nextSyncAt: addMinutesIso(new Date(), 30),
      history: [],
    };
  }
  store.gmailSync.account =
    store.gmailSync.account ??
    process.env.AMAZON_MESSAGES_GMAIL_ACCOUNT ??
    "juanitoopenclaw@gmail.com";
  store.gmailSync.labelName =
    store.gmailSync.labelName ??
    process.env.AMAZON_MESSAGES_GMAIL_LABEL ??
    "AmazonSeller";
  store.gmailSync.status ??= "OK";
  store.gmailSync.jobEnabled ??= true;
  store.gmailSync.intervalMinutes ??= 30;
  store.gmailSync.updatedCount ??= 0;
  store.gmailSync.history ??= [];
  store.gmailSync.nextSyncAt ??= addMinutesIso(
    new Date(),
    store.gmailSync.intervalMinutes,
  );
  return store;
}

function filterKnowledgeExamples(
  examples: AmazonKnowledgeExampleRecord[],
  filters: KnowledgeFilters,
) {
  const query = filters.query?.trim().toLowerCase();
  const order = filters.order?.trim().toLowerCase();
  return examples.filter((example) => {
    if (filters.category && example.category !== filters.category) return false;
    if (filters.language && example.language !== filters.language) return false;
    if (filters.templateId && example.templateId !== filters.templateId) return false;
    if (filters.approver && example.approver !== filters.approver) return false;
    if (
      order &&
      !example.amazonOrderId?.toLowerCase().includes(order)
    ) {
      return false;
    }
    if (!query) return true;
    return [
      example.originalMessage,
      example.finalResponse,
      example.initialDraft,
      example.draftDiff,
      example.humanDiffSummary,
      example.amazonOrderId,
      example.templateName,
      example.approver,
      example.tags.join(" "),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function ensureKnowledgeExample(store: AmazonMessagesStore, exampleId: string) {
  const example = store.knowledgeExamples.find(
    (item) => item.exampleId === exampleId,
  );
  if (!example) throw new Error("Ejemplo de conocimiento no encontrado");
  return example;
}

function findOriginalCustomerMessage(
  store: AmazonMessagesStore,
  conversationId: string,
) {
  return store.messages.find(
    (message) =>
      message.conversationId === conversationId && message.direction === "inbound",
  );
}

function findLatestInboundCustomerMessage(
  store: AmazonMessagesStore,
  conversationId: string,
) {
  return store.messages
    .filter(
      (message) =>
        message.conversationId === conversationId && message.direction === "inbound",
    )
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )[0];
}

function normalizeKnowledgeCategory(category?: string) {
  const value = category?.trim() || "general";
  const aliases: Record<string, string> = {
    tracking: "seguimiento",
    logistics_incident: "seguimiento",
    not_received: "seguimiento",
    delay: "seguimiento",
    return: "devolucion",
    refund: "devolucion",
    invoice: "factura",
    technical: "consulta tecnica",
    cancellation: "cancelacion",
    wrong_product: "producto incorrecto",
    defect: "producto defectuoso",
    other: "general",
  };
  return aliases[value] ?? value;
}

function normalizeTags(tags?: string[]) {
  return Array.from(
    new Set(
      (tags ?? [])
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12),
    ),
  );
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.8;
  return Math.min(1, Math.max(0, value));
}

function summarizeDraftDiff(
  initialDraft: string,
  finalResponse: string,
  fallback?: string,
) {
  if (fallback?.trim()) return fallback.trim();
  if (initialDraft.trim() === finalResponse.trim()) {
    return "Respuesta aprobada sin cambios relevantes respecto al borrador.";
  }
  return "Respuesta aprobada con ajustes humanos respecto al borrador inicial.";
}

function selectSmartTemplate(
  templates: AmazonTemplateRecord[],
  category: string,
  language: string,
  marketplace: string,
) {
  const activeTemplates = templates.filter(
    (template) => template.active && !template.archived,
  );
  const byCategory = activeTemplates.filter(
    (template) => normalizeKnowledgeCategory(template.category) === category,
  );
  return (
    byCategory.find((template) => template.language === language) ??
    byCategory.find((template) => template.marketplace === marketplace) ??
    byCategory[0] ??
    activeTemplates.find((template) => template.language === language) ??
    activeTemplates[0]
  );
}

function selectSmartKnowledgeExamples(
  examples: AmazonKnowledgeExampleRecord[],
  messageBody: string,
  category: string,
  language: string,
) {
  const messageTokens = tokenSet(messageBody);
  return examples
    .filter((example) => example.status === "approved")
    .map((example) => {
      const categoryScore = example.category === category ? 4 : 0;
      const languageScore = example.language === language ? 2 : 0;
      const tokenScore = overlapScore(
        messageTokens,
        tokenSet(`${example.originalMessage} ${example.finalResponse} ${example.tags.join(" ")}`),
      );
      return { example, score: categoryScore + languageScore + tokenScore };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((item) => item.example);
}

type CustomerIntent =
  | "tracking"
  | "invoice"
  | "return"
  | "cancellation"
  | "warranty"
  | "wrong_product"
  | "delay"
  | "not_received"
  | "technical"
  | "general";

type CustomerMessageAnalysis = {
  language: string;
  languageConfidence: number;
  intent: CustomerIntent;
  category: string;
  urgency: "urgent" | "high" | "normal";
};

function extractCustomerMessageForDraft(content: string) {
  const normalized = content.replace(/\r\n/g, "\n");
  const separatorMatch = normalized.match(
    /-{3,}\s*Message:\s*-{3,}\s*([\s\S]*?)(?:-{3,}\s*Finalizar mensaje\s*-{3,}|-{3,}\s*Resolver caso|$)/i,
  );
  const inlineMatch = normalized.match(
    /\bMessage:\s*([\s\S]*?)(?:\n\s*(?:Ver mensaje|Resolver caso|Informar de actividad sospechosa|Este servicio se proporciona|¿Te parecio|¿Te pareció|Derechos de autor|Amazon, Inc\.|SPC-EUAmazon|commMgrTok)|$)/i,
  );
  const commentMatch = normalized.match(
    /Comentario del cliente\s*:?\s*([\s\S]*?)(?:\n\s*(?:Resolver caso|Derechos de autor|$))/i,
  );
  const selected = separatorMatch?.[1] ?? inlineMatch?.[1] ?? commentMatch?.[1] ?? normalized;
  const nestedMessage = selected.match(
    /\bMessage:\s*([\s\S]*?)(?:\n\s*(?:Ver mensaje|Resolver caso|Informar de actividad sospechosa|Este servicio se proporciona|¿Te parecio|¿Te pareció|Derechos de autor|Amazon, Inc\.|SPC-EUAmazon|commMgrTok)|$)/i,
  );
  return cleanDraftCustomerText(nestedMessage?.[1] ?? selected);
}

function cleanDraftCustomerText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b(?:Content-Type|Content-Transfer-Encoding):[^\n]+/gi, "")
    .replace(/@font-face[\s\S]*?\}/gi, "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function analyzeCustomerMessage(
  messageBody: string,
  fallbackCategory: string,
  fallbackLanguage = "es",
  priority = "normal",
): CustomerMessageAnalysis {
  const normalized = normalizeText(messageBody);
  const language = detectMessageLanguage(normalized, fallbackLanguage);
  const intent = detectCustomerIntent(normalized, fallbackCategory);
  return {
    language,
    languageConfidence: normalized ? 0.9 : 0.58,
    intent,
    category: categoryFromIntent(intent, fallbackCategory),
    urgency:
      priority === "urgent" || includesAny(normalized, ["urgente", "dringend", "urgent", "subito"])
        ? "urgent"
        : priority === "high"
          ? "high"
          : "normal",
  };
}

function detectMessageLanguage(normalized: string, fallbackLanguage: string) {
  if (includesAny(normalized, ["nicht", "bestellung", "paket", "sendung", "rechnung", "stornieren"])) {
    return "de";
  }
  if (includesAny(normalized, ["bonjour", "colis", "commande", "facture", "retour", "annuler"])) {
    return "fr";
  }
  if (includesAny(normalized, ["buongiorno", "ordine", "pacco", "fattura", "reso", "annullare"])) {
    return "it";
  }
  if (includesAny(normalized, ["pedido", "factura", "devolucion", "cancelar", "garantia"])) {
    return "es";
  }
  return fallbackLanguage || "es";
}

function detectCustomerIntent(
  normalized: string,
  fallbackCategory: string,
): CustomerIntent {
  if (includesAny(normalized, ["factura", "rechnung", "fattura", "facture", "invoice"])) return "invoice";
  if (includesAny(normalized, ["cancelar", "stornieren", "annullare", "annuler", "cancel"])) return "cancellation";
  if (
    includesAny(normalized, [
      "devolucion",
      "retour",
      "remboursement",
      "rembourser",
      "reso",
      "ruckgabe",
      "return",
      "refund",
    ])
  ) {
    return "return";
  }
  if (includesAny(normalized, ["garantia", "garantie", "garanzia", "warranty"])) return "warranty";
  if (includesAny(normalized, ["incorrecto", "falsch", "sbagliato", "incorrect", "wrong"])) return "wrong_product";
  if (includesAny(normalized, ["tecnico", "technical", "compatib", "instalar", "montaje"])) return "technical";
  if (includesAny(normalized, ["retras", "verspat", "ritardo", "retard", "delay"])) return "delay";
  if (
    includesAny(normalized, [
      "no he recibido",
      "no recibido",
      "nicht erhalten",
      "non ho ricevuto",
      "pas recu",
      "pas arrive",
      "pas arrivé",
      "je ne l'ai pas",
      "je ne l ai pas",
      "je ne les pas",
      "not received",
      "no ha llegado",
    ])
  ) {
    return "not_received";
  }
  if (includesAny(normalized, ["tracking", "seguimiento", "sendung", "spedizione", "suivi"])) return "tracking";
  const normalizedCategory = normalizeKnowledgeCategory(fallbackCategory);
  if (normalizedCategory === "factura") return "invoice";
  if (normalizedCategory === "devolucion") return "return";
  if (normalizedCategory === "cancelacion") return "cancellation";
  if (normalizedCategory === "consulta tecnica") return "technical";
  if (normalizedCategory === "seguimiento") return "tracking";
  return "general";
}

function categoryFromIntent(intent: CustomerIntent, fallbackCategory: string) {
  if (intent === "invoice") return "factura";
  if (intent === "return") return "devolucion";
  if (intent === "cancellation") return "cancelacion";
  if (intent === "technical") return "consulta tecnica";
  if (intent === "wrong_product") return "producto incorrecto";
  if (intent === "warranty") return "garantia";
  if (intent === "tracking" || intent === "delay" || intent === "not_received") {
    return "seguimiento";
  }
  return normalizeKnowledgeCategory(fallbackCategory);
}

function buildSmartDraftWarnings(input: {
  conversation: AmazonConversationRecord;
  detectedLanguage: string;
  languageConfidence: number;
  template?: AmazonTemplateRecord;
  knowledgeExamples: AmazonKnowledgeExampleRecord[];
  context?: AmazonConversationContextRecord;
}) {
  const warnings = [
    "No se debe prometer reembolso/entrega/garantia sin validacion humana.",
  ];
  if (!input.context?.tracking?.trackingNumber) {
    warnings.push("No hay tracking disponible.");
  }
  if (!input.knowledgeExamples.length) {
    warnings.push("No hay ejemplos similares.");
  }
  if (!input.template) {
    warnings.push("No hay plantilla activa adecuada.");
  }
  if (input.languageConfidence < 0.7) {
    warnings.push("Idioma detectado con baja confianza.");
  }
  return warnings;
}

type JuanitoAiDraftInput = {
  conversation: AmazonConversationRecord;
  messageBody: string;
  detectedCategory: string;
  detectedLanguage: string;
  messageAnalysis: CustomerMessageAnalysis;
  knowledgeExamples: AmazonKnowledgeExampleRecord[];
  warnings: string[];
  context?: AmazonConversationContextRecord;
  fallbackDraftBody: string;
};

type JuanitoAiDraftResult = {
  draftBody: string;
  operatorSummary?: string;
  customerLanguage?: string;
  confidence?: number;
  warnings?: string[];
};

async function generateJuanitoAiDraft(
  input: JuanitoAiDraftInput,
): Promise<JuanitoAiDraftResult | undefined> {
  const config = juanitoAiConfig(process.env as Record<string, string | undefined>);
  if (!config) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(config.provider === "openrouter"
          ? {
              "HTTP-Referer": "https://dashboard.todoelectrico.net",
              "X-Title": "TodoElectrico Dashboard Amazon Messages",
            }
          : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Eres Juanito, asistente interno de TodoElectrico. Redactas borradores prudentes para responder mensajes de clientes Amazon. Nunca prometas reembolso, reposicion, cancelacion, entrega ni garantia si no esta confirmado. No envies nada externo. Devuelve solo JSON valido.",
          },
          {
            role: "user",
            content: JSON.stringify(buildJuanitoAiPrompt(input)),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return undefined;
    const parsed = JSON.parse(content) as Partial<JuanitoAiDraftResult>;
    const draftBody = requiredDraftBody(parsed.draftBody, "draftBody");
    return {
      draftBody,
      operatorSummary:
        typeof parsed.operatorSummary === "string" ? parsed.operatorSummary : undefined,
      customerLanguage:
        typeof parsed.customerLanguage === "string" ? parsed.customerLanguage : undefined,
      confidence:
        typeof parsed.confidence === "number"
          ? clampConfidence(parsed.confidence)
          : undefined,
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.filter((warning): warning is string => typeof warning === "string")
        : [],
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function juanitoAiConfig(env: Record<string, string | undefined>) {
  const provider = (env.AMAZON_MESSAGES_AI_PROVIDER ?? "").toLowerCase();
  const openRouterKey = env.AMAZON_MESSAGES_AI_API_KEY ?? env.OPENROUTER_API_KEY;
  const openAiKey = env.AMAZON_MESSAGES_AI_API_KEY ?? env.OPENAI_API_KEY;
  if (provider === "openai" && openAiKey) {
    return {
      provider,
      apiKey: openAiKey,
      url: env.AMAZON_MESSAGES_AI_BASE_URL ?? "https://api.openai.com/v1/chat/completions",
      model: env.AMAZON_MESSAGES_AI_MODEL ?? "gpt-4o-mini",
      timeoutMs: Number(env.AMAZON_MESSAGES_AI_TIMEOUT_MS ?? 30_000),
    };
  }
  if ((provider === "openrouter" || (!provider && openRouterKey)) && openRouterKey) {
    return {
      provider: "openrouter",
      apiKey: openRouterKey,
      url:
        env.AMAZON_MESSAGES_AI_BASE_URL ??
        "https://openrouter.ai/api/v1/chat/completions",
      model: env.AMAZON_MESSAGES_AI_MODEL ?? "openai/gpt-4o-mini",
      timeoutMs: Number(env.AMAZON_MESSAGES_AI_TIMEOUT_MS ?? 30_000),
    };
  }
  return undefined;
}

function buildJuanitoAiPrompt(input: JuanitoAiDraftInput) {
  const order = input.context?.order;
  const tracking = input.context?.tracking;
  return {
    task:
      "Genera un borrador interno para responder al cliente Amazon. Mantén el idioma del cliente.",
    outputSchema: {
      draftBody: "string obligatorio",
      operatorSummary: "string breve",
      customerLanguage: "es|fr|it|de|pt|en si se detecta",
      confidence: "numero 0..1",
      warnings: "array de strings",
    },
    safetyRules: [
      "No enviar nada al cliente.",
      "No prometer reembolso, reemplazo, garantia, cancelacion ni entrega si no esta confirmado.",
      "Si hay tracking, citarlo como dato disponible sin cerrar el caso si el cliente lo discute.",
      "Si falta informacion, indicar que se revisara y se respondera con datos verificados.",
      "Tono profesional, claro y breve.",
    ],
    conversation: {
      id: input.conversation.conversationId,
      amazonOrderId: input.conversation.amazonOrderId,
      odooOrderId: input.conversation.odooOrderId,
      marketplace: input.conversation.marketplace,
      status: input.conversation.workflowStatus ?? input.conversation.status,
      detectedLanguage: input.detectedLanguage,
      detectedCategory: input.detectedCategory,
      intent: input.messageAnalysis.intent,
      customerMessage: input.messageBody,
    },
    context: {
      order: order
        ? {
          id: order.id,
            odooRef: order.odooRef,
            externalRef: order.externalRef,
            status: order.status,
            total: order.total,
            items: order.items?.slice(0, 4),
          }
        : undefined,
      tracking,
    },
    approvedExamples: input.knowledgeExamples.slice(0, 2).map((example) => ({
      originalMessage: example.originalMessage,
      finalResponse: example.finalResponse,
      category: example.category,
      language: example.language,
    })),
    fallbackDraftBody: input.fallbackDraftBody,
    existingWarnings: input.warnings,
  };
}

function smartDraftConfidence(input: {
  languageConfidence: number;
  template?: AmazonTemplateRecord;
  knowledgeExamples: AmazonKnowledgeExampleRecord[];
  warnings: string[];
  context?: AmazonConversationContextRecord;
}) {
  let confidence = 0.45;
  confidence += input.template ? 0.22 : 0;
  confidence += Math.min(input.knowledgeExamples.length, 2) * 0.11;
  confidence += input.context?.order ? 0.08 : 0;
  confidence += input.context?.tracking ? 0.08 : 0;
  confidence += input.languageConfidence >= 0.7 ? 0.12 : 0;
  confidence -= Math.max(0, input.warnings.length - 1) * 0.05;
  return clampConfidence(confidence);
}

function buildSmartDraftBody(input: {
  conversation: AmazonConversationRecord;
  messageBody: string;
  detectedCategory: string;
  detectedLanguage: string;
  messageAnalysis: CustomerMessageAnalysis;
  template?: AmazonTemplateRecord;
  knowledgeExamples: AmazonKnowledgeExampleRecord[];
  warnings: string[];
  context?: AmazonConversationContextRecord;
}) {
  const language = supportedDraftLanguage(input.detectedLanguage);
  const lines = draftText(language);
  const order = input.context?.order;
  const tracking = input.context?.tracking;
  const amazonOrderId = input.conversation.amazonOrderId;
  const productSummary = order?.items?.length
    ? order.items
        .slice(0, 2)
        .map((item) => `${item.quantity}x ${item.name}`)
        .join(", ")
    : "";
  const orderReference =
    amazonOrderId || order?.externalRef || order?.id || input.conversation.odooOrderId;

  const paragraphs = [
    lines.greeting,
    lines.thanks,
    orderReference ? lines.orderReference(orderReference) : lines.orderMissing,
  ];

  if (productSummary) {
    paragraphs.push(lines.productReference(productSummary));
  }

  paragraphs.push(
    responseForIntent(lines, input.messageAnalysis.intent, tracking),
  );

  if (input.knowledgeExamples.length) {
    paragraphs.push(lines.consistentWithHistory);
  }

  paragraphs.push(lines.close, lines.signature);
  return paragraphs.filter(Boolean).join("\n\n");
}

function supportedDraftLanguage(language: string) {
  if (language === "de" || language === "it" || language === "fr") return language;
  return "es";
}

function draftText(language: "es" | "de" | "it" | "fr") {
  const texts = {
    es: {
      greeting: "Hola,",
      thanks: "Gracias por escribirnos. Hemos revisado tu mensaje y vamos a ayudarte con este caso.",
      orderReference: (reference: string) => `El pedido que tenemos localizado es ${reference}.`,
      orderMissing:
        "No vemos una referencia de pedido suficiente en este mensaje, asi que revisaremos el caso con los datos disponibles.",
      productReference: (products: string) => `Productos localizados en el pedido: ${products}.`,
      trackingFound: (tracking: NonNullable<AmazonConversationContextRecord["tracking"]>) =>
        `El envio figura en ${tracking.carrier} con estado "${tracking.status}" y seguimiento ${tracking.trackingNumber ?? "pendiente de numero"}.${tracking.trackingUrl ? ` Puedes consultarlo aqui: ${tracking.trackingUrl}` : ""}`,
      trackingMissing:
        "Ahora mismo no tenemos un seguimiento confirmado para mostrarte. Vamos a revisar el envio y te responderemos con la informacion verificada.",
      invoice:
        "Vamos a revisar la factura del pedido. Si ya esta disponible, prepararemos la informacion correspondiente; si falta algun dato, te lo indicaremos.",
      cancellation:
        "Vamos a comprobar si el pedido todavia puede cancelarse antes de confirmar nada. Si ya estuviera en preparacion o enviado, te indicaremos la alternativa correcta.",
      return:
        "Vamos a revisar la solicitud de devolucion y te indicaremos los pasos correctos segun el estado del pedido y la politica aplicable.",
      warranty:
        "Vamos a revisar la incidencia y la cobertura aplicable antes de confirmar una solucion. Si necesitamos fotos o mas datos, te lo pediremos.",
      wrongProduct:
        "Vamos a comprobar el pedido y la incidencia del producto recibido para indicarte la solucion adecuada sin asumir datos no verificados.",
      technical:
        "Vamos a revisar tu consulta tecnica. Si podemos confirmarlo con seguridad te responderemos directamente; si no, lo validaremos antes con el equipo.",
      consistentWithHistory:
        "Hemos tenido en cuenta casos similares ya revisados por nuestro equipo.",
      close: "Te responderemos con la informacion confirmada lo antes posible.",
      signature: "Un saludo,\nTodoElectrico",
    },
    de: {
      greeting: "Hallo,",
      thanks: "vielen Dank fuer deine Nachricht. Wir haben dein Anliegen geprueft und helfen dir weiter.",
      orderReference: (reference: string) => `Die zugeordnete Bestellung ist ${reference}.`,
      orderMissing:
        "In dieser Nachricht sehen wir keine ausreichende Bestellreferenz, daher pruefen wir den Fall mit den vorhandenen Daten.",
      productReference: (products: string) => `Im Auftrag gefundene Produkte: ${products}.`,
      trackingFound: (tracking: NonNullable<AmazonConversationContextRecord["tracking"]>) =>
        `Die Sendung ist bei ${tracking.carrier} mit Status "${tracking.status}" und Sendungsnummer ${tracking.trackingNumber ?? "noch nicht verfuegbar"} registriert.${tracking.trackingUrl ? ` Du kannst sie hier verfolgen: ${tracking.trackingUrl}` : ""}`,
      trackingMissing:
        "Aktuell haben wir noch keine bestaetigte Sendungsverfolgung, die wir dir anzeigen koennen. Wir pruefen den Versand und melden uns mit bestaetigten Informationen.",
      invoice:
        "Wir pruefen die Rechnung zur Bestellung. Wenn sie bereits verfuegbar ist, bereiten wir die entsprechenden Informationen vor.",
      cancellation:
        "Wir pruefen zuerst, ob die Bestellung noch storniert werden kann. Wenn sie bereits vorbereitet oder versendet wurde, nennen wir dir die passende Alternative.",
      return:
        "Wir pruefen deine Rueckgabeanfrage und teilen dir die korrekten Schritte gemaess Bestellstatus und Richtlinie mit.",
      warranty:
        "Wir pruefen den Vorfall und die moegliche Abdeckung, bevor wir eine Loesung bestaetigen.",
      wrongProduct:
        "Wir pruefen die Bestellung und den gemeldeten Artikel, damit wir dir eine passende Loesung nennen koennen.",
      technical:
        "Wir pruefen deine technische Frage. Wenn wir sie sicher bestaetigen koennen, antworten wir direkt; andernfalls validieren wir sie intern.",
      consistentWithHistory:
        "Wir beruecksichtigen aehnliche Faelle, die unser Team bereits geprueft hat.",
      close: "Wir melden uns so schnell wie moeglich mit bestaetigten Informationen.",
      signature: "Viele Gruesse\nTodoElectrico",
    },
    it: {
      greeting: "Buongiorno,",
      thanks: "grazie per averci scritto. Abbiamo letto il tuo messaggio e verifichiamo il caso.",
      orderReference: (reference: string) => `L'ordine individuato e ${reference}.`,
      orderMissing:
        "Nel messaggio non vediamo un riferimento ordine sufficiente, quindi controlleremo il caso con i dati disponibili.",
      productReference: (products: string) => `Prodotti trovati nell'ordine: ${products}.`,
      trackingFound: (tracking: NonNullable<AmazonConversationContextRecord["tracking"]>) =>
        `La spedizione risulta su ${tracking.carrier} con stato "${tracking.status}" e tracking ${tracking.trackingNumber ?? "non ancora disponibile"}.${tracking.trackingUrl ? ` Puoi seguirla qui: ${tracking.trackingUrl}` : ""}`,
      trackingMissing:
        "Al momento non abbiamo un tracking confermato da mostrarti. Verifichiamo la spedizione e ti risponderemo con informazioni confermate.",
      invoice:
        "Verifichiamo la fattura dell'ordine. Se e gia disponibile, prepareremo le informazioni corrispondenti.",
      cancellation:
        "Controlliamo prima se l'ordine puo ancora essere annullato. Se fosse gia in preparazione o spedito, ti indicheremo l'alternativa corretta.",
      return:
        "Verifichiamo la richiesta di reso e ti indicheremo i passaggi corretti in base allo stato dell'ordine.",
      warranty:
        "Verifichiamo l'incidenza e la copertura applicabile prima di confermare una soluzione.",
      wrongProduct:
        "Controlliamo l'ordine e il prodotto ricevuto per indicarti la soluzione corretta.",
      technical:
        "Verifichiamo la tua domanda tecnica. Se possiamo confermarla con sicurezza ti risponderemo direttamente; altrimenti la controlleremo internamente.",
      consistentWithHistory:
        "Abbiamo considerato casi simili gia verificati dal nostro team.",
      close: "Ti risponderemo il prima possibile con informazioni confermate.",
      signature: "Cordiali saluti,\nTodoElectrico",
    },
    fr: {
      greeting: "Bonjour,",
      thanks: "merci pour votre message. Nous avons lu votre demande et nous allons verifier ce dossier.",
      orderReference: (reference: string) => `La commande identifiee est ${reference}.`,
      orderMissing:
        "Nous ne voyons pas de reference de commande suffisante dans ce message, nous verifierons donc le dossier avec les donnees disponibles.",
      productReference: (products: string) => `Produits trouves dans la commande : ${products}.`,
      trackingFound: (tracking: NonNullable<AmazonConversationContextRecord["tracking"]>) =>
        `L'envoi apparait chez ${tracking.carrier} avec le statut "${tracking.status}" et le suivi ${tracking.trackingNumber ?? "pas encore disponible"}.${tracking.trackingUrl ? ` Vous pouvez le consulter ici : ${tracking.trackingUrl}` : ""}`,
      trackingMissing:
        "Pour le moment, nous n'avons pas de suivi confirme a vous communiquer. Nous allons verifier l'expedition et vous repondre avec les informations confirmees.",
      invoice:
        "Nous allons verifier la facture de la commande. Si elle est deja disponible, nous preparerons les informations correspondantes.",
      cancellation:
        "Nous allons verifier si la commande peut encore etre annulee avant de confirmer quoi que ce soit.",
      return:
        "Nous allons verifier votre demande de retour et vous indiquer les etapes correctes selon l'etat de la commande.",
      warranty:
        "Nous allons verifier l'incident et la couverture applicable avant de confirmer une solution.",
      wrongProduct:
        "Nous allons verifier la commande et le produit recu afin de vous indiquer la solution adaptee.",
      technical:
        "Nous allons verifier votre question technique. Si nous pouvons confirmer la reponse avec certitude, nous vous repondrons directement.",
      consistentWithHistory:
        "Nous avons tenu compte de cas similaires deja verifies par notre equipe.",
      close: "Nous vous repondrons des que possible avec des informations confirmees.",
      signature: "Cordialement,\nTodoElectrico",
    },
  };
  return texts[language];
}

function responseForIntent(
  lines: ReturnType<typeof draftText>,
  intent: CustomerIntent,
  tracking?: AmazonConversationContextRecord["tracking"],
) {
  if (intent === "invoice") return lines.invoice;
  if (intent === "cancellation") return lines.cancellation;
  if (intent === "return") return lines.return;
  if (intent === "warranty") return lines.warranty;
  if (intent === "wrong_product") return lines.wrongProduct;
  if (intent === "technical") return lines.technical;
  if (intent === "tracking" || intent === "delay" || intent === "not_received") {
    return tracking ? lines.trackingFound(tracking) : lines.trackingMissing;
  }
  return tracking ? lines.trackingFound(tracking) : lines.trackingMissing;
}

function tokenSet(value: string) {
  return new Set(
    normalizeText(value)
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 4),
  );
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(normalizeText(needle)));
}

function overlapScore(left: Set<string>, right: Set<string>) {
  let score = 0;
  for (const token of left) {
    if (right.has(token)) score += 1;
  }
  return Math.min(score, 4);
}

function ensureConversation(store: AmazonMessagesStore, conversationId: string) {
  const conversation = store.conversations.find(
    (item) => item.conversationId === conversationId,
  );
  if (!conversation) throw new Error("Conversacion no encontrada");
  return conversation;
}

function normalizeWorkflowStatus(
  status: AmazonConversationWorkflowStatus | undefined,
  fallback: AmazonConversationWorkflowStatus,
): AmazonConversationWorkflowStatus {
  if (
    status === "NUEVO" ||
    status === "PENDIENTE_REVISAR" ||
    status === "EN_REVISION" ||
    status === "LISTO_PARA_RESPONDER" ||
    status === "RESUELTO" ||
    status === "CERRADO"
  ) {
    return status;
  }
  return fallback;
}

function workflowStatusFromLegacyStatus(status: string): AmazonConversationWorkflowStatus {
  if (status === "closed") return "CERRADO";
  if (status === "resolved") return "RESUELTO";
  if (status === "responded" || status === "responded_mock") return "RESUELTO";
  if (status === "pending_internal") return "PENDIENTE_REVISAR";
  if (status === "open") return "PENDIENTE_REVISAR";
  return "NUEVO";
}

function legacyStatusFromWorkflow(status: AmazonConversationWorkflowStatus) {
  if (status === "CERRADO") return "closed";
  if (status === "RESUELTO") return "resolved";
  if (status === "NUEVO") return "new";
  if (status === "PENDIENTE_REVISAR") return "pending_internal";
  if (status === "EN_REVISION") return "pending_internal";
  return "open";
}

function validateWorkflowTransition(
  store: AmazonMessagesStore,
  conversation: AmazonConversationRecord,
  newStatus: AmazonConversationWorkflowStatus,
  input: {
    confirmPendingDraft?: boolean;
    confirmUnreviewed?: boolean;
    confirmClosedReopen?: boolean;
  },
) {
  const previousStatus = conversation.workflowStatus;
  if (previousStatus === newStatus) return;

  if (newStatus === "RESUELTO") {
    if (previousStatus === "CERRADO") {
      throw new Error("Una conversacion cerrada debe reabrirse antes de marcarse resuelta");
    }
    const pendingDraft = store.internalDrafts.find(
      (draft) =>
        draft.conversationId === conversation.conversationId &&
        draft.status !== "SIN_BORRADOR" &&
        draft.status !== "APROBADO_MANUALMENTE" &&
        draft.status !== "RECHAZADO",
    );
    if (pendingDraft && input.confirmPendingDraft !== true) {
      throw new Error("Confirmacion requerida: hay borrador pendiente");
    }
    if (
      (previousStatus === "NUEVO" || previousStatus === "PENDIENTE_REVISAR") &&
      input.confirmUnreviewed !== true
    ) {
      throw new Error("Confirmacion requerida: hay mensaje sin revisar");
    }
    return;
  }

  if (previousStatus === "RESUELTO" && newStatus === "EN_REVISION") return;
  if (previousStatus === "RESUELTO" && newStatus === "CERRADO") return;

  if (
    previousStatus === "CERRADO" &&
    newStatus === "EN_REVISION" &&
    input.confirmClosedReopen !== true
  ) {
    throw new Error("Confirmacion requerida para reabrir una conversacion cerrada");
  }
}

function appendWorkflowHistory(
  conversation: AmazonConversationRecord,
  actor: AmazonMessagesActor,
  previousStatus: AmazonConversationWorkflowStatus,
  newStatus: AmazonConversationWorkflowStatus,
  createdAt: string,
  reason?: string,
) {
  conversation.workflowHistory ??= [];
  if (previousStatus === newStatus) return;
  conversation.workflowHistory.push({
    eventId: `workflow-${Date.now()}-${conversation.workflowHistory.length + 1}`,
    conversationId: conversation.conversationId,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    previousStatus,
    newStatus,
    reason: reason?.trim() || undefined,
    createdAt,
  });
}

function countWorkflowStatuses(conversations: AmazonConversationRecord[]) {
  return conversations.reduce<Record<AmazonConversationWorkflowStatus, number>>(
    (counts, conversation) => {
      counts[conversation.workflowStatus] += 1;
      return counts;
    },
    {
      NUEVO: 0,
      PENDIENTE_REVISAR: 0,
      EN_REVISION: 0,
      LISTO_PARA_RESPONDER: 0,
      RESUELTO: 0,
      CERRADO: 0,
    },
  );
}

function emptyInternalDraft(conversationId: string): AmazonInternalDraftRecord {
  return {
    draftId: `draft-empty-${conversationId}`,
    conversationId,
    draftBody: "",
    status: "SIN_BORRADOR",
    generatedBy: "",
    generatedAt: "",
    updatedBy: "",
    updatedAt: "",
    reviewStatus: "SIN_BORRADOR",
    reviewNotes: "",
    reviewHistory: [],
    source: "Gmail readonly",
    externalSend: false,
  };
}

function emptyPendingReply(conversationId: string): AmazonPendingReplyRecord {
  return {
    pendingReplyId: `pending-reply-empty-${conversationId}`,
    conversationId,
    draftId: "",
    replyBody: "",
    status: "SIN_RESPUESTA",
    validationNotes: "",
    preparedBy: "",
    preparedAt: "",
    updatedBy: "",
    updatedAt: "",
    source: "APPROVED_INTERNAL_DRAFT",
    channel: "INTERNAL_REPLY_PENDING",
    externalSend: false,
    attachments: [],
    history: [],
  };
}

function normalizeDraftStatus(
  status: AmazonInternalDraftStatus | undefined,
  fallback: AmazonInternalDraftStatus,
): AmazonInternalDraftStatus {
  if (
    status === "SIN_BORRADOR" ||
    status === "BORRADOR_INTERNO" ||
    status === "LISTO_PARA_REVISAR" ||
    status === "APROBADO_MANUALMENTE" ||
    status === "RECHAZADO" ||
    status === "NECESITA_CAMBIOS"
  ) {
    return status;
  }
  return fallback;
}

function normalizePendingReplyStatus(
  status: AmazonPendingReplyStatus | undefined,
  fallback: AmazonPendingReplyStatus,
): AmazonPendingReplyStatus {
  if (
    status === "SIN_RESPUESTA" ||
    status === "RESPUESTA_PREPARADA" ||
    status === "PENDIENTE_VALIDACION" ||
    status === "APROBADA_PARA_BORRADOR" ||
    status === "READY_TO_SEND" ||
    status === "SEND_IN_PROGRESS" ||
    status === "SENT_MOCK" ||
    status === "SENT" ||
    status === "SEND_FAILED" ||
    status === "NECESITA_CAMBIOS" ||
    status === "RECHAZADA" ||
    status === "CANCELADA"
  ) {
    return status;
  }
  return fallback;
}

function normalizeGmailDraftStatus(
  status: AmazonGmailDraftStatus | undefined,
): AmazonGmailDraftStatus {
  if (
    status === "SIN_BORRADOR_GMAIL" ||
    status === "BORRADOR_GMAIL_CREADO" ||
    status === "BORRADOR_GMAIL_ACTUALIZADO" ||
    status === "ERROR"
  ) {
    return status;
  }
  return "SIN_BORRADOR_GMAIL";
}

function normalizeManualSendMockStatus(
  status: AmazonManualSendMockStatus | undefined,
): AmazonManualSendMockStatus {
  if (
    status === "READY_TO_SEND" ||
    status === "SEND_IN_PROGRESS" ||
    status === "SENT_MOCK" ||
    status === "SENT" ||
    status === "SEND_FAILED"
  ) {
    return status;
  }
  return "READY_TO_SEND";
}

function assertNoExternalSend(input: Partial<AmazonInternalDraftRecord>) {
  if (input.externalSend === true) {
    throw new Error("Envio externo deshabilitado para borradores internos");
  }
}

function assertNoWorkflowExternalSend(input: { externalSend?: boolean }) {
  if (input.externalSend === true) {
    throw new Error("Envio externo deshabilitado para workflow interno");
  }
}

function assertNoTemplateExternalSend(input: Partial<AmazonTemplateRecord>) {
  if (input.externalSend === true) {
    throw new Error("Envio externo deshabilitado para plantillas internas");
  }
}

function assertNoKnowledgeExternalSend(input: { externalSend?: boolean }) {
  if (input.externalSend === true) {
    throw new Error("Envio externo deshabilitado para base de conocimiento");
  }
}

function assertNoPendingReplyExternalSend(input: { externalSend?: boolean }) {
  if (input.externalSend === true) {
    throw new Error("Envio externo deshabilitado para respuestas pendientes");
  }
}

function renderTemplateContent(
  content: string,
  conversation: AmazonConversationRecord,
  context?: AmazonConversationContextRecord,
) {
  const order = context?.order;
  const tracking = context?.tracking;
  const values: Record<string, string> = {
    cliente: conversation.assignedUser ?? "Soporte",
    amazon_order_id: conversation.amazonOrderId ?? "pedido sin referencia",
    marketplace: conversation.marketplace,
    odoo_order:
      order?.id ?? order?.odooRef ?? conversation.odooOrderId ?? "sin pedido Odoo vinculado",
    transportista: tracking?.carrier ?? "pendiente de revisar",
    tracking: tracking?.trackingNumber ?? "pendiente de revisar",
    tracking_url: tracking?.trackingUrl ?? "pendiente de revisar",
    producto: "producto del pedido",
    fecha_entrega: "pendiente de confirmar",
    fecha_envio: "pendiente de confirmar",
  };
  return content.replace(/\{([a-z_]+)\}/g, (_match, key: string) => {
    return values[key] ?? `{${key}}`;
  });
}

function nameFromTemplateId(templateId: string, category: string) {
  if (templateId.includes("az")) return "Revision A-to-Z interna";
  if (templateId.includes("not-received")) return "Pedido no recibido";
  return `Plantilla ${category}`;
}

function ensurePendingReply(
  store: AmazonMessagesStore,
  conversationId: string,
) {
  const pendingReply = store.pendingReplies.find(
    (item) => item.conversationId === conversationId,
  );
  if (!pendingReply) throw new Error("Respuesta pendiente no encontrada");
  return pendingReply;
}

function findApprovedDraftForPendingReply(
  store: AmazonMessagesStore,
  conversationId: string,
  draftId?: string,
) {
  const draft = store.internalDrafts.find((item) =>
    draftId
      ? item.draftId === draftId && item.conversationId === conversationId
      : item.conversationId === conversationId,
  );
  if (!draft || !draft.draftBody.trim()) {
    throw new Error("No hay borrador interno aprobado para preparar respuesta");
  }
  if (draft.status !== "APROBADO_MANUALMENTE") {
    throw new Error("Solo un borrador aprobado manualmente puede preparar respuesta");
  }
  return draft;
}

function extractEmail(value: string | undefined) {
  return value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function isAmazonRelayRecipient(value: string) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("marketplace.amazon") ||
    normalized.includes("amazon.") ||
    normalized.includes("amazonsellerservices")
  );
}

function stringMetadata(value: string | number | boolean | null | undefined) {
  return typeof value === "string" ? value : undefined;
}

function buildReplySubject(
  originalContent: string,
  pendingReply: AmazonPendingReplyRecord,
  store: AmazonMessagesStore,
) {
  const originalSubject = originalContent.match(/^Subject:\s*(.+)$/im)?.[1]?.trim();
  if (originalSubject) {
    return /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
  }
  const conversation = store.conversations.find(
    (item) => item.conversationId === pendingReply.conversationId,
  );
  return conversation?.amazonOrderId
    ? `Re: Pedido Amazon ${conversation.amazonOrderId}`
    : "Re: Mensaje Amazon";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function applyPendingReplyReviewFields(
  pendingReply: AmazonPendingReplyRecord,
  actor: AmazonMessagesActor,
  previousStatus: AmazonPendingReplyStatus,
  newStatus: AmazonPendingReplyStatus,
  createdAt: string,
  note?: string,
) {
  pendingReply.history ??= [];
  pendingReply.externalSend = false;
  if (note !== undefined) pendingReply.validationNotes = note;
  if (newStatus === "APROBADA_PARA_BORRADOR") {
    pendingReply.approvedBy = actor.name;
    pendingReply.approvedAt = createdAt;
  }
  if (newStatus === "RECHAZADA" || newStatus === "CANCELADA") {
    pendingReply.rejectedBy = actor.name;
    pendingReply.rejectedAt = createdAt;
  }
  if (previousStatus !== newStatus || note) {
    pendingReply.history.push({
      eventId: `pending-reply-review-${Date.now()}-${pendingReply.history.length + 1}`,
      pendingReplyId: pendingReply.pendingReplyId,
      conversationId: pendingReply.conversationId,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      previousStatus,
      newStatus,
      note,
      createdAt,
    });
  }
}

function applyDraftReviewFields(
  draft: AmazonInternalDraftRecord,
  actor: AmazonMessagesActor,
  previousStatus: AmazonInternalDraftStatus,
  newStatus: AmazonInternalDraftStatus,
  createdAt: string,
  note?: string,
) {
  draft.reviewHistory ??= [];
  draft.reviewStatus = newStatus;
  draft.externalSend = false;
  if (note !== undefined) draft.reviewNotes = note;
  if (newStatus === "APROBADO_MANUALMENTE") {
    draft.approvedBy = actor.name;
    draft.approvedAt = createdAt;
  }
  if (newStatus === "RECHAZADO") {
    draft.rejectedBy = actor.name;
    draft.rejectedAt = createdAt;
  }
  if (previousStatus !== newStatus || note) {
    draft.reviewHistory.push({
      eventId: `draft-review-${Date.now()}-${draft.reviewHistory.length + 1}`,
      draftId: draft.draftId,
      conversationId: draft.conversationId,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      previousStatus,
      newStatus,
      note,
      createdAt,
    });
  }
}

function findDuplicateReason(
  store: AmazonMessagesStore,
  parsed: ParsedAmazonEmail,
  input: GmailRawImport,
) {
  if (
    store.messages.some((message) => message.gmailMessageId === input.gmailMessageId)
  ) {
    return "gmail-message-id";
  }
  if (store.messages.some((message) => message.messageId === parsed.messageId)) {
    return "message-id";
  }
  if (
    store.messages.some(
      (message) => message.normalizedHash === parsed.normalizedHash,
    )
  ) {
    return "normalized-hash";
  }
  return undefined;
}

function findConversationForParsedEmail(
  store: AmazonMessagesStore,
  parsed: ParsedAmazonEmail,
  input: GmailRawImport,
) {
  if (parsed.amazonOrderId) {
    const byOrder = store.conversations.find(
      (conversation) => conversation.amazonOrderId === parsed.amazonOrderId,
    );
    if (byOrder) return byOrder;
  }
  if (input.gmailThreadId) {
    const byThread = store.messages.find(
      (message) => message.gmailThreadId === input.gmailThreadId,
    );
    if (byThread) {
      return store.conversations.find(
        (conversation) => conversation.conversationId === byThread.conversationId,
      );
    }
  }
  if (parsed.buyerAlias) {
    const byBuyer = store.messages.find(
      (message) => message.amazonMetadata.buyerAlias === parsed.buyerAlias,
    );
    if (byBuyer) {
      return store.conversations.find(
        (conversation) => conversation.conversationId === byBuyer.conversationId,
      );
    }
  }
  return undefined;
}

function createConversationFromParsedEmail(
  store: AmazonMessagesStore,
  parsed: ParsedAmazonEmail,
  gmailThreadId?: string,
) {
  const createdAt = new Date().toISOString();
  const conversation: AmazonConversationRecord = {
    conversationId: `amz-gmail-${parsed.amazonOrderId ?? gmailThreadId ?? parsed.uid}`,
    category: categoryFromParsedEmail(parsed),
    priority: parsed.priority,
    status: parsed.priority === "urgent" ? "pending_internal" : "open",
    workflowStatus:
      parsed.priority === "urgent" ? "PENDIENTE_REVISAR" : "NUEVO",
    marketplace: parsed.marketplace ?? "Amazon",
    language: parsed.language,
    amazonOrderId: parsed.amazonOrderId,
    assignedUser: parsed.priority === "urgent" ? "Rafa" : "Soporte",
    assignedAt: createdAt,
    lastActivityAt: createdAt,
    workflowHistory: [],
    createdAt,
    updatedAt: createdAt,
    firstMessageAt: parsed.receivedAt,
    lastMessageAt: parsed.receivedAt,
    messageCount: 0,
  };
  store.conversations.push(conversation);
  return conversation;
}

function categoryFromParsedEmail(parsed: ParsedAmazonEmail) {
  if (parsed.operationalQueue === "critical") return "a_to_z";
  if (parsed.operationalQueue === "returns") return "return";
  if (parsed.operationalQueue === "cancellations") return "cancellation";
  if (parsed.operationalQueue === "invoices") return "invoice";
  if (parsed.operationalQueue === "logistics") return "logistics_incident";
  return "other";
}

function updateGmailSync(
  store: AmazonMessagesStore,
  input: {
    imported: number;
    updated?: number;
    duplicate: number;
    error: number;
    processMs: number;
    historyId?: string;
    labelId?: string;
    lastError?: string;
  },
) {
  const current = normalizeStore(store).gmailSync!;
  const previousProcessed =
    current.importedCount +
    current.updatedCount +
    current.duplicateCount +
    current.errorCount;
  const nextProcessed = Math.max(
    previousProcessed +
      input.imported +
      (input.updated ?? 0) +
      input.duplicate +
      input.error,
    1,
  );
  current.importedCount += input.imported;
  current.updatedCount += input.updated ?? 0;
  current.duplicateCount += input.duplicate;
  current.errorCount += input.error;
  current.averageProcessMs = Math.round(
    (current.averageProcessMs * previousProcessed + input.processMs) /
      nextProcessed,
  );
  current.lastSyncedAt = new Date().toISOString();
  current.lastHistoryId = input.historyId ?? current.lastHistoryId;
  current.labelId = input.labelId ?? current.labelId;
  current.lastError = input.lastError;
  if (current.status !== "EN_CURSO") {
    current.status = input.error ? "ERROR" : "OK";
  }
  current.pendingCount = 0;
}

function recoverStaleGmailSyncRun(
  store: AmazonMessagesStore,
  actor: AmazonMessagesActor,
) {
  const current = normalizeStore(store).gmailSync!;
  if (current.status !== "EN_CURSO" || !current.inProgressRunId) return false;
  const startedAtMs = new Date(current.lastStartedAt ?? 0).getTime();
  const maxRunMs = Math.max(current.intervalMinutes, 30) * 2 * 60_000;
  if (!startedAtMs || Date.now() - startedAtMs < maxRunMs) return false;

  const now = new Date().toISOString();
  const message =
    "Sync Gmail anterior marcada como abandonada tras reinicio/caida del Dashboard.";
  current.status = "ERROR";
  current.lastError = message;
  current.lastFinishedAt = now;
  current.nextSyncAt = now;
  const runId = current.inProgressRunId;
  current.inProgressRunId = undefined;
  const historyItem = current.history.find((item) => item.runId === runId);
  if (historyItem) {
    historyItem.status = "ERROR";
    historyItem.finishedAt = now;
    historyItem.errors = Math.max(historyItem.errors, 1);
    historyItem.message = message;
    historyItem.processMs = Math.max(
      historyItem.processMs,
      Date.now() - new Date(historyItem.startedAt).getTime(),
    );
  }
  store.auditLogs.push({
    auditId: `audit-${Date.now()}-${store.auditLogs.length + 1}`,
    entityType: "gmail_sync",
    entityId: current.account,
    eventType: "gmail_sync_stale_recovered",
    actorId: actor.id,
    actorRole: actor.role,
    detail: `${message} runId=${runId}; external_send=false.`,
    createdAt: now,
  });
  return true;
}

function addMinutesIso(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Campo requerido: ${field}`);
  }
  return value;
}

function requiredDraftBody(value: unknown, field: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const nested = value as Record<string, unknown>;
    for (const key of ["draftBody", "body", "text", "message"]) {
      if (typeof nested[key] === "string" && nested[key].trim()) {
        return nested[key];
      }
    }
  }
  throw new Error(`Campo requerido: ${field} debe ser texto no vacio`);
}
