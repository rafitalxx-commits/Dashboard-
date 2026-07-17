import { useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  LayoutPanelTop,
  ListTodo,
  Plus,
  XCircle,
} from "lucide-react";

type Status = "Pendiente" | "En curso" | "Bloqueada" | "Hecha" | "Listo para responder";
type Priority = "Alta" | "Media" | "Baja";
type Category = "Dashboard" | "Odoo" | "Compras" | "Gmail" | "Amazon" | "Dominio" | "IA" | "Operaciones";

export type TaskRecord = {
  id: string;
  title: string;
  detail: string;
  category: string;
  priority: string;
  status: string;
  dueDate: string;
  reminderAt?: string;
  createdAt: string;
  updatedAt: string;
  assignee?: string;
  tags?: string[];
  attachments?: string[];
};

const COLUMNS: { key: Status; label: string }[] = [
  { key: "Pendiente", label: "Pendiente" },
  { key: "En curso", label: "En curso" },
  { key: "Bloqueada", label: "Bloqueada" },
  { key: "Hecha", label: "Hecha" },
  { key: "Listo para responder", label: "Listo para responder" },
];

const empty = (): TaskRecord => ({
  id: "",
  title: "",
  detail: "",
  category: "Operaciones",
  priority: "Media",
  status: "Pendiente",
  dueDate: new Date().toISOString().slice(0, 10),
  reminderAt: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  assignee: "",
  tags: [],
});

export function TasksKanbanBoard({
  tasks,
  onChange,
}: {
  tasks: TaskRecord[];
  onChange: (next: TaskRecord[]) => void;
}) {
  const [draft, setDraft] = useState<TaskRecord | null>(null);

  const byColumn = useMemo(() => {
    const map = new Map<Status, TaskRecord[]>();
    for (const col of COLUMNS) map.set(col.key, []);
    for (const t of tasks) {
      const list = map.get(t.status as Status);
      if (list) list.push(t); else map.get("Pendiente")?.push(t);
    }
    return map;
  }, [tasks]);

  const createTask = () => {
    const next = empty();
    setDraft(next);
  };

  const saveTask = (patch: TaskRecord) => {
    if (!patch.title.trim()) return;
    onChange(
      tasks.map((t) =>
        t.id === patch.id
          ? { ...t, ...patch, updatedAt: new Date().toISOString() }
          : t
      )
    );
    setDraft(null);
  };

  const cancelDraft = () => setDraft(null);

  const moveTask = (taskId: string, newStatus: Status) => {
    onChange(
      tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: newStatus, updatedAt: new Date().toISOString() }
          : t
      )
    );
  };

  const deleteTask = (taskId: string) => {
    onChange(tasks.filter((t) => t.id !== taskId));
  };

  return (
    <div className="tasks-board">
      <div className="toolbar">
        <div className="toolbar-left">
          <ListTodo size={16} /> <span>Tablero</span>
        </div>
        <button className="button primary" onClick={createTask}>
          <Plus size={16} /> Nueva
        </button>
      </div>

      <div className="columns">
        {COLUMNS.map((col) => (
          <div className="column" key={col.key}>
            <div className="column-header">
              <LayoutPanelTop size={14} />
              <span>{col.label}</span>
              <span className="badge">{byColumn.get(col.key)?.length ?? 0}</span>
            </div>

            <div className="cards">
              {(byColumn.get(col.key) ?? []).map((task) => (
                <div
                  className="card"
                  key={task.id}
                  draggable
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => moveTask(task.id, col.key)}
                >
                  <div className="card-meta">
                    <span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>
                    <span className="category">{task.category}</span>
                  </div>
                  <div className="title">{task.title}</div>
                  <div className="detail">{task.detail}</div>
                  <div className="footer">
                    <span className="date">
                      <CalendarDays size={12} /> {task.dueDate}
                    </span>
                    <span className="assignee">{task.assignee ?? "Sin asignar"}</span>
                    <button className="ghost" onClick={() => deleteTask(task.id)}>
                      <XCircle size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              className="ghost column-adder"
              onClick={() => {
                const next = empty();
                next.status = col.key;
                setDraft(next);
              }}
            >
              <Plus size={14} /> Añadir
            </button>
          </div>
        ))}
      </div>

      {draft && (
        <form
          className="backdrop"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const title = String(form.get("title") ?? "");
            if (!title.trim()) return;
            const task: TaskRecord = {
              id: draft.id || `task-${Date.now().toString(36)}`,
              title,
              detail: String(form.get("detail") ?? ""),
              category: String(form.get("category") ?? draft.category),
              priority: String(form.get("priority") ?? draft.priority),
              status: draft.status,
              dueDate: String(form.get("dueDate") ?? draft.dueDate),
              reminderAt: String(form.get("reminderAt") ?? ""),
              createdAt: draft.createdAt,
              updatedAt: new Date().toISOString(),
              assignee: String(form.get("assignee") ?? ""),
              tags: String(form.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
            };
            saveTask(task);
          }}
        >
          <div className="sheet">
            <div className="sheet-header">Nueva tarea</div>
            <label className="label">Título</label>
            <input className="input" name="title" placeholder="Qué hay que hacer" autoFocus />
            <label className="label">Detalle</label>
            <textarea className="input" name="detail" placeholder="Contexto extra" />
            <div className="row">
              <label className="label">
                Estado
                <select className="input" name="status" defaultValue={draft.status}>
                  {COLUMNS.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </label>
              <label className="label">
                Prioridad
                <select className="input" name="priority" defaultValue={draft.priority}>
                  {["Alta", "Media", "Baja"].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="label">
                Categoría
                <select className="input" name="category" defaultValue={draft.category}>
                  {["Dashboard","Odoo","Compras","Gmail","Amazon","Dominio","IA","Operaciones"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row">
              <label className="label">
                Vencimiento
                <input className="input" type="date" name="dueDate" defaultValue={draft.dueDate} />
              </label>
              <label className="label">
                Aviso
                <input className="input" type="datetime-local" name="reminderAt" />
              </label>
              <label className="label">
                Asignado
                <input className="input" name="assignee" placeholder="Nombre del operador" />
              </label>
            </div>
            <label className="label">Etiquetas</label>
            <input className="input" name="tags" placeholder="logging, frontend, urgente..." />
            <div className="actions">
              <button type="button" className="button" onClick={cancelDraft}>Cancelar</button>
              <button type="submit" className="button primary">Guardar</button>
            </div>
          </div>
        </form>
      )}

      <style>{css}</style>
    </div>
  );
}

const css = `
.tasks-board, .columns, .toolbar, .calendar-grid, .calendar-legend { color: inherit; }
.tasks-board {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.toolbar-left {
  display: flex;
  gap: 8px;
  align-items: center;
  font-weight: 600;
}
.columns {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 768px) {
  .columns {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
.column {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.column-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.badge {
  background: rgba(255,255,255,0.14);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 20px;
}
.card {
  background: #0f172a;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: grab;
}
.card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.priority.alta { color: #fecaca; }
.priority.media { color: #fde68a; }
.priority.baja { color: #99f6e4; }
.category {
  color: #93c5fd;
}
.title {
  font-weight: 600;
}
.detail {
  color: #cbd5e1;
  font-size: 13px;
}
.footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  color: #94a3b8;
  font-size: 12px;
}
.column-adder {
  margin-top: auto;
}
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.72);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14vh;
}
.sheet {
  background: #0b1120;
  border: 1px solid rgba(255,255,255,0.06);
  padding: 18px;
  border-radius: 14px;
  width: 980px;
  max-width: 94vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sheet-header {
  font-weight: 700;
  font-size: 16px;
}
.row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
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
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 16px;
}
.input { min-width: 0; }
textarea { min-height: 80px; }
.actions {
  display: flex;
  justify-content: stretch;
  gap: 10px;
}
.actions .button {
  flex: 1;
  text-align: center;
}
.button, .ghost {
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  color: inherit;
  padding: 12px 14px;
  border-radius: 8px;
  cursor: pointer;
  min-height: 44px;
  font-size: 15px;
}
.button.primary { background: #1d4ed8; border-color: #1d4ed8; color: white; }
.button:hover, .ghost:hover { filter: brightness(1.1); }

@media (max-width: 767px) {
  .backdrop {
    align-items: flex-end;
    padding-top: 0;
    padding-bottom: env(safe-area-inset-bottom, 12px);
  }
  .sheet {
    width: 100vw;
    max-width: 100vw;
    border-radius: 14px 14px 0 0;
    padding-bottom: 16px;
  }
  .row {
    flex-direction: column;
  }
}
`;
