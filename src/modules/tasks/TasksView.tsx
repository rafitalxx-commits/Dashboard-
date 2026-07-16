import { useMemo, useState } from "react";
import type {
  DashboardTask,
  DashboardTaskCategory,
  DashboardTaskPriority,
  DashboardTaskStatus,
} from "../App";
import { TasksKanbanBoard, type TaskRecord } from "./TasksKanbanBoard";
import { TasksCalendarView, type CalendarEvent } from "./TasksCalendarView";

/* ---------- tipos públicos ---------- */
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

/* ---------- helpers ---------- */
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

function projectLabel(category?: DashboardTaskCategory) {
  return category ?? "Operaciones";
}

function statusLabel(status?: DashboardTaskStatus) {
  if (status === "Listo para responder") return "Listo para responder";
  return status ?? "Pendiente";
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
  };
}

/* ---------- componentes internos ---------- */
function TaskList({
  tasks,
  onUpdate,
  onDelete,
}: {
  tasks: TaskRecord[];
  onUpdate: (id: string, patch: Partial<DashboardTask>) => void;
  onDelete: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  if (!tasks.length) {
    return (
      <div className="empty-state">No hay tareas para este filtro.</div>
    );
  }

  return (
    <div className="task-list">
      {tasks.map((task) => {
        const completed = ["Hecha", "Listo para responder", "Completada"].includes(
          task.status
        );
        return (
          <div
            className={`task-card ${completed ? "done" : ""}`}
            key={task.id}
            onClick={() =>
              setSelected(task.id === selected ? null : task.id)
            }
          >
            <div className="task-main">
              <div className="task-title">{task.title}</div>
              <div className="task-sub">
                <span className="chip small">{projectLabel(task.category)}</span>
                <span className="task-who">
                  {task.assignee || "Sin asignar"}
                </span>
                <span className={`priority-dot ${task.priority.toLowerCase()}`} />
              </div>
            </div>
            <div className="task-meta">
              <span className={`status-chip ${task.status.toLowerCase()}`}>
                {statusLabel(task.status)}
              </span>
              {task.dueDate && <span className="due-date">{task.dueDate}</span>}
            </div>
            {selected === task.id && (
              <div className="task-actions">
                <button
                  className="button primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(task.id, { status: "Hecha" });
                  }}
                >
                  Completar
                </button>
                <button
                  className="button ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(task.id);
                  }}
                >
                  Eliminar
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NewTaskSheet({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (task: {
    title: string;
    category: DashboardTaskCategory;
    assignee?: string;
    dueDate: string;
    priority: DashboardTaskPriority;
    detail?: string;
  }) => void;
}) {
  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="sheet"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const title = String(form.get("title") ?? "");
          if (!title.trim()) return;
          onSave({
            title,
            category: String(form.get("category") ?? "Operaciones") as DashboardTaskCategory,
            assignee: String(form.get("assignee") ?? ""),
            dueDate: String(form.get("dueDate") ?? new Date().toISOString().slice(0, 10)),
            priority: String(form.get("priority") ?? "Media") as DashboardTaskPriority,
            detail: String(form.get("detail") ?? ""),
          });
        }}
      >
        <div className="sheet-header">Nueva tarea</div>
        <label className="label">Título</label>
        <input className="input" name="title" placeholder="Qué hay que hacer" autoFocus />
        <div className="row">
          <label className="label">
            Proyecto
            <select className="input" name="category" defaultValue="Operaciones">
              {["Operaciones","Dashboard","Odoo","Compras","Gmail","Amazon","Dominio","IA"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="label">
            Prioridad
            <select className="input" name="priority" defaultValue="Media">
              {["Crítica","Alta","Media","Baja"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="label">
            Responsable
            <input className="input" name="assignee" placeholder="Nombre" />
          </label>
          <label className="label">
            Fecha límite
            <input className="input" type="date" name="dueDate" defaultValue={new Date().toISOString().slice(0, 10)} />
          </label>
        </div>
        <label className="label">Detalle</label>
        <textarea className="input" name="detail" placeholder="Contexto extra" />
        <div className="actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button primary">Guardar</button>
        </div>
      </form>
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
  const [tab, setTab] = useState<"inicio" | "tareas" | "calendario" | "proyectos" | "equipo">("tareas");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [view, setView] = useState<"lista" | "kanban">(taskSection === "Calendario" ? "lista" : "lista");
  const [fabOpen, setFabOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!matchesFilter(t, filter)) return false;
      if (isCompleted(t.status) && filter !== "completadas") return false;
      if (!isCompleted(t.status) && filter === "completadas") return false;
      if (q) {
        const haystack = `${t.title} ${t.detail} ${t.assignee ?? ""} ${projectLabel(t.category)} ${t.id}`.toLowerCase();
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

  return (
    <>
      <div className="tasks-shell">
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
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="task-section-toggle">
                <button
                  className={view === "lista" ? "active" : ""}
                  onClick={() => setView("lista")}
                >
                  Lista
                </button>
                <button
                  className={view === "kanban" ? "active" : ""}
                  onClick={() => setView("kanban")}
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
                    const first = next[0];
                    if (first) onUpdateTask(first.id, {});
                  }}
                />
              ) : (
                <TaskList
                  tasks={kanbanTasks}
                  onUpdate={onUpdateTask}
                  onDelete={onDeleteTask}
                />
              )}
            </div>

            <button className="fab" onClick={() => setFabOpen(true)}>
              +
            </button>

            {fabOpen && (
              <NewTaskSheet
                onClose={() => setFabOpen(false)}
                onSave={(task) => {
                  onAddTask({
                    ...task,
                    id: `task-${Date.now().toString(36)}`,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  });
                  setFabOpen(false);
                }}
              />
            )}
          </>
        )}

        {tab === "calendario" && (
          <TasksCalendarView
            events={calendarEvents}
            onCreate={(payload) => {
              onAddCalendarEvent(payload);
            }}
          />
        )}

        {tab === "inicio" && (
          <div className="inicio-empty">
            <div className="inicio-title">Inicio</div>
            <div className="inicio-meta">
              {taskCount.todos} tareas · {taskCount.vencidas} vencidas
            </div>
          </div>
        )}

        {tab === "proyectos" && (
          <div className="empty-state">
            <div className="empty-title">Proyectos</div>
            <div className="empty-text">
              Próximamente: tarjetas de proyecto y carga por equipo.
            </div>
          </div>
        )}

        {tab === "equipo" && (
          <div className="empty-state">
            <div className="empty-title">Equipo</div>
            <div className="empty-text">
              Próximamente: empleados y tareas activas por persona.
            </div>
          </div>
        )}
      </div>

      <nav className="bottom-bar">
        <button
          className={tab === "inicio" ? "active" : ""}
          onClick={() => setTab("inicio")}
        >
          <span>🏠</span>
          <span>Inicio</span>
        </button>
        <button
          className={tab === "tareas" ? "active" : ""}
          onClick={() => setTab("tareas")}
        >
          <span>✅</span>
          <span>Tareas</span>
        </button>
        <button
          className={tab === "calendario" ? "active" : ""}
          onClick={() => setTab("calendario")}
        >
          <span>📅</span>
          <span>Calendario</span>
        </button>
        <button
          className={tab === "proyectos" ? "active" : ""}
          onClick={() => setTab("proyectos")}
        >
          <span>📂</span>
          <span>Proyectos</span>
        </button>
        <button
          className={tab === "equipo" ? "active" : ""}
          onClick={() => setTab("equipo")}
        >
          <span>👥</span>
          <span>Equipo</span>
        </button>
      </nav>

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
.tasks-topbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.search input {
  width: 100%;
  background: rgba(255,255,255,0.04);
  color: inherit;
  border: 1px solid rgba(255,255,255,0.12);
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 16px;
}
.filters {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 6px;
}
.chip {
  white-space: nowrap;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.04);
  color: inherit;
}
.chip.active {
  background: #1d4ed8;
  border-color: #1d4ed8;
  color: white;
}
.task-section-toggle {
  display: inline-flex;
  gap: 8px;
  padding: 6px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  border-radius: 999px;
}
.task-section-toggle button {
  border: none;
  background: transparent;
  color: inherit;
  padding: 8px 14px;
  border-radius: 999px;
  cursor: pointer;
  min-height: 40px;
}
.task-section-toggle button.active {
  background: #1d4ed8;
  color: white;
}

.tasks-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.fab {
  position: fixed;
  right: 18px;
  bottom: 88px;
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

.task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.task-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  min-height: 56px;
}
.task-card.done { opacity: 0.7; }
.task-main { display: flex; flex-direction: column; gap: 4px; }
.task-title { font-weight: 600; }
.task-sub {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #cbd5e1;
  font-size: 13px;
}
.task-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #94a3b8;
}
.task-actions { display: flex; gap: 10px; justify-content: flex-end; }
.priority-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.priority-dot.crítica { background: #ef4444; }
.priority-dot.alta { background: #f97316; }
.priority-dot.media { background: #facc15; }
.priority-dot.baja { background: #34d399; }

.status-chip {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  font-size: 12px;
}
.status-chip.hecha { background: rgba(52,211,153,0.18); color: #a7f3d0; }
.status-chip.pendiente { background: rgba(255,255,255,0.08); color: #e2e8f0; }
.status-chip.en-curso { background: rgba(56,189,248,0.18); color: #bae6fd; }
.status-chip.bloqueada { background: rgba(248,113,113,0.18); color: #fecaca; }

.due-date { font-variant-numeric: tabular-nums; }

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
}
.sheet-header { font-weight: 700; font-size: 16px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; }
.label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #cbd5e1;
}
.input, select, textarea {
  background: rgba(255,255,255,0.04);
  color: inherit;
  border: 1px solid rgba(255,255,255,0.12);
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 16px;
}
.input { min-width: 0; }
textarea { min-height: 80px; }
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

.empty-state {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #94a3b8;
}
.empty-title { font-weight: 600; color: #e2e8f0; }
.empty-text { font-size: 14px; }

.inicio-title { font-weight: 700; font-size: 20px; }
.inicio-meta { color: #94a3b8; font-size: 14px; }

@media (min-width: 1024px) {
  .tasks-shell { max-width: 1100px; margin: 0 auto; }
  .bottom-bar { justify-content: center; }
}
`;
