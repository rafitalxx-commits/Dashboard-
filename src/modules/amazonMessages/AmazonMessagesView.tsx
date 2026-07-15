import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bot,
  Brain,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Inbox,
  Lightbulb,
  Mail,
  Package,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Truck,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import type { Order } from "../../services/odooTypes";
import {
  buildAmazonDemoConversations,
  buildAmazonKnowledgeEntries,
  buildAmazonLogisticsStats,
  buildAmazonOperatorStats,
  buildAmazonProductStats,
  buildAmazonSmartAlerts,
  buildAmazonStatsSummary,
  buildAmazonSupportBotCapabilities,
  buildAmazonTemplates,
} from "./amazonMessagesDemoData";
import { buildAttachmentMetadata } from "./amazonEmailParser";
import type {
  AmazonAttachmentMetadata,
  AmazonAuditEvent,
  AmazonConversation,
  AmazonConversationContext,
  AmazonMatchConfidence,
  AmazonConversationPriority,
  AmazonConversationStatus,
  AmazonInboxFilter,
  AmazonKnowledgeEntry,
  AmazonMessageCategory,
  AmazonNotificationType,
  AmazonOperationalQueue,
  AmazonOperatorStats,
  AmazonPendingReply,
  AmazonPendingReplyStatus,
  AmazonProductStats,
  AmazonQualityScore,
  AmazonSmartAlert,
  AmazonStatsRange,
  AmazonStatsSummary,
  AmazonSupportBotCapability,
  AmazonSupportMessage,
  AmazonTemplate,
  AmazonWorkflowStatus,
} from "./amazonMessagesTypes";
import "./amazonMessages.css";

type Props = {
  orders: Order[];
  currentUser?: {
    id: string;
    name: string;
    role: string;
    permissions: string[];
  } | null;
};

type GmailSyncStatus = {
  account: string;
  labelName: string;
  labelId?: string;
  lastSyncedAt?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  nextSyncAt?: string;
  lastRunId?: string;
  lastTrigger?: "manual" | "auto";
  inProgressRunId?: string;
  status: "OK" | "ERROR" | "EN_CURSO";
  jobEnabled: boolean;
  intervalMinutes: number;
  importedCount: number;
  updatedCount: number;
  duplicateCount: number;
  errorCount: number;
  pendingCount: number;
  averageProcessMs: number;
  lastError?: string;
  history?: GmailSyncHistoryRecord[];
};

type GmailSyncHistoryRecord = {
  runId: string;
  trigger: "manual" | "auto";
  status: "OK" | "ERROR" | "EN_CURSO";
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

type ConversationSourceMode = "real" | "demo";
type DraftSourceMode = "backend" | "local";
type BackendInternalDraftStatus =
  | "SIN_BORRADOR"
  | "BORRADOR_INTERNO"
  | "LISTO_PARA_REVISAR"
  | "APROBADO_MANUALMENTE"
  | "RECHAZADO"
  | "NECESITA_CAMBIOS";

type BackendInternalDraftReviewEvent = {
  eventId: string;
  draftId: string;
  conversationId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  previousStatus: BackendInternalDraftStatus;
  newStatus: BackendInternalDraftStatus;
  note?: string;
  createdAt: string;
};

type BackendConversationRecord = {
  conversationId: string;
  category: string;
  priority: string;
  status: string;
  workflowStatus?: AmazonWorkflowStatus;
  marketplace: string;
  language?: string;
  amazonOrderId?: string;
  odooOrderId?: string;
  assignedUser?: string;
  assignedAt?: string;
  closedAt?: string;
  lastActivityAt?: string;
  workflowHistory?: BackendWorkflowEvent[];
  createdAt: string;
  updatedAt: string;
  firstMessageAt: string;
  lastMessageAt: string;
  responseMinutes?: number;
  messageCount: number;
};

type BackendWorkflowEvent = {
  eventId: string;
  conversationId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  previousStatus: AmazonWorkflowStatus;
  newStatus: AmazonWorkflowStatus;
  reason?: string;
  createdAt: string;
};

type BackendTemplateRecord = {
  templateId: string;
  name?: string;
  templateType?: "INTERNAL_RESPONSE";
  category: string;
  language: string;
  marketplace: string;
  content: string;
  variables: string[];
  active: boolean;
  archived: boolean;
  externalSend?: false;
  createdBy?: string;
  updatedBy?: string;
  updatedAt: string;
};

type BackendMessageRecord = {
  messageId: string;
  conversationId: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  sender: string;
  direction: "inbound" | "outbound" | "internal";
  content: string;
  classification?: string;
  language?: string;
  createdAt: string;
  amazonMetadata?: Record<string, string | number | boolean | null>;
};

type BackendAttachmentRecord = {
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

type BackendClassificationRecord = {
  classificationId: string;
  conversationId: string;
  category: string;
  priority: string;
  confidence: number;
  source: "parser" | "operator" | "ai";
  createdAt: string;
};

type BackendAuditLogRecord = {
  auditId: string;
  conversationId?: string;
  eventType: string;
  detail: string;
  actorRole: string;
  createdAt: string;
};

type BackendConversationDetail = {
  conversation: BackendConversationRecord;
  context?: AmazonConversationContext;
  messages?: BackendMessageRecord[];
  attachments?: BackendAttachmentRecord[];
  classifications?: BackendClassificationRecord[];
  auditLogs?: BackendAuditLogRecord[];
  pendingReplies?: BackendPendingReplyRecord[];
};

type BackendInternalDraftRecord = {
  draftId: string;
  conversationId: string;
  draftBody: string;
  status: BackendInternalDraftStatus;
  reviewStatus: BackendInternalDraftStatus;
  reviewNotes?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  reviewHistory: BackendInternalDraftReviewEvent[];
  generatedBy: string;
  generatedAt: string;
  updatedBy: string;
  updatedAt: string;
  source: "Gmail readonly" | "SMART_DRAFT";
  templateId?: string;
  knowledgeExampleIds?: string[];
  detectedLanguage?: string;
  detectedCategory?: string;
  confidence?: number;
  warnings?: string[];
  externalSend: false;
};

type BackendPendingReplyStatus =
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

type FinalGmailDraftSendRecord = {
  finalizationId: string;
  conversationId: string;
  pendingReplyId: string;
  gmailDraftId: string;
  recipient: string;
  subject: string;
  bodyHash: string;
  confirmationHash: string;
  idempotencyKey: string;
  status: "SEND_IN_PROGRESS" | "SENT" | "SEND_FAILED";
  sentMessageId?: string;
  lastError?: string;
  requestedBy: string;
  requestedAt: string;
  updatedBy: string;
  updatedAt: string;
};

type BackendPendingReplyReviewEvent = {
  eventId: string;
  pendingReplyId: string;
  conversationId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  previousStatus: BackendPendingReplyStatus;
  newStatus: BackendPendingReplyStatus;
  note?: string;
  createdAt: string;
};

type BackendPendingReplyRecord = {
  pendingReplyId: string;
  conversationId: string;
  draftId: string;
  replyBody: string;
  status: BackendPendingReplyStatus;
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
  history: BackendPendingReplyReviewEvent[];
};

type BackendKnowledgeExampleRecord = {
  exampleId: string;
  conversationId?: string;
  category: string;
  language: string;
  marketplace: string;
  originalMessage: string;
  amazonOrderId?: string;
  templateId?: string;
  templateName?: string;
  initialDraft?: string;
  aiDraft: string;
  finalResponse: string;
  draftDiff?: string;
  humanDiffSummary: string;
  approverId?: string;
  approver: string;
  approvedAt?: string;
  quality: string;
  confidence?: number;
  tags?: string[];
  status: "approved" | "ignored" | "archived";
  sku?: string;
  createdAt: string;
  updatedAt: string;
};

const filterLabels: Record<AmazonInboxFilter, string> = {
  all: "Todas",
  workflow_new: "Nuevas",
  workflow_pending: "Pendientes",
  workflow_review: "En revision",
  workflow_ready: "Listas",
  workflow_resolved: "Resueltas",
  workflow_closed: "Cerradas",
};

const categoryLabels: Record<AmazonMessageCategory, string> = {
  seguimiento: "Seguimiento",
  devolucion: "Devolucion",
  garantia: "Garantia",
  factura: "Factura",
  "consulta tecnica": "Consulta tecnica",
  cancelacion: "Cancelacion",
  "producto incorrecto": "Producto incorrecto",
  "producto defectuoso": "Producto defectuoso",
  general: "General",
  tracking: "Seguimiento",
  delay: "Retraso",
  not_received: "Pedido no recibido",
  invoice: "Factura",
  warranty: "Garantia",
  defect: "Defecto",
  wrong_product: "Producto incorrecto",
  return: "Devolucion",
  refund: "Reembolso",
  cancellation: "Cancelacion",
  a_to_z: "A-to-Z / ODR",
  technical: "Tecnica",
  logistics_incident: "Incidencia logistica",
  other: "Otros",
};

const queueLabels: Record<AmazonOperationalQueue, string> = {
  conversations: "Conversaciones",
  logistics: "Logistica",
  cancellations: "Cancelaciones",
  returns: "Devoluciones",
  critical: "A-to-Z / Criticas",
  invoices: "Facturas",
  unclassified: "Sin clasificar",
};

const statusLabels: Record<AmazonConversationStatus, string> = {
  new: "Nuevo",
  open: "Abierto",
  pending_customer: "Pendiente cliente",
  pending_internal: "Pendiente interno",
  resolved: "Resuelto",
  closed: "Cerrado",
  responded: "Respondido",
  responded_mock: "Respondido mock",
};

const workflowLabels: Record<AmazonWorkflowStatus, string> = {
  NUEVO: "Nuevo",
  PENDIENTE_REVISAR: "Pendiente revisar",
  EN_REVISION: "En revision",
  LISTO_PARA_RESPONDER: "Listo para responder",
  RESUELTO: "Resuelto",
  CERRADO: "Cerrado",
};

const workflowOrder: AmazonWorkflowStatus[] = [
  "NUEVO",
  "PENDIENTE_REVISAR",
  "EN_REVISION",
  "LISTO_PARA_RESPONDER",
  "RESUELTO",
  "CERRADO",
];

const priorityLabels: Record<AmazonConversationPriority, string> = {
  urgent: "Urgente",
  high: "Alta",
  normal: "Normal",
  low: "Baja",
};

type AmazonModuleTab =
  | "inbox"
  | "knowledge"
  | "templates"
  | "stats"
  | "supervisor";

type InternalDraft = NonNullable<AmazonConversation["draft"]>;

const moduleTabs: Array<{
  id: AmazonModuleTab;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "inbox", label: "Bandeja", icon: <Inbox size={16} /> },
  { id: "knowledge", label: "Base de conocimiento", icon: <Brain size={16} /> },
  { id: "templates", label: "Plantillas", icon: <FileText size={16} /> },
  { id: "stats", label: "Estadisticas", icon: <BarChart3 size={16} /> },
  { id: "supervisor", label: "Supervisor", icon: <UsersRound size={16} /> },
];

export function AmazonMessagesView({ orders, currentUser }: Props) {
  const demoConversations = useMemo(
    () => buildAmazonDemoConversations(orders),
    [orders],
  );
  const [realConversations, setRealConversations] = useState<
    AmazonConversation[] | null
  >(null);
  const [conversationSourceMode, setConversationSourceMode] =
    useState<ConversationSourceMode>("demo");
  const [conversationSourceMessage, setConversationSourceMessage] =
    useState("Cargando API real...");
  const conversations =
    realConversations && realConversations.length > 0
      ? realConversations
      : demoConversations;
  const demoTemplates = useMemo(() => buildAmazonTemplates(), []);
  const [backendTemplates, setBackendTemplates] = useState<AmazonTemplate[] | null>(null);
  const templates = backendTemplates?.length ? backendTemplates : demoTemplates;
  const demoKnowledgeEntries = useMemo(
    () => buildAmazonKnowledgeEntries(conversations),
    [conversations],
  );
  const [backendKnowledgeEntries, setBackendKnowledgeEntries] = useState<
    AmazonKnowledgeEntry[] | null
  >(null);
  const knowledgeEntries = backendKnowledgeEntries ?? demoKnowledgeEntries;
  const [knowledgeMessage, setKnowledgeMessage] = useState(
    "Cargando base de conocimiento...",
  );
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [knowledgeOrderSearch, setKnowledgeOrderSearch] = useState("");
  const [knowledgeCategoryFilter, setKnowledgeCategoryFilter] = useState("");
  const [knowledgeLanguageFilter, setKnowledgeLanguageFilter] = useState("");
  const statsSummary = useMemo(
    () => buildAmazonStatsSummary(conversations, templates),
    [conversations, templates],
  );
  const operatorStats = useMemo(
    () => buildAmazonOperatorStats(conversations),
    [conversations],
  );
  const productStats = useMemo(
    () => buildAmazonProductStats(conversations),
    [conversations],
  );
  const logisticsStats = useMemo(
    () => buildAmazonLogisticsStats(conversations),
    [conversations],
  );
  const smartAlerts = useMemo(
    () => buildAmazonSmartAlerts(conversations, productStats, logisticsStats),
    [conversations, logisticsStats, productStats],
  );
  const supportBotCapabilities = useMemo(
    () => buildAmazonSupportBotCapabilities(),
    [],
  );
  const [activeTab, setActiveTab] = useState<AmazonModuleTab>("inbox");
  const [activeFilter, setActiveFilter] = useState<AmazonInboxFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(conversations[0]?.id ?? "");
  const [statsRange, setStatsRange] = useState<AmazonStatsRange>("last_7_days");
  const [workflowDrafts, setWorkflowDrafts] = useState<Record<string, AmazonWorkflowStatus>>({});
  const [ownerDrafts, setOwnerDrafts] = useState<Record<string, string>>({});
  const [draftOverrides, setDraftOverrides] = useState<Record<string, string>>({});
  const [internalDrafts, setInternalDrafts] = useState<
    Record<string, InternalDraft>
  >({});
  const [internalDraftAuditEvents, setInternalDraftAuditEvents] = useState<
    Record<string, AmazonAuditEvent[]>
  >(() => readAmazonMessagesStorage("amazonMessagesInternalDraftAuditEvents", {}));
  const [draftSourceMode, setDraftSourceMode] =
    useState<DraftSourceMode>("backend");
  const [draftSourceMessage, setDraftSourceMessage] =
    useState("Borradores cargando desde backend...");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [gmailSyncStatus, setGmailSyncStatus] = useState<GmailSyncStatus | null>(null);
  const [gmailSyncMessage, setGmailSyncMessage] = useState("Auto-sync cada 30 min.");
  const [manualSyncRunning, setManualSyncRunning] = useState(false);

  async function fetchBackendConversationList() {
    const response = await fetch("/api/amazon-messages/conversations");
    if (!response.ok) throw new Error(`API ${response.status}`);
    const records = ((await response.json()) as BackendConversationRecord[]).filter(
      isRealBackendConversation,
    );
    if (!records.length) return null;

    return records
      .map((record) => adaptBackendConversation({ conversation: record }))
      .sort(
        (left, right) =>
          new Date(right.lastActivityAt).getTime() -
          new Date(left.lastActivityAt).getTime(),
      );
  }

  async function refreshGmailSyncStatus() {
    const response = await fetch("/api/amazon-messages/gmail/status");
    if (!response.ok) throw new Error(`API ${response.status}`);
    return (await response.json()) as GmailSyncStatus;
  }

  async function fetchKnowledgeEntries(filters?: {
    query?: string;
    order?: string;
    category?: string;
    language?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.query) params.set("q", filters.query);
    if (filters?.order) params.set("order", filters.order);
    if (filters?.category) params.set("category", filters.category);
    if (filters?.language) params.set("language", filters.language);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const response = await fetch(`/api/amazon-messages/knowledge${suffix}`);
    if (!response.ok) throw new Error(`API ${response.status}`);
    return ((await response.json()) as BackendKnowledgeExampleRecord[]).map(
      adaptBackendKnowledgeExample,
    );
  }

  useEffect(() => {
    let mounted = true;

    async function loadRealConversations() {
      try {
        const loadedConversations = await fetchBackendConversationList();
        if (!loadedConversations?.length) {
          if (mounted) {
            setRealConversations(null);
            setConversationSourceMode("demo");
            setConversationSourceMessage(
              "API real sin conversaciones importadas; mostrando fallback demo.",
            );
          }
          return;
        }

        if (mounted) {
          setRealConversations(loadedConversations);
          setSelectedId((currentSelectedId) =>
            loadedConversations.some((conversation) => conversation.id === currentSelectedId)
              ? currentSelectedId
              : loadedConversations[0]?.id ?? "",
          );
          setConversationSourceMode("real");
          setConversationSourceMessage("Conversaciones cargadas desde backend/API.");
        }
      } catch (error) {
        if (mounted) {
          setRealConversations(null);
          setConversationSourceMode("demo");
          setConversationSourceMessage(
            error instanceof Error
              ? `API no disponible (${error.message}); mostrando fallback demo.`
              : "API no disponible; mostrando fallback demo.",
          );
        }
      }
    }

    loadRealConversations();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (conversationSourceMode !== "real" || !selectedId) return;
    let mounted = true;

    async function loadSelectedConversationDetail() {
      try {
        const backendSelectedId =
          realConversations?.some((conversation) => conversation.id === selectedId)
            ? selectedId
            : realConversations?.[0]?.id;
        if (!backendSelectedId) return;
        const detailResponse = await fetch(
          `/api/amazon-messages/conversations/${backendSelectedId}`,
        );
        if (!detailResponse.ok) throw new Error(`API ${detailResponse.status}`);
        const detail = (await detailResponse.json()) as BackendConversationDetail;
        const detailedConversation = adaptBackendConversation(detail);

        const draftResponse = await fetch(
          `/api/amazon-messages/conversations/${backendSelectedId}/draft`,
        );
        const draft = draftResponse.ok
          ? adaptBackendDraft(
              (await draftResponse.json()) as BackendInternalDraftRecord,
              detailedConversation,
            )
          : undefined;

        if (mounted) {
          setRealConversations((current) =>
            current
              ?.map((conversation) =>
                conversation.id === detailedConversation.id
                  ? {
                      ...conversation,
                      ...detailedConversation,
                      draft: conversation.draft,
                    }
                  : conversation,
              )
              .sort(
                (left, right) =>
                  new Date(right.lastActivityAt).getTime() -
                  new Date(left.lastActivityAt).getTime(),
              ) ?? current,
          );
          if (draft) {
            setInternalDrafts((current) => ({
              ...current,
              [backendSelectedId]: draft,
            }));
            setDraftOverrides((current) => {
              const next = { ...current };
              delete next[backendSelectedId];
              return next;
            });
          }
          setSelectedId(detailedConversation.id);
          setDraftSourceMode("backend");
          setDraftSourceMessage("Detalle y borrador cargados desde backend.");
        }
      } catch (error) {
        if (mounted) {
          const localDrafts = readAmazonMessagesStorage(
            "amazonMessagesInternalDrafts",
            {},
          );
          setInternalDrafts((current) => ({
            ...current,
            ...(localDrafts[selectedId] ? { [selectedId]: localDrafts[selectedId] } : {}),
          }));
          setDraftSourceMessage(
            error instanceof Error
              ? `Detalle backend no disponible (${error.message}); sin carga masiva.`
              : "Detalle backend no disponible; sin carga masiva.",
          );
        }
      }
    }

    loadSelectedConversationDetail();
    return () => {
      mounted = false;
    };
  }, [conversationSourceMode, selectedId, realConversations?.[0]?.id]);

  useEffect(() => {
    let mounted = true;
    refreshGmailSyncStatus()
      .then((payload: GmailSyncStatus | null) => {
        if (mounted) setGmailSyncStatus(payload);
      })
      .catch(() => {
        if (mounted) setGmailSyncStatus(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch("/api/amazon-messages/templates")
      .then((response) => (response.ok ? response.json() : []))
      .then((payload: BackendTemplateRecord[]) => {
        if (mounted) setBackendTemplates(payload.map(adaptBackendTemplate));
      })
      .catch(() => {
        if (mounted) setBackendTemplates(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchKnowledgeEntries({
      query: knowledgeSearch,
      order: knowledgeOrderSearch,
      category: knowledgeCategoryFilter,
      language: knowledgeLanguageFilter,
    })
      .then((entries) => {
        if (mounted) {
          setBackendKnowledgeEntries(entries);
          setKnowledgeMessage("Base de conocimiento cargada desde backend.");
        }
      })
      .catch((error) => {
        if (mounted) {
          setBackendKnowledgeEntries(null);
          setKnowledgeMessage(
            error instanceof Error
              ? `Backend conocimiento no disponible (${error.message}); mostrando fallback demo.`
              : "Backend conocimiento no disponible; mostrando fallback demo.",
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [
    knowledgeCategoryFilter,
    knowledgeLanguageFilter,
    knowledgeOrderSearch,
    knowledgeSearch,
  ]);

  useEffect(() => {
    if (!conversations.some((conversation) => conversation.id === selectedId)) {
      setSelectedId(conversations[0]?.id ?? "");
    }
  }, [conversations, selectedId]);

  useEffect(() => {
    if (draftSourceMode === "local") {
      writeAmazonMessagesStorage("amazonMessagesInternalDrafts", internalDrafts);
    }
  }, [draftSourceMode, internalDrafts]);

  useEffect(() => {
    writeAmazonMessagesStorage(
      "amazonMessagesInternalDraftAuditEvents",
      internalDraftAuditEvents,
    );
  }, [internalDraftAuditEvents]);

  const decoratedConversations = conversations.map((conversation) => ({
    ...conversation,
    workflowStatus: workflowDrafts[conversation.id] ?? workflowStatusOf(conversation),
    assignedUser: ownerDrafts[conversation.id] ?? conversation.assignedUser,
    assignedAt: ownerDrafts[conversation.id]
      ? new Date().toISOString()
      : conversation.assignedAt,
    lastActivityAt: conversation.lastActivityAt ?? conversation.lastMessageAt,
    draft: buildDisplayedDraft(
      internalDrafts[conversation.id] ?? conversation.draft,
      draftOverrides[conversation.id],
    ),
    audit: [
      ...conversation.audit,
      ...(internalDraftAuditEvents[conversation.id] ?? []),
    ],
  }));

  const filteredConversations = decoratedConversations.filter((conversation) => {
    if (!matchesFilter(conversation, activeFilter)) return false;
    if (!query.trim()) return true;
    const value = [
      conversation.subject,
      conversation.amazonOrderId,
      conversation.customerDisplayName,
      conversation.context.order?.odooRef,
      conversation.messages[0]?.bodyText,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return value.includes(query.toLowerCase().trim());
  });

  const selected =
    decoratedConversations.find((conversation) => conversation.id === selectedId) ??
    decoratedConversations[0];
  const workflowStats = buildWorkflowStats(decoratedConversations);
  const smartDraftStats = buildSmartDraftStats(decoratedConversations);

  async function persistBackendDraft(
    conversation: AmazonConversation,
    draftBody: string,
    status: BackendInternalDraftStatus,
    method: "POST" | "PUT",
    reviewNote?: string,
  ) {
    const response = await fetch(
      `/api/amazon-messages/conversations/${conversation.id}/draft`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftBody,
          status,
          reviewNotes: reviewNote,
          source: "Gmail readonly",
          externalSend: false,
        }),
      },
    );
    if (!response.ok) throw new Error(`API ${response.status}`);
    return adaptBackendDraft(
      (await response.json()) as BackendInternalDraftRecord,
      conversation,
    );
  }

  async function persistBackendDraftReview(
    conversation: AmazonConversation,
    status: Exclude<BackendInternalDraftStatus, "SIN_BORRADOR" | "BORRADOR_INTERNO" | "LISTO_PARA_REVISAR">,
    reviewNote: string,
  ) {
    const response = await fetch(
      `/api/amazon-messages/conversations/${conversation.id}/draft/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reviewNotes: reviewNote,
          externalSend: false,
        }),
      },
    );
    if (!response.ok) throw new Error(`API ${response.status}`);
    return adaptBackendDraft(
      (await response.json()) as BackendInternalDraftRecord,
      conversation,
    );
  }

  function appendInternalDraftAudit(conversation: AmazonConversation) {
    setInternalDraftAuditEvents((current) => ({
      ...current,
      [conversation.id]: [
        ...(current[conversation.id] ?? []),
        buildInternalDraftAuditEvent(conversation),
      ],
    }));
  }

  async function generateInternalDraft(conversation: AmazonConversation) {
    const draftBody = buildInternalDraftBody(conversation);
    try {
      const draft = await persistBackendDraft(
        conversation,
        draftBody,
        "BORRADOR_INTERNO",
        "POST",
      );
      if (draft) {
        setDraftOverrides((current) => {
          const next = { ...current };
          delete next[conversation.id];
          return next;
        });
        setInternalDrafts((current) => ({ ...current, [conversation.id]: draft }));
        setDraftSourceMode("backend");
        setDraftSourceMessage("Borrador interno guardado en backend.");
        appendInternalDraftAudit(conversation);
      }
    } catch {
      const draft = buildInternalDraft(conversation);
      setDraftOverrides((current) => {
        const next = { ...current };
        delete next[conversation.id];
        return next;
      });
      setInternalDrafts((current) => ({ ...current, [conversation.id]: draft }));
      setDraftSourceMode("local");
      setDraftSourceMessage("Backend drafts no disponible; borrador en fallback local.");
      appendInternalDraftAudit(conversation);
    }
  }

  async function updateInternalDraft(conversation: AmazonConversation, draftBody: string) {
    setDraftOverrides((current) => ({
      ...current,
      [conversation.id]: draftBody,
    }));
    try {
      const draft = await persistBackendDraft(
        conversation,
        draftBody,
        "LISTO_PARA_REVISAR",
        "PUT",
      );
      if (draft) {
        setInternalDrafts((current) => ({ ...current, [conversation.id]: draft }));
        setDraftSourceMode("backend");
        setDraftSourceMessage("Borrador interno actualizado en backend.");
      }
    } catch {
      setDraftSourceMode("local");
      setDraftSourceMessage("Backend drafts no disponible; cambios en fallback local.");
    }
  }

  async function reviewInternalDraft(
    conversation: AmazonConversation,
    status: "APROBADO_MANUALMENTE" | "RECHAZADO" | "NECESITA_CAMBIOS",
  ) {
    const note = reviewNotes[conversation.id] ?? "";
    try {
      const draft = await persistBackendDraftReview(conversation, status, note);
      if (draft) {
        setInternalDrafts((current) => ({ ...current, [conversation.id]: draft }));
        setDraftOverrides((current) => {
          const next = { ...current };
          delete next[conversation.id];
          return next;
        });
        setDraftSourceMode("backend");
        setDraftSourceMessage("Revision manual guardada en backend. Modo seguro: sin envio externo.");
      }
    } catch {
      setDraftSourceMode("local");
      setDraftSourceMessage("No se pudo guardar la revision en backend; no se envio nada.");
    }
  }

  async function preparePendingReply(conversation: AmazonConversation) {
    if (!conversation.draft || conversation.draft.status !== "APROBADO_MANUALMENTE") {
      setDraftSourceMessage("Primero hay que aprobar manualmente el borrador. No se preparo respuesta.");
      return;
    }
    try {
      const response = await fetch(
        `/api/amazon-messages/conversations/${conversation.id}/pending-reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftId: conversation.draft.id,
            replyBody: conversation.draft.body,
            status: "RESPUESTA_PREPARADA",
            validationNotes: "Preparada desde borrador aprobado. Sin envio externo.",
            externalSend: false,
          }),
        },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const pendingReply = adaptBackendPendingReply(
        (await response.json()) as BackendPendingReplyRecord,
      );
      if (!pendingReply) throw new Error("Respuesta pendiente vacia");
      setRealConversations((current) =>
        current?.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                pendingReply,
                workflowStatus: "LISTO_PARA_RESPONDER",
                status: "open",
                lastActivityAt: pendingReply.updatedAt,
              }
            : item,
        ) ?? current,
      );
      setDraftSourceMessage("Respuesta pendiente preparada en backend. Sin Gmail, sin SP-API y sin envio.");
    } catch (error) {
      setDraftSourceMessage(
        error instanceof Error
          ? `No se pudo preparar respuesta pendiente (${error.message}); no se envio nada.`
          : "No se pudo preparar respuesta pendiente; no se envio nada.",
      );
    }
  }

  async function reviewPendingReplyForGmailDraft(conversation: AmazonConversation) {
    if (!conversation.pendingReply) {
      setDraftSourceMessage("Primero hay que preparar la respuesta pendiente.");
      return;
    }
    try {
      const response = await fetch(
        `/api/amazon-messages/conversations/${conversation.id}/pending-reply/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "APROBADA_PARA_BORRADOR",
            validationNotes:
              "Respuesta pendiente aprobada para crear borrador Gmail real. Sin envio.",
            externalSend: false,
          }),
        },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const pendingReply = adaptBackendPendingReply(
        (await response.json()) as BackendPendingReplyRecord,
      );
      if (!pendingReply) throw new Error("Respuesta pendiente vacia");
      setRealConversations((current) =>
        current?.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                pendingReply,
                lastActivityAt: pendingReply.updatedAt,
              }
            : item,
        ) ?? current,
      );
      setDraftSourceMessage("Respuesta pendiente aprobada para borrador Gmail. Sin envio.");
    } catch (error) {
      setDraftSourceMessage(
        error instanceof Error
          ? `No se pudo aprobar la respuesta pendiente (${error.message}); no se envio nada.`
          : "No se pudo aprobar la respuesta pendiente; no se envio nada.",
      );
    }
  }

  async function createGmailDraftOnly(conversation: AmazonConversation) {
    if (conversation.pendingReply?.status !== "APROBADA_PARA_BORRADOR") {
      setDraftSourceMessage("La respuesta pendiente debe estar aprobada antes de crear Gmail Draft.");
      return;
    }
    try {
      const response = await fetch(
        `/api/amazon-messages/conversations/${conversation.id}/gmail-draft`,
        {
          method: conversation.pendingReply.gmailDraftId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmDraftOnly: true,
            externalSend: false,
          }),
        },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const result = (await response.json()) as {
        pendingReply: BackendPendingReplyRecord;
      };
      const pendingReply = adaptBackendPendingReply(result.pendingReply);
      if (!pendingReply) throw new Error("Respuesta pendiente vacia");
      setRealConversations((current) =>
        current?.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                pendingReply,
                lastActivityAt: pendingReply.gmailDraftUpdatedAt ?? pendingReply.updatedAt,
              }
            : item,
        ) ?? current,
      );
      setDraftSourceMessage(
        pendingReply.gmailDraftId
          ? "Borrador Gmail real creado/actualizado. No se ha realizado respuesta externa."
          : "No se pudo confirmar el borrador Gmail. No hubo respuesta externa.",
      );
    } catch (error) {
      setDraftSourceMessage(
        error instanceof Error
          ? `No se pudo crear borrador Gmail (${error.message}); no hubo respuesta externa.`
          : "No se pudo crear borrador Gmail; no hubo respuesta externa.",
      );
    }
  }

  async function finalizeGmailDraftSend(
    conversation: AmazonConversation,
    idempotencyKey: string,
  ) {
    const pendingReply = conversation.pendingReply;
    if (!pendingReply?.gmailDraftId) {
      setDraftSourceMessage("No existe Gmail Draft para enviar respuesta final.");
      return;
    }
    if (!pendingReply.gmailDraftRecipient || !pendingReply.gmailDraftSubject || !pendingReply.gmailDraftBodyHash) {
      setDraftSourceMessage("Faltan datos firmados del Gmail Draft. No se envia nada.");
      return;
    }
    const now = new Date().toISOString();
    setRealConversations((current) =>
      current?.map((item) =>
        item.id === conversation.id && item.pendingReply
          ? {
              ...item,
              pendingReply: {
                ...item.pendingReply,
                status: "SEND_IN_PROGRESS",
                updatedAt: now,
              },
            }
          : item,
      ) ?? current,
    );
    try {
      const response = await fetch(
        `/api/amazon-messages/conversations/${conversation.id}/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversation.id,
            pendingReplyId: pendingReply.id,
            gmailDraftId: pendingReply.gmailDraftId,
            recipient: pendingReply.gmailDraftRecipient,
            subject: pendingReply.gmailDraftSubject,
            bodyHash: pendingReply.gmailDraftBodyHash,
            confirmFinalSendMock: true,
            idempotencyKey,
            externalSend: false,
          }),
        },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const finalization = (await response.json()) as FinalGmailDraftSendRecord;
      setRealConversations((current) =>
        current?.map((item) =>
          item.id === conversation.id && item.pendingReply
            ? {
                ...item,
                status: finalization.status === "SENT" ? "responded" : item.status,
                workflowStatus:
                  finalization.status === "SENT" ? "RESUELTO" : item.workflowStatus,
                closedAt: finalization.status === "SENT" ? undefined : item.closedAt,
                lastActivityAt: finalization.updatedAt,
                pendingReply: {
                  ...item.pendingReply,
                  status: finalization.status,
                  amazonMessageActionId:
                    finalization.sentMessageId ?? item.pendingReply.amazonMessageActionId,
                  updatedAt: finalization.updatedAt,
                },
              }
            : item,
        ) ?? current,
      );
      setDraftSourceMessage(
        finalization.status === "SENT"
          ? `Respuesta enviada desde Gmail Draft y conversacion resuelta. sentMessageId=${finalization.sentMessageId ?? "pendiente"}`
          : `Finalizacion registrada con estado ${finalization.status}.`,
      );
    } catch (error) {
      const failedAt = new Date().toISOString();
      setRealConversations((current) =>
        current?.map((item) =>
          item.id === conversation.id && item.pendingReply
            ? {
                ...item,
                pendingReply: {
                  ...item.pendingReply,
                  status: "SEND_FAILED",
                  updatedAt: failedAt,
                },
              }
            : item,
        ) ?? current,
      );
      setDraftSourceMessage(
        error instanceof Error
          ? `No se pudo enviar desde Gmail Draft (${error.message}); conversacion no cerrada.`
          : "No se pudo enviar desde Gmail Draft; conversacion no cerrada.",
      );
    }
  }

  async function saveApprovedKnowledgeExample(
    conversation: AmazonConversation,
    templateId?: string,
  ) {
    try {
      const response = await fetch("/api/amazon-messages/knowledge/examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          draftId: conversation.draft?.id,
          templateId,
          category: categoryForKnowledge(conversation.category),
          language: conversation.extracted.language ?? "es",
          amazonOrderId: conversation.amazonOrderId,
          originalMessage: conversation.messages[0]?.bodyText,
          initialDraft: conversation.draft?.body,
          aiDraft: conversation.draft?.body,
          finalResponse: conversation.draft?.body,
          humanDiffSummary:
            conversation.draft?.humanDiffSummary ??
            "Ejemplo aprobado manualmente desde revision humana.",
          quality: "alta",
          confidence: conversation.draft?.confidence ?? 0.8,
          tags: [
            categoryForKnowledge(conversation.category),
            conversation.marketplace,
            conversation.extracted.language ?? "es",
          ],
          externalSend: false,
        }),
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const created = adaptBackendKnowledgeExample(
        (await response.json()) as BackendKnowledgeExampleRecord,
      );
      setBackendKnowledgeEntries((current) => [created, ...(current ?? [])]);
      setKnowledgeMessage("Ejemplo aprobado guardado en base de conocimiento. Sin envio externo.");
    } catch (error) {
      setKnowledgeMessage(
        error instanceof Error
          ? `No se pudo guardar el ejemplo (${error.message}); no se envio nada.`
          : "No se pudo guardar el ejemplo; no se envio nada.",
      );
    }
  }

  async function updateKnowledgeTags(exampleId: string, tags: string[]) {
    const response = await fetch(`/api/amazon-messages/knowledge/examples/${exampleId}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags, externalSend: false }),
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const updated = adaptBackendKnowledgeExample(
      (await response.json()) as BackendKnowledgeExampleRecord,
    );
    setBackendKnowledgeEntries((current) =>
      current?.map((entry) => (entry.id === exampleId ? updated : entry)) ?? [updated],
    );
  }

  async function updateKnowledgeCategory(exampleId: string, category: string) {
    const response = await fetch(
      `/api/amazon-messages/knowledge/examples/${exampleId}/category`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, externalSend: false }),
      },
    );
    if (!response.ok) throw new Error(`API ${response.status}`);
    const updated = adaptBackendKnowledgeExample(
      (await response.json()) as BackendKnowledgeExampleRecord,
    );
    setBackendKnowledgeEntries((current) =>
      current?.map((entry) => (entry.id === exampleId ? updated : entry)) ?? [updated],
    );
  }

  async function applyInternalTemplate(
    conversation: AmazonConversation,
    templateId: string,
  ) {
    try {
      const response = await fetch(
        `/api/amazon-messages/conversations/${conversation.id}/draft/from-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId, externalSend: false }),
        },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const draft = adaptBackendDraft(
        (await response.json()) as BackendInternalDraftRecord,
        conversation,
      );
      if (draft) {
        setInternalDrafts((current) => ({ ...current, [conversation.id]: draft }));
        setDraftOverrides((current) => {
          const next = { ...current };
          delete next[conversation.id];
          return next;
        });
        setDraftSourceMode("backend");
        setDraftSourceMessage("Plantilla interna aplicada en backend. Sin IA, sin Roger y sin envio externo.");
      }
    } catch {
      setDraftSourceMessage("No se pudo aplicar la plantilla interna; no se envio nada.");
    }
  }

  async function generateSmartDraft(conversation: AmazonConversation) {
    try {
      const response = await fetch(
        `/api/amazon-messages/conversations/${conversation.id}/draft/smart`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalSend: false }),
        },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const draft = adaptBackendDraft(
        (await response.json()) as BackendInternalDraftRecord,
        conversation,
      );
      if (draft?.body.trim()) {
        setInternalDrafts((current) => ({ ...current, [conversation.id]: draft }));
        setDraftOverrides((current) => {
          const next = { ...current };
          delete next[conversation.id];
          return next;
        });
        setRealConversations((current) =>
          current
            ?.map((item) =>
              item.id === conversation.id
                ? {
                    ...item,
                    lastActivityAt: draft.updatedAt,
                    workflowStatus: "EN_REVISION",
                  }
                : item,
            )
            .sort(
              (left, right) =>
                new Date(right.lastActivityAt).getTime() -
                new Date(left.lastActivityAt).getTime(),
            ) ?? current,
        );
        setDraftSourceMode("backend");
        setDraftSourceMessage(
          "Borrador inteligente generado directamente en Dashboard/Juanito. No se envio nada.",
        );
        return;
      }
      setDraftSourceMessage(
        "No se pudo crear un borrador inteligente con contenido; no se envio nada.",
      );
    } catch (error) {
      setDraftSourceMessage(
        error instanceof Error
          ? `No se pudo generar borrador inteligente (${error.message}); no se envio nada.`
          : "No se pudo generar borrador inteligente; no se envio nada.",
      );
    }
  }

  async function changeWorkflowStatus(
    conversation: AmazonConversation,
    workflowStatus: AmazonWorkflowStatus,
    options: {
      reason?: string;
      confirmPendingDraft?: boolean;
      confirmUnreviewed?: boolean;
      confirmClosedReopen?: boolean;
    } = {},
  ) {
    setWorkflowDrafts((current) => ({
      ...current,
      [conversation.id]: workflowStatus,
    }));
    try {
      const response = await fetch(
        `/api/amazon-messages/conversations/${conversation.id}/workflow`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowStatus,
            reason: options.reason,
            confirmPendingDraft: options.confirmPendingDraft,
            confirmUnreviewed: options.confirmUnreviewed,
            confirmClosedReopen: options.confirmClosedReopen,
            externalSend: false,
          }),
        },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const updated = adaptBackendConversation({
        conversation: (await response.json()) as BackendConversationRecord,
        messages: conversation.messages.map(adaptUiMessageForDetail),
        auditLogs: conversation.audit.map(adaptUiAuditForDetail),
      });
      updateConversationFromBackend(updated);
      setWorkflowDrafts((current) => {
        const next = { ...current };
        delete next[conversation.id];
        return next;
      });
    } catch {
      // Keep the local visual state only; safe mode still prevents external actions.
    }
  }

  function markConversationResolved(conversation: AmazonConversation) {
    const workflowStatus = workflowStatusOf(conversation);
    if (workflowStatus === "RESUELTO" || workflowStatus === "CERRADO") return;
    const hasPendingDraft = Boolean(
      conversation.draft &&
        conversation.draft.status !== "SIN_BORRADOR" &&
        conversation.draft.status !== "APROBADO_MANUALMENTE" &&
        conversation.draft.status !== "RECHAZADO",
    );
    const hasUnreviewedMessage =
      workflowStatus === "NUEVO" || workflowStatus === "PENDIENTE_REVISAR";
    if (
      hasPendingDraft &&
      !window.confirm("Hay un borrador pendiente. Marcar igualmente como resuelto?")
    ) {
      return;
    }
    if (
      hasUnreviewedMessage &&
      !window.confirm("La conversacion no figura como revisada. Marcar igualmente como resuelta?")
    ) {
      return;
    }
    const reason =
      window.prompt("Motivo opcional para marcar como resuelto:", "")?.trim() ??
      undefined;
    void changeWorkflowStatus(conversation, "RESUELTO", {
      reason,
      confirmPendingDraft: hasPendingDraft,
      confirmUnreviewed: hasUnreviewedMessage,
    });
  }

  function reopenConversation(conversation: AmazonConversation) {
    const workflowStatus = workflowStatusOf(conversation);
    if (workflowStatus !== "RESUELTO" && workflowStatus !== "CERRADO") return;
    if (
      workflowStatus === "CERRADO" &&
      !window.confirm("Esta conversacion esta cerrada. Reabrirla en revision?")
    ) {
      return;
    }
    const reason =
      window.prompt("Motivo opcional para reabrir la conversacion:", "")?.trim() ??
      undefined;
    void changeWorkflowStatus(conversation, "EN_REVISION", {
      reason,
      confirmClosedReopen: workflowStatus === "CERRADO",
    });
  }

  async function assignWorkflowUser(conversation: AmazonConversation, assignedUser: string) {
    setOwnerDrafts((current) => ({ ...current, [conversation.id]: assignedUser }));
    try {
      const response = await fetch(
        `/api/amazon-messages/conversations/${conversation.id}/assign`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignedUser, externalSend: false }),
        },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const updated = adaptBackendConversation({
        conversation: (await response.json()) as BackendConversationRecord,
        messages: conversation.messages.map(adaptUiMessageForDetail),
        auditLogs: conversation.audit.map(adaptUiAuditForDetail),
      });
      updateConversationFromBackend(updated);
      setOwnerDrafts((current) => {
        const next = { ...current };
        delete next[conversation.id];
        return next;
      });
    } catch {
      // Keep the local visual state only; no external action is attempted.
    }
  }

  function updateConversationFromBackend(updated: AmazonConversation) {
    setRealConversations((current) =>
      current?.map((conversation) =>
        conversation.id === updated.id
          ? {
              ...conversation,
              workflowStatus: updated.workflowStatus,
              status: updated.status,
              assignedUser: updated.assignedUser,
              assignedAt: updated.assignedAt,
              closedAt: updated.closedAt,
              lastActivityAt: updated.lastActivityAt,
              workflowHistory: updated.workflowHistory,
              audit: mergeAuditEvents(conversation.audit, updated.audit),
            }
          : conversation,
      ) ?? current,
    );
  }

  async function runManualGmailSync() {
    setManualSyncRunning(true);
    setGmailSyncMessage("Sincronizacion manual en curso...");
    try {
      const response = await fetch("/api/amazon-messages/gmail/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: "AmazonSeller",
          max: 20,
          readonly: true,
          externalSend: false,
        }),
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const result = (await response.json()) as {
        ok: boolean;
        scanned?: number;
        imported?: number;
        updated?: number;
        duplicates?: number;
        errors?: number;
        message?: string;
      };
      setGmailSyncMessage(
        result.ok
          ? `Sync manual OK: leidos ${result.scanned ?? 0}, importados ${
              result.imported ?? 0
            }, actualizados ${result.updated ?? 0}, duplicados ${
              result.duplicates ?? 0
            }, errores ${result.errors ?? 0}.`
          : `Sync manual sin completar: ${result.message ?? "revise estado"}.`,
      );
      setGmailSyncStatus(await refreshGmailSyncStatus());
      const loadedConversations = await fetchBackendConversationList();
      if (loadedConversations?.length) {
        setRealConversations(loadedConversations);
        setConversationSourceMode("real");
        setConversationSourceMessage("Conversaciones cargadas desde backend/API.");
      }
    } catch (error) {
      setGmailSyncMessage(
        error instanceof Error
          ? `Sync manual fallido (${error.message}); sin envio externo.`
          : "Sync manual fallido; sin envio externo.",
      );
      try {
        setGmailSyncStatus(await refreshGmailSyncStatus());
      } catch {
        setGmailSyncStatus(null);
      }
    } finally {
      setManualSyncRunning(false);
    }
  }

  const stats = {
    total: conversations.length,
    newWorkflow: decoratedConversations.filter(
      (conversation) => workflowStatusOf(conversation) === "NUEVO",
    ).length,
    pendingWorkflow: decoratedConversations.filter(
      (conversation) => workflowStatusOf(conversation) === "PENDIENTE_REVISAR",
    ).length,
    inReviewWorkflow: decoratedConversations.filter(
      (conversation) => workflowStatusOf(conversation) === "EN_REVISION",
    ).length,
    readyWorkflow: decoratedConversations.filter(
      (conversation) => workflowStatusOf(conversation) === "LISTO_PARA_RESPONDER",
    ).length,
    resolvedWorkflow: decoratedConversations.filter(
      (conversation) => workflowStatusOf(conversation) === "RESUELTO",
    ).length,
    closedWorkflow: decoratedConversations.filter(
      (conversation) => workflowStatusOf(conversation) === "CERRADO",
    ).length,
    critical: conversations.filter(
      (conversation) => conversation.operationalQueue === "critical",
    ).length,
    knowledge: knowledgeEntries.filter((entry) => entry.status === "active").length,
    templates: templates.filter((template) => template.status === "active").length,
  };

  return (
    <section className="amazon-messages">
      <div className="amazon-module-banner">
        <div>
          <p className="eyebrow">FASE 0.6 · conocimiento, IA y supervision</p>
          <h2>Amazon Messages</h2>
          <p>{moduleDescription(conversationSourceMode)}</p>
        </div>
        <div className="amazon-safety-lock">
          <ShieldCheck size={18} />
          Modo no destructivo
        </div>
        <div
          className={`amazon-source-badge ${
            conversationSourceMode === "real" ? "real" : "demo"
          }`}
          title={conversationSourceMessage}
        >
          {conversationSourceMode === "real" ? "REAL API" : "DEMO FALLBACK"}
        </div>
      </div>

      <div className="amazon-metrics">
        <Metric label="Conversaciones" value={stats.total.toString()} icon={<Inbox size={18} />} />
        <Metric label="Nuevas" value={stats.newWorkflow.toString()} icon={<Mail size={18} />} />
        <Metric label="Criticas" value={stats.critical.toString()} icon={<AlertTriangle size={18} />} />
        <Metric label="Ejemplos activos" value={stats.knowledge.toString()} icon={<Brain size={18} />} />
        <Metric label="Plantillas activas" value={stats.templates.toString()} icon={<FileText size={18} />} />
      </div>

      <div className="amazon-module-tabs">
        {moduleTabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "inbox" && (
        <div className="amazon-workspace">
        <aside className="amazon-inbox">
          <div className="amazon-inbox-toolbar">
            <div className="amazon-source-note">{conversationSourceMessage}</div>
            <label className="amazon-search">
              <Search size={16} />
              <input
                aria-label="Buscar mensajes Amazon"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar pedido, cliente o texto"
                value={query}
              />
            </label>
            <div className="amazon-filter-row">
              {(Object.keys(filterLabels) as AmazonInboxFilter[]).map((filter) => (
                <button
                  className={activeFilter === filter ? "active" : ""}
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  type="button"
                >
                  {filterLabels[filter]} ({filterCount(filter, decoratedConversations)})
                </button>
              ))}
            </div>
          </div>

          <div className="amazon-conversation-list">
            {filteredConversations.map((conversation) => (
              <button
                className={`amazon-conversation-row ${
                  selected?.id === conversation.id ? "active" : ""
                }`}
                key={conversation.id}
                onClick={() => setSelectedId(conversation.id)}
                type="button"
              >
                <span className={`priority-dot ${conversation.priority}`} />
                <span>
                  <strong>{conversation.customerDisplayName}</strong>
                  <small>{conversation.subject}</small>
                </span>
                <span className="amazon-row-meta">
                  <small>{conversation.marketplace}</small>
                  <span>{formatRelative(conversation.lastMessageAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {selected ? (
          <ConversationDetail
            conversation={selected}
            draftSourceMessage={draftSourceMessage}
            draftSourceMode={draftSourceMode}
            knowledgeEntries={knowledgeEntries}
            templates={templates}
            onChangeDraft={(value) =>
              void updateInternalDraft(selected, value)
            }
            onChangeOwner={(value) =>
              void assignWorkflowUser(selected, value)
            }
            onChangeWorkflowStatus={(value) =>
              void changeWorkflowStatus(selected, value)
            }
            onMarkResolved={() => markConversationResolved(selected)}
            onReopenConversation={() => reopenConversation(selected)}
            onGenerateDraft={() => void generateInternalDraft(selected)}
            onGenerateSmartDraft={() => void generateSmartDraft(selected)}
            onApplyTemplate={(templateId) =>
              void applyInternalTemplate(selected, templateId)
            }
            onSaveKnowledge={(templateId) =>
              void saveApprovedKnowledgeExample(selected, templateId)
            }
            onReviewDraft={(status) => void reviewInternalDraft(selected, status)}
            onPreparePendingReply={() => void preparePendingReply(selected)}
            onReviewPendingReplyForGmailDraft={() =>
              void reviewPendingReplyForGmailDraft(selected)
            }
            onCreateGmailDraftOnly={() => void createGmailDraftOnly(selected)}
            onFinalizeGmailDraftSend={(idempotencyKey) =>
              void finalizeGmailDraftSend(selected, idempotencyKey)
            }
            currentUser={currentUser}
            reviewNote={reviewNotes[selected.id] ?? ""}
            onChangeReviewNote={(value) =>
              setReviewNotes((current) => ({ ...current, [selected.id]: value }))
            }
          />
        ) : (
          <div className="amazon-empty-state">No hay conversaciones.</div>
        )}
        </div>
      )}

      {activeTab === "knowledge" && (
        <KnowledgeBasePanel
          categoryFilter={knowledgeCategoryFilter}
          entries={knowledgeEntries}
          languageFilter={knowledgeLanguageFilter}
          message={knowledgeMessage}
          onChangeCategoryFilter={setKnowledgeCategoryFilter}
          onChangeLanguageFilter={setKnowledgeLanguageFilter}
          onChangeOrderSearch={setKnowledgeOrderSearch}
          onChangeSearch={setKnowledgeSearch}
          onUpdateCategory={(exampleId, category) =>
            void updateKnowledgeCategory(exampleId, category)
          }
          onUpdateTags={(exampleId, tags) =>
            void updateKnowledgeTags(exampleId, tags)
          }
          orderSearch={knowledgeOrderSearch}
          search={knowledgeSearch}
        />
      )}

      {activeTab === "templates" && (
        <TemplatesPanel templates={templates} />
      )}

      {activeTab === "stats" && (
        <StatsPanel
          alerts={smartAlerts}
          logisticsStats={logisticsStats}
          productStats={productStats}
          range={statsRange}
          setRange={setStatsRange}
          summary={statsSummary}
          templates={templates}
        />
      )}

      {activeTab === "supervisor" && (
        <SupervisorPanel
          capabilities={supportBotCapabilities}
          gmailSyncStatus={gmailSyncStatus}
          gmailSyncMessage={gmailSyncMessage}
          manualSyncRunning={manualSyncRunning}
          onManualSync={() => void runManualGmailSync()}
          operatorStats={operatorStats}
          smartDraftStats={smartDraftStats}
          workflowStats={workflowStats}
          knowledgeEntries={knowledgeEntries}
          summary={statsSummary}
        />
      )}
    </section>
  );
}

function ConversationDetail({
  conversation,
  draftSourceMessage,
  draftSourceMode,
  knowledgeEntries,
  onChangeDraft,
  onChangeReviewNote,
  onGenerateDraft,
  onGenerateSmartDraft,
  onApplyTemplate,
  onSaveKnowledge,
  onReviewDraft,
  onPreparePendingReply,
  onReviewPendingReplyForGmailDraft,
  onCreateGmailDraftOnly,
  onFinalizeGmailDraftSend,
  onChangeOwner,
  onChangeWorkflowStatus,
  onMarkResolved,
  onReopenConversation,
  currentUser,
  reviewNote,
  templates,
}: {
  conversation: AmazonConversation;
  currentUser?: Props["currentUser"];
  draftSourceMessage: string;
  draftSourceMode: DraftSourceMode;
  knowledgeEntries: AmazonKnowledgeEntry[];
  onChangeDraft: (value: string) => void;
  onChangeReviewNote: (value: string) => void;
  onGenerateDraft: () => void;
  onGenerateSmartDraft: () => void;
  onApplyTemplate: (templateId: string) => void;
  onSaveKnowledge: (templateId?: string) => void;
  onReviewDraft: (
    status: "APROBADO_MANUALMENTE" | "RECHAZADO" | "NECESITA_CAMBIOS",
  ) => void;
  onPreparePendingReply: () => void;
  onReviewPendingReplyForGmailDraft: () => void;
  onCreateGmailDraftOnly: () => void;
  onFinalizeGmailDraftSend: (idempotencyKey: string) => void;
  onChangeOwner: (value: string) => void;
  onChangeWorkflowStatus: (value: AmazonWorkflowStatus) => void;
  onMarkResolved: () => void;
  onReopenConversation: () => void;
  reviewNote: string;
  templates: AmazonTemplate[];
}) {
  const sortedMessages = [...conversation.messages].sort(
    (left, right) =>
      new Date(left.receivedAt).getTime() - new Date(right.receivedAt).getTime(),
  );
  const customerMessages = sortedMessages.filter(
    (item) => item.direction === "inbound",
  );
  const customerAttachments = customerMessages.flatMap((item) => item.attachments);
  const contextSummary = buildConversationContextSummary(
    conversation,
    sortedMessages,
  );
  const relatedKnowledge = knowledgeEntries.filter((entry) =>
    conversation.draft?.consultedKnowledgeIds.includes(entry.id),
  );
  const selectedTemplate = templates.find(
    (template) => template.id === conversation.draft?.templateId,
  );
  const recommendedTemplate = templates.find(
    (template) => template.category === conversation.category && template.status === "active",
  ) ?? templates.find((template) => template.status === "active");
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    recommendedTemplate?.id ?? "",
  );
  useEffect(() => {
    if (!selectedTemplateId && recommendedTemplate?.id) {
      setSelectedTemplateId(recommendedTemplate.id);
    }
  }, [recommendedTemplate?.id, selectedTemplateId]);
  const [previewAttachment, setPreviewAttachment] =
    useState<AmazonAttachmentMetadata | null>(null);
  const [outgoingAttachments, setOutgoingAttachments] = useState<
    AmazonAttachmentMetadata[]
  >([]);
  const [attachmentAuditEvents, setAttachmentAuditEvents] = useState<
    AmazonAuditEvent[]
  >([]);
  const [finalSendModalOpen, setFinalSendModalOpen] = useState(false);
  const currentWorkflowStatus = workflowStatusOf(conversation);
  const canMarkResolved =
    currentWorkflowStatus !== "RESUELTO" && currentWorkflowStatus !== "CERRADO";
  const canReopen =
    currentWorkflowStatus === "RESUELTO" || currentWorkflowStatus === "CERRADO";
  const [finalSendIdempotencyKey, setFinalSendIdempotencyKey] = useState("");
  const [finalSendConfirmations, setFinalSendConfirmations] = useState<
    Record<string, boolean>
  >({});
  const [translatedCustomerMessages, setTranslatedCustomerMessages] = useState<
    Record<string, string>
  >({});
  const [translatedDraftBody, setTranslatedDraftBody] = useState("");

  const pendingReply = conversation.pendingReply;
  const canUseFinalSend = Boolean(
    currentUser?.permissions.includes("amazonMessagesSendFinal"),
  );
  const finalSendState = finalSendStateOf(conversation);
  const finalSendReady = isFinalSendReady(conversation, canUseFinalSend);
  const finalSendConfirmationItems = pendingReply
    ? [
        ["conversationId", "conversationId", conversation.id],
        ["pendingReplyId", "pendingReplyId", pendingReply.id],
        ["gmailDraftId", "gmailDraftId", pendingReply.gmailDraftId ?? "Pendiente"],
        ["recipient", "destinatario", pendingReply.gmailDraftRecipient ?? "Pendiente"],
        ["subject", "asunto", pendingReply.gmailDraftSubject ?? "Pendiente"],
        ["bodyHash", "bodyHash", pendingReply.gmailDraftBodyHash ?? "Pendiente"],
        ["idempotencyKey", "idempotencyKey", finalSendIdempotencyKey || "Pendiente"],
      ] as Array<[string, string, string]>
    : [];
  const finalSendFullyConfirmed =
    finalSendConfirmationItems.length > 0 &&
    finalSendConfirmationItems.every(([key]) => finalSendConfirmations[key]);

  function openFinalSendModal() {
    setFinalSendIdempotencyKey(
      `final-send-${conversation.id}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`,
    );
    setFinalSendConfirmations({});
    setFinalSendModalOpen(true);
  }

  function confirmFinalSend() {
    if (!finalSendFullyConfirmed || !finalSendIdempotencyKey) return;
    onFinalizeGmailDraftSend(finalSendIdempotencyKey);
    setFinalSendModalOpen(false);
  }

  function translateCustomerMessage(messageToTranslate: AmazonSupportMessage) {
    setTranslatedCustomerMessages((current) => ({
      ...current,
      [messageToTranslate.id]: translateMessageToSpanish(
        messageToTranslate.bodyText,
        conversation.extracted.language,
      ),
    }));
  }

  function translateDraftToCustomerLanguage() {
    setTranslatedDraftBody(
      translateDraftFromSpanish(
        conversation.draft?.body ?? "",
        conversation.draft?.detectedLanguage ?? conversation.extracted.language,
      ),
    );
  }

  const auditEvents = [...conversation.audit, ...attachmentAuditEvents].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  function registerAttachmentAudit(
    attachment: AmazonAttachmentMetadata,
    eventType: "attachment_viewed" | "attachment_downloaded",
  ) {
    setAttachmentAuditEvents((current) => [
      ...current,
      {
        id: `${conversation.id}-${eventType}-${attachment.id}-${current.length + 1}`,
        conversationId: conversation.id,
        eventType,
        label:
          eventType === "attachment_viewed"
            ? `Adjunto visualizado: ${attachment.sanitizedName}`
            : `Descarga solicitada: ${attachment.sanitizedName}`,
        actor: "Operador demo",
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  function handleOutgoingAttachment(files: FileList | null) {
    if (!files) return;
    const nextAttachments = Array.from(files).map((file) => ({
      ...buildAttachmentMetadata(file.name, `draft-${conversation.id}`, new Date().toISOString(), file.size),
      conversationId: conversation.id,
      origin: "operator_upload" as const,
    }));
    setOutgoingAttachments((current) => [...current, ...nextAttachments]);
  }

  return (
    <div className="amazon-detail">
      <div className="amazon-detail-header">
        <div>
          <p className="eyebrow">{conversation.marketplace}</p>
          <h3>{conversation.subject}</h3>
          <div className="amazon-tag-row">
            <Tag tone={conversation.priority}>{priorityLabels[conversation.priority]}</Tag>
            <Tag tone={conversation.operationalQueue === "critical" ? "urgent" : "neutral"}>
              {queueLabels[conversation.operationalQueue]}
            </Tag>
            <Tag tone="neutral">{categoryLabels[conversation.category]}</Tag>
            <Tag tone={conversation.matchConfidence === "exact" ? "normal" : "high"}>
              Match {conversation.matchConfidence}
            </Tag>
          </div>
        </div>
        <div className="amazon-inline-controls">
          {canMarkResolved ? (
            <button
              className="amazon-resolve-button"
              onClick={onMarkResolved}
              type="button"
            >
              Marcar como resuelto
            </button>
          ) : null}
          {canReopen ? (
            <button
              className="amazon-reopen-button"
              onClick={onReopenConversation}
              type="button"
            >
              Reabrir
            </button>
          ) : null}
          <label>
            Estado conversacion
            <select
              onChange={(event) =>
                onChangeWorkflowStatus(event.target.value as AmazonWorkflowStatus)
              }
              value={workflowStatusOf(conversation)}
            >
              {workflowOrder.map((value) => (
                <option key={value} value={value}>
                  {workflowLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Responsable
            <select
              onChange={(event) => onChangeOwner(event.target.value)}
              value={conversation.assignedUser}
            >
              <option>Sin asignar</option>
              <option>Soporte</option>
              <option>Rafa</option>
            </select>
          </label>
        </div>
      </div>

      <div className="amazon-detail-grid">
        <aside className="amazon-side-panel">
          <PanelTitle icon={<UserRound size={17} />} title="Cliente" />
          <InfoLine label="Cliente" value={conversation.customerDisplayName} />
          <InfoLine label="Alias hash" value={conversation.buyerAliasHash} />
          <InfoLine label="Marketplace" value={conversation.marketplace} />
          <InfoLine label="Pedido Amazon" value={conversation.amazonOrderId ?? "Sin pedido"} />
          <InfoLine label="Notificacion" value={conversation.notificationType} />
          <InfoLine label="Cola" value={queueLabels[conversation.operationalQueue]} />
          <InfoLine label="Idioma" value={conversation.extracted.language ?? "Sin detectar"} />
          <InfoLine label="Estado conversacion" value={workflowLabels[workflowStatusOf(conversation)]} />
          <InfoLine label="Estado borrador" value={draftStatusLabel(conversation)} />
          <InfoLine label="Asignado a" value={conversation.assignedUser} />
          <InfoLine
            label="Asignado el"
            value={conversation.assignedAt ? formatDateTime(conversation.assignedAt) : "Sin fecha"}
          />
          <InfoLine
            label="Ultima actividad"
            value={formatDateTime(conversation.lastActivityAt ?? conversation.lastMessageAt)}
          />
        </aside>

        <main className="amazon-thread">
          <div className="amazon-context-summary">
            <PanelTitle icon={<Brain size={17} />} title="Resumen IA del contexto" />
            <p>{contextSummary}</p>
          </div>

          <div className="amazon-thread-history">
            <PanelTitle icon={<Mail size={17} />} title="Historial completo" />
            {sortedMessages.map((threadMessage) => (
              <div
                className={`amazon-message ${threadMessage.direction}`}
                key={threadMessage.id}
              >
                <div className="amazon-message-meta">
                  <strong>{messageAuthorLabel(threadMessage)}</strong>
                  <span>{formatDateTime(threadMessage.receivedAt)}</span>
                </div>
                <p>{threadMessage.bodyText}</p>
                {threadMessage.direction === "inbound" ? (
                  <div className="amazon-translation-actions">
                    <button
                      onClick={() => translateCustomerMessage(threadMessage)}
                      type="button"
                    >
                      Traducir al español
                    </button>
                  </div>
                ) : null}
                {translatedCustomerMessages[threadMessage.id] ? (
                  <div className="amazon-translation-result">
                    <strong>Español</strong>
                    <p>{translatedCustomerMessages[threadMessage.id]}</p>
                  </div>
                ) : null}
                {threadMessage.attachmentNames.length > 0 && (
                  <div className="amazon-attachments">
                    {threadMessage.attachmentNames.map((attachmentName) => (
                      <span key={attachmentName}>
                        <Paperclip size={14} />
                        {attachmentName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="amazon-attachment-panel">
            <PanelTitle icon={<Paperclip size={17} />} title="Adjuntos del cliente" />
            {customerAttachments.length > 0 ? (
              <AttachmentList
                attachments={customerAttachments}
                onDownload={(attachment) => {
                  registerAttachmentAudit(attachment, "attachment_downloaded");
                }}
                onPreview={(attachment) => {
                  setPreviewAttachment(attachment);
                  registerAttachmentAudit(attachment, "attachment_viewed");
                }}
              />
            ) : (
              <EmptyPanel text="Este mensaje no incluye adjuntos." />
            )}
            {previewAttachment && (
              <AttachmentPreview
                attachment={previewAttachment}
                onClose={() => setPreviewAttachment(null)}
              />
            )}
          </div>

          <div className="amazon-ai-panel">
            <PanelTitle icon={<Bot size={17} />} title="Motor de sugerencias IA" />
            <div className="amazon-draft-state-row">
              <span className={`amazon-draft-state ${draftStateClass(conversation)}`}>
                {draftStatusLabel(conversation)}
              </span>
              <span
                className={`amazon-draft-source ${
                  draftSourceMode === "backend" ? "backend" : "local"
                }`}
                title={draftSourceMessage}
              >
                {draftSourceMode === "backend" ? "BACKEND DRAFT" : "LOCAL FALLBACK"}
              </span>
              <button onClick={onGenerateDraft} type="button">
                <Sparkles size={15} />
                Generar borrador
              </button>
              <button onClick={onGenerateSmartDraft} type="button">
                <Brain size={15} />
                Generar borrador inteligente
              </button>
            </div>
            <div className="amazon-template-apply-row">
              <select
                aria-label="Plantilla interna"
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                value={selectedTemplateId}
              >
                {templates
                  .filter((template) => template.status === "active")
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} · {categoryLabels[template.category]}
                    </option>
                  ))}
              </select>
              <button
                disabled={!selectedTemplateId}
                onClick={() => onApplyTemplate(selectedTemplateId)}
                type="button"
              >
                <FileText size={15} />
                Aplicar plantilla interna
              </button>
            </div>
            <div className="amazon-ai-summary">
              <InfoLine
                label="Clasificacion"
                value={categoryLabels[conversation.category]}
              />
              <InfoLine label="Accion" value={conversation.recommendedAction} />
              <InfoLine
                label="Confianza"
                value={`${Math.round((conversation.draft?.confidence ?? 0) * 100)}%`}
              />
              <InfoLine
                label="Idioma detectado"
                value={conversation.draft?.detectedLanguage ?? conversation.extracted.language ?? "Sin detectar"}
              />
              <InfoLine
                label="Categoria detectada"
                value={categoryLabel(conversation.draft?.detectedCategory ?? conversation.category)}
              />
              <InfoLine
                label="Modo"
                value={suggestionModeLabel(conversation.draft?.suggestionMode)}
              />
            </div>
            <div className="amazon-ai-evidence">
              <div>
                <span>Plantilla utilizada</span>
                <strong>{selectedTemplate?.name ?? "Sin plantilla aprobada"}</strong>
                <small>
                  Prioridad: plantilla aprobada, ejemplos aprobados, generacion libre.
                </small>
              </div>
              <div>
                <span>Ejemplos consultados</span>
                <strong>{relatedKnowledge.length}</strong>
                <small>
                  Solo ejemplos aprobados y marcados para uso interno. Sin entrenamiento externo.
                </small>
              </div>
            </div>
            {conversation.draft?.warnings?.length ? (
              <div className="amazon-smart-warnings">
                {conversation.draft.warnings.map((warning) => (
                  <span key={warning}>
                    <AlertTriangle size={14} />
                    {warning}
                  </span>
                ))}
              </div>
            ) : null}
            <label className="amazon-draft-editor">
              Borrador editable
              <textarea
                onChange={(event) => onChangeDraft(event.target.value)}
                placeholder="Sin borrador interno generado."
                value={conversation.draft?.body ?? ""}
              />
            </label>
            <div className="amazon-translation-actions">
              <button
                disabled={!conversation.draft?.body}
                onClick={translateDraftToCustomerLanguage}
                type="button"
              >
                Traducir al idioma del cliente
              </button>
            </div>
            {translatedDraftBody ? (
              <div className="amazon-translation-result">
                <strong>
                  Idioma cliente:{" "}
                  {conversation.draft?.detectedLanguage ??
                    conversation.extracted.language ??
                    "sin detectar"}
                </strong>
                <p>{translatedDraftBody}</p>
              </div>
            ) : null}
            <div className="amazon-review-panel">
              <div className="amazon-review-header">
                <strong>Revision humana</strong>
                <span>Modo seguro: no se enviara nada</span>
              </div>
              <label>
                Nota interna
                <textarea
                  onChange={(event) => onChangeReviewNote(event.target.value)}
                  placeholder="Motivo de aprobacion, rechazo o cambios necesarios."
                  value={reviewNote}
                />
              </label>
              <div className="amazon-review-actions">
                <button
                  disabled={!conversation.draft}
                  onClick={() => onReviewDraft("APROBADO_MANUALMENTE")}
                  type="button"
                >
                  <CheckCircle2 size={15} />
                  Aprobar borrador
                </button>
                <button
                  disabled={!conversation.draft}
                  onClick={() => onReviewDraft("NECESITA_CAMBIOS")}
                  type="button"
                >
                  <AlertTriangle size={15} />
                  Necesita cambios
                </button>
                <button
                  disabled={!conversation.draft}
                  onClick={() => onReviewDraft("RECHAZADO")}
                  type="button"
                >
                  <X size={15} />
                  Rechazar borrador
                </button>
                <button
                  disabled={conversation.draft?.status !== "APROBADO_MANUALMENTE"}
                  onClick={onPreparePendingReply}
                  type="button"
                >
                  <Mail size={15} />
                  Preparar respuesta
                </button>
                <button
                  disabled={conversation.draft?.status !== "APROBADO_MANUALMENTE"}
                  onClick={() => onSaveKnowledge(selectedTemplateId || undefined)}
                  type="button"
                >
                  <Brain size={15} />
                  Guardar ejemplo
                </button>
              </div>
              {conversation.draft?.reviewHistory?.length ? (
                <div className="amazon-review-history">
                  {conversation.draft.reviewHistory.map((event) => (
                    <div key={event.eventId}>
                      <span>{formatDateTime(event.createdAt)}</span>
                      <strong>
                        {draftReviewStatusLabel(event.previousStatus)} {"->"}{" "}
                        {draftReviewStatusLabel(event.newStatus)}
                      </strong>
                      <small>
                        {event.actorName}
                        {event.note ? ` · ${event.note}` : ""}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyPanel text="Sin historial de revision manual." />
              )}
            </div>
            <div className="amazon-pending-reply-panel">
              <div className="amazon-review-header">
                <strong>Respuesta pendiente</strong>
                <span>Preparada, no enviada</span>
              </div>
              {conversation.pendingReply ? (
                <>
                  <div className="amazon-ai-summary">
                    <InfoLine
                      label="Estado"
                      value={pendingReplyStatusLabel(conversation.pendingReply.status)}
                    />
                    <InfoLine label="Canal" value={pendingReplyChannelLabel(conversation.pendingReply.channel)} />
                    <InfoLine label="Preparada por" value={conversation.pendingReply.preparedBy} />
                    <InfoLine
                      label="Actualizada"
                      value={formatDateTime(conversation.pendingReply.updatedAt)}
                    />
                  </div>
                  <pre className="amazon-pending-reply-body">
                    {conversation.pendingReply.replyBody}
                  </pre>
                  <div className="amazon-send-guard">
                    <ShieldCheck size={16} />
                    {conversation.pendingReply.status === "SENT"
                      ? "Respuesta enviada desde Gmail Draft aprobado y registrada en auditoria."
                      : conversation.pendingReply.status === "SEND_FAILED"
                        ? "El envio final fallo. La conversacion no se ha cerrado y solo se permite reintento si no existe sentMessageId."
                        : "Esta respuesta esta preparada para validacion. No existe respuesta real al comprador antes de la confirmacion final."}
                  </div>
                  <div className="amazon-review-actions">
                    <button
                      disabled={
                        conversation.pendingReply.status === "APROBADA_PARA_BORRADOR" ||
                        conversation.pendingReply.status === "RECHAZADA" ||
                        conversation.pendingReply.status === "CANCELADA"
                      }
                      onClick={onReviewPendingReplyForGmailDraft}
                      type="button"
                    >
                      <ShieldCheck size={15} />
                      Aprobar para borrador Gmail
                    </button>
                    <button
                      disabled={
                        conversation.pendingReply.status !== "APROBADA_PARA_BORRADOR"
                      }
                      onClick={onCreateGmailDraftOnly}
                      type="button"
                    >
                      <Mail size={15} />
                      Crear/actualizar borrador Gmail
                    </button>
                  </div>
                  <div className={`amazon-final-send-state ${finalSendState}`}>
                    <strong>{finalSendStateLabel(finalSendState)}</strong>
                    <span>
                      {finalSendState === "ready"
                        ? "Gmail Draft existente, bodyHash firmado y permiso final disponibles."
                        : finalSendState === "sending"
                          ? "Envio en progreso. Doble envio bloqueado por estado e idempotencia."
                          : finalSendState === "sent"
                            ? `Enviado. sentMessageId=${conversation.pendingReply.amazonMessageActionId ?? "registrado"}`
                            : finalSendState === "error"
                              ? "Fallo registrado. Reintento solo si no existe sentMessageId."
                              : canUseFinalSend
                                ? "Falta aprobacion, Gmail Draft o datos firmados para finalizar."
                                : "Permiso amazonMessagesSendFinal no disponible para este usuario."}
                    </span>
                  </div>
                  {conversation.pendingReply.gmailDraftId ? (
                    <div className="amazon-ai-summary">
                      <InfoLine
                        label="Gmail Draft"
                        value={conversation.pendingReply.gmailDraftId}
                      />
                      <InfoLine
                        label="Destinatario"
                        value={conversation.pendingReply.gmailDraftRecipient ?? "Pendiente"}
                      />
                      <InfoLine
                        label="Asunto"
                        value={conversation.pendingReply.gmailDraftSubject ?? "Pendiente"}
                      />
                      <InfoLine
                        label="Hash body"
                        value={conversation.pendingReply.gmailDraftBodyHash ?? "Pendiente"}
                      />
                      <InfoLine
                        label="sentMessageId"
                        value={conversation.pendingReply.amazonMessageActionId ?? "Sin envio"}
                      />
                    </div>
                  ) : null}
                  {finalSendReady ? (
                    <div className="amazon-review-actions">
                      <button
                        className="amazon-final-send-button"
                        disabled={conversation.pendingReply.status === "SEND_IN_PROGRESS"}
                        onClick={openFinalSendModal}
                        type="button"
                      >
                        <Send size={15} />
                        Enviar y resolver
                      </button>
                    </div>
                  ) : null}
                  {conversation.pendingReply.history.length ? (
                    <div className="amazon-pending-reply-history">
                      <strong>Auditoria respuesta pendiente</strong>
                      {conversation.pendingReply.history.map((event) => (
                        <div key={event.eventId}>
                          <span>{formatDateTime(event.createdAt)}</span>
                          <b>
                            {pendingReplyStatusLabel(event.previousStatus)} {"->"}{" "}
                            {pendingReplyStatusLabel(event.newStatus)}
                          </b>
                          <small>
                            {event.actorName}
                            {event.note ? ` · ${event.note}` : ""}
                          </small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyPanel text="Sin auditoria propia de respuesta pendiente." />
                  )}
                </>
              ) : (
                <EmptyPanel text="Aun no hay respuesta pendiente preparada." />
              )}
            </div>
            {finalSendModalOpen && pendingReply ? (
              <div className="amazon-final-send-modal-backdrop" role="presentation">
                <div
                  aria-modal="true"
                  className="amazon-final-send-modal"
                  role="dialog"
                >
                  <div className="amazon-review-header">
                    <strong>Confirmar envio y resolucion</strong>
                    <button
                      aria-label="Cerrar confirmacion"
                      onClick={() => setFinalSendModalOpen(false)}
                      type="button"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="amazon-final-send-warning">
                    <AlertTriangle size={18} />
                    <span>Esta acción enviará el mensaje al cliente, registrará auditoría y marcará la conversación como resuelta</span>
                  </div>
                  <div className="amazon-ai-summary">
                    <InfoLine label="Destinatario" value={pendingReply.gmailDraftRecipient ?? "Pendiente"} />
                    <InfoLine label="Asunto" value={pendingReply.gmailDraftSubject ?? "Pendiente"} />
                    <InfoLine label="Pedido" value={conversation.amazonOrderId ?? "Sin pedido"} />
                    <InfoLine label="Marketplace" value={conversation.marketplace} />
                    <InfoLine label="Idioma" value={conversation.extracted.language ?? "Sin detectar"} />
                    <InfoLine label="bodyHash" value={pendingReply.gmailDraftBodyHash ?? "Pendiente"} />
                    <InfoLine label="Resumen" value={summarizeReplyBody(pendingReply.replyBody)} />
                  </div>
                  <div className="amazon-final-send-confirmations">
                    {finalSendConfirmationItems.map(([key, label, value]) => (
                      <label key={key}>
                        <input
                          checked={Boolean(finalSendConfirmations[key])}
                          onChange={(event) =>
                            setFinalSendConfirmations((current) => ({
                              ...current,
                              [key]: event.target.checked,
                            }))
                          }
                          type="checkbox"
                        />
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </label>
                    ))}
                  </div>
                  <div className="amazon-final-send-modal-actions">
                    <button
                      onClick={() => setFinalSendModalOpen(false)}
                      type="button"
                    >
                      Cancelar
                    </button>
                    <button
                      className="amazon-final-send-button"
                      disabled={!finalSendFullyConfirmed}
                      onClick={confirmFinalSend}
                      type="button"
                    >
                      <Send size={15} />
                      Enviar y resolver
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="amazon-outgoing-attachments">
              <label className="amazon-file-button">
                <Upload size={16} />
                Adjuntar archivo
                <input
                  multiple
                  onChange={(event) => handleOutgoingAttachment(event.target.files)}
                  type="file"
                />
              </label>
              {outgoingAttachments.length > 0 && (
                <AttachmentList
                  attachments={outgoingAttachments}
                  onDownload={() => undefined}
                  onPreview={(attachment) => setPreviewAttachment(attachment)}
                  onRemove={(attachment) =>
                    setOutgoingAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                />
              )}
            </div>
            <div className="amazon-send-guard">
              <AlertTriangle size={16} />
              Respuesta real deshabilitada en modo seguro. Este borrador es interno
              y no contacta al comprador.
            </div>
          </div>

          <div className="amazon-audit">
            <PanelTitle icon={<Clock size={17} />} title="Auditoria interna" />
            {conversation.workflowHistory?.length ? (
              <div className="amazon-review-history">
                {conversation.workflowHistory.map((event) => (
                  <div key={event.eventId}>
                    <span>{formatDateTime(event.createdAt)}</span>
                    <strong>
                      {workflowLabels[event.previousStatus]} {"->"}{" "}
                      {workflowLabels[event.newStatus]}
                    </strong>
                    <small>
                      {event.actorName}
                      {event.reason ? ` · ${event.reason}` : ""}
                    </small>
                  </div>
                ))}
              </div>
            ) : null}
            {auditEvents.map((event) => (
              <div className="amazon-audit-event" key={event.id}>
                <span>{formatDateTime(event.createdAt)}</span>
                <strong>{event.label}</strong>
                <small>{event.actor}</small>
              </div>
            ))}
          </div>
        </main>

        <aside className="amazon-context-panel">
          <PanelTitle icon={<Package size={17} />} title="Pedido Odoo" />
          <InfoLine label="ASIN" value={conversation.extracted.asin ?? "No extraido"} />
          <InfoLine label="SKU" value={conversation.extracted.sku ?? "No extraido"} />
          <InfoLine
            label="Cantidad"
            value={conversation.extracted.quantity?.toString() ?? "No extraida"}
          />
          <InfoLine
            label="Importe"
            value={
              conversation.extracted.amount
                ? `${conversation.extracted.amount.toFixed(2)} ${conversation.extracted.currency ?? "EUR"}`
                : "No extraido"
            }
          />
          <InfoLine label="Motivo" value={conversation.extracted.reason ?? "No extraido"} />
          <InfoLine
            label="Riesgo devolucion"
            value={
              conversation.extracted.isInternationalReturnAddressRisk
                ? "Direccion internacional/local"
                : "No detectado"
            }
          />
          {conversation.context.order ? (
            <>
              <InfoLine label="Odoo" value={conversation.context.order.odooRef} />
              <InfoLine
                label="Amazon"
                value={
                  conversation.context.order.externalRef ??
                  conversation.amazonOrderId ??
                  "Sin referencia"
                }
              />
              <InfoLine label="Canal" value={conversation.context.order.channel} />
              <InfoLine label="Cliente" value={conversation.context.order.client} />
              <InfoLine label="Total" value={`${conversation.context.order.total.toFixed(2)} EUR`} />
              <div className="amazon-products">
                {conversation.context.order.items.slice(0, 3).map((item) => (
                  <span key={`${item.sku}-${item.name}`}>
                    {item.quantity}x {item.name}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <EmptyPanel text="No hay pedido vinculado. El operador debera enlazarlo manualmente." />
          )}

          <PanelTitle icon={<Truck size={17} />} title="Tracking Sendcloud" />
          {conversation.context.tracking ? (
            <>
              <InfoLine label="Transportista" value={conversation.context.tracking.carrier} />
              <InfoLine label="Estado" value={conversation.context.tracking.status} />
              <InfoLine
                label="Tracking"
                value={conversation.context.tracking.trackingNumber ?? "Sin tracking"}
              />
              {conversation.context.tracking.trackingUrl ? (
                <a
                  className="amazon-tracking-link"
                  href={conversation.context.tracking.trackingUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Abrir Sendcloud
                </a>
              ) : null}
              <InfoLine label="Ultimo evento" value={conversation.context.tracking.lastEvent} />
              <InfoLine
                label="Actualizado"
                value={formatDateTime(conversation.context.tracking.updatedAt)}
              />
            </>
          ) : (
            <EmptyPanel text="Sin seguimiento encontrado." />
          )}

          <PanelTitle icon={<FileText size={17} />} title="Factura Odoo" />
          {conversation.context.invoice ? (
            <>
              <InfoLine label="Referencia" value={conversation.context.invoice.ref} />
              <InfoLine label="Estado" value={conversation.context.invoice.status} />
              <InfoLine
                label="PDF"
                value={conversation.context.invoice.pdfAvailable ? "Disponible" : "No disponible"}
              />
            </>
          ) : (
            <EmptyPanel text="Sin factura localizada." />
          )}

          <div className="amazon-context-note">
            <CheckCircle2 size={16} />
            Contexto mostrado en lectura. No modifica Odoo ni Sendcloud.
          </div>

          <TraceabilityPanel
            conversation={conversation}
            draftSourceMessage={draftSourceMessage}
            draftSourceMode={draftSourceMode}
          />
        </aside>
      </div>
    </div>
  );
}

function TraceabilityPanel({
  conversation,
  draftSourceMessage,
  draftSourceMode,
}: {
  conversation: AmazonConversation;
  draftSourceMessage: string;
  draftSourceMode: DraftSourceMode;
}) {
  const message = conversation.messages[0];
  const importedEvent = conversation.audit.find(
    (event) => event.eventType === "imported",
  );
  const hasDraftEvent = conversation.audit.some((event) =>
    event.label.toLowerCase().includes("borrador interno"),
  );
  return (
    <div className="amazon-traceability-panel">
      <PanelTitle icon={<ShieldCheck size={17} />} title="Trazabilidad Gmail readonly" />
      <InfoLine label="Origen" value={message.source === "amazon_email_relay" ? "Gmail readonly" : message.source} />
      <InfoLine label="Etiqueta origen" value="AmazonSeller" />
      <InfoLine
        label="Fecha importacion"
        value={formatDateTime(importedEvent?.createdAt ?? conversation.lastMessageAt)}
      />
      <InfoLine label="Parser utilizado" value="amazonEmailParser / backend parser" />
      <InfoLine label="Estado conversacion" value={workflowLabels[workflowStatusOf(conversation)]} />
      <InfoLine label="Estado borrador" value={draftStatusLabel(conversation)} />
      <InfoLine
        label="Adjuntos"
        value={message.attachments.length > 0 ? `${message.attachments.length}` : "No"}
      />
      <InfoLine
        label="Duplicado"
        value={
          conversation.audit.some((event) => event.eventType === "deduplicated")
            ? "Si"
            : "No"
        }
      />
      <InfoLine label="Remitente" value={message.fromLabel} />
      <InfoLine label="Asunto" value={message.subject} />
      <InfoLine label="Fecha mensaje" value={formatDateTime(message.receivedAt)} />
      <InfoLine
        label="Borrador"
        value={hasDraftEvent ? "BORRADOR INTERNO registrado" : "Sin borrador"}
      />
      <InfoLine
        label="Persistencia"
        value={draftSourceMode === "backend" ? "BACKEND DRAFT" : "LOCAL FALLBACK"}
      />
      <InfoLine label="Detalle persistencia" value={draftSourceMessage} />
    </div>
  );
}

function KnowledgeBasePanel({
  categoryFilter,
  entries,
  languageFilter,
  message,
  onChangeCategoryFilter,
  onChangeLanguageFilter,
  onChangeOrderSearch,
  onChangeSearch,
  onUpdateCategory,
  onUpdateTags,
  orderSearch,
  search,
}: {
  categoryFilter: string;
  entries: AmazonKnowledgeEntry[];
  languageFilter: string;
  message: string;
  onChangeCategoryFilter: (value: string) => void;
  onChangeLanguageFilter: (value: string) => void;
  onChangeOrderSearch: (value: string) => void;
  onChangeSearch: (value: string) => void;
  onUpdateCategory: (exampleId: string, category: string) => void;
  onUpdateTags: (exampleId: string, tags: string[]) => void;
  orderSearch: string;
  search: string;
}) {
  const categories = knowledgeCategories;
  const languages = Array.from(new Set(entries.map((entry) => entry.language))).sort();
  return (
    <div className="amazon-management-grid">
      <section className="amazon-management-main">
        <PanelTitle icon={<Brain size={17} />} title="Base de conocimiento" />
        <div className="amazon-source-note">{message}</div>
        <div className="amazon-knowledge-filters">
          <label className="amazon-search">
            <Search size={16} />
            <input
              aria-label="Buscar ejemplos aprobados"
              onChange={(event) => onChangeSearch(event.target.value)}
              placeholder="Texto libre, respuesta, etiqueta"
              value={search}
            />
          </label>
          <label className="amazon-search">
            <Package size={16} />
            <input
              aria-label="Buscar pedido Amazon"
              onChange={(event) => onChangeOrderSearch(event.target.value)}
              placeholder="Pedido Amazon"
              value={orderSearch}
            />
          </label>
          <select
            aria-label="Filtrar categoria"
            onChange={(event) => onChangeCategoryFilter(event.target.value)}
            value={categoryFilter}
          >
            <option value="">Todas las categorias</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {categoryLabel(category)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar idioma"
            onChange={(event) => onChangeLanguageFilter(event.target.value)}
            value={languageFilter}
          >
            <option value="">Todos los idiomas</option>
            {languages.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </div>
        <div className="amazon-table-list">
          {entries.map((entry) => (
            <article className="amazon-knowledge-row" key={entry.id}>
              <div>
                <strong>{categoryLabel(entry.category)}</strong>
                <span>
                  {entry.marketplace} · {entry.language} · {formatDateTime(entry.approvedAt || entry.date)}
                </span>
                <p>{entry.originalCustomerMessage}</p>
              </div>
              <div className="amazon-knowledge-meta">
                <Tag tone={entry.status === "active" ? "normal" : "neutral"}>
                  {entry.status}
                </Tag>
                <span>Aprobador: {entry.approver}</span>
                <span>Plantilla: {entry.templateName ?? "sin plantilla"}</span>
                <span>Calidad: {entry.quality} · {Math.round(entry.confidence * 100)}%</span>
                <span>SKU: {entry.sku ?? "sin SKU"}</span>
                <span>Pedido: {entry.amazonOrderId ?? "sin pedido"}</span>
              </div>
              <div className="amazon-approved-response">
                <span>Respuesta final aprobada</span>
                <p>{entry.finalResponse}</p>
                <small>{entry.draftDiff || entry.humanDiffSummary}</small>
                <div className="amazon-knowledge-edit">
                  <select
                    aria-label="Cambiar categoria ejemplo"
                    onChange={(event) => onUpdateCategory(entry.id, event.target.value)}
                    value={categoryForKnowledge(entry.category)}
                  >
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {categoryLabel(category)}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Editar etiquetas"
                    defaultValue={entry.tags.join(", ")}
                    onBlur={(event) =>
                      onUpdateTags(
                        entry.id,
                        event.target.value
                          .split(",")
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      )
                    }
                    placeholder="etiquetas separadas por coma"
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      <aside className="amazon-management-side">
        <PanelTitle icon={<ShieldCheck size={17} />} title="Aprendizaje controlado" />
        <InfoLine label="Ejemplos" value={entries.length.toString()} />
        <InfoLine label="Anonimizacion" value="Manual/controlada" />
        <InfoLine label="Aprendizaje" value="Solo ejemplos aprobados" />
        <InfoLine label="Plantillas" value="No se modifican solas" />
        <InfoLine label="Respuestas" value="No cambian automaticamente" />
        <div className="amazon-context-note">
          <Eye size={16} />
          Esta fase solo almacena conocimiento. No genera ni envia respuestas.
        </div>
      </aside>
    </div>
  );
}

function TemplatesPanel({ templates }: { templates: AmazonTemplate[] }) {
  return (
    <div className="amazon-management-grid">
      <section className="amazon-management-main">
        <PanelTitle icon={<FileText size={17} />} title="Plantillas editables" />
        <div className="amazon-action-row">
          <button type="button">
            <Plus size={15} />
            Crear
          </button>
          <button type="button">
            <Copy size={15} />
            Duplicar
          </button>
          <button type="button">
            <Archive size={15} />
            Archivar
          </button>
        </div>
        <div className="amazon-template-grid">
          {templates.map((template) => (
            <article className="amazon-template-card" key={template.id}>
              <div className="amazon-template-head">
                <strong>{template.name}</strong>
                <Tag tone={template.status === "active" ? "normal" : "neutral"}>
                  {template.status}
                </Tag>
              </div>
              <span>
                {categoryLabels[template.category]} · {template.marketplace} ·{" "}
                {template.language}
              </span>
              <p>{template.body}</p>
              <div className="amazon-variable-row">
                {template.variables.map((variable) => (
                  <code key={variable}>{variable}</code>
                ))}
              </div>
              <div className="amazon-card-stats">
                <span>{template.usageCount} usos</span>
                <span>{Math.round(template.acceptanceRate * 100)}% aceptacion</span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <aside className="amazon-management-side">
        <PanelTitle icon={<Sparkles size={17} />} title="Orden IA" />
        <InfoLine label="1" value="Plantilla aprobada" />
        <InfoLine label="2" value="Ejemplos aprobados" />
        <InfoLine label="3" value="Generacion libre controlada" />
        <div className="amazon-send-guard">
          <AlertTriangle size={16} />
          Las plantillas se validan aqui, pero ninguna respuesta se envia.
        </div>
      </aside>
    </div>
  );
}

function StatsPanel({
  alerts,
  logisticsStats,
  productStats,
  range,
  setRange,
  summary,
  templates,
}: {
  alerts: AmazonSmartAlert[];
  logisticsStats: Array<{
    carrier: string;
    incidents: number;
    delays: number;
    notReceived: number;
    deliveryProblems: number;
    country: string;
  }>;
  productStats: AmazonProductStats[];
  range: AmazonStatsRange;
  setRange: (range: AmazonStatsRange) => void;
  summary: AmazonStatsSummary;
  templates: AmazonTemplate[];
}) {
  return (
    <div className="amazon-stats-layout">
      <section className="amazon-management-main">
        <div className="amazon-stats-header">
          <PanelTitle icon={<BarChart3 size={17} />} title="Estadisticas operativas" />
          <select
            onChange={(event) => setRange(event.target.value as AmazonStatsRange)}
            value={range}
          >
            <option value="today">Hoy</option>
            <option value="last_7_days">Ultimos 7 dias</option>
            <option value="last_30_days">Ultimos 30 dias</option>
            <option value="current_month">Mes actual</option>
          </select>
        </div>
        <div className="amazon-kpi-grid">
          <Metric label="Total mensajes" value={summary.totalMessages.toString()} icon={<Mail size={18} />} />
          <Metric label="T. medio respuesta" value={`${summary.kpis.averageResponseMinutes} min`} icon={<Clock size={18} />} />
          <Metric label="Abiertos" value={summary.kpis.openCases.toString()} icon={<Inbox size={18} />} />
          <Metric label="Criticos" value={summary.kpis.criticalCases.toString()} icon={<AlertTriangle size={18} />} />
          <Metric label="Uso plantillas" value={summary.kpis.templateUses.toString()} icon={<FileText size={18} />} />
          <Metric label="Uso IA" value={summary.kpis.aiUses.toString()} icon={<Bot size={18} />} />
        </div>
        <div className="amazon-stat-columns">
          <StatList title="Categorias" rows={summary.byCategory} />
          <StatList title="Marketplaces" rows={summary.byMarketplace} />
          <StatList title="Idiomas" rows={summary.byLanguage} />
          <StatList title="Prioridad" rows={summary.byPriority} />
        </div>
        <AnalysisTables
          logisticsStats={logisticsStats}
          productStats={productStats}
          templates={templates}
        />
      </section>
      <aside className="amazon-management-side">
        <PanelTitle icon={<Lightbulb size={17} />} title="Alertas inteligentes" />
        {alerts.map((alert) => (
          <div className={`amazon-alert ${alert.severity}`} key={alert.id}>
            <strong>{alert.title}</strong>
            <span>{alert.detail}</span>
            <small>{alert.metric}</small>
          </div>
        ))}
      </aside>
    </div>
  );
}

function SupervisorPanel({
  capabilities,
  gmailSyncMessage,
  gmailSyncStatus,
  knowledgeEntries,
  manualSyncRunning,
  onManualSync,
  operatorStats,
  smartDraftStats,
  workflowStats,
  summary,
}: {
  capabilities: AmazonSupportBotCapability[];
  gmailSyncMessage: string;
  gmailSyncStatus: GmailSyncStatus | null;
  knowledgeEntries: AmazonKnowledgeEntry[];
  manualSyncRunning: boolean;
  onManualSync: () => void;
  operatorStats: AmazonOperatorStats[];
  smartDraftStats: ReturnType<typeof buildSmartDraftStats>;
  workflowStats: ReturnType<typeof buildWorkflowStats>;
  summary: AmazonStatsSummary;
}) {
  const knowledgeByCategory = countKnowledgeBy(knowledgeEntries, (entry) =>
    categoryLabel(entry.category),
  );
  const knowledgeByLanguage = countKnowledgeBy(
    knowledgeEntries,
    (entry) => entry.language,
  );
  return (
    <div className="amazon-management-grid">
      <section className="amazon-management-main">
        <PanelTitle icon={<UsersRound size={17} />} title="Control del personal" />
        <div className="amazon-operator-grid">
          {operatorStats.map((operator) => (
            <article className="amazon-operator-card" key={operator.operator}>
              <strong>{operator.operator}</strong>
              <div className="amazon-card-stats">
                <span>Asignados: {operator.assigned}</span>
                <span>Respondidos: {operator.responded}</span>
                <span>Validados: {operator.validated}</span>
                <span>Pendientes: {operator.pendingCases}</span>
                <span>Cerrados: {operator.closedCases}</span>
                <span>Tiempo medio: {operator.averageResponseMinutes} min</span>
                <span>Plantillas: {operator.templateUses}</span>
                <span>IA: {operator.aiUses}</span>
                <span>Correcciones: {operator.corrections}</span>
              </div>
            </article>
          ))}
        </div>
        <PanelTitle icon={<Bot size={17} />} title="AmazonSupportBot preparado" />
        <div className="amazon-bot-list">
          {capabilities.map((capability) => (
            <div className="amazon-bot-row" key={capability.question}>
              <strong>{capability.question}</strong>
              <span>{capability.dataSource}</span>
              <code>{capability.endpoint}</code>
            </div>
          ))}
        </div>
      </section>
      <aside className="amazon-management-side">
        <PanelTitle icon={<Mail size={17} />} title="Gmail readonly" />
        <div className="amazon-action-row">
          <button
            disabled={manualSyncRunning || gmailSyncStatus?.status === "EN_CURSO"}
            onClick={onManualSync}
            type="button"
          >
            <RefreshCw size={15} />
            {manualSyncRunning || gmailSyncStatus?.status === "EN_CURSO"
              ? "Sincronizando"
              : "Sincronizar ahora"}
          </button>
        </div>
        <InfoLine
          label="Cuenta"
          value={gmailSyncStatus?.account ?? "Login requerido / no conectado"}
        />
        <InfoLine
          label="Etiqueta"
          value={gmailSyncStatus?.labelName ?? "AmazonSeller"}
        />
        <InfoLine
          label="Importados"
          value={(gmailSyncStatus?.importedCount ?? 0).toString()}
        />
        <InfoLine
          label="Actualizados"
          value={(gmailSyncStatus?.updatedCount ?? 0).toString()}
        />
        <InfoLine
          label="Duplicados"
          value={(gmailSyncStatus?.duplicateCount ?? 0).toString()}
        />
        <InfoLine
          label="Errores"
          value={(gmailSyncStatus?.errorCount ?? 0).toString()}
        />
        <InfoLine
          label="Pendientes"
          value={(gmailSyncStatus?.pendingCount ?? 0).toString()}
        />
        <InfoLine
          label="Proceso medio"
          value={`${gmailSyncStatus?.averageProcessMs ?? 0} ms`}
        />
        <InfoLine label="Estado" value={gmailSyncStatus?.status ?? "SIN DATOS"} />
        <InfoLine
          label="Auto-sync"
          value={
            gmailSyncStatus?.jobEnabled
              ? `Cada ${gmailSyncStatus.intervalMinutes} min`
              : "Inactivo"
          }
        />
        <InfoLine
          label="Ultimo sync"
          value={
            gmailSyncStatus?.lastFinishedAt
              ? formatDateTime(gmailSyncStatus.lastFinishedAt)
              : "Pendiente"
          }
        />
        <InfoLine
          label="Proximo sync"
          value={
            gmailSyncStatus?.nextSyncAt
              ? formatDateTime(gmailSyncStatus.nextSyncAt)
              : "Pendiente"
          }
        />
        <InfoLine label="Fuente" value="Gmail readonly" />
        <InfoLine label="Modo seguro" value="Sin envio externo" />
        <div className="amazon-context-note">
          <RefreshCw size={16} />
          {gmailSyncMessage}
        </div>
        {gmailSyncStatus?.history?.length ? (
          <div className="amazon-sync-history">
            {gmailSyncStatus.history.slice(0, 5).map((run) => (
              <div key={run.runId}>
                <strong>
                  {run.status} · {run.trigger === "auto" ? "auto" : "manual"}
                </strong>
                <span>
                  {formatDateTime(run.finishedAt ?? run.startedAt)} · leidos{" "}
                  {run.scanned} · importados {run.imported} · actualizados{" "}
                  {run.updated} · duplicados {run.duplicates} · errores{" "}
                  {run.errors}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <PanelTitle icon={<Inbox size={17} />} title="Workflow bandeja" />
        <InfoLine label="Nuevas" value={workflowStats.new.toString()} />
        <InfoLine label="Abiertas" value={workflowStats.open.toString()} />
        <InfoLine label="Resueltas" value={workflowStats.resolved.toString()} />
        <InfoLine label="Cerradas" value={workflowStats.closed.toString()} />
        <InfoLine label="Asignadas" value={workflowStats.assigned.toString()} />
        {gmailSyncStatus?.lastError && (
          <div className="amazon-send-guard">
            <AlertTriangle size={16} />
            {gmailSyncStatus.lastError}
          </div>
        )}
        <PanelTitle icon={<Brain size={17} />} title="Base de conocimiento" />
        <InfoLine
          label="Ejemplos almacenados"
          value={knowledgeEntries.length.toString()}
        />
        <div className="amazon-sync-history">
          {knowledgeByCategory.slice(0, 5).map((row) => (
            <div key={row.label}>
              <strong>{row.label}</strong>
              <span>{row.value} ejemplos</span>
            </div>
          ))}
          {knowledgeByLanguage.slice(0, 5).map((row) => (
            <div key={`lang-${row.label}`}>
              <strong>Idioma {row.label}</strong>
              <span>{row.value} ejemplos</span>
            </div>
          ))}
        </div>
        <PanelTitle icon={<Sparkles size={17} />} title="Borradores inteligentes" />
        <InfoLine label="Generados" value={smartDraftStats.generated.toString()} />
        <InfoLine label="Confianza media" value={`${smartDraftStats.averageConfidence}%`} />
        <InfoLine label="Con warnings" value={smartDraftStats.withWarnings.toString()} />
        <InfoLine label="Aprobados manualmente" value={smartDraftStats.approved.toString()} />
        <PanelTitle icon={<BarChart3 size={17} />} title="KPI negocio" />
        <InfoLine label="Tiempo resolucion" value={`${summary.kpis.averageResolutionHours} h`} />
        <InfoLine label="Aceptadas sin cambios" value={summary.kpis.acceptedWithoutChanges.toString()} />
        <InfoLine label="Modificadas" value={summary.kpis.modifiedResponses.toString()} />
        <InfoLine label="Descartadas" value={summary.kpis.discardedResponses.toString()} />
        <InfoLine label="Correcciones humanas" value={summary.kpis.humanCorrections.toString()} />
        <div className="amazon-context-note">
          <ShieldCheck size={16} />
          El agente solo responde con endpoints/datos reales del modulo.
        </div>
      </aside>
    </div>
  );
}

function StatList({ rows, title }: { rows: AmazonStatsSummary["byCategory"]; title: string }) {
  return (
    <div className="amazon-stat-list">
      <strong>{title}</strong>
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  );
}

function AnalysisTables({
  logisticsStats,
  productStats,
  templates,
}: {
  logisticsStats: Array<{
    carrier: string;
    incidents: number;
    delays: number;
    notReceived: number;
    deliveryProblems: number;
    country: string;
  }>;
  productStats: AmazonProductStats[];
  templates: AmazonTemplate[];
}) {
  return (
    <div className="amazon-analysis-grid">
      <div>
        <PanelTitle icon={<Package size={17} />} title="Productos conflictivos" />
        {productStats.map((product) => (
          <div className="amazon-analysis-row" key={product.sku}>
            <strong>{product.sku}</strong>
            <span>
              Incidencias {product.incidents} · devoluciones {product.returns} · A-to-Z{" "}
              {product.aToZ}
            </span>
          </div>
        ))}
      </div>
      <div>
        <PanelTitle icon={<Truck size={17} />} title="Analisis logistico" />
        {logisticsStats.map((logistics) => (
          <div className="amazon-analysis-row" key={`${logistics.carrier}-${logistics.country}`}>
            <strong>{logistics.carrier}</strong>
            <span>
              Incidencias {logistics.incidents} · retrasos {logistics.delays} · no
              recibido {logistics.notReceived} · pais {logistics.country}
            </span>
          </div>
        ))}
      </div>
      <div>
        <PanelTitle icon={<FileText size={17} />} title="Plantillas que funcionan" />
        {templates.slice(0, 5).map((template) => (
          <div className="amazon-analysis-row" key={template.id}>
            <strong>{template.name}</strong>
            <span>
              {template.usageCount} usos · {Math.round(template.acceptanceRate * 100)}%
              aceptacion
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildDisplayedDraft(
  draft: AmazonConversation["draft"],
  override?: string,
): AmazonConversation["draft"] {
  if (!draft) return undefined;
  return {
    ...draft,
    body: override ?? draft.body,
    status: override ? "LISTO_PARA_REVISAR" : draft.status,
  };
}

function readAmazonMessagesStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeAmazonMessagesStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage is a convenience for internal drafts, not a hard dependency.
  }
}

function buildInternalDraft(conversation: AmazonConversation): InternalDraft {
  return {
    id: `internal-draft-${conversation.id}-${Date.now()}`,
    conversationId: conversation.id,
    category: conversation.category,
    confidence: 0.65,
    body: buildInternalDraftBody(conversation),
    status: "BORRADOR_INTERNO",
    generatedAt: new Date().toISOString(),
    consultedKnowledgeIds: [],
    suggestionMode: "approved_template",
    templateName: "Borrador interno seguro",
    humanDiffSummary: "Generado en modo seguro. Sin envio externo.",
  };
}

function buildInternalDraftBody(conversation: AmazonConversation) {
  return [
      "Hola,",
      "",
      "Hemos recibido tu mensaje y estamos revisando el caso.",
      conversation.amazonOrderId
        ? `Pedido Amazon: ${conversation.amazonOrderId}.`
        : "Estamos revisando la informacion del pedido.",
      "",
      "Te responderemos en cuanto el equipo valide la solucion adecuada.",
      "",
      "Un saludo,",
      "TodoElectrico",
    ].join("\n");
}

function adaptBackendDraft(
  record: BackendInternalDraftRecord,
  conversation: AmazonConversation,
): InternalDraft | undefined {
  const draftBody = typeof record.draftBody === "string" ? record.draftBody : "";
  if (!draftBody.trim() || record.status === "SIN_BORRADOR") {
    return undefined;
  }
  return {
    id: record.draftId,
    conversationId: conversation.id,
    category: conversation.category,
    confidence: record.confidence ?? 0.65,
    body: draftBody,
    status: record.status,
    generatedAt: record.generatedAt || record.updatedAt || new Date().toISOString(),
    consultedKnowledgeIds: record.knowledgeExampleIds ?? [],
    detectedLanguage: record.detectedLanguage,
    detectedCategory: record.detectedCategory,
    warnings: record.warnings ?? [],
    suggestionMode:
      record.source === "SMART_DRAFT"
        ? record.templateId
          ? "approved_template"
          : record.knowledgeExampleIds?.length
            ? "approved_examples"
            : "free_generation"
        : "approved_template",
    templateId: record.templateId,
    templateName:
      record.source === "SMART_DRAFT"
        ? record.templateId ?? "Smart draft sin plantilla"
        : "Borrador interno seguro",
    humanDiffSummary: `Persistido en backend. Fuente: ${record.source}. externalSend=${String(
      record.externalSend,
    )}.`,
    reviewStatus: record.reviewStatus,
    reviewNotes: record.reviewNotes,
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt,
    rejectedBy: record.rejectedBy,
    rejectedAt: record.rejectedAt,
    reviewHistory: record.reviewHistory ?? [],
  };
}

function buildInternalDraftAuditEvent(
  conversation: AmazonConversation,
): AmazonAuditEvent {
  return {
    id: `${conversation.id}-internal-draft-${Date.now()}`,
    conversationId: conversation.id,
    eventType: "draft_generated",
    label:
      "Borrador interno generado desde Gmail readonly. Sin envio externo, sin SP-API y sin respuesta al comprador.",
    actor: "Rafa",
    createdAt: new Date().toISOString(),
  };
}

function draftStatusLabel(conversation: AmazonConversation) {
  if (!conversation.draft) return "SIN BORRADOR";
  return draftReviewStatusLabel(conversation.draft.status);
}

function draftStateClass(conversation: AmazonConversation) {
  if (!conversation.draft) return "empty";
  if (conversation.draft.status === "APROBADO_MANUALMENTE") return "approved";
  if (conversation.draft.status === "RECHAZADO") return "rejected";
  if (conversation.draft.status === "NECESITA_CAMBIOS") return "changes";
  if (conversation.draft.status === "LISTO_PARA_REVISAR") return "review";
  return "internal";
}

function draftReviewStatusLabel(status: string) {
  if (status === "SIN_BORRADOR") return "SIN BORRADOR";
  if (status === "BORRADOR_INTERNO" || status === "suggested") return "BORRADOR INTERNO";
  if (status === "LISTO_PARA_REVISAR" || status === "edited") return "LISTO PARA REVISAR";
  if (status === "APROBADO_MANUALMENTE" || status === "accepted") return "APROBADO MANUALMENTE";
  if (status === "RECHAZADO" || status === "rejected") return "RECHAZADO";
  if (status === "NECESITA_CAMBIOS") return "NECESITA CAMBIOS";
  return status;
}

function pendingReplyStatusLabel(status: AmazonPendingReplyStatus) {
  if (status === "SIN_RESPUESTA") return "SIN RESPUESTA";
  if (status === "RESPUESTA_PREPARADA") return "RESPUESTA PREPARADA";
  if (status === "PENDIENTE_VALIDACION") return "PENDIENTE VALIDACION";
  if (status === "APROBADA_PARA_BORRADOR") return "APROBADA PARA BORRADOR";
  if (status === "READY_TO_SEND") return "LISTA PARA ENVIAR";
  if (status === "SEND_IN_PROGRESS") return "ENVIO EN PROGRESO";
  if (status === "SENT_MOCK") return "ENVIADA MOCK";
  if (status === "SENT") return "ENVIADA";
  if (status === "SEND_FAILED") return "ENVIO FALLIDO";
  if (status === "NECESITA_CAMBIOS") return "NECESITA CAMBIOS";
  if (status === "RECHAZADA") return "RECHAZADA";
  if (status === "CANCELADA") return "CANCELADA";
  return status;
}

function finalSendStateOf(conversation: AmazonConversation) {
  const pendingReply = conversation.pendingReply;
  if (!pendingReply) return "blocked";
  if (pendingReply.status === "SEND_IN_PROGRESS") return "sending";
  if (pendingReply.status === "SENT" || pendingReply.status === "SENT_MOCK") return "sent";
  if (pendingReply.status === "SEND_FAILED") return "error";
  if (
    (pendingReply.status === "APROBADA_PARA_BORRADOR" ||
      pendingReply.status === "READY_TO_SEND") &&
    pendingReply.gmailDraftId &&
    pendingReply.gmailDraftRecipient &&
    pendingReply.gmailDraftSubject &&
    pendingReply.gmailDraftBodyHash &&
    conversation.status !== "responded" &&
    workflowStatusOf(conversation) !== "RESUELTO" &&
    workflowStatusOf(conversation) !== "CERRADO"
  ) {
    return "ready";
  }
  return "blocked";
}

function isFinalSendReady(conversation: AmazonConversation, hasPermission: boolean) {
  if (!hasPermission) return false;
  const pendingReply = conversation.pendingReply;
  if (!pendingReply) return false;
  if (
    conversation.status === "responded" ||
    workflowStatusOf(conversation) === "RESUELTO" ||
    workflowStatusOf(conversation) === "CERRADO"
  ) {
    return false;
  }
  if (pendingReply.amazonMessageActionId) return false;
  if (
    pendingReply.status !== "APROBADA_PARA_BORRADOR" &&
    pendingReply.status !== "READY_TO_SEND" &&
    pendingReply.status !== "SEND_FAILED"
  ) {
    return false;
  }
  return Boolean(
    pendingReply.gmailDraftId &&
      pendingReply.gmailDraftRecipient &&
      pendingReply.gmailDraftSubject &&
      pendingReply.gmailDraftBodyHash,
  );
}

function finalSendStateLabel(state: ReturnType<typeof finalSendStateOf>) {
  if (state === "ready") return "Listo para envio final";
  if (state === "sending") return "Enviando";
  if (state === "sent") return "Enviado";
  if (state === "error") return "Error de envio";
  return "No listo";
}

function summarizeReplyBody(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177)}...`;
}

function messageAuthorLabel(message: AmazonSupportMessage) {
  if (message.direction === "inbound") return "Comprador";
  if (message.direction === "outbound") return "Soporte";
  return "Nota interna";
}

function buildConversationContextSummary(
  conversation: AmazonConversation,
  messages: AmazonSupportMessage[],
) {
  const inboundCount = messages.filter((message) => message.direction === "inbound").length;
  const outboundCount = messages.filter((message) => message.direction === "outbound").length;
  const latestMessage = messages[messages.length - 1];
  const latestText = latestMessage?.bodyText.replace(/\s+/g, " ").trim() ?? "";
  const latestSnippet =
    latestText.length > 180 ? `${latestText.slice(0, 177)}...` : latestText;
  return [
    `${inboundCount} mensaje(s) del cliente y ${outboundCount} respuesta(s) registradas.`,
    `Pedido ${conversation.amazonOrderId ?? "sin pedido Amazon"} en ${conversation.marketplace}.`,
    `Categoría ${categoryLabel(conversation.category)} con prioridad ${priorityLabels[conversation.priority]}.`,
    latestSnippet ? `Último contexto: ${latestSnippet}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function translateMessageToSpanish(value: string, language?: string) {
  if (!value.trim()) return "";
  const normalizedAmazonMessage = translateAmazonCustomerServiceWrapper(value);
  const normalizedLanguage = (language ?? "").toLowerCase();
  const translatedMessage = normalizedLanguage.startsWith("fr")
    ? translateFrenchCustomerMessage(normalizedAmazonMessage)
    : normalizedAmazonMessage;
  if (isSpanishLanguage(language) && translatedMessage === value) return value;
  return translateWithDictionary(translatedMessage, translationsToSpanish);
}

function translateDraftFromSpanish(value: string, language?: string) {
  if (!value.trim()) return "";
  if (isSpanishLanguage(language)) return value;
  const normalizedLanguage = (language ?? "").toLowerCase();
  if (normalizedLanguage.startsWith("en")) {
    return translateWithDictionary(value, translationsFromSpanishToEnglish);
  }
  if (normalizedLanguage.startsWith("fr")) {
    return translateWithDictionary(value, translationsFromSpanishToFrench);
  }
  if (normalizedLanguage.startsWith("de")) {
    return translateWithDictionary(value, translationsFromSpanishToGerman);
  }
  if (normalizedLanguage.startsWith("it")) {
    return translateWithDictionary(value, translationsFromSpanishToItalian);
  }
  if (normalizedLanguage.startsWith("pt")) {
    return translateWithDictionary(value, translationsFromSpanishToPortuguese);
  }
  return value;
}

function isSpanishLanguage(language?: string) {
  return !language || language.toLowerCase().startsWith("es");
}

function translateWithDictionary(value: string, dictionary: Record<string, string>) {
  return Object.entries(dictionary).reduce(
    (translated, [source, target]) =>
      translated.replace(new RegExp(`\\b${escapeRegExp(source)}\\b`, "gi"), target),
    value,
  );
}

function translateAmazonCustomerServiceWrapper(value: string) {
  return value
    .replace(/Dear Amazon Seller,?/gi, "Estimado vendedor de Amazon,")
    .replace(
      /This is Amazon['’]s Customer Service team\./gi,
      "Somos el equipo de Atencion al Cliente de Amazon.",
    )
    .replace(
      /A customer reached out to us with some questions about a purchase they made from you\.\s*Here['’]s a description of the issue:/gi,
      "Un cliente nos ha contactado con algunas preguntas sobre una compra realizada. Esta es la descripcion del problema:",
    )
    .replace(/\bProduct:/gi, "Producto:")
    .replace(/\bOrder number:/gi, "Numero de pedido:")
    .replace(/\bReturn requested:\s*No\b/gi, "Devolucion solicitada: No")
    .replace(/\bReturn requested:\s*Yes\b/gi, "Devolucion solicitada: Si")
    .replace(/\bReason for contact:/gi, "Motivo de contacto:")
    .replace(
      /Please respond to this request within 48 hours\./gi,
      "Por favor, responde a esta solicitud en un plazo de 48 horas.",
    )
    .replace(/\bThanks,\s*/gi, "Gracias,\n")
    .replace(/\bAmazon Customer Service\b/gi, "Atencion al Cliente de Amazon");
}

function translateFrenchCustomerMessage(value: string) {
  return value
    .replace(/\bBonjour,?/gi, "Hola,")
    .replace(/\bD['’]accord\b/gi, "De acuerdo")
    .replace(/\bmerci beaucoup\b/gi, "muchas gracias")
    .replace(/\bmerci\b/gi, "gracias")
    .replace(/\bje souhaiterais\b/gi, "quisiera")
    .replace(/\bun remboursement\b/gi, "un reembolso")
    .replace(/\bsi le colis arrive\b/gi, "si el paquete llega")
    .replace(/\bje le refuserais\b/gi, "lo rechazare")
    .replace(/\ble colis\b/gi, "el paquete")
    .replace(/\bcolis\b/gi, "paquete")
    .replace(/\bremboursement\b/gi, "reembolso")
    .replace(/\barrive\b/gi, "llega");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const translationsToSpanish: Record<string, string> = {
  hello: "hola",
  hi: "hola",
  order: "pedido",
  package: "paquete",
  tracking: "seguimiento",
  invoice: "factura",
  refund: "reembolso",
  return: "devolución",
  warranty: "garantía",
  broken: "roto",
  damaged: "dañado",
  delayed: "retrasado",
  delay: "retraso",
  received: "recibido",
  missing: "faltante",
  wrong: "incorrecto",
  product: "producto",
  please: "por favor",
  thanks: "gracias",
  thank: "gracias",
  delivery: "entrega",
  address: "dirección",
  customer: "cliente",
  message: "mensaje",
};

const translationsFromSpanishToEnglish: Record<string, string> = {
  hola: "hello",
  pedido: "order",
  paquete: "package",
  seguimiento: "tracking",
  factura: "invoice",
  reembolso: "refund",
  devolución: "return",
  garantía: "warranty",
  roto: "broken",
  dañado: "damaged",
  retrasado: "delayed",
  retraso: "delay",
  recibido: "received",
  faltante: "missing",
  incorrecto: "wrong",
  producto: "product",
  "por favor": "please",
  gracias: "thanks",
  entrega: "delivery",
  dirección: "address",
  cliente: "customer",
  mensaje: "message",
};

const translationsFromSpanishToFrench: Record<string, string> = {
  hola: "bonjour",
  pedido: "commande",
  paquete: "colis",
  seguimiento: "suivi",
  factura: "facture",
  reembolso: "remboursement",
  devolución: "retour",
  garantía: "garantie",
  producto: "produit",
  gracias: "merci",
  entrega: "livraison",
  dirección: "adresse",
  cliente: "client",
  mensaje: "message",
};

const translationsFromSpanishToGerman: Record<string, string> = {
  hola: "hallo",
  pedido: "Bestellung",
  paquete: "Paket",
  seguimiento: "Sendungsverfolgung",
  factura: "Rechnung",
  reembolso: "Rückerstattung",
  devolución: "Rückgabe",
  garantía: "Garantie",
  producto: "Produkt",
  gracias: "danke",
  entrega: "Lieferung",
  dirección: "Adresse",
  cliente: "Kunde",
  mensaje: "Nachricht",
};

const translationsFromSpanishToItalian: Record<string, string> = {
  hola: "ciao",
  pedido: "ordine",
  paquete: "pacco",
  seguimiento: "tracciamento",
  factura: "fattura",
  reembolso: "rimborso",
  devolución: "reso",
  garantía: "garanzia",
  producto: "prodotto",
  gracias: "grazie",
  entrega: "consegna",
  dirección: "indirizzo",
  cliente: "cliente",
  mensaje: "messaggio",
};

const translationsFromSpanishToPortuguese: Record<string, string> = {
  hola: "olá",
  pedido: "pedido",
  paquete: "pacote",
  seguimiento: "rastreamento",
  factura: "fatura",
  reembolso: "reembolso",
  devolución: "devolução",
  garantía: "garantia",
  producto: "produto",
  gracias: "obrigado",
  entrega: "entrega",
  dirección: "endereço",
  cliente: "cliente",
  mensaje: "mensagem",
};

function pendingReplyChannelLabel(channel: AmazonPendingReply["channel"]) {
  if (channel === "INTERNAL_REPLY_PENDING") {
    return "Preparacion interna para respuesta";
  }
  return "Pendiente interno";
}

function adaptBackendConversation(
  detail: BackendConversationDetail,
): AmazonConversation {
  const record = detail.conversation;
  const messages = detail.messages ?? [];
  const firstMessage = messages[0];
  const classification = detail.classifications?.[0];
  const category = normalizeCategory(classification?.category ?? record.category);
  const priority = normalizePriority(classification?.priority ?? record.priority);
  const operationalQueue = queueForCategory(category, priority);
  const metadata = firstMessage?.amazonMetadata ?? {};
  const notificationType = normalizeNotificationType(
    typeof metadata.notificationType === "string"
      ? metadata.notificationType
      : undefined,
  );
  const supportMessages = messages.length
    ? messages.map((message) =>
        adaptBackendMessage(
          message,
          detail.attachments?.filter(
            (attachment) => attachment.messageId === message.messageId,
          ) ?? [],
        ),
      )
    : [buildPlaceholderMessage(record)];
  const subject =
    extractSubject(firstMessage?.content) ??
    (record.amazonOrderId
      ? `Mensaje Amazon pedido ${record.amazonOrderId}`
      : "Conversacion Amazon importada");
  const buyerAlias =
    typeof metadata.buyerAlias === "string" ? metadata.buyerAlias : "";

  return {
    id: record.conversationId,
    marketplace: record.marketplace,
    amazonOrderId: record.amazonOrderId,
    odooOrderId: record.odooOrderId,
    customerDisplayName: displayNameFromSender(firstMessage?.sender),
    buyerAliasHash: buyerAlias ? `buyer-${hashString(buyerAlias)}` : "buyer-real-api",
    subject,
    status: normalizeStatus(record.status),
    workflowStatus: normalizeWorkflowStatus(record.workflowStatus, record.status),
    category,
    notificationType,
    operationalQueue,
    recommendedAction: recommendedActionForCategory(category),
    extracted: {
      language: record.language ?? firstMessage?.language,
      asin: extractAsin(firstMessage?.content),
      quantity: extractQuantity(firstMessage?.content),
      isInternationalReturnAddressRisk: false,
    },
    priority,
    assignedUser: record.assignedUser ?? "Sin asignar",
    assignedAt: record.assignedAt,
    closedAt: record.closedAt,
    lastActivityAt: record.lastActivityAt ?? record.updatedAt ?? record.lastMessageAt,
    workflowHistory: record.workflowHistory ?? [],
    timeSpentMinutes: record.responseMinutes ?? 0,
    unreadCount: record.status === "resolved" ? 0 : 1,
    lastMessageAt: record.lastMessageAt,
    matchConfidence: record.odooOrderId ? "strong" : "unmatched",
    messages: supportMessages,
    draft: undefined,
    pendingReply: detail.pendingReplies?.[0]
      ? adaptBackendPendingReply(detail.pendingReplies[0])
      : undefined,
    audit: (detail.auditLogs ?? []).map(adaptBackendAuditLog),
    context: detail.context ?? {},
  };
}

function isRealBackendConversation(record: BackendConversationRecord) {
  return !record.conversationId.startsWith("amz-backend-conv-");
}

function moduleDescription(source: ConversationSourceMode) {
  if (source === "real") {
    return "Bandeja conectada al backend/API con mensajes Gmail importados. Sin SP-API real y sin envio.";
  }
  return "Fixtures sanitizados como fallback seguro. Sin mailbox real, sin SP-API real y sin envio.";
}

function adaptBackendMessage(
  message: BackendMessageRecord,
  attachments: BackendAttachmentRecord[],
): AmazonSupportMessage {
  const attachmentMetadata = attachments.map(adaptBackendAttachment);
  return {
    id: message.messageId,
    conversationId: message.conversationId,
    direction: message.direction,
    source: "amazon_email_relay",
    externalMessageId: message.gmailMessageId ?? message.messageId,
    subject: extractSubject(message.content) ?? "Mensaje Amazon",
    bodyText: extractReadableEmailBody(message.content),
    fromLabel: displayNameFromSender(message.sender),
    toLabel: "Amazon Messages",
    receivedAt: message.createdAt,
    attachmentNames: attachmentMetadata.map((attachment) => attachment.sanitizedName),
    attachments: attachmentMetadata,
  };
}

function buildPlaceholderMessage(
  record: BackendConversationRecord,
): AmazonSupportMessage {
  return {
    id: `${record.conversationId}-placeholder`,
    conversationId: record.conversationId,
    direction: "internal",
    source: "system",
    externalMessageId: record.conversationId,
    subject: "Conversacion Amazon importada",
    bodyText: "Conversacion importada desde backend/API. Sin detalle de mensaje disponible.",
    fromLabel: "Sistema",
    toLabel: "Amazon Messages",
    receivedAt: record.lastMessageAt,
    attachmentNames: [],
    attachments: [],
  };
}

function adaptBackendAttachment(
  attachment: BackendAttachmentRecord,
): AmazonAttachmentMetadata {
  const extension = extensionFromName(attachment.sanitizedName);
  const kind = attachmentKind(attachment.mimeType);
  const allowed = attachment.storageStatus !== "blocked";
  return {
    id: attachment.attachmentId,
    conversationId: attachment.conversationId,
    messageId: attachment.messageId,
    originalName: attachment.originalName,
    sanitizedName: attachment.sanitizedName,
    mimeType: attachment.mimeType,
    extension,
    sizeBytes: attachment.sizeBytes,
    hash: attachment.hash,
    receivedAt: attachment.createdAt,
    origin: "amazon_email_relay",
    downloadable: allowed,
    previewable: allowed && (kind === "image" || kind === "pdf"),
    isImage: kind === "image",
    isPdf: kind === "pdf",
    kind,
    allowed,
    blockedReason: allowed ? undefined : "Adjunto bloqueado por backend",
    visualAnalysisReady: false,
    visualAnalysisHints: [],
  };
}

function adaptBackendPendingReply(
  record: BackendPendingReplyRecord,
): AmazonPendingReply | undefined {
  if (record.status === "SIN_RESPUESTA" && !record.replyBody.trim()) {
    return undefined;
  }
  return {
    id: record.pendingReplyId,
    conversationId: record.conversationId,
    draftId: record.draftId,
    replyBody: record.replyBody,
    status: record.status as AmazonPendingReplyStatus,
    validationNotes: record.validationNotes,
    preparedBy: record.preparedBy,
    preparedAt: record.preparedAt,
    updatedBy: record.updatedBy,
    updatedAt: record.updatedAt,
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt,
    rejectedBy: record.rejectedBy,
    rejectedAt: record.rejectedAt,
    source: record.source,
    channel: record.channel,
    externalSend: record.externalSend,
    gmailDraftId: record.gmailDraftId,
    gmailDraftRecipient: record.gmailDraftRecipient,
    gmailDraftSubject: record.gmailDraftSubject,
    gmailDraftBodyHash: record.gmailDraftBodyHash,
    gmailDraftCreatedBy: record.gmailDraftCreatedBy,
    gmailDraftCreatedAt: record.gmailDraftCreatedAt,
    gmailDraftUpdatedBy: record.gmailDraftUpdatedBy,
    gmailDraftUpdatedAt: record.gmailDraftUpdatedAt,
    amazonMessageActionId: record.amazonMessageActionId,
    history: record.history.map((event) => ({
      eventId: event.eventId,
      actorName: event.actorName,
      actorRole: event.actorRole,
      previousStatus: event.previousStatus as AmazonPendingReplyStatus,
      newStatus: event.newStatus as AmazonPendingReplyStatus,
      note: event.note,
      createdAt: event.createdAt,
    })),
  };
}

function adaptBackendAuditLog(log: BackendAuditLogRecord): AmazonAuditEvent {
  return {
    id: log.auditId,
    conversationId: log.conversationId ?? "amazon-messages",
    eventType: log.eventType.includes("workflow")
      ? "conversation_workflow_changed"
      : log.eventType.includes("assigned")
        ? "conversation_assigned"
        : log.eventType.includes("classified")
          ? "classified"
          : log.eventType.includes("pending_reply")
            ? "response_approved"
          : "imported",
    label: log.detail,
    actor: log.actorRole,
    createdAt: log.createdAt,
  };
}

function adaptBackendTemplate(record: BackendTemplateRecord): AmazonTemplate {
  return {
    id: record.templateId,
    name: record.name ?? `Plantilla ${record.category}`,
    category: normalizeCategory(record.category),
    marketplace: record.marketplace,
    language: record.language,
    status: record.archived ? "archived" : record.active ? "active" : "inactive",
    body: record.content,
    variables: record.variables ?? [],
    usageCount: 0,
    acceptanceRate: 1,
    createdBy: record.createdBy ?? "Juanito",
    updatedAt: record.updatedAt,
  };
}

function adaptBackendKnowledgeExample(
  record: BackendKnowledgeExampleRecord,
): AmazonKnowledgeEntry {
  return {
    id: record.exampleId,
    conversationId: record.conversationId,
    category: normalizeCategory(record.category),
    marketplace: record.marketplace,
    language: record.language,
    date: record.createdAt,
    originalCustomerMessage: record.originalMessage,
    classification: record.category,
    templateId: record.templateId,
    templateName: record.templateName,
    initialDraft: record.initialDraft ?? record.aiDraft,
    aiDraft: record.aiDraft,
    finalResponse: record.finalResponse,
    approver: record.approver,
    quality: normalizeQuality(record.quality),
    confidence: record.confidence ?? 0.8,
    tags: record.tags ?? [],
    sku: record.sku,
    amazonOrderId: record.amazonOrderId,
    status:
      record.status === "approved"
        ? "active"
        : record.status === "archived"
          ? "archived"
          : "ignored",
    useAsApprovedExample: record.status === "approved",
    anonymized: false,
    approvedAt: record.approvedAt ?? record.createdAt,
    draftDiff: record.draftDiff ?? record.humanDiffSummary,
    humanDiffSummary: record.humanDiffSummary,
  };
}

function adaptUiMessageForDetail(message: AmazonSupportMessage): BackendMessageRecord {
  return {
    messageId: message.id,
    conversationId: message.conversationId,
    gmailMessageId: message.externalMessageId,
    sender: message.fromLabel,
    direction: message.direction,
    content: message.bodyText,
    createdAt: message.receivedAt,
    amazonMetadata: {},
  };
}

function adaptUiAuditForDetail(event: AmazonAuditEvent): BackendAuditLogRecord {
  return {
    auditId: event.id,
    conversationId: event.conversationId,
    eventType: event.eventType,
    detail: event.label,
    actorRole: event.actor,
    createdAt: event.createdAt,
  };
}

function mergeAuditEvents(
  current: AmazonAuditEvent[],
  next: AmazonAuditEvent[],
) {
  const seen = new Set<string>();
  return [...current, ...next].filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function normalizeStatus(value: string): AmazonConversationStatus {
  if (value === "new" || value === "open" || value === "pending_customer") {
    return value;
  }
  if (value === "pending_internal" || value === "resolved" || value === "closed") {
    return value;
  }
  return "open";
}

function normalizeWorkflowStatus(
  value: AmazonWorkflowStatus | undefined,
  legacyStatus?: string,
): AmazonWorkflowStatus {
  if (
    value === "NUEVO" ||
    value === "PENDIENTE_REVISAR" ||
    value === "EN_REVISION" ||
    value === "LISTO_PARA_RESPONDER" ||
    value === "RESUELTO" ||
    value === "CERRADO"
  ) {
    return value;
  }
  if (
    legacyStatus === "resolved" ||
    legacyStatus === "responded" ||
    legacyStatus === "responded_mock"
  ) {
    return "RESUELTO";
  }
  if (legacyStatus === "closed") return "CERRADO";
  if (legacyStatus === "pending_internal") return "PENDIENTE_REVISAR";
  if (legacyStatus === "open") return "PENDIENTE_REVISAR";
  return "NUEVO";
}

function workflowStatusOf(conversation: AmazonConversation): AmazonWorkflowStatus {
  return normalizeWorkflowStatus(conversation.workflowStatus, conversation.status);
}

function buildWorkflowStats(conversations: AmazonConversation[]) {
  return {
    new: conversations.filter((conversation) => workflowStatusOf(conversation) === "NUEVO").length,
    open: conversations.filter((conversation) => {
      const status = workflowStatusOf(conversation);
      return status !== "RESUELTO" && status !== "CERRADO";
    }).length,
    resolved: conversations.filter((conversation) => workflowStatusOf(conversation) === "RESUELTO").length,
    closed: conversations.filter((conversation) => workflowStatusOf(conversation) === "CERRADO").length,
    assigned: conversations.filter(
      (conversation) =>
        conversation.assignedUser && conversation.assignedUser !== "Sin asignar",
    ).length,
  };
}

function buildSmartDraftStats(conversations: AmazonConversation[]) {
  const smartDrafts = conversations
    .map((conversation) => conversation.draft)
    .filter((draft): draft is InternalDraft => Boolean(draft?.detectedCategory));
  const confidenceTotal = smartDrafts.reduce(
    (total, draft) => total + draft.confidence,
    0,
  );
  return {
    generated: smartDrafts.length,
    averageConfidence: smartDrafts.length
      ? Math.round((confidenceTotal / smartDrafts.length) * 100)
      : 0,
    withWarnings: smartDrafts.filter((draft) => (draft.warnings?.length ?? 0) > 0).length,
    approved: smartDrafts.filter(
      (draft) => draft.status === "APROBADO_MANUALMENTE",
    ).length,
  };
}

const knowledgeCategories = [
  "seguimiento",
  "devolucion",
  "garantia",
  "factura",
  "consulta tecnica",
  "cancelacion",
  "producto incorrecto",
  "producto defectuoso",
  "general",
];

function categoryForKnowledge(category?: string) {
  const aliases: Record<string, string> = {
    tracking: "seguimiento",
    delay: "seguimiento",
    not_received: "seguimiento",
    logistics_incident: "seguimiento",
    return: "devolucion",
    refund: "devolucion",
    warranty: "garantia",
    invoice: "factura",
    technical: "consulta tecnica",
    cancellation: "cancelacion",
    wrong_product: "producto incorrecto",
    defect: "producto defectuoso",
    other: "general",
  };
  return aliases[category ?? ""] ?? category ?? "general";
}

function categoryLabel(category: AmazonMessageCategory | string) {
  return categoryLabels[normalizeCategory(category) as AmazonMessageCategory] ?? category;
}

function countKnowledgeBy(
  entries: AmazonKnowledgeEntry[],
  keyForEntry: (entry: AmazonKnowledgeEntry) => string,
) {
  const grouped = new Map<string, number>();
  for (const entry of entries) {
    const key = keyForEntry(entry) || "Sin dato";
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return Array.from(grouped.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

function normalizePriority(value: string): AmazonConversationPriority {
  if (value === "urgent" || value === "high" || value === "normal" || value === "low") {
    return value;
  }
  return "normal";
}

function normalizeCategory(value?: string): AmazonMessageCategory {
  if (
    value === "seguimiento" ||
    value === "devolucion" ||
    value === "garantia" ||
    value === "factura" ||
    value === "consulta tecnica" ||
    value === "cancelacion" ||
    value === "producto incorrecto" ||
    value === "producto defectuoso" ||
    value === "general" ||
    value === "tracking" ||
    value === "delay" ||
    value === "not_received" ||
    value === "invoice" ||
    value === "warranty" ||
    value === "defect" ||
    value === "wrong_product" ||
    value === "return" ||
    value === "refund" ||
    value === "cancellation" ||
    value === "a_to_z" ||
    value === "technical" ||
    value === "logistics_incident" ||
    value === "other"
  ) {
    return value;
  }
  return "other";
}

function normalizeQuality(value?: string): AmazonQualityScore {
  if (value === "alta" || value === "high") return "high";
  if (value === "media" || value === "medium") return "medium";
  if (value === "baja" || value === "low") return "low";
  return "unknown";
}

function normalizeNotificationType(value?: string): AmazonNotificationType {
  if (
    value === "BBC_MESSAGE_SENT_TO_MERCHANT" ||
    value === "BRC_SELLER_NOTIFICATION" ||
    value === "RETURN_REQUEST" ||
    value === "A_Z_CLAIM_RESPONDENT_CLOSE"
  ) {
    return value;
  }
  return "UNKNOWN";
}

function queueForCategory(
  category: AmazonMessageCategory,
  priority: AmazonConversationPriority,
): AmazonOperationalQueue {
  if (priority === "urgent" || category === "a_to_z") return "critical";
  if (category === "invoice" || category === "factura") return "invoices";
  if (category === "cancellation" || category === "cancelacion") return "cancellations";
  if (category === "return" || category === "refund" || category === "devolucion") return "returns";
  if (
    category === "seguimiento" ||
    category === "tracking" ||
    category === "delay" ||
    category === "not_received" ||
    category === "logistics_incident"
  ) {
    return "logistics";
  }
  if (category === "other" || category === "general") return "unclassified";
  return "conversations";
}

function recommendedActionForCategory(category: AmazonMessageCategory) {
  if (category === "invoice" || category === "factura") return "Revisar factura y preparar respuesta validada.";
  if (category === "cancellation" || category === "cancelacion") return "Revisar estado del pedido antes de aceptar o rechazar.";
  if (category === "return" || category === "refund" || category === "devolucion") {
    return "Revisar motivo de devolucion, SKU y politica aplicable.";
  }
  if (
    category === "seguimiento" ||
    category === "tracking" ||
    category === "delay" ||
    category === "not_received" ||
    category === "logistics_incident"
  ) {
    return "Revisar tracking y contexto logistico antes de redactar respuesta.";
  }
  return "Revisar mensaje importado y clasificar manualmente si procede.";
}

function extractReadableEmailBody(content = "") {
  const decodedContent = decodeQuotedPrintableEmail(content);
  const messageMatch = decodedContent.match(
    /-{5,}\s*Message:\s*-{5,}\s*([\s\S]*?)(?:-{5,}\s*Finalizar mensaje|-{5,}\s*End message|$)/i,
  );
  if (messageMatch?.[1]) return cleanEmailText(messageMatch[1]);
  const textPart = decodedContent.split(/Content-Type:\s*text\/html/i)[0] ?? decodedContent;
  return cleanEmailText(textPart).slice(0, 1200);
}

function decodeQuotedPrintableEmail(content: string) {
  const normalized = content.replace(/=\r?\n/g, "");
  try {
    return decodeURIComponent(
      normalized.replace(/=([A-Fa-f0-9]{2})/g, "%$1"),
    );
  } catch {
    return normalized.replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  }
}

function cleanEmailText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/=\r?\n/g, "")
    .replace(/^------=.*$/gm, "")
    .replace(/^Content-.*$/gm, "")
    .replace(/^Ha recibido un mensaje\.\s*$/gim, "")
    .replace(/^You received a message\.\s*$/gim, "")
    .replace(/^#\s*\d{3}-\d{7}-\d{7}:.*$/gm, "")
    .replace(/^-{3,}\s*(?:Finalizar mensaje|End message).*$/gim, "")
    .replace(/^\s*\d+\s*$/gm, "")
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSubject(content = "") {
  return content.match(/^Subject:\s*(.+)$/im)?.[1]?.trim();
}

function extractAsin(content = "") {
  return content.match(/\[ASIN:\s*([A-Z0-9]+)\]/i)?.[1];
}

function extractQuantity(content = "") {
  const value = content.match(/#\s*\d{3}-\d{7}-\d{7}:\s*\n\s*(\d+)\s*\//)?.[1];
  return value ? Number(value) : undefined;
}

function displayNameFromSender(sender = "Cliente Amazon") {
  const name = sender.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim();
  return name || sender || "Cliente Amazon";
}

function extensionFromName(name: string) {
  return name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
}

function attachmentKind(mimeType: string): AmazonAttachmentMetadata["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/")) return "text";
  return "other";
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="amazon-metric">
      {icon}
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h4 className="amazon-panel-title">
      {icon}
      {title}
    </h4>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="amazon-info-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return <p className="amazon-empty-panel">{text}</p>;
}

function AttachmentList({
  attachments,
  onDownload,
  onPreview,
  onRemove,
}: {
  attachments: AmazonAttachmentMetadata[];
  onDownload: (attachment: AmazonAttachmentMetadata) => void;
  onPreview: (attachment: AmazonAttachmentMetadata) => void;
  onRemove?: (attachment: AmazonAttachmentMetadata) => void;
}) {
  return (
    <div className="amazon-attachment-list">
      {attachments.map((attachment) => (
        <div className="amazon-attachment-card" key={attachment.id}>
          <div className={`amazon-attachment-thumb ${attachment.kind}`}>
            {attachment.isImage ? <ImageIcon size={20} /> : <FileText size={20} />}
          </div>
          <div className="amazon-attachment-main">
            <strong>{attachment.sanitizedName}</strong>
            <span>
              {formatFileSize(attachment.sizeBytes)} · {attachment.mimeType} ·{" "}
              {formatDateTime(attachment.receivedAt)}
            </span>
            {!attachment.allowed && (
              <small>{attachment.blockedReason ?? "Adjunto bloqueado"}</small>
            )}
          </div>
          <div className="amazon-attachment-actions">
            {attachment.previewable && (
              <button onClick={() => onPreview(attachment)} type="button">
                Ver
              </button>
            )}
            {attachment.downloadable && (
              <button onClick={() => onDownload(attachment)} type="button">
                <Download size={14} />
              </button>
            )}
            {onRemove && (
              <button onClick={() => onRemove(attachment)} type="button">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function AttachmentPreview({
  attachment,
  onClose,
}: {
  attachment: AmazonAttachmentMetadata;
  onClose: () => void;
}) {
  return (
    <div className="amazon-attachment-preview">
      <div className="amazon-attachment-preview-header">
        <strong>{attachment.sanitizedName}</strong>
        <button onClick={onClose} type="button">
          <X size={16} />
        </button>
      </div>
      <div className="amazon-attachment-preview-body">
        {attachment.isImage ? (
          <div className="amazon-image-placeholder">
            <ImageIcon size={38} />
            Miniatura demo sin archivo real almacenado
          </div>
        ) : attachment.isPdf ? (
          <div className="amazon-pdf-placeholder">
            <FileText size={38} />
            Visor PDF preparado sin documento real conectado
          </div>
        ) : (
          <div className="amazon-file-placeholder">
            <FileText size={38} />
            Vista previa no disponible para este formato
          </div>
        )}
      </div>
    </div>
  );
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: AmazonConversationPriority | "neutral";
}) {
  return <span className={`amazon-tag ${tone}`}>{children}</span>;
}

function suggestionModeLabel(value?: NonNullable<AmazonConversation["draft"]>["suggestionMode"]) {
  if (value === "approved_template") return "Plantilla aprobada";
  if (value === "approved_examples") return "Ejemplos aprobados";
  if (value === "free_generation") return "Generacion libre";
  return "Sin sugerencia";
}

function matchesFilter(
  conversation: AmazonConversation,
  filter: AmazonInboxFilter,
) {
  const workflowStatus = workflowStatusOf(conversation);
  if (filter === "all") return true;
  if (filter === "workflow_new") return workflowStatus === "NUEVO";
  if (filter === "workflow_pending") return workflowStatus === "PENDIENTE_REVISAR";
  if (filter === "workflow_review") return workflowStatus === "EN_REVISION";
  if (filter === "workflow_ready") return workflowStatus === "LISTO_PARA_RESPONDER";
  if (filter === "workflow_resolved") return workflowStatus === "RESUELTO";
  if (filter === "workflow_closed") return workflowStatus === "CERRADO";
  return true;
}

function filterCount(
  filter: AmazonInboxFilter,
  conversations: AmazonConversation[],
) {
  return conversations.filter((conversation) => matchesFilter(conversation, filter)).length;
}

function formatRelative(value: string) {
  const minutes = Math.max(
    1,
    Math.round((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatFileSize(value?: number) {
  if (!value) return "tamano desconocido";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
