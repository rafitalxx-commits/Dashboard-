import { useEffect, useState } from "react";
import { TasksView } from "./modules/tasks/TasksView";
import type { CalendarEvent } from "./modules/tasks/TasksCalendarView";

type Task = Parameters<typeof TasksView>[0]["tasks"][number];

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
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(initialEvents);
  const [taskSection, setTaskSection] = useState<"Tareas" | "Calendario">("Tareas");

  useEffect(() => {
    let cancelled = false;
    fetch("/hermes-updated/api/tasks")
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((payload) => {
        if (cancelled) return;
        const loaded = Array.isArray(payload) ? payload : payload?.tasks;
        if (Array.isArray(loaded) && loaded.length > 0) {
          setTasks(loaded);
        }
      })
      .catch(() => {
        /* Keep seeded v4 tasks if the isolated API is unavailable. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const createTask = async (task: Task) => {
    setTasks((current) => [task, ...current]);
    try {
      const response = await fetch("/hermes-updated/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task),
      });
      if (response.ok) {
        const saved = (await response.json()) as Task;
        setTasks((current) =>
          current.map((item) => (item.id === task.id ? saved : item)),
        );
      }
    } catch {
      /* Optimistic local state keeps mobile creation usable offline. */
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
    try {
      await fetch(`/hermes-updated/api/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      /* Optimistic local state keeps mobile edits usable offline. */
    }
  };

  const deleteTask = async (id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id));
    try {
      await fetch(`/hermes-updated/api/tasks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      /* Optimistic local state keeps mobile deletes usable offline. */
    }
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
