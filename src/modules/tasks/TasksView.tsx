import { useMemo, useState, useRef, useEffect } from "react";
import { TasksKanbanBoard, type TaskRecord } from "./TasksKanbanBoard";
import { TasksCalendarView, type CalendarEvent } from "./TasksCalendarView";

/* ---------- props públicas ---------- */
export type TasksViewProps = {
  tasks: Record<string, unknown>[];
  taskSection: "Tareas" | "Calendario";
  onChangeTaskSection: (value: "Tareas" | "Calendario") => void;
  onAddTask: (task: unknown) => void;
  onUpdateTask: (id: string, patch: Partial<TaskRecord>) => void;
  onDeleteTask: (id: string) => void;
  onAddCalendarEvent: (event: {
    date: string;
    title: string;
    startsAt: string;
    endsAt: string;
    location?: string;
  }) => void;
  calendarEvents: CalendarEvent[];
  newTaskTitle: string;
  newTaskDetail: string;
  newTaskCategory: string;
  newTaskPriority: string;
  newTaskDueDate: string;
  newTaskReminderAt: string;
  onChangeNewTaskTitle: (value: string) => void;
  onChangeNewTaskDetail: (value: string) => void;
  onChangeNewTaskCategory: (value: string) => void;
  onChangeNewTaskPriority: (value: string) => void;
  onChangeNewTaskDueDate: (value: string) => void;
  onChangeNewTaskReminderAt: (value: string) => void;
  onAddTaskFromForm: () => void;
  taskFilter: string;
  onChangeTaskFilter: (value: string) => void;
  newEventTitle: string;
  newEventDetail: string;
  newEventLocation: string;
  newEventSource: string;
  newEventStartsAt: string;
  newEventEndsAt: string;
  onChangeNewEventTitle: (value: string) => void;
  onChangeNewEventDetail: (value: string) => void;
  onChangeNewEventLocation: (value: string) => void;
  onChangeNewEventSource: (value: string) => void;
  onChangeNewEventStartsAt: (value: string) => void;
  onChangeNewEventEndsAt: (value: string) => void;
  onAddCalendarEventFromForm: () => void;
  calendarMonth: string;
  onChangeCalendarMonth: (value: string) => void;
  calendarAccounts: { id: string; label: string; email: string; connected: boolean }[];
};

/* ---------- datos locales ---------- */
type MailMessage = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  read: boolean;
  body?: string;
  threadId?: string;
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

/* ---------- helpers ---------- */
function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function isToday(date?: string) {
  if (!date) return false;
  return date === today();
}
function isOverdue(date?: string) {
  if (!date) return false;
  return date < today();
}
function shiftDay(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function mapActivity(t: Record<string, unknown>): TaskRecord {
  return {
    id: String(t.id ?? ""),
    title: String(t.title ?? ""),
    detail: String(t.detail ?? ""),
    category: String(t.category ?? "Operaciones"),
    priority: String(t.priority ?? "Media"),
    status: String(t.status ?? "Pendiente"),
    dueDate: String(t.dueDate ?? ""),
    reminderAt: t.reminderAt ? String(t.reminderAt) : undefined,
    createdAt: String(t.createdAt ?? new Date().toISOString()),
    updatedAt: String(t.updatedAt ?? new Date().toISOString()),
    assignee: t.assignee ? String(t.assignee) : undefined,
    tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
  };
}

/* ---------- componente principal ---------- */
export function TasksView({
  tasks,
  taskSection,
  onChangeTaskSection,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onAddCalendarEvent,
  calendarEvents,
  newTaskTitle,
  newTaskDetail,
  newTaskCategory,
  newTaskPriority,
  newTaskDueDate,
  newTaskReminderAt,
  onChangeNewTaskTitle,
  onChangeNewTaskDetail,
  onChangeNewTaskCategory,
  onChangeNewTaskPriority,
  onChangeNewTaskDueDate,
  onChangeNewTaskReminderAt,
  onAddTaskFromForm,
  taskFilter,
  onChangeTaskFilter,
  newEventTitle,
  newEventDetail,
  newEventLocation,
  newEventSource,
  newEventStartsAt,
  newEventEndsAt,
  onChangeNewEventTitle,
  onChangeNewEventDetail,
  onChangeNewEventLocation,
  onChangeNewEventSource,
  onChangeNewEventStartsAt,
  onChangeNewEventEndsAt,
  onAddCalendarEventFromForm,
  calendarMonth,
  onChangeCalendarMonth,
  calendarAccounts,
}: TasksViewProps) {
  const [query, setQuery] = useState("");
  const [mailPanelOpen, setMailPanelOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"list" | "compose" | "reply">("list");
  const [selectedThread, setSelectedThread] = useState<MailMessage | null>(null);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [reminders] = useState<Reminder[]>([
    { id: "r1", title: "Tareas vencidas", dueAt: "", postponed: 0 },
    { id: "r2", title: "Hoy", dueAt: "", postponed: 0 },
  ]);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | "default">("default");

  const activity = useMemo(() => tasks.map(mapActivity), [tasks]);

  const filteredActivities = useMemo(() => {
    const q = query.toLowerCase().trim();
    return activity.filter((t) => {
      if (!q) return true;
      const haystack = `${t.title} ${t.detail} ${t.category} ${t.assignee ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [activity, query]);

  const overdueTasks = useMemo(() => activity.filter((t) => isOverdue(t.dueDate)), [activity]);
  const todayTasks = useMemo(() => activity.filter((t) => isToday(t.dueDate)), [activity]);
  const remindedTasks = useMemo(() => activity.filter((t) => t.reminderAt), [activity]);

  useEffect(() => {
    loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadInbox() {
    try {
      const res = await fetch(`http://localhost:5174/api/inbox`);
      if (!res.ok) return;
      const data = await res.json();
      const messages: MailMessage[] = (data.messages ?? []).map((m: Record<string, unknown>) => ({
        id: String(m.id ?? m.threadId ?? Math.random()),
        from: String(m.from ?? ""),
        subject: String(m.subject ?? "(sin asunto)"),
        date: String(m.date ?? ""),
        snippet: String(m.snippet ?? ""),
        read: typeof m.read === "boolean" ? m.read : false,
        body: typeof m.body === "string" ? m.body : undefined,
        threadId: String(m.threadId ?? m.id ?? ""),
      }));
      // local cache could be implemented here
      void messages;
    } catch {
      // offline
    }
  }

  function requestNotifications() {
    if ("Notification" in window) {
      Notification.requestPermission().then((perm) => setNotificationStatus(perm));
    }
  }

  function formatNotificationPermission(status: typeof notificationStatus) {
    if (status === "granted") return "✔ Concedidos";
    if (status === "denied") return "✘ Denegados";
    return "Pendientes / sin soporte";
  }

  function openThread(message: MailMessage) {
    setSelectedThread(message);
    setComposeMode("reply");
    setComposeTo(message.from);
    setComposeSubject(`Re: ${message.subject}`);
    setComposeBody(message.body || message.snippet || "");
  }

  async function sendMail() {
    const payload = { to: composeTo, subject: composeSubject, body: composeBody };
    try {
      const r = await fetch("http://localhost:5174/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (data?.status === "sent" || r.ok) {
        alert(`Correo enviado a ${composeTo || "destinatario"}`);
      } else {
        alert("No se pudo enviar el correo");
      }
      setComposeMode("list");
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
    } catch {
      alert("No se pudo enviar el correo");
    }
  }

  async function saveDraft() {
    try {
      const r = await fetch("http://localhost:5174/api/mail/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: composeTo, subject: composeSubject, body: composeBody }),
      });
      if (r.ok) alert(`Borrador guardado para ${composeTo || "destinatario"}\nAsunto: ${composeSubject || "(sin asunto)"}`);
      else alert("No se pudo guardar");
    } catch {
      alert("No se pudo guardar");
    }
  }

  async function sendReplyAll() {
    const payload = { to: composeTo, subject: composeSubject, body: composeBody, replyAll: true };
    try {
      await fetch("http://localhost:5174/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      alert("Responder a todos: prototipo");
      setComposeMode("list");
    } catch {
      alert("No se pudo responder a todos");
    }
  }

  async function sendChat() {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatMessages((prev) => [...prev, { id: `u-${Date.now()}`, from: "user", text, at: new Date().toLocaleTimeString() }]);
    setChatInput("");
    try {
      const r = await fetch("http://localhost:5174/api/telegram/send-hermes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = (await r.json()) as { reply?: string };
      setChatMessages((prev) => [
        ...prev,
        { id: `h-${Date.now()}`, from: "hermes", text: d.reply ?? "Prototipo sin respuesta", at: new Date().toLocaleTimeString() },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { id: `h-${Date.now()}`, from: "hermes", text: "Prototipo sin backend", at: new Date().toLocaleTimeString() },
      ]);
    }
  }

  return (
    <section className="tasks-module">
      <div className="module-tabs">
        <button className={taskSection === "Tareas" ? "active" : ""} onClick={() => onChangeTaskSection("Tareas")} type="button">Tareas</button>
        <button className={taskSection === "Calendario" ? "active" : ""} onClick={() => onChangeTaskSection("Calendario")} type="button">Calendario</button>
      </div>

      {taskSection === "Tareas" ? (
        <>
          <section className="tasks-layout">
            <article className="panel task-create-panel">
              <div className="section-heading">
                <span>Alta rapida</span>
                <h2>Nueva tarea</h2>
              </div>
              <input aria-label="Titulo" onChange={(e) => onChangeNewTaskTitle(e.target.value)} placeholder="Tarea rapida" value={newTaskTitle} />
              <textarea aria-label="Detalle" onChange={(e) => onChangeNewTaskDetail(e.target.value)} placeholder="Indicaciones, bloqueo o siguiente paso" value={newTaskDetail} rows={3} />
              <div className="task-form-grid">
                <label className="label">
                  <span>Tipo</span>
                  <select aria-label="Tipo" value="task" onChange={(e) => {}}>
                    <option value="task">Tarea</option>
                    <option value="event">Evento</option>
                    <option value="mail">Correo</option>
                  </select>
                </label>
                <input aria-label="Categoria" value={newTaskCategory} readOnly />
                <input aria-label="Prioridad" value={newTaskPriority} readOnly />
                <input aria-label="Fecha limite" onChange={(e) => onChangeNewTaskDueDate(e.target.value)} type="date" value={newTaskDueDate} />
                <input aria-label="Recordatorio" onChange={(e) => onChangeNewTaskReminderAt(e.target.value)} type="datetime-local" value={newTaskReminderAt} />
              </div>
              <button className="primary-action" onClick={onAddTaskFromForm} type="button">Anadir tarea</button>
            </article>

            <article className="panel task-alert-panel">
              <div className="section-heading">
                <span>Avisos</span>
                <h2>Recordatorios</h2>
                <p>Los avisos del navegador funcionan si este equipo tiene la pagina abierta o permitida.</p>
              </div>
              <button className="clear-filters" onClick={requestNotifications} type="button">Activar avisos navegador</button>
              <div className="task-alert-list">
                {overdueTasks.length > 0 && <div className="task-alert"><strong>Vencidas</strong>: {overdueTasks.length}</div>}
                {todayTasks.length > 0 && <div className="task-alert"><strong>Para hoy</strong>: {todayTasks.length}</div>}
                {remindedTasks.length > 0 && <div className="task-alert"><strong>Recordatorio</strong>: {remindedTasks.length}</div>}
              </div>
              <small>Estado navegador: {formatNotificationPermission(notificationStatus)}</small>
            </article>
          </section>

          <section className="panel tasks-panel">
            <div className="panel-header">
              <div>
                <h2>Tareas pendientes</h2>
                <span>Lista operativa de lo hablado y siguientes pasos</span>
              </div>
              <div className="segmented-control compact">
                {(["Activas", "Todas", "Hechas"] as const).map((option) => (
                  <button className={taskFilter === option ? "active" : ""} key={option} onClick={() => onChangeTaskFilter(option)} type="button">{option}</button>
                ))}
              </div>
            </div>

            <div className="task-list">
              <TasksKanbanBoard tasks={filteredActivities} onChange={(next)=> onUpdateTask("", { status: (next as TaskRecord[])[0]?.status ?? "Pendiente" })} />
            </div>
          </section>
        </>
      ) : (
        <TasksCalendarView
          {...({
            events: calendarEvents,
            onCreate: onAddCalendarEvent,
            month: calendarMonth,
            onChangeMonth: onChangeCalendarMonth,
            newEventTitle,
            newEventDetail,
            newEventLocation,
            newEventSource,
            newEventStartsAt,
            newEventEndsAt,
            onChangeNewEventTitle,
            onChangeNewEventDetail,
            onChangeNewEventLocation,
            onChangeNewEventSource,
            onChangeNewEventStartsAt,
            onChangeNewEventEndsAt,
            onAddEvent: onAddCalendarEventFromForm,
          } as unknown as React.ComponentProps<typeof TasksCalendarView>)}
        />
      )}

      {taskSection === "Tareas" && (
        <button className="fab" onClick={() => setMailPanelOpen(true)} type="button">Correo</button>
      )}

      {mailPanelOpen && (
        <div className="backdrop" onClick={() => { setMailPanelOpen(false); setComposeMode("list"); }}>
          <div className="sheet mail-sheet">
            <div className="sheet-header">
              <span>Correo</span>
              <button className="ghost close" onClick={() => { setMailPanelOpen(false); setComposeMode("list"); }} type="button">×</button>
            </div>
            <div className="mail-accounts">
              {(calendarAccounts ?? []).map((account, idx) => (
                <button key={account.id} className={`mail-card ${idx === 0 ? "active" : ""}`} onClick={() => {}} type="button">
                  <div className="mail-header">
                    <span className="mail-name">{account.label}</span>
                    <span className="mail-unread">{account.connected ? "conectado" : "desconectado"}</span>
                  </div>
                  <div className="mail-email">{account.email}</div>
                </button>
              ))}
            </div>
            <div className="mail-actions">
              <button className="button primary" onClick={() => { setComposeMode("compose"); setSelectedThread(null); setComposeTo(""); setComposeSubject(""); setComposeBody(""); }} type="button">Nuevo correo</button>
              <button className="ghost" onClick={() => setComposeMode("list")} type="button">Limpiar</button>
            </div>

            {composeMode === "compose" && (
              <form className="composer" onSubmit={(e) => { e.preventDefault(); sendMail(); }}>
                <label className="label">Para
                  <input className="input" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="destinatario@correo.es" />
                </label>
                <label className="label">Asunto
                  <input className="input" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} placeholder="Asunto" />
                </label>
                <label className="label">Mensaje
                  <textarea className="input" value={composeBody} onChange={(e) => setComposeBody(e.target.value)} placeholder="Escribe el mensaje" rows={5} />
                </label>
                <div className="composer-actions">
                  <button className="button primary" type="submit">Enviar</button>
                  <button className="ghost" type="button" onClick={saveDraft}>Guardar borrador</button>
                  <button className="ghost" type="button" onClick={() => setComposeMode("list")}>Cancelar</button>
                </div>
              </form>
            )}

            {composeMode === "reply" && selectedThread && (
              <form className="composer" onSubmit={(e) => { e.preventDefault(); sendMail(); }}>
                <div className="reply-preview">
                  <div><strong>Respondiendo a:</strong> {selectedThread.from}</div>
                  <div><strong>Asunto:</strong> {selectedThread.subject}</div>
                  <div className="reply-snippet">{selectedThread.snippet}</div>
                </div>
                <label className="label">Para
                  <input className="input" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} />
                </label>
                <label className="label">Asunto
                  <input className="input" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
                </label>
                <label className="label">Mensaje
                  <textarea className="input" value={composeBody} onChange={(e) => setComposeBody(e.target.value)} rows={5} />
                </label>
                <div className="composer-actions">
                  <button className="button primary" type="submit">Responder</button>
                  <button className="button primary" type="button" onClick={sendReplyAll}>Responder a todos</button>
                  <button className="ghost" type="button" onClick={saveDraft}>Guardar borrador</button>
                  <button className="ghost" type="button" onClick={() => { setComposeMode("list"); setSelectedThread(null); }}>Cancelar</button>
                </div>
              </form>
            )}

            {composeMode === "list" && (
              <div className="mail-threads">
                {([ ] as MailMessage[]).map((message) => (
                  <button key={message.id} className={`mail-thread ${message.read ? "" : "unread"}`} onClick={() => openThread(message)} type="button">
                    <div className="thread-header">
                      <span className="thread-from">{message.from}</span>
                      <span className="thread-date">{message.date}</span>
                    </div>
                    <div className="thread-subject">{message.subject}</div>
                    <div className="thread-snippet">{message.snippet}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <article className="panel chat-panel">
        <div className="section-heading">
          <span>Chat</span>
          <h2>Hermes</h2>
        </div>
        <div className="chat-history">
          {chatMessages.length === 0 && <div className="empty-state">Sin mensajes aun.</div>}
          {chatMessages.map((msg) => (
            <div key={msg.id} className={`chat-message ${msg.from}`}>
              <span>{escapeHtml(msg.text)}</span>
              <small>{msg.at}</small>
            </div>
          ))}
        </div>
        <form className="chat-form" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
          <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Mensaje para Hermes" />
          <button className="button primary" type="submit">Enviar</button>
        </form>
      </article>
    </section>
  );
}
