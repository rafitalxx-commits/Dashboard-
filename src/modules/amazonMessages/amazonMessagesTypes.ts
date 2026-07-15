import type { Order } from "../../services/odooTypes";

export type AmazonConversationStatus =
  | "new"
  | "open"
  | "pending_customer"
  | "pending_internal"
  | "resolved"
  | "closed"
  | "responded"
  | "responded_mock";

export type AmazonWorkflowStatus =
  | "NUEVO"
  | "PENDIENTE_REVISAR"
  | "EN_REVISION"
  | "LISTO_PARA_RESPONDER"
  | "RESUELTO"
  | "CERRADO";

export type AmazonConversationPriority = "urgent" | "high" | "normal" | "low";

export type AmazonNotificationType =
  | "BBC_MESSAGE_SENT_TO_MERCHANT"
  | "BRC_SELLER_NOTIFICATION"
  | "RETURN_REQUEST"
  | "A_Z_CLAIM_RESPONDENT_CLOSE"
  | "UNKNOWN";

export type AmazonOperationalQueue =
  | "conversations"
  | "logistics"
  | "cancellations"
  | "returns"
  | "critical"
  | "invoices"
  | "unclassified";

export type AmazonMessageCategory =
  | "seguimiento"
  | "devolucion"
  | "garantia"
  | "factura"
  | "consulta tecnica"
  | "cancelacion"
  | "producto incorrecto"
  | "producto defectuoso"
  | "general"
  | "tracking"
  | "delay"
  | "not_received"
  | "invoice"
  | "warranty"
  | "defect"
  | "wrong_product"
  | "return"
  | "refund"
  | "cancellation"
  | "a_to_z"
  | "technical"
  | "logistics_incident"
  | "other";

export type AmazonMatchConfidence = "exact" | "strong" | "weak" | "unmatched";

export type AmazonAttachmentKind = "image" | "pdf" | "text" | "other" | "blocked";

export type AmazonAttachmentOrigin =
  | "amazon_email_relay"
  | "operator_upload"
  | "odoo_document"
  | "system";

export type AmazonAttachmentMetadata = {
  id: string;
  conversationId?: string;
  messageId: string;
  originalName: string;
  sanitizedName: string;
  mimeType: string;
  extension: string;
  sizeBytes?: number;
  hash: string;
  receivedAt: string;
  origin: AmazonAttachmentOrigin;
  downloadable: boolean;
  previewable: boolean;
  isImage: boolean;
  isPdf: boolean;
  kind: AmazonAttachmentKind;
  allowed: boolean;
  blockedReason?: string;
  visualAnalysisReady: boolean;
  visualAnalysisHints: Array<
    | "broken_product"
    | "wrong_product"
    | "damaged_packaging"
    | "visible_label"
    | "visible_serial_number"
  >;
};

export type ParsedAmazonEmail = {
  uid: string;
  messageId: string;
  subject: string;
  bodyText: string;
  cleanBody: string;
  from: string;
  to: string;
  receivedAt: string;
  headers: Record<string, string>;
  amazonOrderId?: string;
  buyerAlias?: string;
  marketplace?: string;
  marketplaceId?: string;
  notificationType: AmazonNotificationType;
  language?: string;
  sku?: string;
  asin?: string;
  quantity?: number;
  amount?: number;
  currency?: string;
  reason?: string;
  operationalStatus?: string;
  customerComment?: string;
  recommendedAction: string;
  operationalQueue: AmazonOperationalQueue;
  priority: AmazonConversationPriority;
  isInternationalReturnAddressRisk: boolean;
  attachmentNames: string[];
  attachments: AmazonAttachmentMetadata[];
  normalizedHash: string;
};

export type AmazonSupportMessage = {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound" | "internal";
  source: "amazon_email_relay" | "amazon_sp_api" | "operator_note" | "system";
  externalMessageId: string;
  subject: string;
  bodyText: string;
  fromLabel: string;
  toLabel: string;
  receivedAt: string;
  attachmentNames: string[];
  attachments: AmazonAttachmentMetadata[];
};

export type AmazonAuditEvent = {
  id: string;
  conversationId: string;
  eventType:
    | "imported"
    | "classified"
    | "draft_generated"
    | "draft_edited"
    | "status_changed"
    | "assigned"
    | "linked"
    | "deduplicated"
    | "attachment_received"
    | "attachment_viewed"
    | "attachment_downloaded"
    | "template_created"
    | "template_modified"
    | "knowledge_approved"
    | "knowledge_archived"
    | "ai_suggestion_generated"
    | "response_approved"
    | "response_discarded"
    | "conversation_workflow_changed"
    | "conversation_assigned";
  label: string;
  actor: string;
  createdAt: string;
};

export type AmazonAiDraft = {
  id: string;
  conversationId: string;
  category: AmazonMessageCategory;
  confidence: number;
  body: string;
  status:
    | "SIN_BORRADOR"
    | "suggested"
    | "edited"
    | "accepted"
    | "rejected"
    | "BORRADOR_INTERNO"
    | "LISTO_PARA_REVISAR"
    | "APROBADO_MANUALMENTE"
    | "RECHAZADO"
    | "NECESITA_CAMBIOS";
  generatedAt: string;
  templateId?: string;
  templateName?: string;
  consultedKnowledgeIds: string[];
  detectedLanguage?: string;
  detectedCategory?: string;
  warnings?: string[];
  suggestionMode: "approved_template" | "approved_examples" | "free_generation";
  humanDiffSummary?: string;
  reviewStatus?: string;
  reviewNotes?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  reviewHistory?: Array<{
    eventId: string;
    actorName: string;
    actorRole: string;
    previousStatus: string;
    newStatus: string;
    note?: string;
    createdAt: string;
  }>;
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

export type AmazonPendingReply = {
  id: string;
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
  channel: "INTERNAL_REPLY_PENDING" | "GMAIL_DRAFT_PENDING";
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
  history: Array<{
    eventId: string;
    actorName: string;
    actorRole: string;
    previousStatus: AmazonPendingReplyStatus;
    newStatus: AmazonPendingReplyStatus;
    note?: string;
    createdAt: string;
  }>;
};

export type AmazonKnowledgeStatus = "active" | "archived" | "ignored";

export type AmazonQualityScore = "high" | "medium" | "low" | "unknown";

export type AmazonKnowledgeEntry = {
  id: string;
  category: AmazonMessageCategory;
  conversationId?: string;
  marketplace: string;
  language: string;
  date: string;
  originalCustomerMessage: string;
  classification: string;
  templateId?: string;
  templateName?: string;
  initialDraft: string;
  aiDraft: string;
  finalResponse: string;
  approver: string;
  quality: AmazonQualityScore;
  confidence: number;
  tags: string[];
  sku?: string;
  amazonOrderId?: string;
  status: AmazonKnowledgeStatus;
  useAsApprovedExample: boolean;
  anonymized: boolean;
  approvedAt: string;
  draftDiff: string;
  humanDiffSummary: string;
};

export type AmazonTemplateStatus = "active" | "inactive" | "archived";

export type AmazonTemplate = {
  id: string;
  name: string;
  category: AmazonMessageCategory;
  marketplace: string;
  language: string;
  status: AmazonTemplateStatus;
  body: string;
  variables: string[];
  usageCount: number;
  acceptanceRate: number;
  createdBy: string;
  updatedAt: string;
};

export type AmazonStatsRange =
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "current_month";

export type AmazonOperatorStats = {
  operator: string;
  assigned: number;
  responded: number;
  validated: number;
  timeSpentMinutes: number;
  closedCases: number;
  pendingCases: number;
  templateUses: number;
  aiUses: number;
  corrections: number;
  averageResponseMinutes: number;
};

export type AmazonStatRow = {
  label: string;
  value: number;
  critical?: boolean;
};

export type AmazonProductStats = {
  sku: string;
  asin?: string;
  incidents: number;
  returns: number;
  technicalQuestions: number;
  claims: number;
  aToZ: number;
};

export type AmazonLogisticsStats = {
  carrier: string;
  incidents: number;
  delays: number;
  notReceived: number;
  deliveryProblems: number;
  country: string;
};

export type AmazonSmartAlert = {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  metric: string;
  createdAt: string;
};

export type AmazonSupportBotCapability = {
  question: string;
  dataSource: string;
  endpoint: string;
  ready: boolean;
};

export type AmazonStatsSummary = {
  totalMessages: number;
  byCategory: AmazonStatRow[];
  byMarketplace: AmazonStatRow[];
  byLanguage: AmazonStatRow[];
  byPriority: AmazonStatRow[];
  byStatus: AmazonStatRow[];
  kpis: {
    averageResponseMinutes: number;
    averageResolutionHours: number;
    openCases: number;
    closedCases: number;
    criticalCases: number;
    templateUses: number;
    aiUses: number;
    humanCorrections: number;
    acceptedWithoutChanges: number;
    modifiedResponses: number;
    discardedResponses: number;
  };
};

export type AmazonConversationContext = {
  order?: Order;
  tracking?: {
    carrier: string;
    status: string;
    trackingNumber?: string;
    trackingUrl?: string;
    lastEvent: string;
    updatedAt: string;
  };
  invoice?: {
    ref: string;
    status: string;
    pdfAvailable: boolean;
  };
};

export type AmazonConversation = {
  id: string;
  marketplace: string;
  amazonOrderId?: string;
  odooOrderId?: string;
  customerDisplayName: string;
  buyerAliasHash: string;
  subject: string;
  status: AmazonConversationStatus;
  workflowStatus?: AmazonWorkflowStatus;
  assignedAt?: string;
  closedAt?: string;
  lastActivityAt?: string;
  workflowHistory?: Array<{
    eventId: string;
    actorName: string;
    actorRole: string;
    previousStatus: AmazonWorkflowStatus;
    newStatus: AmazonWorkflowStatus;
    reason?: string;
    createdAt: string;
  }>;
  category: AmazonMessageCategory;
  notificationType: AmazonNotificationType;
  operationalQueue: AmazonOperationalQueue;
  recommendedAction: string;
  extracted: {
    language?: string;
    sku?: string;
    asin?: string;
    quantity?: number;
    amount?: number;
    currency?: string;
    reason?: string;
    operationalStatus?: string;
    customerComment?: string;
    isInternationalReturnAddressRisk: boolean;
  };
  priority: AmazonConversationPriority;
  assignedUser: string;
  respondingUser?: string;
  validatingUser?: string;
  timeSpentMinutes: number;
  unreadCount: number;
  lastMessageAt: string;
  matchConfidence: AmazonMatchConfidence;
  messages: AmazonSupportMessage[];
  draft?: AmazonAiDraft;
  pendingReply?: AmazonPendingReply;
  audit: AmazonAuditEvent[];
  context: AmazonConversationContext;
};

export type AmazonInboxFilter =
  | "all"
  | "workflow_new"
  | "workflow_pending"
  | "workflow_review"
  | "workflow_ready"
  | "workflow_resolved"
  | "workflow_closed";
