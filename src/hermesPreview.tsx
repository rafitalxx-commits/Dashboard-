import { useEffect, useState } from "react";
import { TasksView } from "./modules/tasks/TasksView";
import type { CalendarEvent } from "./modules/tasks/TasksCalendarView";

type Task = Parameters<typeof TasksView>[0]["tasks"][number];
type QuickNote = NonNullable<Parameters<typeof TasksView>[0]["quickNotes"]>[number];
type Reminder = NonNullable<Parameters<typeof TasksView>[0]["reminders"]>[number];
type SyncOperation = { method: "POST" | "PATCH" | "DELETE"; path: string; body?: unknown };
const syncQueueKey = "hermes-updated.sync-queue.v1";

function readSyncQueue(): SyncOperation[] {
  try { const value = JSON.parse(localStorage.getItem(syncQueueKey) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}

function writeSyncQueue(queue: SyncOperation[]) {
  localStorage.setItem(syncQueueKey, JSON.stringify(queue.slice(-200)));
}

const today = new Date().toISOString().slice(0, 10);

function shiftDay(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const initialTasks: Task[] = [
  {
    id: "hermes-001",
    title: "Revisar pedidos pendientes de imprimir",
    detail: "Comprobar filtros de sin imprimir y preparar el lote de hoy.",
    category: "Operaciones",
    priority: "Alta",
    status: "Pendiente",
    dueDate: today,
    reminderAt: `${today}T18:00`,
    createdAt: `${today}T09:00`,
    updatedAt: `${today}T09:00`,
    assignee: "Rafa",
    tags: ["Dashboard", "Odoo"],
  },
  {
    id: "hermes-002",
    title: "Responder mensaje Amazon con adjunto",
    detail: "Validar que el detalle conserva las notas y adjuntos.",
    category: "Amazon",
    priority: "Media",
    status: "En curso",
    dueDate: today,
    reminderAt: `${today}T17:30`,
    createdAt: `${today}T10:00`,
    updatedAt: `${today}T10:25`,
    assignee: "Juanito",
    tags: ["Amazon", "Cliente"],
    attachments: [
      "data:text/plain;base64,SGVybWVzIHByZXZpZXcgYWRqdW50byBkZSBwcnVlYmEu",
    ],
  },
  {
    id: "hermes-003",
    title: "Comprobar tareas vencidas",
    detail: "Esta tarjeta debe aparecer en vencidas para valorar el acceso directo.",
    category: "Dashboard",
    priority: "Crítica",
    status: "Pendiente",
    dueDate: shiftDay(-1),
    reminderAt: `${shiftDay(-1)}T12:00`,
    createdAt: `${shiftDay(-2)}T12:00`,
    updatedAt: `${shiftDay(-1)}T12:00`,
  },
  {
    id: "hermes-004",
    title: "Preparar calendario de entregas",
    detail: "Ejemplo para revisar la pestaña calendario del módulo.",
    category: "Odoo",
    priority: "Baja",
    status: "Hecha",
    dueDate: shiftDay(1),
    reminderAt: `${shiftDay(1)}T11:00`,
    createdAt: `${today}T08:30`,
    updatedAt: `${today}T13:45`,
  },
];

const initialEvents: CalendarEvent[] = [
  {
    id: "event-001",
    title: "Bloque de revisión Dashboard",
    detail: "Revisar Hermes con Rafa",
    startsAt: `${today}T17:00`,
    endsAt: `${today}T18:00`,
    location: "Dashboard",
    source: "local",
  },
];

export function HermesPreview() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [quickNotes, setQuickNotes] = useState<QuickNote[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(initialEvents);
  const [taskSection, setTaskSection] = useState<"Tareas" | "Calendario">("Tareas");

  const sendOrQueue = async (operation: SyncOperation) => {
    try {
      const response = await fetch(`/hermes-updated/api${operation.path}`, {
        method: operation.method,
        headers: operation.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: operation.body === undefined ? undefined : JSON.stringify(operation.body),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json().catch(() => undefined);
    } catch {
      writeSyncQueue([...readSyncQueue(), operation]);
      return undefined;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [taskResult, noteResult, reminderResult] = await Promise.all([
        fetch("/hermes-updated/api/tasks"), fetch("/hermes-updated/api/notes"), fetch("/hermes-updated/api/reminders"),
      ]);
      if (cancelled) return;
      if (taskResult.ok) { const payload = await taskResult.json(); const loaded = Array.isArray(payload) ? payload : payload?.tasks; if (Array.isArray(loaded)) setTasks(loaded); }
      if (noteResult.ok) { const payload = await noteResult.json(); if (Array.isArray(payload?.notes)) setQuickNotes(payload.notes); }
      if (reminderResult.ok) { const payload = await reminderResult.json(); if (Array.isArray(payload?.reminders)) setReminders(payload.reminders); }
    };
    const flush = async () => {
      const pending = readSyncQueue();
      if (!pending.length) return;
      const remaining: SyncOperation[] = [];
      for (const operation of pending) {
        try {
          const response = await fetch(`/hermes-updated/api${operation.path}`, { method: operation.method, headers: operation.body === undefined ? undefined : { "Content-Type": "application/json" }, body: operation.body === undefined ? undefined : JSON.stringify(operation.body) });
          if (!response.ok) remaining.push(operation);
        } catch { remaining.push(operation); }
      }
      writeSyncQueue(remaining);
      if (!remaining.length) await load();
    };
    void load();
    void flush();
    window.addEventListener("online", flush);
    const retry = window.setInterval(() => void flush(), 20_000);
    return () => { cancelled = true; window.removeEventListener("online", flush); window.clearInterval(retry); };
  }, []);

  const createTask = async (task: Task) => {
    setTasks((current) => [task, ...current]);
    const saved = await sendOrQueue({ method: "POST", path: "/tasks", body: task }) as Task | undefined;
    if (saved) {
        setTasks((current) =>
          current.map((item) => (item.id === task.id ? saved : item)),
        );
    }
  };

  const updateTask = async (id: string, patch: Partial<Task>) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? { ...task, ...patch, updatedAt: new Date().toISOString() }
          : task,
      ),
    );
    await sendOrQueue({ method: "PATCH", path: `/tasks/${encodeURIComponent(id)}`, body: patch });
  };

  const deleteTask = async (id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id));
    await sendOrQueue({ method: "DELETE", path: `/tasks/${encodeURIComponent(id)}` });
  };

  return (
    <div className="hermes-preview-frame">
      <TasksView
        calendarEvents={calendarEvents}
        onAddCalendarEvent={(event) => {
          setCalendarEvents((current) => [
            ...current,
            {
              id: `event-${Date.now().toString(36)}`,
              detail: "",
              source: "local",
              ...event,
            },
          ]);
        }}
        onAddTask={createTask}
        onChangeTaskSection={setTaskSection}
        onDeleteTask={deleteTask}
        onUpdateTask={updateTask}
        quickNotes={quickNotes}
        reminders={reminders}
        onCreateQuickNote={(note) => {
          setQuickNotes((current) => [note, ...current]);
          void sendOrQueue({ method: "POST", path: "/notes", body: note });
        }}
        onDeleteQuickNote={(id) => {
          setQuickNotes((current) => current.filter((note) => note.id !== id));
          void sendOrQueue({ method: "DELETE", path: `/notes/${encodeURIComponent(id)}` });
        }}
        onCreateReminder={(reminder) => {
          setReminders((current) => [...current, reminder]);
          void sendOrQueue({ method: "POST", path: "/reminders", body: reminder });
        }}
        onUpdateReminder={(id, patch) => {
          setReminders((current) => current.map((reminder) => reminder.id === id ? { ...reminder, ...patch } : reminder));
          void sendOrQueue({ method: "PATCH", path: `/reminders/${encodeURIComponent(id)}`, body: patch });
        }}
        onDeleteReminder={(id) => {
          setReminders((current) => current.filter((reminder) => reminder.id !== id));
          void sendOrQueue({ method: "DELETE", path: `/reminders/${encodeURIComponent(id)}` });
        }}
        taskSection={taskSection}
        tasks={tasks}
      />
      <style>
        {`
          html,
          body,
          #root,
          .hermes-preview-frame {
            min-height: 100%;
            background: #0b1120;
            color: #e2e8f0;
          }

          body {
            margin: 0;
          }
        `}
      </style>
    </div>
  );
}
