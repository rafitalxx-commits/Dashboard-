import { useMemo, useState, useRef } from "react";
import type {
  DashboardTask,
  DashboardTaskCategory,
  DashboardTaskPriority,
  DashboardTaskStatus,
} from "../App";
import { TasksKanbanBoard, type TaskRecord } from "./TasksKanbanBoard";
import { TasksCalendarView, type CalendarEvent } from "./TasksCalendarView";

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
type MailAccount = { id: string; name: string; email: string; unread: number; messages: MailMessage[] };
type MailMessage = { from: string; subject: string; date: string; snippet: string; read: boolean };

const mailAccounts: MailAccount[] = [
  {
    id: "personal",
    name: "Personal",
    email: "rafitalxx@gmail.com",
    unread: 10,
    messages: Array.from({ length: 10 }).map((_, i) => ({
      from: `remitente-${i + 1}@gmail.com`,
      subject: `Asunto personal #${i + 1}`,
      date: new Date(Date.now() - i * 3600000).toISOString(),
      snippet: `Resumen del correo personal ${i + 1}...`,
      read: false,
    })),
  },
  {
    id: "work",
    name: "Trabajo",
    email: "r.garcia@empresa.com",
    unread: 3,
    messages: Array.from({ length: 3 }).map((_, i) => ({
      from: `compañero-${i + 1}@empresa.com`,
      subject: `Asunto trabajo #${i + 1}`,
      date: new Date(Date.now() - i * 7200000).toISOString(),
      snippet: `Resumen del correo de trabajo ${i + 1}...`,
      read: false,
    })),
  },
];

/* ---------- filtros ---------- */
const filters = [
  { key: "todos", label: "Todos", icon: "📋" },
  { key: "hoy", label: "Hoy", icon: "📅" },
  { key: "manana", label: "Mañana", icon: "🌤" },
  { key: "semana", label: "Semana", icon: "📆" },
  { key: "vencidas", label: "Vencidas", icon: "⏰" },
  { key: "urgentes", label: "Urgentes", icon: "🔥" },
  { key: "sin_asignar", label: "Sin asignar", icon: "👤" },
  { key: "completadas", label: "Completadas", icon: "✅" },
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
    detail: t.detail,
    category: (t.category as DashboardTaskCategory) ?? "Operaciones",
    priority: (t.priority as DashboardTaskPriority) ?? "Media",
    status: (t.status as DashboardTaskStatus) ?? "Pendiente",
    dueDate: t.dueDate,
    reminderAt: t.reminderAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    assignee: t.assignee,
    tags: t.tags,
    attachments: (t as unknown as Record<string, unknown>).attachments as string[],
  };
}

type Attachment = { kind: "image" | "document"; name: string; dataUrl: string };
type OpenTarget = { type: "task"; id?: string } | { type: "calendar"; date?: string } | { type: "filter"; filter?: Filter };

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
  task: TaskRecord & { attachments?: string[] };
  onClose: () => void;
  onUpdate: (patch: Partial<DashboardTask>) => void;
  onDelete: () => void;
}) {
  const [detail, setDetail] = useState(task.detail || "");
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const kind: Attachment["kind"] = file.type.startsWith("image/") ? "image" : "document";
        setAttachments((p) => [...p, { kind, name: file.name, dataUrl: reader.result as string }]);
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="sheet"
        onSubmit={(e) => {
          e.preventDefault();
          onUpdate({
            detail,
            attachments: attachments.map((a) => a.dataUrl),
          });
          onClose();
        }}
      >
        <div className="sheet-header">
          <span>Detalle</span>
          <button className="ghost close" onClick={onClose} type="button">×</button>
        </div>
        <label className="label">Título</label>
        <input className="input" value={task.title} readOnly />
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
                className="ghost icon-btn"
                onClick={() => setAttachments((p) => p.filter((_, idx) => idx !== i))}
                type="button"
              >
                ×
              </button>
            </div>
          ))}
          <label className="upload-btn">
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip" onChange={(e) => onFiles(e.target.files)} />
            <span>+ Subir imágenes o documentos</span>
          </label>
        </div>
        <div className="actions">
          <button className="ghost" onClick={onDelete} type="button">Eliminar</button>
          <button className="button primary" type="submit">Guardar</button>
        </div>
      </form>
    </div>
  );
}

function QuickCreate({
  onSaveTask,
  onSaveEvent,
}: {
  onSaveTask: (t: { title: string; dueDate: string; priority: DashboardTaskPriority }) => void;
  onSaveEvent: (e: { title: string; date: string; startsAt: string; endsAt: string }) => void;
}) {
  const [mode, setMode] = useState<"task" | "event" | "telegram">("task");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [priority, setPriority] = useState<DashboardTaskPriority>("Media");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");

  const submit = () => {
    if (!title.trim()) return;
    if (mode === "task") {
      onSaveTask({ title, dueDate, priority });
    } else {
      const date = dueDate;
      onSaveEvent({ title, date, startsAt: `${date}T${start}`, endsAt: `${date}T${end}` });
    }
    setTitle("");
    setMode("task");
  };

  return (
    <div className="backdrop" onClick={() => setMode("task")}>
      <form className="sheet" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="sheet-header">Creación rápida</div>
        <div className="segmented">
          {(["task", "event", "telegram"] as const).map((m) => (
            <button key={m} className={`chip ${mode === m ? "active" : ""}`} onClick={() => setMode(m)} type="button">
              {m === "task" ? "Tarea" : m === "event" ? "Evento" : "Telegram"}
            </button>
          ))}
        </div>
        <input
          className="input"
          placeholder={mode === "task" ? "Tarea rápida" : "Evento"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        {mode === "task" && (
          <div className="row">
            <label className="label">
              Fecha
              <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <label className="label">
              Prioridad
              <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as DashboardTaskPriority)}>
                {["Crítica","Alta","Media","Baja"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
        )}
        {mode === "event" && (
          <div className="row">
            <label className="label">
              Fecha
              <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <label className="label">
              Inicio
              <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="label">
              Fin
              <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
        )}
        {mode === "telegram" && (
          <div className="hint">Envía un mensaje a Hermes en Telegram con la tarea o evento y se creará automáticamente.</div>
        )}
        <div className="actions">
          <button className="ghost" onClick={() => setMode("task")} type="button">Cancelar</button>
          <button className="button primary" type="submit">Guardar</button>
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
      <div className="mail-action">Ver 10 no leídos →</div>
    </button>
  );
}

function MailPanel({ account, onClose }: { account: MailAccount; onClose: () => void }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet mail-sheet">
        <div className="sheet-header">
          <span>Correo · {account.name}</span>
          <button className="ghost close" onClick={onClose} type="button">×</button>
        </div>
        <div className="mail-list-panel">
          {account.messages.map((m, i) => (
            <div className="mail-item" key={i}>
              <div className="mail-item-header">
                <span className="mail-from">{m.from}</span>
                <span className="mail-date">{new Date(m.date).toLocaleString("es-ES", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span>
              </div>
              <div className="mail-subject">{m.subject}</div>
              <div className="mail-snippet">{m.snippet}</div>
            </div>
          ))}
        </div>
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
  const [tab, setTab] = useState<"inicio" | "tareas" | "calendario" | "proyectos" | "equipo">("inicio");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [view, setView] = useState<"lista" | "kanban">("lista");
  const [fabOpen, setFabOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openMailId, setOpenMailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!matchesFilter(t, filter)) return false;
      if (isCompleted(t.status) && filter !== "completadas") return false;
      if (!isCompleted(t.status) && filter === "completadas") return false;
      if (q) {
        const haystack = `${t.title} ${t.detail} ${t.assignee ?? ""} ${t.category ?? ""} ${t.id}`.toLowerCase();
        return haystack.includes(q);
      }
      return true;
    });
  }, [tasks, filter, query]);

  const kanbanTasks = filtered.map(mapTask);

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

  return (
    <>
      <div className="tasks-shell">
        {tab === "inicio" && (
          <div className="home">
            <div className="home-header">
              <div>
                <div className="home-title">Inicio</div>
                <div className="home-meta">{taskCount.todos} tareas · {taskCount.vencidas} vencidas</div>
              </div>
              <button className="ghost icon-btn" onClick={() => setFabOpen(true)} aria-label="Nuevo" type="button">➕</button>
            </div>

            <div className="section">
              <div className="section-title">📧 Correo</div>
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
              <div className="section-title">Accesos directos</div>
              <div className="quick-actions">
                <button className="quick-card" onClick={() => openFilter("hoy")}>
                  <span className="quick-title">📅 Tareas de hoy</span>
                  <span className="quick-count">{taskCount.hoy}</span>
                </button>
                <button className="quick-card" onClick={() => openFilter("vencidas")}>
                  <span className="quick-title">⏰ Vencidas</span>
                  <span className="quick-count">{taskCount.vencidas}</span>
                </button>
                <button className="quick-card" onClick={() => setTab("calendario")}>
                  <span className="quick-title">🗓 Calendario</span>
                </button>
              </div>
            </div>

            <div className="section">
              <div className="section-title">Tareas de hoy</div>
              <div className="quick-list">
                {(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  const todayTasks = tasks.filter((t) => t.dueDate === today && !isCompleted(t.status)).slice(0, 8);
                  if (!todayTasks.length) return <div className="empty-state">Sin tareas para hoy.</div>;
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
                      <button className="quick-row-text" onClick={() => navigateToTask(task.id)} type="button">
                        <span>{task.title}</span>
                        <span className={`priority-dot ${(task.priority ?? "media").toLowerCase()}`} />
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
                  const overdue = tasks.filter((t) => isOverdue(t.dueDate) && !isCompleted(t.status)).slice(0, 8);
                  if (!overdue.length) return <div className="empty-state">No tienes tareas vencidas.</div>;
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
                      <button className="quick-row-text" onClick={() => navigateToTask(task.id)} type="button">
                        <span>{task.title}</span>
                        <span className={`priority-dot ${(task.priority ?? "media").toLowerCase()}`} />
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
                  const urgent = tasks.filter((t) => isUrgent(t.priority) && !isCompleted(t.status)).slice(0, 8);
                  if (!urgent.length) return <div className="empty-state">No tienes tareas urgentes.</div>;
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
                      <button className="quick-row-text" onClick={() => navigateToTask(task.id)} type="button">
                        <span>{task.title}</span>
                        <span className={`priority-dot ${(task.priority ?? "media").toLowerCase()}`} />
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
                {filters.map((f) => (
                  <button
                    key={f.key}
                    className={`chip ${filter === f.key ? "active" : ""}`}
                    onClick={() => setFilter(f.key)}
                  >
                    <span>{f.icon}</span>
                    <span>{f.label}</span>
                  </button>
                ))}
              </div>
              <div className="task-section-toggle">
                <button className={view === "lista" ? "active" : ""} onClick={() => setView("lista")} type="button">Lista</button>
                <button className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")} type="button">Kanban</button>
              </div>
            </div>
            <div className="tasks-content">
              {view === "kanban" ? (
                <TasksKanbanBoard tasks={kanbanTasks} onChange={() => {}} />
              ) : (
                <TaskList tasks={kanbanTasks} onUpdate={onUpdateTask} onDelete={onDeleteTask} onOpen={(id) => setOpenTaskId(id)} />
              )}
            </div>
            <button className="fab" onClick={() => setFabOpen(true)} type="button">＋</button>
          </>
        )}

        {tab === "calendario" && (
          <TasksCalendarView
            events={calendarEvents}
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
            <div className="empty-text">Próximamente: tarjetas de proyecto y carga por equipo.</div>
          </div>
        )}
        {tab === "equipo" && (
          <div className="empty-state">
            <div className="empty-title">👥 Equipo</div>
            <div className="empty-text">Próximamente: empleados y tareas activas por persona.</div>
          </div>
        )}
      </div>

      <nav className="bottom-bar">
        {([["inicio","🏠","Inicio"],["tareas","✅","Tareas"],["calendario","📅","Calendario"],["proyectos","📂","Proyectos"],["equipo","👥","Equipo"]] as const).map(([k, icon, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)} type="button">
            <span>{icon}</span><span>{label}</span>
          </button>
        ))}
      </nav>

      {fabOpen && (
        <QuickCreate
          onSaveTask={(task) => {
            onAddTask({
              ...task,
              id: `task-${Date.now().toString(36)}`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            setFabOpen(false);
          }}
          onSaveEvent={(evt) => {
            onAddCalendarEvent({
              date: evt.date,
              title: evt.title,
              startsAt: evt.startsAt,
              endsAt: evt.endsAt,
            });
            setFabOpen(false);
          }}
        />
      )}

      {openTask && (
        <TaskDetail
          task={openTask}
          onClose={() => setOpenTaskId(null)}
          onUpdate={(patch) => onUpdateTask(openTask.id, patch)}
          onDelete={() => { onDeleteTask(openTask.id); setOpenTaskId(null); }}
        />
      )}

      {openMail && (
        <MailPanel account={openMail} onClose={() => setOpenMailId(null)} />
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
.section-title { font-weight: 600; color: #e2e8f0; }

/* tarjetas Gmail */
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
.mail-action { color: #60a5fa; font-size: 13px; }

.mail-sheet { max-height: 92vh; overflow: hidden; display: flex; flex-direction: column; }
.mail-list-panel { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 60vh; }
.mail-item { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); padding: 12px; border-radius: 10px; }
.mail-item-header { display: flex; justify-content: space-between; font-size: 12px; color: #94a3b8; }
.mail-from { color: #e2e8f0; font-weight: 600; }
.mail-subject { font-weight: 600; color: #e2e8f0; margin-top: 6px; }
.mail-snippet { color: #94a3b8; font-size: 13px; margin-top: 4px; }

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
.filters { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; align-items: center; }
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
.priority-dot.crítica { background: #ef4444; }
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
  display: flex;
  justify-content: space-between;
  gap: 6px;
  border-top: 1px solid rgba(255,255,255,0.08);
  background: rgba(15,23,42,0.85);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  z-index: 20;
}
.bottom-bar button {
  flex: 1;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: inherit;
  padding: 8px 6px;
  min-height: 48px;
  font-size: 11px;
}
.bottom-bar button.active { color: #60a5fa; }
.bottom-bar button span:first-child { font-size: 20px; }

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
}
.chip.active { background: #1d4ed8; border-color: #1d4ed8; color: white; }
.chip.small { padding: 4px 8px; font-size: 12px; min-height: 28px; }

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
  background: rgba(15,23,42,0.72);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: env(safe-area-inset-bottom, 12px);
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
.att-card { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); padding: 10px; border-radius: 10px; font-size: 13px; color: #e2e8f0; }
.att-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); }
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

.hint { color: #94a3b8; font-size: 13px; }

@media (min-width: 640px) {
  .quick-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (min-width: 1024px) {
  .tasks-shell { max-width: 1100px; margin: 0 auto; }
}
`;
