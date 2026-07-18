import { useState } from "react";
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
  const [taskFilter, setTaskFilter] = useState("Activas");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDetail, setNewTaskDetail] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("Operaciones");
  const [newTaskPriority, setNewTaskPriority] = useState("Media");
  const [newTaskDueDate, setNewTaskDueDate] = useState(today);
  const [newTaskReminderAt, setNewTaskReminderAt] = useState("");
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDetail, setNewEventDetail] = useState("");
  const [newEventLocation, setNewEventLocation] = useState("");
  const [newEventSource, setNewEventSource] = useState("local");
  const [newEventStartsAt, setNewEventStartsAt] = useState(`${today}T09:00`);
  const [newEventEndsAt, setNewEventEndsAt] = useState(`${today}T10:00`);
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));

  const addTaskFromForm = () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    setTasks((current) => [
      {
        id: `task-${Date.now().toString(36)}`,
        title,
        detail: newTaskDetail.trim(),
        category: newTaskCategory,
        priority: newTaskPriority,
        status: "Pendiente",
        dueDate: newTaskDueDate,
        reminderAt: newTaskReminderAt || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setNewTaskTitle("");
    setNewTaskDetail("");
  };

  const addCalendarEventFromForm = () => {
    const title = newEventTitle.trim();
    if (!title) return;
    setCalendarEvents((current) => [
      ...current,
      {
        id: `event-${Date.now().toString(36)}`,
        title,
        detail: newEventDetail.trim(),
        startsAt: newEventStartsAt,
        endsAt: newEventEndsAt,
        location: newEventLocation.trim(),
        source: "local",
      },
    ]);
    setNewEventTitle("");
    setNewEventDetail("");
    setNewEventLocation("");
  };

  return (
    <div className="hermes-preview-frame">
      <TasksView
        calendarAccounts={[
          {
            id: "local",
            label: "Preview local",
            email: "sin-produccion@preview.local",
            connected: true,
          },
        ]}
        calendarEvents={calendarEvents}
        calendarMonth={calendarMonth}
        newEventDetail={newEventDetail}
        newEventEndsAt={newEventEndsAt}
        newEventLocation={newEventLocation}
        newEventSource={newEventSource}
        newEventStartsAt={newEventStartsAt}
        newEventTitle={newEventTitle}
        newTaskCategory={newTaskCategory}
        newTaskDetail={newTaskDetail}
        newTaskDueDate={newTaskDueDate}
        newTaskPriority={newTaskPriority}
        newTaskReminderAt={newTaskReminderAt}
        newTaskTitle={newTaskTitle}
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
        onAddCalendarEventFromForm={addCalendarEventFromForm}
        onAddTask={(task) => setTasks((current) => [task as Task, ...current])}
        onAddTaskFromForm={addTaskFromForm}
        onChangeCalendarMonth={setCalendarMonth}
        onChangeNewEventDetail={setNewEventDetail}
        onChangeNewEventEndsAt={setNewEventEndsAt}
        onChangeNewEventLocation={setNewEventLocation}
        onChangeNewEventSource={setNewEventSource}
        onChangeNewEventStartsAt={setNewEventStartsAt}
        onChangeNewEventTitle={setNewEventTitle}
        onChangeNewTaskCategory={setNewTaskCategory}
        onChangeNewTaskDetail={setNewTaskDetail}
        onChangeNewTaskDueDate={setNewTaskDueDate}
        onChangeNewTaskPriority={setNewTaskPriority}
        onChangeNewTaskReminderAt={setNewTaskReminderAt}
        onChangeNewTaskTitle={setNewTaskTitle}
        onChangeTaskFilter={setTaskFilter}
        onChangeTaskSection={setTaskSection}
        onDeleteTask={(id) => setTasks((current) => current.filter((task) => task.id !== id))}
        onUpdateTask={(id, patch) => {
          setTasks((current) =>
            current.map((task) =>
              task.id === id
                ? { ...task, ...patch, updatedAt: new Date().toISOString() }
                : task,
            ),
          );
        }}
        taskFilter={taskFilter}
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
