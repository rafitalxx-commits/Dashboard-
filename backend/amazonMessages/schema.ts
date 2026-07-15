import type { Order } from "../../src/services/odooTypes.ts";

export type AmazonMessagesRole =
  | "ADMIN"
  | "SUPERVISOR"
  | "OPERADOR"
  | "LECTURA"
  | "AGENTE_IA";

export type AmazonMessagesPermission =
  | "amazonMessages:read"
  | "amazonMessages:manage"
  | "amazonMessages:supervise"
  | "amazonMessages:validate"
  | "amazonMessages:aiDraft"
  | "amazonMessages:gmailDraft"
  | "amazonMessages:admin"
  | "amazonMessagesSendFinal";

export const rolePermissions: Record<
  AmazonMessagesRole,
  AmazonMessagesPermission[]
> = {
  ADMIN: [
    "amazonMessages:read",
    "amazonMessages:manage",
    "amazonMessages:supervise",
    "amazonMessages:validate",
    "amazonMessages:aiDraft",
    "amazonMessages:gmailDraft",
    "amazonMessages:admin",
  ],
  SUPERVISOR: [
    "amazonMessages:read",
    "amazonMessages:supervise",
    "amazonMessages:validate",
  ],
  OPERADOR: [
    "amazonMessages:read",
    "amazonMessages:manage",
    "amazonMessages:validate",
    "amazonMessages:aiDraft",
    "amazonMessages:gmailDraft",
  ],
  LECTURA: ["amazonMessages:read"],
  AGENTE_IA: ["amazonMessages:read", "amazonMessages:aiDraft"],
};

export type AmazonMessagesActor = {
  id: string;
  name: string;
  role: AmazonMessagesRole;
  permissions?: AmazonMessagesPermission[];
};

export type AmazonConversationWorkflowStatus =
  | "NUEVO"
  | "PENDIENTE_REVISAR"
  | "EN_REVISION"
  | "LISTO_PARA_RESPONDER"
  | "RESUELTO"
  | "CERRADO";

export type AmazonConversationWorkflowEvent = {
  eventId: string;
  conversationId: string;
  actorId: string;
  actorName: string;
  actorRole: AmazonMessagesRole;
  previousStatus: AmazonConversationWorkflowStatus;
  newStatus: AmazonConversationWorkflowStatus;
  reason?: string;
  createdAt: string;
};

export type AmazonConversationRecord = {
  conversationId: string;
  category: string;
  priority: string;
  status: string;
  workflowStatus: AmazonConversationWorkflowStatus;
  marketplace: string;
  language?: string;
  amazonOrderId?: string;
  odooOrderId?: string;
  assignedUser?: string;
  assignedAt?: string;
  closedAt?: string;
  lastActivityAt: string;
  workflowHistory: AmazonConversationWorkflowEvent[];
  createdAt: string;
  updatedAt: string;
  firstMessageAt: string;
  lastMessageAt: string;
  responseMinutes?: number;
  resolutionMinutes?: number;
  messageCount: number;
};

export type AmazonConversationContextRecord = {
  order?: Order;
  tracking?: {
    carrier: string;
    status: string;
    trackingNumber?: string;
    trackingUrl?: string;
    lastEvent: string;
    updatedAt: string;
  };
};

export type AmazonMessageRecord = {
  messageId: string;
  conversationId: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  normalizedHash?: string;
  sender: string;
  direction: "inbound" | "outbound" | "internal";
  content: string;
  classification?: string;
  language?: string;
  createdAt: string;
  amazonMetadata: Record<string, string | number | boolean | null>;
};

export type AmazonAttachmentRecord = {
  attachmentId: string;
  conversationId: string;
  messageId: string;
  originalName: string;
  sanitizedName: string;
  hash: string;
  sizeBytes?: number;
  mimeType: string;
  origin: string;
  storageStatus: "metadata_only" | "stored" | "blocked";
  createdAt: string;
};

export type AmazonTemplateRecord = {
  templateId: string;
  name: string;
  templateType: "INTERNAL_RESPONSE";
  category: string;
  language: string;
  marketplace: string;
  content: string;
  variables: string[];
  active: boolean;
  archived: boolean;
  externalSend: false;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AmazonKnowledgeExampleRecord = {
  exampleId: string;
  conversationId?: string;
  category: string;
  language: string;
  marketplace: string;
  originalMessage: string;
  amazonOrderId?: string;
  templateId?: string;
  templateName?: string;
  initialDraft: string;
  aiDraft: string;
  finalResponse: string;
  draftDiff: string;
  humanDiffSummary: string;
  approverId?: string;
  approver: string;
  approvedAt: string;
  quality: string;
  confidence: number;
  tags: string[];
  status: "approved" | "ignored" | "archived";
  sku?: string;
  createdAt: string;
  updatedAt: string;
};

export type AmazonClassificationRecord = {
  classificationId: string;
  conversationId: string;
  category: string;
  priority: string;
  confidence: number;
  source: "parser" | "operator" | "ai";
  createdAt: string;
  createdBy: string;
};

export type AmazonAuditLogRecord = {
  auditId: string;
  conversationId?: string;
  entityType: string;
  entityId: string;
  eventType: string;
  actorId: string;
  actorRole: AmazonMessagesRole;
  detail: string;
  createdAt: string;
};

export type AmazonInternalDraftStatus =
  | "SIN_BORRADOR"
  | "BORRADOR_INTERNO"
  | "LISTO_PARA_REVISAR"
  | "APROBADO_MANUALMENTE"
  | "RECHAZADO"
  | "NECESITA_CAMBIOS";

export type AmazonInternalDraftReviewEvent = {
  eventId: string;
  draftId: string;
  conversationId: string;
  actorId: string;
  actorName: string;
  actorRole: AmazonMessagesRole;
  previousStatus: AmazonInternalDraftStatus;
  newStatus: AmazonInternalDraftStatus;
  note?: string;
  createdAt: string;
};

export type AmazonInternalDraftRecord = {
  draftId: string;
  conversationId: string;
  draftBody: string;
  status: AmazonInternalDraftStatus;
  reviewStatus: AmazonInternalDraftStatus;
  reviewNotes?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  reviewHistory: AmazonInternalDraftReviewEvent[];
  generatedBy: string;
  generatedAt: string;
  updatedBy: string;
  updatedAt: string;
  source: "Gmail readonly" | "SMART_DRAFT" | "AGENT_API" | "HERMES_DRAFT";
  templateId?: string;
  knowledgeExampleIds?: string[];
  detectedLanguage?: string;
  detectedCategory?: string;
  confidence?: number;
  warnings?: string[];
  externalSend: false;
};

export type AmazonDraftRequestStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";

export type AmazonDraftRequestRecord = {
  requestId: string;
  conversationId: string;
  status: AmazonDraftRequestStatus;
  requestedBy: string;
  requestedAt: string;
  updatedBy: string;
  updatedAt: string;
  claimedBy?: string;
  claimedAt?: string;
  completedBy?: string;
  completedAt?: string;
  failedBy?: string;
  failedAt?: string;
  draftId?: string;
  operatorSummary?: string;
  customerLanguage?: string;
  confidence?: number;
  warnings: string[];
  errorMessage?: string;
  externalSend: false;
};

export type AmazonPendingReplyStatus =
  | "SIN_RESPUESTA"
  | "RESPUESTA_PREPARADA"
  | "PENDIENTE_VALIDACION"
  | "APROBADA_PARA_BORRADOR"
  | "READY_TO_SEND"
  | "SEND_IN_PROGRESS"
  | "SENT_MOCK"
  | "SENT"
  | "SEND_FAILED"
  | "NECESITA_CAMBIOS"
  | "RECHAZADA"
  | "CANCELADA";

export type AmazonPendingReplyReviewEvent = {
  eventId: string;
  pendingReplyId: string;
  conversationId: string;
  actorId: string;
  actorName: string;
  actorRole: AmazonMessagesRole;
  previousStatus: AmazonPendingReplyStatus;
  newStatus: AmazonPendingReplyStatus;
  note?: string;
  createdAt: string;
};

export type AmazonPendingReplyAttachmentRecord = {
  attachmentId: string;
  originalName: string;
  sanitizedName: string;
  hash: string;
  sizeBytes?: number;
  mimeType: string;
  storageStatus: "metadata_only" | "blocked";
  createdAt: string;
};

export type AmazonPendingReplyRecord = {
  pendingReplyId: string;
  conversationId: string;
  draftId: string;
  replyBody: string;
  status: AmazonPendingReplyStatus;
  validationNotes?: string;
  preparedBy: string;
  preparedAt: string;
  updatedBy: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  source: "APPROVED_INTERNAL_DRAFT";
  channel: "INTERNAL_REPLY_PENDING";
  externalSend: false;
  gmailDraftId?: string;
  gmailDraftRecipient?: string;
  gmailDraftSubject?: string;
  gmailDraftBodyHash?: string;
  gmailDraftCreatedBy?: string;
  gmailDraftCreatedAt?: string;
  gmailDraftUpdatedBy?: string;
  gmailDraftUpdatedAt?: string;
  amazonMessageActionId?: string;
  attachments: AmazonPendingReplyAttachmentRecord[];
  history: AmazonPendingReplyReviewEvent[];
};

export type AmazonOutboundMode = "disabled" | "draft_only" | "manual_send";

export type AmazonGmailDraftStatus =
  | "SIN_BORRADOR_GMAIL"
  | "BORRADOR_GMAIL_CREADO"
  | "BORRADOR_GMAIL_ACTUALIZADO"
  | "ERROR";

export type AmazonGmailDraftLinkRecord = {
  linkId: string;
  conversationId: string;
  pendingReplyId: string;
  gmailDraftId: string;
  gmailThreadId?: string;
  recipient: string;
  subject: string;
  bodyHash: string;
  status: AmazonGmailDraftStatus;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  lastError?: string;
  externalSend: false;
};

export type AmazonManualSendMockStatus =
  | "READY_TO_SEND"
  | "SEND_IN_PROGRESS"
  | "SENT_MOCK"
  | "SENT"
  | "SEND_FAILED";

export type AmazonManualSendMockRecord = {
  finalizationId: string;
  conversationId: string;
  pendingReplyId: string;
  gmailDraftId: string;
  gmailThreadId?: string;
  recipient: string;
  subject: string;
  bodyHash: string;
  confirmationHash: string;
  idempotencyKey: string;
  status: AmazonManualSendMockStatus;
  mockMessageId?: string;
  sentMessageId?: string;
  mode?: "MOCK" | "GMAIL_DRAFT";
  requestedBy: string;
  requestedAt: string;
  updatedBy: string;
  updatedAt: string;
  lastError?: string;
  externalSend: false;
};

export type AmazonGmailSyncRunStatus = "OK" | "ERROR" | "EN_CURSO";

export type AmazonGmailSyncTrigger = "manual" | "auto";

export type AmazonGmailSyncHistoryRecord = {
  runId: string;
  trigger: AmazonGmailSyncTrigger;
  status: AmazonGmailSyncRunStatus;
  startedAt: string;
  finishedAt?: string;
  scanned: number;
  imported: number;
  updated: number;
  duplicates: number;
  errors: number;
  processMs: number;
  message?: string;
  externalSend: false;
};

export type AmazonGmailSyncState = {
  account: string;
  labelName: string;
  labelId?: string;
  lastSyncedAt?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  nextSyncAt?: string;
  lastHistoryId?: string;
  lastRunId?: string;
  lastTrigger?: AmazonGmailSyncTrigger;
  inProgressRunId?: string;
  status: AmazonGmailSyncRunStatus;
  jobEnabled: boolean;
  intervalMinutes: number;
  importedCount: number;
  updatedCount: number;
  duplicateCount: number;
  errorCount: number;
  pendingCount: number;
  averageProcessMs: number;
  lastError?: string;
  history: AmazonGmailSyncHistoryRecord[];
};

export type AmazonGmailImportResult = {
  status: "imported" | "updated" | "duplicate" | "error";
  gmailMessageId: string;
  conversationId?: string;
  messageId?: string;
  reason?: string;
  processMs: number;
};

export type AmazonOperatorAssignmentRecord = {
  assignmentId: string;
  conversationId: string;
  operatorId: string;
  assignedBy: string;
  status: "assigned" | "responded" | "validated" | "closed";
  timeSpentMinutes: number;
  createdAt: string;
  updatedAt: string;
};

export type AmazonStatisticsSnapshotRecord = {
  snapshotId: string;
  rangeKey: "today" | "last_7_days" | "last_30_days" | "current_month";
  metrics: Record<string, number>;
  createdAt: string;
};

export type AmazonAlertRecord = {
  alertId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  status: "open" | "acknowledged" | "closed";
  createdAt: string;
};

export type AmazonMessagesStore = {
  schemaVersion: 1;
  conversations: AmazonConversationRecord[];
  messages: AmazonMessageRecord[];
  attachments: AmazonAttachmentRecord[];
  templates: AmazonTemplateRecord[];
  knowledgeExamples: AmazonKnowledgeExampleRecord[];
  classifications: AmazonClassificationRecord[];
  auditLogs: AmazonAuditLogRecord[];
  internalDrafts: AmazonInternalDraftRecord[];
  draftRequests: AmazonDraftRequestRecord[];
  pendingReplies: AmazonPendingReplyRecord[];
  gmailDraftLinks: AmazonGmailDraftLinkRecord[];
  manualSendMockFinalizations: AmazonManualSendMockRecord[];
  operatorAssignments: AmazonOperatorAssignmentRecord[];
  statisticsSnapshots: AmazonStatisticsSnapshotRecord[];
  alerts: AmazonAlertRecord[];
  gmailSync?: AmazonGmailSyncState;
};

export const amazonMessagesSqlSchema = [
  `create table amazon_conversations (
    conversation_id text primary key,
    category text not null,
    priority text not null,
    status text not null,
    workflow_status text not null,
    marketplace text not null,
    language text,
    amazon_order_id text,
    odoo_order_id text,
    assigned_user text,
    assigned_at text,
    closed_at text,
    last_activity_at text not null,
    workflow_history_json text not null,
    created_at text not null,
    updated_at text not null,
    first_message_at text not null,
    last_message_at text not null,
    response_minutes integer,
    resolution_minutes integer,
    message_count integer not null default 0
  )`,
  `create table amazon_messages (
    message_id text primary key,
    conversation_id text not null references amazon_conversations(conversation_id),
    gmail_message_id text,
    gmail_thread_id text,
    normalized_hash text,
    sender text not null,
    direction text not null,
    content text not null,
    classification text,
    language text,
    created_at text not null,
    amazon_metadata_json text not null
  )`,
  `create table amazon_attachments (
    attachment_id text primary key,
    conversation_id text not null references amazon_conversations(conversation_id),
    message_id text not null references amazon_messages(message_id),
    original_name text not null,
    sanitized_name text not null,
    hash text not null,
    size_bytes integer,
    mime_type text not null,
    origin text not null,
    storage_status text not null,
    created_at text not null
  )`,
  `create table amazon_templates (
    template_id text primary key,
    name text not null,
    template_type text not null,
    category text not null,
    language text not null,
    marketplace text not null,
    content text not null,
    variables_json text not null,
    active integer not null,
    archived integer not null,
    external_send integer not null default 0,
    created_by text not null,
    updated_by text not null,
    created_at text not null,
    updated_at text not null
  )`,
  `create table amazon_knowledge_examples (
    example_id text primary key,
    category text not null,
    language text not null,
    marketplace text not null,
    original_message text not null,
    ai_draft text not null,
    final_response text not null,
    human_diff_summary text not null,
    approver text not null,
    quality text not null,
    status text not null,
    sku text,
    amazon_order_id text,
    created_at text not null,
    updated_at text not null
  )`,
  `create table amazon_audit_logs (
    audit_id text primary key,
    conversation_id text,
    entity_type text not null,
    entity_id text not null,
    event_type text not null,
    actor_id text not null,
    actor_role text not null,
    detail text not null,
    created_at text not null
  )`,
  `create table amazon_internal_drafts (
    draft_id text primary key,
    conversation_id text not null unique references amazon_conversations(conversation_id),
    draft_body text not null,
    status text not null,
    generated_by text not null,
    generated_at text not null,
    updated_by text not null,
    updated_at text not null,
    source text not null,
    external_send integer not null default 0,
    review_status text not null,
    review_notes text,
    approved_by text,
    approved_at text,
    rejected_by text,
    rejected_at text,
    review_history_json text not null
  )`,
  `create table amazon_pending_replies (
    pending_reply_id text primary key,
    conversation_id text not null unique references amazon_conversations(conversation_id),
    draft_id text not null references amazon_internal_drafts(draft_id),
    reply_body text not null,
    status text not null,
    validation_notes text,
    prepared_by text not null,
    prepared_at text not null,
    updated_by text not null,
    updated_at text not null,
    approved_by text,
    approved_at text,
    rejected_by text,
    rejected_at text,
    source text not null,
    channel text not null,
    external_send integer not null default 0,
    gmail_draft_id text,
    amazon_message_action_id text,
    attachments_json text not null,
    history_json text not null
  )`,
  `create table amazon_gmail_sync_state (
    account text primary key,
    label_name text not null,
    label_id text,
    last_synced_at text,
    last_history_id text,
    imported_count integer not null default 0,
    duplicate_count integer not null default 0,
    error_count integer not null default 0,
    pending_count integer not null default 0,
    average_process_ms integer not null default 0,
    last_error text
  )`,
] as const;
