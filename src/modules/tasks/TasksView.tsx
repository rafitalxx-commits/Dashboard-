import { useMemo, useState, useRef, useEffect } from "react";
import { TasksKanbanBoard, type TaskRecord } from "./TasksKanbanBoard";
import { TasksCalendarView, type CalendarEvent } from "./TasksCalendarView";

type DashboardTaskCategory = string;
type DashboardTaskPriority = string;
type DashboardTaskStatus = string;
type DashboardTask = {
  id: string;
  title: string;
  detail?: string;
  category?: DashboardTaskCategory;
  priority?: DashboardTaskPriority;
  status?: DashboardTaskStatus;
  dueDate: string;
  reminderAt?: string;
  createdAt: string;
  updatedAt: string;
  assignee?: string;
  tags?: string[];
  attachments?: string[];
};

/* ---------- props públicas ---------- */
export type TasksViewProps = {
  tasks: DashboardTask[];
  taskSection: "Tareas" | "Calendario";
  onChangeTaskSection: (value: "Tareas" | "Calendario") => void;
  onAddTask: (task: DashboardTask) => void;
  onUpdateTask: (id: string, patch: Partial<DashboardTask>) => void;
  onDeleteTask: (id: string) => void;
  onAddCalendarEvent: (event: {
    date: string;
    title: string;
    startsAt: string;
    endsAt: string;
    location?: string;
  }) => void;
  calendarEvents: CalendarEvent[];
};

/* ---------- datos estructurados ---------- */
type MailAccount = {
  id: string;
  name: string;
  email: string;
  unread: number;
  messages: MailMessage[];
};
type MailMessage = {
  from: string;
  subject: string;
  date: string;
  snippet: string;
  read: boolean;
  body?: string;
  threadId?: string;
};

type GoogleAccountStatus = {
  accountKey: "personal" | "work";
  label: string;
  email: string;
  status: "connected" | "disconnected" | "auth_error" | "token_expired" | "config_missing";
  connected: boolean;
  connectedAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  scopes?: string[];
  missing?: {
    clientId?: boolean;
    clientSecret?: boolean;
    encryptionKey?: boolean;
  };
};

type ChatMessage = {
  id: string;
  from: "user" | "hermes";
  text: string;
  at: string;
};

type Reminder = {
  id: string;
  title: string;
  dueAt: string;
  postponed: number;
};

const DEFAULT_ACCOUNTS: MailAccount[] = [
  {
    id: "personal",
    name: "Personal",
    email: "rafitalxx@gmail.com",
    unread: 0,
    messages: [],
  },
  {
    id: "work",
    name: "Trabajo",
    email: "todoelectrico.es@gmail.com",
    unread: 0,
    messages: [],
  },
];

const DEFAULT_GOOGLE_ACCOUNTS: GoogleAccountStatus[] = [
  {
    accountKey: "personal",
    label: "Personal",
    email: "rafitalxx@gmail.com",
    status: "disconnected",
    connected: false,
  },
  {
    accountKey: "work",
    label: "Trabajo",
    email: "todoelectrico.es@gmail.com",
    status: "disconnected",
    connected: false,
  },
];

const COMPANY_PEOPLE = [
  "Rafa",
  "Juanito",
  "Hermes",
  "Almacen",
  "Administracion",
  "Compras",
];

function hermesApi(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (window.location.pathname.startsWith("/hermes-updated")) {
    return `/hermes-updated/api${normalized.replace(/^\/api/, "")}`;
  }
  return `/api${normalized.replace(/^\/api/, "")}`;
}

async function fetchHermes(path: string, init?: RequestInit) {
  const primary = await fetch(hermesApi(path), init);
  const contentType = primary.headers.get("content-type") ?? "";
  if (
    primary.ok &&
    (contentType.includes("application/json") || !window.location.pathname.startsWith("/hermes-updated"))
  ) {
    return primary;
  }
  if (primary.status !== 404 && contentType.includes("application/json")) {
    return primary;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return fetch(`http://127.0.0.1:5174/api${normalized.replace(/^\/api/, "")}`, init);
}

/* ---------- filtros ---------- */
const filters = [
  { key: "todos", label: "Todos" },
  { key: "hoy", label: "Hoy" },
  { key: "manana", label: "Mañana" },
  { key: "semana", label: "Semana" },
  { key: "vencidas", label: "Vencidas" },
  { key: "urgentes", label: "Urgentes" },
  { key: "sin_asignar", label: "Sin asignar" },
  { key: "completadas", label: "Completadas" },
] as const;

type Filter = (typeof filters)[number]["key"];

/* ---------- helpers ---------- */
function isToday(date?: string) {
  if (!date) return false;
  return date === new Date().toISOString().slice(0, 10);
}

function isOverdue(date?: string) {
  if (!date) return false;
  return date < new Date().toISOString().slice(0, 10);
}

function isUrgent(priority?: DashboardTaskPriority) {
  return priority === "Alta" || priority === "Crítica";
}

function isCompleted(status?: DashboardTaskStatus) {
  return (
    status === "Hecha" ||
    status === "Listo para responder" ||
    status === "Completada"
  );
}

function timeFromDateTime(value?: string) {
  if (!value) return "";
  return value.slice(11, 16);
}

function buildDateTime(date?: string, time?: string) {
  if (!date || !time) return "";
  return `${date}T${time}`;
}

function matchesFilter(task: DashboardTask, filter: Filter) {
  switch (filter) {
    case "todos":
      return true;
    case "hoy":
      return isToday(task.dueDate);
    case "manana":
      return task.dueDate === shiftDay(1);
    case "semana": {
      const today = new Date().toISOString().slice(0, 10);
      const end = shiftDay(7);
      return task.dueDate >= today && task.dueDate <= end;
    }
    case "vencidas":
      return isOverdue(task.dueDate);
    case "urgentes":
      return isUrgent(task.priority);
    case "sin_asignar":
      return !task.assignee;
    case "completadas":
      return isCompleted(task.status);
    default:
      return true;
  }
}

function shiftDay(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function mapTask(t: DashboardTask): TaskRecord {
  return {
    id: t.id,
    title: t.title,
    detail: t.detail ?? "",
    category: t.category ?? "Operaciones",
    priority: t.priority ?? "Media",
    status: t.status ?? "Pendiente",
    dueDate: t.dueDate,
    reminderAt: t.reminderAt ?? "",
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    assignee: t.assignee,
    tags: t.tags,
    attachments: t.attachments ?? [],
  };
}

type Attachment = { kind: "image" | "document"; name: string; dataUrl: string };

function openAttachment(att: Attachment) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  if (att.kind === "image") {
    win.document.write(
      `<title>${att.name}</title><body style="margin:0;background:#0b1120;display:grid;place-items:center;min-height:100vh"><img src="${att.dataUrl}" alt="${att.name}" style="max-width:100%;max-height:100vh;object-fit:contain"/></body>`,
    );
    win.document.close();
    return;
  }
  win.document.write(
    `<title>${att.name}</title><body style="margin:0;background:#0b1120;height:100vh"><iframe src="${att.dataUrl}" title="${att.name}" style="border:0;width:100%;height:100%"></iframe></body>`,
  );
  win.document.close();
}

/* ---------- componentes internos ---------- */
function TaskList({
  tasks,
  onUpdate,
  onDelete,
  onOpen,
}: {
  tasks: TaskRecord[];
  onUpdate: (id: string, patch: Partial<DashboardTask>) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const sorted = useMemo(() => {
    const list = [...tasks];
    list.sort((a, b) => {
      const aDone = isCompleted(a.status) ? 1 : 0;
      const bDone = isCompleted(b.status) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      const aToday = a.dueDate === today ? 0 : 1;
      const bToday = b.dueDate === today ? 0 : 1;
      if (aToday !== bToday) return aToday - bToday;
      return (a.dueDate || "").localeCompare(b.dueDate || "");
    });
    return list;
  }, [tasks, today]);

  if (!sorted.length) {
    return <div className="empty-state">No hay tareas para este filtro.</div>;
  }

  return (
    <div className="task-list">
      {sorted.map((task) => {
        const completed = isCompleted(task.status);
        return (
          <div className={`task-row ${completed ? "done" : ""}`} key={task.id}>
            <label className="check-cell">
              <input
                type="checkbox"
                checked={completed}
                onChange={(e) => {
                  e.stopPropagation();
                  onUpdate(task.id, { status: "Hecha" });
                }}
              />
            </label>
            <button
              className="task-row-main"
              onClick={() => onOpen(task.id)}
              type="button"
            >
              <span className="task-row-title">{task.title}</span>
              <span className="task-row-meta">
                <span className="chip small">{task.category}</span>
                <span className="chip small">{task.assignee || "Sin asignar"}</span>
                {task.dueDate && <span className="due">{task.dueDate}</span>}
              </span>
            </button>
            <button
              className="ghost icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task.id);
              }}
              aria-label="Eliminar"
              type="button"
            >
              🗑
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TaskDetail({
  task,
  onClose,
  onUpdate,
  onDelete,
}: {
  task: DashboardTask;
  onClose: () => void;
  onUpdate: (patch: Partial<DashboardTask>) => void;
  onDelete: () => void;
}) {
  const [detail, setDetail] = useState(task.detail || "");
  const [assignee, setAssignee] = useState(task.assignee || "");
  const [priority, setPriority] = useState(task.priority || "Media");
  const [dueDate, setDueDate] = useState(task.dueDate);
  const [reminderTime, setReminderTime] = useState(timeFromDateTime(task.reminderAt) || "09:00");
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    setDetail(task.detail || "");
    setAssignee(task.assignee || "");
    setPriority(task.priority || "Media");
    setDueDate(task.dueDate);
    setReminderTime(timeFromDateTime(task.reminderAt) || "09:00");
    setAttachments(
      (task.attachments ?? []).map((dataUrl, idx) => ({
        kind: dataUrl.startsWith("data:image") ? "image" : "document",
        name: `adjunto-${idx + 1}`,
        dataUrl,
      })),
    );
  }, [task]);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const kind: Attachment["kind"] = file.type.startsWith("image/")
          ? "image"
          : "document";
        setAttachments((p) => [
          ...p,
          { kind, name: file.name, dataUrl: reader.result as string },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onUpdate({
            detail,
            assignee,
            priority,
            dueDate,
            reminderAt: buildDateTime(dueDate, reminderTime),
            attachments: attachments.map((a) => a.dataUrl),
          });
          onClose();
        }}
      >
        <div className="sheet-header">
          <span>Detalle</span>
          <button className="ghost close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <label className="label">Título</label>
        <input className="input" value={task.title} readOnly />
        <div className="row">
          <label className="label">
            Responsable
            <select
              className="input"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Sin asignar</option>
              {COMPANY_PEOPLE.map((person) => (
                <option key={person} value={person}>
                  {person}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Prioridad
            <select
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {["Crítica", "Alta", "Media", "Baja"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Fecha
            <input
              className="input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <label className="label">
            Hora aviso
            <input
              className="input"
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
            />
          </label>
        </div>
        <label className="label">Notas</label>
        <textarea
          className="input"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Contexto, pasos, enlaces..."
        />
        <label className="label">Adjuntos</label>
        <div className="attachments">
          {attachments.map((att, i) => (
            <div className="att-card" key={i}>
              <span className="att-name">{att.name}</span>
              {att.kind === "image" && (
                <img src={att.dataUrl} alt={att.name} className="att-thumb" />
              )}
              <button
                className="ghost"
                onClick={() => openAttachment(att)}
                type="button"
              >
                Ver
              </button>
              <a
                className="ghost attachment-link"
                href={att.dataUrl}
                download={att.name}
              >
                Descargar
              </a>
              <button
                className="ghost icon-btn"
                onClick={() =>
                  setAttachments((p) => p.filter((_, idx) => idx !== i))
                }
                type="button"
              >
                ×
              </button>
            </div>
          ))}
          <label className="upload-btn">
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
              onChange={(e) => onFiles(e.target.files)}
            />
            <span>+ Subir imágenes o documentos</span>
          </label>
        </div>
        <div className="actions">
          <button className="ghost" onClick={onDelete} type="button">
            Eliminar
          </button>
          <button className="button primary" type="submit">
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}

function QuickCreate({
  onClose,
  onSaveTask,
}: {
  onClose: () => void;
  onSaveTask: (t: {
    title: string;
    dueDate: string;
    reminderAt: string;
    priority: DashboardTaskPriority;
    assignee: string;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [reminderTime, setReminderTime] = useState("09:00");
  const [priority, setPriority] = useState<DashboardTaskPriority>("Media");
  const [assignee, setAssignee] = useState("Rafa");

  const submit = () => {
    if (!title.trim()) return;
    onSaveTask({
      title,
      dueDate,
      reminderAt: buildDateTime(dueDate, reminderTime),
      priority,
      assignee,
    });
    setTitle("");
    onClose();
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <div className="sheet-header">Tarea rápida</div>
        <input
          className="input"
          placeholder="Tarea rápida"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <div className="row">
          <label className="label">
            Fecha
            <input
              className="input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <label className="label">
            Hora aviso
            <input
              className="input"
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
            />
          </label>
          <label className="label">
            Prioridad
            <select
              className="input"
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as DashboardTaskPriority)
              }
            >
              {["Crítica", "Alta", "Media", "Baja"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Responsable
            <select
              className="input"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Sin asignar</option>
              {COMPANY_PEOPLE.map((person) => (
                <option key={person} value={person}>
                  {person}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="actions">
          <button className="ghost" onClick={onClose} type="button">
            Cancelar
          </button>
          <button className="button primary" type="submit">
            Añadir tarea
          </button>
        </div>
      </form>
    </div>
  );
}

function MailCard({ account, onClick }: { account: MailAccount; onClick: () => void }) {
  return (
    <button className="mail-card" onClick={onClick} type="button">
      <div className="mail-header">
        <span className="mail-name">{account.name}</span>
        <span className="mail-unread">{account.unread} nuevos</span>
      </div>
      <div className="mail-email">{account.email}</div>
      <div className="mail-preview" style={{ marginTop: 6 }}>
        {account.messages.slice(0, 5).map((m, i) => (
          <div
            key={i}
            style={{
              fontSize: 13,
              color: "#e2e8f0",
              padding: "6px 0",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ color: "#94a3b8", fontSize: 11 }}>
              {new Date(m.date).toLocaleString("es-ES", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>{m.from}</div>
            <div style={{ fontWeight: 600 }}>{m.subject}</div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>{m.snippet}</div>
          </div>
        ))}
      </div>
    </button>
  );
}

function GoogleAccountsPanel({
  accounts,
  onConnect,
  onDisconnect,
}: {
  accounts: GoogleAccountStatus[];
  onConnect: (accountKey: GoogleAccountStatus["accountKey"]) => void;
  onDisconnect: (accountKey: GoogleAccountStatus["accountKey"]) => void;
}) {
  const statusLabel = (status: GoogleAccountStatus["status"]) => {
    if (status === "connected") return "Conectada";
    if (status === "auth_error") return "Error de autenticación";
    if (status === "token_expired") return "Token caducado";
    if (status === "config_missing") return "Config pendiente";
    return "Desconectada";
  };

  return (
    <div className="google-accounts">
      {accounts.map((account) => (
        <div className="google-account-row" key={account.accountKey}>
          <div className="google-account-main">
            <strong>{account.label}</strong>
            <span>{account.email}</span>
          </div>
          <span className={`google-status ${account.status}`}>
            {statusLabel(account.status)}
          </span>
          <button
            className="chip small"
            onClick={() =>
              account.connected
                ? onDisconnect(account.accountKey)
                : onConnect(account.accountKey)
            }
            type="button"
          >
            {account.connected ? "Desconectar" : "Conectar"}
          </button>
        </div>
      ))}
    </div>
  );
}

function MailPanel({ account, onClose }: { account: MailAccount; onClose: () => void }) {
  const [repr, setRepr] = useState<"list" | "compose" | "view">("list");
  const [selectedMessage, setSelectedMessage] = useState<MailMessage | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [summary, setSummary] = useState("");
  const [replyAll, setReplyAll] = useState(false);
  const [sending, setSending] = useState(false);
  const [draftingReply, setDraftingReply] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  const compose = (mode: "new" | "reply" | "replyAll", message?: MailMessage) => {
    setDraftNote("");
    setSelectedMessage(message ?? null);
    setReplyAll(mode === "replyAll");
    if (mode === "new") {
      setTo("");
      setSubject("");
      setBody("");
    } else if (message) {
      setTo(message.from);
      setSubject(message.subject.startsWith("Re:") ? message.subject : `Re: ${message.subject}`);
      setBody("");
    }
    setRepr("compose");
  };

  const viewMessage = (index: number) => {
    const m = account.messages[index];
    setSelectedMessage(m);
    setTo(m.from);
    setSubject(m.subject);
    setBody(m.body || m.snippet);
    setSummary("");
    setRepr("view");
  };

  const summarizeMessage = async (message: MailMessage) => {
    setSelectedMessage(message);
    setTo(message.from);
    setSubject(message.subject);
    setBody(message.body || message.snippet);
    setSummary("");
    setDraftNote("Resumiendo correo...");
    setSummarizing(true);
    setRepr("view");
    try {
      const res = await fetchHermes("/mail/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: message.from,
          subject: message.subject,
          snippet: message.snippet,
          body: message.body,
          account: account.email,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Hermes no pudo resumir el correo.");
      }
      setSummary(data.summary || "Sin resumen disponible.");
      setDraftNote("");
    } catch (error) {
      setDraftNote(
        error instanceof Error ? error.message : "No se pudo resumir el correo."
      );
    } finally {
      setSummarizing(false);
    }
  };

  const submitMail = async (action: "draft" | "send") => {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      setDraftNote("Faltan Para, Asunto o Mensaje.");
      return;
    }
    if (
      action === "send" &&
      !window.confirm("Enviar este correo ahora desde Gmail?")
    ) {
      return;
    }
    setSending(true);
    setDraftNote(action === "draft" ? "Guardando borrador..." : "Enviando...");
    try {
      const res = await fetchHermes(action === "draft" ? "/mail/draft" : "/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          body,
          replyAll,
          threadId: selectedMessage?.threadId,
          account: account.email,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Hermes API no pudo procesar el correo.");
      }
      setDraftNote(
        action === "draft"
          ? `Borrador guardado${data.draft_id ? `: ${data.draft_id}` : ""}.`
          : "Correo enviado."
      );
      setRepr("list");
    } catch (error) {
      setDraftNote(
        error instanceof Error ? error.message : "No se pudo completar la accion."
      );
    } finally {
      setSending(false);
    }
  };

  const draftReplyWithHermes = async () => {
    if (!selectedMessage) return;
    setDraftingReply(true);
    setDraftNote("Hermes está redactando una respuesta...");
    try {
      const res = await fetchHermes("/mail/draft-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: selectedMessage.from,
          subject: selectedMessage.subject,
          snippet: selectedMessage.snippet,
          body: selectedMessage.body,
          account: account.email,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Hermes no pudo redactar la respuesta.");
      }
      setBody(data.body || "");
      setDraftNote("Respuesta preparada para revisar.");
      setRepr("compose");
    } catch (error) {
      setDraftNote(
        error instanceof Error ? error.message : "No se pudo redactar la respuesta."
      );
    } finally {
      setDraftingReply(false);
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet mail-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <span>Correo · {account.name}</span>
          <button className="ghost close" onClick={onClose} type="button">
            ×
          </button>
        </div>

        {repr === "list" && (
          <div className="mail-list-panel">
            {account.messages.map((m, i) => (
              <div className="mail-item" key={i}>
                <div className="mail-item-header">
                  <span className="mail-from">{m.from}</span>
                  <span className="mail-date">
                    {new Date(m.date).toLocaleString("es-ES", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "2-digit",
                    })}
                  </span>
                </div>
                <div className="mail-subject">{m.subject}</div>
                <div className="mail-snippet">{m.snippet}</div>
                <div className="mail-actions">
                  <button
                    className="chip small"
                    onClick={() => viewMessage(i)}
                    type="button"
                  >
                    📖 Leer
                  </button>
                  <button
                    className="chip small"
                    disabled={summarizing}
                    onClick={() => summarizeMessage(m)}
                    type="button"
                  >
                    Resumir
                  </button>
                  <button
                    className="chip small"
                    onClick={() => compose("reply", m)}
                    type="button"
                  >
                    ↩ Responder
                  </button>
                  <button
                    className="chip small"
                    onClick={() => compose("replyAll", m)}
                    type="button"
                  >
                    ↩ Responder a todos
                  </button>
                  <button
                    className="chip small"
                    onClick={() => compose("new")}
                    type="button"
                  >
                    ✏️ Nuevo
                  </button>
                </div>
              </div>
            ))}
            {!account.messages.length && (
              <div className="empty-state">Sin mensajes.</div>
            )}
          </div>
        )}

        {repr === "view" && (
          <div className="mail-composer">
            <div className="mail-view">
              <div className="mail-view-meta">
                <strong>Para:</strong> {to || "—"}
                <br />
                <strong>Asunto:</strong> {subject}
              </div>
              <div className="mail-view-body">{body}</div>
              {summary && (
                <div className="mail-summary">
                  <strong>Resumen</strong>
                  <span>{summary}</span>
                </div>
              )}
              {draftNote && <div className="hint">{draftNote}</div>}
            </div>
            <div className="actions">
              <button
                className="ghost"
                onClick={() => setRepr("list")}
                type="button"
              >
                Volver
              </button>
              <button
                className="button primary"
                disabled={sending}
                onClick={() => submitMail("draft")}
                type="button"
              >
                Guardar borrador
              </button>
              <button
                className="button"
                disabled={!selectedMessage || summarizing}
                onClick={() => selectedMessage && summarizeMessage(selectedMessage)}
                type="button"
              >
                Resumir
              </button>
              <button
                className="button"
                disabled={draftingReply}
                onClick={draftReplyWithHermes}
                type="button"
              >
                Redactar respuesta
              </button>
            </div>
          </div>
        )}

        {repr === "compose" && (
          <form
            className="mail-composer"
            onSubmit={(e) => {
              e.preventDefault();
              submitMail("draft");
            }}
          >
            <label className="label">Para</label>
            <input
              className="input"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <label className="label">Asunto</label>
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <label className="label">Mensaje</label>
            <textarea
              className="input textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <label className="label">Adjuntos (local)</label>
            <input
              className="input"
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.zip"
            />
            <div className="hint" style={{ marginTop: 8 }}>
              {draftNote || "Pulsa Guardar para crear el borrador."}
            </div>
            <div className="actions">
              <button
                className="ghost"
                onClick={() => setRepr("list")}
                type="button"
              >
                Cancelar
              </button>
              <button disabled={sending} type="button" onClick={() => submitMail("send")}>
                Enviar
              </button>
              {selectedMessage && (
                <button
                  className="button"
                  disabled={draftingReply}
                  onClick={draftReplyWithHermes}
                  type="button"
                >
                  Redactar respuesta
                </button>
              )}
              <button className="button primary" disabled={sending} type="submit">
                Guardar borrador
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ChatPanel({
  onClose,
  onSendTelegram,
}: {
  onClose: () => void;
  onSendTelegram: (text: string) => Promise<string>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setMessages((p) => [
      ...p,
      { id: `u-${Date.now()}`, from: "user", text, at: new Date().toISOString() },
    ]);
    setInput("");
    try {
      const reply = await onSendTelegram(text);
      setMessages((p) => [
        ...p,
        {
          id: `h-${Date.now()}`,
          from: "hermes",
          text: reply,
          at: new Date().toISOString(),
        },
      ]);
    } catch (e) {
      setMessages((p) => [
        ...p,
        {
          id: `h-${Date.now()}`,
          from: "hermes",
          text: "No pude ejecutar esa acción en este prototipo.",
          at: new Date().toISOString(),
        },
      ]);
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet chat-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <span>Chat Hermes</span>
          <button className="ghost close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="empty-state">
              Pídeme cualquier cosa: crea tareas, consulta correos, agenda eventos,
              resume hilos, adjunta archivos...
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`chat-bubble ${m.from === "user" ? "right" : "left"}`}
            >
              <div className="chat-text">{m.text}</div>
              <div className="chat-at">
                {new Date(m.at).toLocaleTimeString("es-ES", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe a Hermes..."
            autoFocus
          />
          <button className="button primary" type="submit">
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}

function ReminderCard({
  reminder,
  onClose,
  onSnooze,
}: {
  reminder: Reminder;
  onClose: () => void;
  onSnooze: (minutes: number) => void;
}) {
  const due = new Date(reminder.dueAt);
  const overdue = due < new Date();

  return (
    <div className="reminder-card">
      <div className="reminder-title">{reminder.title}</div>
      <div className="reminder-meta">
        {due.toLocaleString("es-ES", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
        {overdue && (
          <span className="reminder-badge" style={{ color: "#ef4444" }}>
            {" "}
            · Atrasado
          </span>
        )}
      </div>
      <div className="reminder-actions">
        <button className="chip small" onClick={onClose} type="button">
          Cerrar
        </button>
        <button
          className="chip small"
          onClick={() => onSnooze(10)}
          type="button"
        >
          +10 min
        </button>
        <button
          className="chip small"
          onClick={() => onSnooze(30)}
          type="button"
        >
          +30 min
        </button>
        <button
          className="chip small"
          onClick={() => onSnooze(60)}
          type="button"
        >
          +1 h
        </button>
      </div>
    </div>
  );
}

function TeamView({
  onOpenTask,
  onUpdateTask,
  tasks,
}: {
  onOpenTask: (id: string) => void;
  onUpdateTask: (id: string, patch: Partial<DashboardTask>) => void;
  tasks: DashboardTask[];
}) {
  const people = useMemo(() => {
    const names = new Set(COMPANY_PEOPLE);
    for (const task of tasks) {
      if (task.assignee) names.add(task.assignee);
    }
    names.add("Sin asignar");
    return Array.from(names);
  }, [tasks]);

  const activeTasks = tasks.filter((task) => !isCompleted(task.status));

  return (
    <div className="team-view">
      <div className="team-summary">
        {people.map((person) => {
          const assigned = activeTasks.filter((task) =>
            person === "Sin asignar" ? !task.assignee : task.assignee === person,
          );
          const overdue = assigned.filter((task) => isOverdue(task.dueDate)).length;
          return (
            <button
              className="team-card"
              key={person}
              onClick={() => {
                const first = assigned[0];
                if (first) onOpenTask(first.id);
              }}
              type="button"
            >
              <span className="team-name">{person}</span>
              <strong>{assigned.length}</strong>
              <small>
                {overdue ? `${overdue} vencidas` : "Sin vencidas"}
              </small>
            </button>
          );
        })}
      </div>

      <div className="team-columns">
        {people.map((person) => {
          const assigned = activeTasks.filter((task) =>
            person === "Sin asignar" ? !task.assignee : task.assignee === person,
          );
          return (
            <section className="team-column" key={person}>
              <header>
                <strong>{person}</strong>
                <span>{assigned.length}</span>
              </header>
              {assigned.map((task) => (
                <article
                  className={`team-task ${isOverdue(task.dueDate) ? "overdue" : ""}`}
                  key={task.id}
                >
                  <button onClick={() => onOpenTask(task.id)} type="button">
                    <strong>{task.title}</strong>
                    <span>{task.dueDate || "Sin fecha"}</span>
                  </button>
                  <select
                    className="input"
                    value={task.status ?? "Pendiente"}
                    onChange={(event) =>
                      onUpdateTask(task.id, { status: event.target.value })
                    }
                  >
                    {["Pendiente", "En curso", "Bloqueada", "Hecha"].map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
              {!assigned.length && (
                <div className="empty-state compact">Sin tareas activas.</div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- vista principal ---------- */
export function TasksView({
  tasks,
  taskSection,
  onChangeTaskSection,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onAddCalendarEvent,
  calendarEvents,
}: TasksViewProps) {
  const [tab, setTab] = useState<"inicio" | "tareas" | "calendario" | "proyectos" | "equipo">(
    "inicio"
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [view, setView] = useState<"lista" | "kanban">("lista");
  const [fabOpen, setFabOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openMailId, setOpenMailId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>(DEFAULT_ACCOUNTS);
  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccountStatus[]>(
    DEFAULT_GOOGLE_ACCOUNTS,
  );

  const refreshGoogleAccounts = async () => {
    try {
      const response = await fetchHermes("/google/accounts");
      const payload = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(payload.accounts)) {
        setGoogleAccounts(payload.accounts);
      }
    } catch {
      setGoogleAccounts(DEFAULT_GOOGLE_ACCOUNTS);
    }
  };

  useEffect(() => {
    void refreshGoogleAccounts();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadAccountInbox = async (account: MailAccount) => {
      const response = await fetchHermes(`/inbox?account=${encodeURIComponent(account.id)}`);
      if (!response.ok) return account;
      const payload = await response.json().catch(() => ({}));
      const inbox = Array.isArray(payload) ? payload : payload?.messages ?? [];
      const messages = (inbox || []).slice(0, 10).map((m: any) => ({
        from: m.from || m.sender || "",
        subject: m.subject || "",
        date: m.date || m.internalDate || new Date().toISOString(),
        snippet: m.snippet || m.body || "",
        read: !!m.read,
        body: m.body || m.snippet,
        threadId: m.threadId || m.id,
      }));
      return {
        ...account,
        unread: messages.filter((x: MailMessage) => !x.read).length,
        messages,
      };
    };

    Promise.all(DEFAULT_ACCOUNTS.map((account) => loadAccountInbox(account)))
      .then((accounts) => {
        if (cancelled) return;
        setMailAccounts(accounts);
      })
      .catch(() => {
        /* keep DEFAULT_ACCOUNTS if backend unavailable */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectGoogleAccount = (accountKey: GoogleAccountStatus["accountKey"]) => {
    window.location.href = hermesApi(`/google/connect/${accountKey}`);
  };

  const disconnectGoogleAccount = async (accountKey: GoogleAccountStatus["accountKey"]) => {
    try {
      await fetchHermes(`/google/accounts/${accountKey}`, { method: "DELETE" });
    } finally {
      await refreshGoogleAccounts();
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!matchesFilter(t, filter)) return false;
      if (isCompleted(t.status) && filter !== "completadas") return false;
      if (!isCompleted(t.status) && filter === "completadas") return false;
      if (q) {
        const haystack = `${t.title} ${t.detail} ${t.assignee ?? ""} ${
          t.category ?? ""
        } ${t.id}`.toLowerCase();
        return haystack.includes(q);
      }
      return true;
    });
  }, [tasks, filter, query]);

  const kanbanTasks = filtered.map(mapTask);

  const calendarEventsWithTasks = useMemo<CalendarEvent[]>(() => {
    const taskEvents = tasks
      .filter((task) => task.dueDate && !isCompleted(task.status))
      .map((task) => {
        const startsAt = task.reminderAt || `${task.dueDate}T09:00`;
        return {
          id: `task-${task.id}`,
          title: task.title,
          detail: task.detail || "Tarea",
          startsAt,
          endsAt: startsAt,
          location: task.assignee ? `Responsable: ${task.assignee}` : "Tarea",
          source: "task" as const,
        };
      });
    return [...calendarEvents, ...taskEvents];
  }, [calendarEvents, tasks]);

  const taskCount = useMemo(() => {
    return {
      todos: tasks.length,
      hoy: tasks.filter((t) => isToday(t.dueDate)).length,
      vencidas: tasks.filter((t) => isOverdue(t.dueDate)).length,
      urgentes: tasks.filter((t) => isUrgent(t.priority)).length,
    };
  }, [tasks]);

  const openTask = tasks.find((t) => t.id === openTaskId) || null;
  const openMail = mailAccounts.find((m) => m.id === openMailId) || null;

  const navigateToTask = (id: string) => {
    setOpenTaskId(id);
  };

  const openFilter = (f: Filter) => {
    setFilter(f);
    setTab("tareas");
  };

  const openCalendarForDate = (date: string) => {
    setTab("calendario");
  };

  const onSendTelegram = async (text: string): Promise<string> => {
    try {
      const res = await fetchHermes("/api/telegram/send-hermes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("not_ok");
      const data = await res.json().catch(() => ({}));
      return data.reply || "Mensaje enviado a Hermes.";
    } catch (e) {
      return (
        "Prototipo: esta acción se ejecutará desde el backend en producción."
      );
    }
  };

  /* ---------- reminders desde texto natural ---------- */
  const addReminderFromText = (text: string) => {
    const normalized = text
      .toLowerCase()
      .replace(/,/g, " ")
      .replace(/\s+/g, " ");
    const dateMatch = normalized.match(
      /(?:el\s+|dia\s+|a\s+)?(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/
    );
    const timeMatch = normalized.match(/(\d{1,2})(?::|\.)(\d{2})/);
    let dueAt = new Date();
    if (dateMatch) {
      const day = Number(dateMatch[1]);
      const month = Number(dateMatch[2]);
      const year = Number(dateMatch[3] ?? new Date().getFullYear());
      const currentYear = new Date().getFullYear();
      const fullYear = year < 100 ? currentYear + year : year;
      dueAt = new Date(fullYear, month - 1, day);
      if (timeMatch) {
        dueAt.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
      } else {
        dueAt.setHours(9, 0, 0, 0);
      }
    } else if (timeMatch) {
      const now = new Date();
      now.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
      dueAt = now;
    } else {
      dueAt = new Date();
      dueAt.setHours(dueAt.getHours() + 1);
    }
    const title = text
      .replace(
        /(?:el\s+|dia\s+|a\s+)?\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?/,
        ""
      )
      .replace(/\d{1,2}(?::|\.)\d{2}/, "")
      .replace(/\s+/g, " ")
      .trim();
    setReminders((p) => [
      ...p,
      { id: `rem-${Date.now()}`, title: title || "Recordatorio", dueAt: dueAt.toISOString(), postponed: 0 },
    ]);
  };

  useEffect(() => {
    if (!reminders.length) return;
    const ids = reminders.map((r) => {
      const due = new Date(r.dueAt).getTime();
      return setTimeout(() => {
        alert(`🔔 ${r.title}\n${new Date(r.dueAt).toLocaleString("es-ES")}`);
      }, due - Date.now());
    });
    return () => ids.forEach(clearTimeout);
  }, [reminders]);

  /* ---------- render ---------- */
  return (
    <>
      <div className="tasks-shell">
        {tab === "inicio" && (
          <div className="home">
            <div className="home-header">
              <div>
                <div className="home-title">Inicio</div>
                <div className="home-meta">
                  {taskCount.todos} tareas · {taskCount.vencidas} vencidas
                </div>
              </div>
              <button
                className="ghost icon-btn"
                onClick={() => setFabOpen(true)}
                aria-label="Nuevo"
                type="button"
              >
                ＋
              </button>
            </div>

            <div className="section">
              <div className="section-title">📧 Correo</div>
              <GoogleAccountsPanel
                accounts={googleAccounts}
                onConnect={connectGoogleAccount}
                onDisconnect={(accountKey) => void disconnectGoogleAccount(accountKey)}
              />
              <div className="mail-list">
                {mailAccounts.map((acc) => (
                  <MailCard
                    key={acc.id}
                    account={acc}
                    onClick={() => setOpenMailId(acc.id)}
                  />
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-title">🔔 Avisos</div>
              <div className="reminders">
                {reminders.map((r) => (
                  <ReminderCard
                    key={r.id}
                    reminder={r}
                    onClose={() =>
                      setReminders((p) => p.filter((x) => x.id !== r.id))
                    }
                    onSnooze={(minutes) => {
                      const next = new Date(r.dueAt);
                      next.setMinutes(next.getMinutes() + minutes);
                      setReminders((p) =>
                        p.map((x) =>
                          x.id === r.id
                            ? { ...x, dueAt: next.toISOString(), postponed: x.postponed + 1 }
                            : x
                        )
                      );
                      alert(
                        `Recordatorio pospuesto a ${next.toLocaleString("es-ES")}`
                      );
                    }}
                  />
                ))}
                {!reminders.length && (
                  <div className="empty-state">
                    Sin avisos. Crea una tarea con fecha y hora o pídele a Hermes
                    que te recuerde algo.
                  </div>
                )}
              </div>
            </div>

            <div className="section">
              <div className="section-title">Accesos directos</div>
              <div className="quick-actions">
                <button
                  className="quick-card"
                  onClick={() => openFilter("hoy")}
                >
                  <span className="quick-title">📋 Tareas de hoy</span>
                  <span className="quick-count">{taskCount.hoy}</span>
                </button>
                <button
                  className="quick-card"
                  onClick={() => openFilter("vencidas")}
                >
                  <span className="quick-title">⏰ Vencidas</span>
                  <span className="quick-count">{taskCount.vencidas}</span>
                </button>
                <button
                  className="quick-card"
                  onClick={() => setTab("calendario")}
                >
                  <span className="quick-title">🗓 Calendario</span>
                  <span className="quick-count">{taskCount.hoy + taskCount.vencidas}</span>
                </button>
                <button
                  className="quick-card"
                  onClick={() => setChatOpen(true)}
                >
                  <span className="quick-title">💬 Chat Hermes</span>
                </button>
              </div>
            </div>

            <div className="section">
              <div className="section-title">
                🗓 Calendario
                <button
                  className="chip small cal-go"
                  onClick={() => setTab("calendario")}
                  type="button"
                >
                  Ver calendario →
                </button>
              </div>
              <div className="cal-preview">
                {(() => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const weekEnd = shiftDay(7);
                  const overdueTasks = tasks
                    .filter((t) => isOverdue(t.dueDate) && !isCompleted(t.status))
                    .slice(0, 4);
                  const todayTasks = tasks
                    .filter((t) => t.dueDate === todayStr && !isCompleted(t.status))
                    .slice(0, 4);
                  const upcomingTasks = tasks
                    .filter(
                      (t) =>
                        t.dueDate > todayStr &&
                        t.dueDate <= weekEnd &&
                        !isCompleted(t.status)
                    )
                    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
                    .slice(0, 4);
                  const total = overdueTasks.length + todayTasks.length + upcomingTasks.length;
                  if (!total) {
                    return <div className="empty-state">Sin tareas próximas.</div>;
                  }
                  return (
                    <>
                      {overdueTasks.length > 0 && (
                        <div className="cal-preview-group overdue">
                          <span className="cal-preview-label">Vencidas ({overdueTasks.length})</span>
                          {overdueTasks.map((task) => (
                            <button
                              className="cal-preview-row"
                              key={task.id}
                              onClick={() => navigateToTask(task.id)}
                              type="button"
                            >
                              <span className="cal-preview-date danger">{task.dueDate.slice(8, 10) + "/" + task.dueDate.slice(5, 7)}</span>
                              <span className="cal-preview-title">{task.title}</span>
                              {isUrgent(task.priority) && <span className="priority-dot critica" />}
                            </button>
                          ))}
                        </div>
                      )}
                      {todayTasks.length > 0 && (
                        <div className="cal-preview-group today">
                          <span className="cal-preview-label">Hoy ({todayTasks.length})</span>
                          {todayTasks.map((task) => (
                            <button
                              className="cal-preview-row"
                              key={task.id}
                              onClick={() => navigateToTask(task.id)}
                              type="button"
                            >
                              <span className="cal-preview-date accent">Hoy</span>
                              <span className="cal-preview-title">{task.title}</span>
                              {isUrgent(task.priority) && <span className="priority-dot critica" />}
                            </button>
                          ))}
                        </div>
                      )}
                      {upcomingTasks.length > 0 && (
                        <div className="cal-preview-group upcoming">
                          <span className="cal-preview-label">Próximos 7 días ({upcomingTasks.length})</span>
                          {upcomingTasks.map((task) => (
                            <button
                              className="cal-preview-row"
                              key={task.id}
                              onClick={() => navigateToTask(task.id)}
                              type="button"
                            >
                              <span className="cal-preview-date">{task.dueDate.slice(8, 10) + "/" + task.dueDate.slice(5, 7)}</span>
                              <span className="cal-preview-title">{task.title}</span>
                              {isUrgent(task.priority) && <span className="priority-dot critica" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="section">
              <div className="section-title">Tareas de hoy</div>
              <div className="quick-list">
                {(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  const todayTasks = tasks
                    .filter((t) => t.dueDate === today && !isCompleted(t.status))
                    .slice(0, 8);
                  if (!todayTasks.length)
                    return (
                      <div className="empty-state">Sin tareas para hoy.</div>
                    );
                  return todayTasks.map((task) => (
                    <label className="quick-row" key={task.id}>
                      <input
                        type="checkbox"
                        checked={isCompleted(task.status)}
                        onChange={(e) => {
                          e.stopPropagation();
                          onUpdateTask(task.id, { status: "Hecha" });
                        }}
                      />
                      <button
                        className="quick-row-text"
                        onClick={() => navigateToTask(task.id)}
                        type="button"
                      >
                        <span>{task.title}</span>
                        <span
                          className={`priority-dot ${(task.priority ?? "media").toLowerCase()}`}
                        />
                      </button>
                    </label>
                  ));
                })()}
              </div>
            </div>

            <div className="section">
              <div className="section-title">Vencidas</div>
              <div className="quick-list">
                {(() => {
                  const overdue = tasks
                    .filter(
                      (t) => isOverdue(t.dueDate) && !isCompleted(t.status)
                    )
                    .slice(0, 8);
                  if (!overdue.length)
                    return (
                      <div className="empty-state">
                        No tienes tareas vencidas.
                      </div>
                    );
                  return overdue.map((task) => (
                    <label className="quick-row" key={task.id}>
                      <input
                        type="checkbox"
                        checked={isCompleted(task.status)}
                        onChange={(e) => {
                          e.stopPropagation();
                          onUpdateTask(task.id, { status: "Hecha" });
                        }}
                      />
                      <button
                        className="quick-row-text"
                        onClick={() => navigateToTask(task.id)}
                        type="button"
                      >
                        <span>{task.title}</span>
                        <span
                          className={`priority-dot ${(task.priority ?? "media").toLowerCase()}`}
                        />
                      </button>
                    </label>
                  ));
                })()}
              </div>
            </div>

            <div className="section">
              <div className="section-title">Urgentes</div>
              <div className="quick-list">
                {(() => {
                  const urgent = tasks
                    .filter(
                      (t) => isUrgent(t.priority) && !isCompleted(t.status)
                    )
                    .slice(0, 8);
                  if (!urgent.length)
                    return (
                      <div className="empty-state">
                        No tienes tareas urgentes.
                      </div>
                    );
                  return urgent.map((task) => (
                    <label className="quick-row" key={task.id}>
                      <input
                        type="checkbox"
                        checked={isCompleted(task.status)}
                        onChange={(e) => {
                          e.stopPropagation();
                          onUpdateTask(task.id, { status: "Hecha" });
                        }}
                      />
                      <button
                        className="quick-row-text"
                        onClick={() => navigateToTask(task.id)}
                        type="button"
                      >
                        <span>{task.title}</span>
                        <span
                          className={`priority-dot ${(task.priority ?? "media").toLowerCase()}`}
                        />
                      </button>
                    </label>
                  ));
                })()}
              </div>
            </div>
          </div>
        )}

        {tab === "tareas" && (
          <>
            <div className="tasks-topbar">
              <div className="search">
                <input
                  placeholder="Buscar tarea, proyecto o responsable..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="filters">
                <label className="select-filter dark-select">
                  <span>Filtro</span>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as Filter)}
                  >
                    {filters.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="task-section-toggle">
                <button
                  className={view === "lista" ? "active" : ""}
                  onClick={() => setView("lista")}
                  type="button"
                >
                  Lista
                </button>
                <button
                  className={view === "kanban" ? "active" : ""}
                  onClick={() => setView("kanban")}
                  type="button"
                >
                  Kanban
                </button>
              </div>
            </div>
            <div className="tasks-content">
              {view === "kanban" ? (
                <TasksKanbanBoard
                  tasks={kanbanTasks}
                  onChange={(next) => {
                    const nextIds = new Set(next.map((task) => task.id));
                    for (const task of next) {
                      const original = tasks.find((item) => item.id === task.id);
                      if (original) {
                        onUpdateTask(task.id, task);
                      } else {
                        onAddTask(task);
                      }
                    }
                    for (const task of kanbanTasks) {
                      if (!nextIds.has(task.id)) {
                        onDeleteTask(task.id);
                      }
                    }
                  }}
                />
              ) : (
                <TaskList
                  tasks={kanbanTasks}
                  onUpdate={onUpdateTask}
                  onDelete={onDeleteTask}
                  onOpen={(id) => setOpenTaskId(id)}
                />
              )}
            </div>
            <button
              className="fab"
              onClick={() => setFabOpen(true)}
              type="button"
            >
              ＋
            </button>
          </>
        )}

        {tab === "calendario" && (
          <TasksCalendarView
            events={calendarEventsWithTasks}
            onCreate={(payload) => {
              onAddCalendarEvent({
                date: payload.date,
                title: payload.title,
                startsAt: payload.startsAt,
                endsAt: payload.endsAt,
                location: payload.location,
              });
            }}
          />
        )}

        {tab === "proyectos" && (
          <div className="empty-state">
            <div className="empty-title">📂 Proyectos</div>
            <div className="empty-text">
              Próximamente: tarjetas de proyecto y carga por equipo.
            </div>
          </div>
        )}
        {tab === "equipo" && (
          <TeamView
            onOpenTask={(id) => setOpenTaskId(id)}
            onUpdateTask={onUpdateTask}
            tasks={tasks}
          />
        )}
      </div>

      <nav className="bottom-bar">
        {[
          ["inicio", "Inicio"],
          ["tareas", "Tareas"],
          ["calendario", "Calendario"],
          ["proyectos", "Proyectos"],
          ["equipo", "Equipo"],
        ].map(([k, label]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k as any)}
            type="button"
          >
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {fabOpen && (
        <QuickCreate
          onClose={() => setFabOpen(false)}
          onSaveTask={(task) => {
            const parsed = /(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/.exec(
              task.title
            );
            let dueDate = task.dueDate;
            if (parsed) {
              const day = Number(parsed[1]);
              const month = Number(parsed[2]);
              const year = Number(parsed[3] ?? new Date().getFullYear());
              const currentYear = new Date().getFullYear();
              const fullYear = year < 100 ? currentYear + year : year;
              const d = new Date(fullYear, month - 1, day);
              dueDate = d.toISOString().slice(0, 10);
              const titleWithoutDate = task.title
                .replace(parsed[0], "")
                .replace(/^\s*,?\s*/, "")
                .trim();
              onAddTask({
                id: `task-${Date.now().toString(36)}`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                title: titleWithoutDate || task.title,
                detail: "",
                category: "Operaciones",
                priority: task.priority,
                status: "Pendiente",
                dueDate,
                assignee: task.assignee,
                reminderAt: buildDateTime(dueDate, timeFromDateTime(task.reminderAt) || "09:00"),
              });
              setReminders((p) => [
                ...p,
                {
                  id: `rem-${Date.now().toString(36)}`,
                  title: titleWithoutDate || task.title,
                  dueAt: new Date(buildDateTime(dueDate, timeFromDateTime(task.reminderAt) || "09:00")).toISOString(),
                  postponed: 0,
                },
              ]);
              setFabOpen(false);
              return;
            }
            const timeMatch = /(\d{1,2})(?::|\.)(\d{2})/.exec(task.title);
            if (timeMatch) {
              const now = new Date();
              now.setHours(
                Number(timeMatch[1]),
                Number(timeMatch[2]),
                0,
                0
              );
              dueDate = now.toISOString().slice(0, 10);
              addReminderFromText(task.title);
            }
            onAddTask({
              ...task,
              id: `task-${Date.now().toString(36)}`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              detail: "",
              category: "Operaciones",
              status: "Pendiente",
              dueDate,
            });
            if (task.reminderAt) {
              setReminders((p) => [
                ...p,
                {
                  id: `rem-${Date.now().toString(36)}`,
                  title: task.title,
                  dueAt: new Date(task.reminderAt).toISOString(),
                  postponed: 0,
                },
              ]);
            }
            setFabOpen(false);
          }}
        />
      )}

      {openTask && (
        <TaskDetail
          task={openTask}
          onClose={() => setOpenTaskId(null)}
          onUpdate={(patch) => onUpdateTask(openTask.id, patch)}
          onDelete={() => {
            onDeleteTask(openTask.id);
            setOpenTaskId(null);
          }}
        />
      )}

      {openMail && (
        <MailPanel account={openMail} onClose={() => setOpenMailId(null)} />
      )}

      {chatOpen && (
        <ChatPanel
          onClose={() => setChatOpen(false)}
          onSendTelegram={onSendTelegram}
        />
      )}

      <style>{css}</style>
    </>
  );
}

const css = `
.tasks-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100vh;
  padding: 16px;
  padding-bottom: 96px;
}

.home { display: flex; flex-direction: column; gap: 16px; }
.home-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.home-title { font-weight: 700; font-size: 22px; }
.home-meta { color: #94a3b8; font-size: 14px; }

.section { display: flex; flex-direction: column; gap: 10px; }
.section-title { font-weight: 600; color: #e2e8f0; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cal-go { font-size: 12px; }

/* calendario preview en inicio */
.cal-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 12px;
}
.cal-preview-group { display: flex; flex-direction: column; gap: 4px; }
.cal-preview-label { font-size: 12px; color: #94a3b8; font-weight: 600; padding: 2px 0; }
.cal-preview-group.overdue .cal-preview-label { color: #f87171; }
.cal-preview-group.today .cal-preview-label { color: #38bdf8; }
.cal-preview-group.upcoming .cal-preview-label { color: #a3e635; }
.cal-preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  border-radius: 8px;
  font-size: 14px;
}
.cal-preview-row:hover { background: rgba(255,255,255,0.05); }
.cal-preview-date {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #64748b;
  min-width: 38px;
  text-align: center;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
}
.cal-preview-date.danger { color: #f87171; background: rgba(239,68,68,0.15); }
.cal-preview-date.accent { color: #38bdf8; background: rgba(56,189,248,0.15); }
.cal-preview-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e2e8f0; }

/* tarjetas Gmail */
.google-accounts { display: flex; flex-direction: column; gap: 8px; }
.google-account-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 10px;
}
.google-account-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.google-account-main strong { color: #e2e8f0; font-size: 14px; }
.google-account-main span { color: #94a3b8; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.google-status {
  border-radius: 999px;
  font-size: 12px;
  padding: 4px 8px;
  white-space: nowrap;
  color: #cbd5e1;
  background: rgba(148,163,184,0.14);
}
.google-status.connected { color: #86efac; background: rgba(34,197,94,0.14); }
.google-status.auth_error,
.google-status.token_expired { color: #fecaca; background: rgba(239,68,68,0.16); }
.google-status.config_missing { color: #fde68a; background: rgba(245,158,11,0.16); }
.mail-list { display: flex; flex-direction: column; gap: 10px; }
.mail-card {
  text-align: left;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 14px;
  min-height: 56px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
}
.mail-header { display: flex; justify-content: space-between; align-items: center; }
.mail-name { font-weight: 600; color: #e2e8f0; }
.mail-unread { color: #ef4444; font-size: 12px; }
.mail-email { color: #94a3b8; font-size: 13px; }
.mail-preview { display: flex; flex-direction: column; gap: 6px; }
.mail-action {
  color: #60a5fa;
  font-size: 13px;
  text-decoration: none;
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.mail-sheet { max-height: 92vh; overflow: hidden; display: flex; flex-direction: column; }
.mail-list-panel { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 60vh; }
.mail-item {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  padding: 12px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mail-item-header { display: flex; justify-content: space-between; font-size: 12px; color: #94a3b8; }
.mail-from { color: #e2e8f0; font-weight: 600; }
.mail-subject { font-weight: 600; color: #e2e8f0; margin-top: 6px; }
.mail-snippet { color: #94a3b8; font-size: 13px; margin-top: 4px; }
.mail-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.mail-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
}
.mail-composer { display: flex; flex-direction: column; gap: 12px; }
.mail-view-body { color: #e2e8f0; line-height: 1.6; }
.mail-view-meta { font-size: 13px; color: #94a3b8; line-height: 1.7; }
.mail-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid rgba(250,204,21,0.24);
  border-radius: 10px;
  background: rgba(250,204,21,0.08);
  color: #fde68a;
  padding: 10px;
}
.mail-summary span {
  color: #e2e8f0;
  line-height: 1.45;
}

/* accesos directos */
.quick-actions { display: grid; grid-template-columns: 1fr; gap: 10px; }
.quick-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 14px;
  min-height: 56px;
  cursor: pointer;
  text-align: left;
}
.quick-title { font-weight: 600; color: #e2e8f0; }
.quick-count { font-weight: 700; color: #facc15; font-size: 18px; }

/* reminders */
.reminders { display: flex; flex-direction: column; gap: 10px; }
.reminder-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(29,78,216,0.15);
  border-radius: 12px;
}
.reminder-title { font-weight: 700; color: #e2e8f0; }
.reminder-meta { color: #94a3b8; font-size: 12px; }
.reminder-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.reminder-badge { font-weight: 700; }

/* chat */
.chat-sheet { max-height: 92vh; overflow: hidden; display: flex; flex-direction: column; }
.chat-messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  max-height: 60vh;
  padding: 8px;
}
.chat-bubble {
  max-width: 80%;
  padding: 10px 11px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.45;
}
.chat-bubble.left {
  align-self: flex-start;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.1);
}
.chat-bubble.right {
  align-self: flex-end;
  background: #1d4ed8;
  color: white;
}
.chat-text { white-space: pre-wrap; word-break: break-word; }
.chat-at { font-size: 10px; opacity: 0.8; margin-top: 4px; }
.chat-form {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 0;
}
.chat-form input { flex: 1; }

/* tareas rápidas con checkbox */
.quick-list { display: flex; flex-direction: column; gap: 10px; }
.quick-row { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); padding: 12px 14px; border-radius: 12px; min-height: 48px; }
.quick-row input[type="checkbox"] { width: 20px; height: 20px; accent-color: #1d4ed8; }
.quick-row-text { flex: 1; display: flex; justify-content: space-between; align-items: center; color: #e2e8f0; background: transparent; border: none; padding: 0; cursor: pointer; text-align: left; min-width: 0; }

/* tareas */
.tasks-topbar { display: flex; flex-direction: column; gap: 12px; }
.search input {
  width: 100%;
  background: rgba(255,255,255,0.04);
  color: inherit;
  border: 1px solid rgba(255,255,255,0.12);
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 16px;
}
.filters { display: flex; gap: 10px; padding-bottom: 6px; align-items: center; }
.dark-select {
  width: 100%;
  max-width: 360px;
}
.dark-select span {
  color: #94a3b8;
}
.dark-select select {
  width: 100%;
  min-height: 44px;
  margin-top: 6px;
}
.task-section-toggle { display: inline-flex; gap: 8px; padding: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); border-radius: 999px; align-self: flex-start; }
.tasks-content { display: flex; flex-direction: column; gap: 12px; }

.task-list { display: flex; flex-direction: column; gap: 10px; }
.task-row { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); padding: 12px 14px; border-radius: 12px; min-height: 56px; }
.task-row.done { opacity: 0.7; }
.check-cell { display: inline-flex; align-items: center; }
.check-cell input { width: 22px; height: 22px; accent-color: #1d4ed8; }
.task-row-main { flex: 1; display: flex; flex-direction: column; gap: 6px; background: transparent; border: none; color: inherit; padding: 0; cursor: pointer; text-align: left; min-width: 0; }
.task-row-title { font-weight: 600; color: #e2e8f0; word-break: break-word; }
.task-row-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: #94a3b8; font-size: 12px; }
.priority-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.priority-dot.crítica, .priority-dot.critica { background: #ef4444; }
.priority-dot.alta { background: #f97316; }
.priority-dot.media { background: #facc15; }
.priority-dot.baja { background: #34d399; }
.due { font-variant-numeric: tabular-nums; }

/* FAB */
.fab {
  position: fixed;
  right: 18px;
  bottom: 84px;
  width: 56px;
  height: 56px;
  border-radius: 999px;
  border: none;
  background: #1d4ed8;
  color: white;
  font-size: 28px;
  line-height: 56px;
  text-align: center;
  box-shadow: 0 8px 24px rgba(29,78,216,0.35);
  cursor: pointer;
  z-index: 8;
}

/* bottom */
.bottom-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: env(safe-area-inset-bottom, 10px) 8px 10px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  border-top: 1px solid rgba(255,255,255,0.08);
  background: rgba(15,23,42,0.92);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  z-index: 20;
}
.bottom-bar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: rgba(226,232,240,0.7);
  padding: 10px 4px;
  min-height: 52px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2px;
  transition: color 0.15s ease, transform 0.05s ease;
}
.bottom-bar button.active { color: #60a5fa; }

/* generic */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.04);
  color: inherit;
  font-size: 14px;
  white-space: nowrap;
  min-height: 40px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.chip.active { background: #1d4ed8; border-color: #1d4ed8; color: white; }
.chip.small { padding: 4px 8px; font-size: 12px; min-height: 28px; }
.chip:disabled,
.button:disabled,
.ghost:disabled {
  cursor: wait;
  opacity: 0.62;
}

.input, select, textarea {
  background: rgba(255,255,255,0.04);
  color: inherit;
  border: 1px solid rgba(255,255,255,0.12);
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 16px;
  min-width: 0;
}
.textarea { min-height: 80px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; }
.label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #cbd5e1; }

.segmented { display: inline-flex; gap: 8px; flex-wrap: wrap; }

.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15,23,42,0.82);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: max(env(safe-area-inset-bottom, 12px), 84px);
  z-index: 12;
}
.sheet {
  background: #0b1120;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px 14px 0 0;
  width: 100vw;
  max-width: 100vw;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 92vh;
  overflow-y: auto;
}
.sheet-header { font-weight: 700; font-size: 16px; display: flex; justify-content: space-between; align-items: center; }
.actions { display: flex; justify-content: stretch; gap: 10px; }
.actions .button { flex: 1; text-align: center; }
.button, .ghost {
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  color: inherit;
  padding: 12px 14px;
  border-radius: 10px;
  cursor: pointer;
  min-height: 44px;
  font-size: 15px;
}
.button.primary { background: #1d4ed8; border-color: #1d4ed8; color: white; }
.button:hover, .ghost:hover { filter: brightness(1.1); }
.icon-btn { padding: 8px 10px; min-width: 36px; text-align: center; }
.close { border: none; background: transparent; color: inherit; font-size: 18px; padding: 4px 8px; border-radius: 8px; }

.empty-state { color: #94a3b8; font-size: 14px; padding: 10px 0; }
.empty-title { font-weight: 700; font-size: 20px; color: #e2e8f0; }
.empty-text { font-size: 14px; color: #94a3b8; }

.attachments { display: flex; flex-direction: column; gap: 8px; }
.att-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  padding: 10px;
  border-radius: 10px;
  font-size: 13px;
  color: #e2e8f0;
}
.att-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); }
.attachment-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}
.upload-btn input[type="file"] { display: none; }
.upload-btn {
  border: 1px dashed rgba(255,255,255,0.22);
  padding: 12px;
  border-radius: 10px;
  text-align: center;
  color: #cbd5e1;
  font-size: 13px;
  cursor: pointer;
  background: rgba(255,255,255,0.02);
}

.team-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.team-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.team-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  min-height: 92px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  background: rgba(255,255,255,0.04);
  color: inherit;
  padding: 14px;
  text-align: left;
  cursor: pointer;
}
.team-card strong {
  color: #facc15;
  font-size: 24px;
}
.team-card small,
.team-name {
  color: #cbd5e1;
}
.team-name {
  font-weight: 700;
}
.team-columns {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.team-column {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  background: rgba(255,255,255,0.025);
  padding: 12px;
}
.team-column header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #e2e8f0;
}
.team-column header span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  min-height: 26px;
  border-radius: 999px;
  background: rgba(96,165,250,0.15);
  color: #93c5fd;
  font-weight: 800;
}
.team-task {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  background: rgba(255,255,255,0.04);
  padding: 10px;
}
.team-task.overdue {
  border-color: rgba(239,68,68,0.48);
}
.team-task button {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border: 0;
  background: transparent;
  color: #e2e8f0;
  padding: 0;
  text-align: left;
}
.team-task button span {
  color: #94a3b8;
  font-size: 12px;
  white-space: nowrap;
}
.empty-state.compact {
  padding: 6px 0;
  font-size: 13px;
}

.hint { color: #94a3b8; font-size: 13px; }

@media (min-width: 640px) {
  .quick-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .team-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 639px) {
  .google-account-row { grid-template-columns: minmax(0, 1fr); align-items: stretch; }
  .google-account-row .chip { justify-content: center; }
}

@media (min-width: 1024px) {
  .tasks-shell { max-width: 1100px; margin: 0 auto; }
  .team-columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }
}
`;
