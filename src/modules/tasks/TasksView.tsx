import { useMemo, useState } from "react";
import type {
  DashboardTask,
  DashboardTaskCategory,
  DashboardTaskPriority,
  DashboardTaskStatus,
} from "../App";
import { TasksKanbanBoard, type TaskRecord } from "./TasksKanbanBoard";
import { TasksCalendarView, type CalendarEvent } from "./TasksCalendarView";

type Section = "Tareas" | "Calendario";

export type TasksViewProps = {
  tasks: DashboardTask[];
  taskSection: Section;
  onChangeTaskSection: (value: Section) => void;
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
  };
}

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
  const [newTask, setNewTask] = useState<DashboardTask>(() => ({
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
  }));

  const handleAddTask = () => {
    if (!newTask.title.trim()) return;
    onAddTask({
      ...newTask,
      id: `task-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setNewTask({
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
    });
  };

  return (
    <>
      <div className="segmented-control" style={{ marginBottom: 16 }}>
        {(["Tareas", "Calendario"] as const).map((s) => (
          <button
            key={s}
            className={taskSection === s ? "active" : ""}
            onClick={() => onChangeTaskSection(s)}
            type="button"
          >
            {s === "Tareas" ? "Tablero" : "Calendario"}
          </button>
        ))}
      </div>

      {taskSection === "Tareas" ? (
        <TasksKanbanBoard
          tasks={tasks.map(mapTask)}
          onChange={(next) => {
            const first = next[0];
            if (first) onUpdateTask(first.id, {});
          }}
        />
      ) : (
        <TasksCalendarView
          events={calendarEvents}
          onCreate={onAddCalendarEvent}
        />
      )}
      <style>{tasksStyle}</style>
    </>
  );
}

const tasksStyle = `
.task-entry { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; background: rgba(255,255,255,0.05); margin-bottom: 8px; }
.task-field { display: flex; flex-direction: column; gap: 4px; }
.task-field input, .task-field select, .task-field textarea { background: rgba(255,255,255,0.04); color: inherit; border: 1px solid rgba(255,255,255,0.12); padding: 8px 10px; border-radius: 8px; }
.task-actions { display: flex; gap: 10px; align-items: center; }
.task-badge { padding: 4px 8px; border-radius: 999px; background: rgba(255,255,255,0.1); font-size: 12px; }
.segmented-control { display: inline-flex; gap: 8px; padding: 6px; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; background: rgba(255,255,255,0.04); }
.segmented-control button { border: none; background: transparent; color: inherit; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-weight: 500; }
.segmented-control button.active { background: #1d4ed8; color: white; }
.segmented-control button:hover:not(.active) { background: rgba(255,255,255,0.08); }
`;
