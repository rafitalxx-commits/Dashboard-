import type {
  DashboardTask,
  DashboardTaskCategory,
  DashboardTaskPriority,
  DashboardTaskStatus,
} from "../../../../dashboard/src/App";

export type TaskRepository = {
  listTasks: (filters?: {
    status?: DashboardTaskStatus;
    category?: DashboardTaskCategory;
    assignee?: string;
    query?: string;
  }) => Promise<DashboardTask[]>;
  getTask: (taskId: string) => Promise<DashboardTask | undefined>;
  createTask: (
    input: Partial<DashboardTask> & { createdBy: string }
  ) => Promise<DashboardTask>;
  updateTask: (
    taskId: string,
    patch: Partial<DashboardTask>
  ) => Promise<DashboardTask>;
  moveTask: (
    taskId: string,
    status: DashboardTaskStatus,
    position?: number
  ) => Promise<DashboardTask>;
  listTeamTasks: (userId: string) => Promise<DashboardTask[]>;
  addCalendarEvent: (
    taskId: string,
    event: {
      title: string;
      startsAt: string;
      endsAt: string;
      location?: string;
      googleEventId?: string;
    }
  ) => Promise<DashboardTask>;
  sendNotification: (taskId: string, channel: "telegram" | "email") => Promise<void>;
};

type TaskRow = {
  id: string;
  title: string;
  detail: string;
  category: DashboardTaskCategory;
  priority: DashboardTaskPriority;
  status: DashboardTaskStatus;
  dueDate: string;
  reminderAt: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  assignee?: string;
  tags: string[];
  estimateHours?: number;
};

const store: TaskRow[] = [];
let sequence = 0;

function nowIso() {
  return new Date().toISOString();
}

export function createInMemoryTaskRepository(): TaskRepository {
  return {
    async listTasks(filters) {
      let rows = store.slice();

      if (filters?.status) {
        rows = rows.filter((item) => item.status === filters.status);
      }
      if (filters?.category) {
        rows = rows.filter((item) => item.category === filters.category);
      }
      if (filters?.assignee) {
        rows = rows.filter((item) => item.assignee === filters.assignee);
      }
      if (filters?.query) {
        const q = filters.query.toLowerCase();
        rows = rows.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.detail.toLowerCase().includes(q)
        );
      }

      return rows.map((item) => mapRowToTask(item));
    },

    async getTask(taskId) {
      const row = store.find((item) => item.id === taskId);
      return row ? mapRowToTask(row) : undefined;
    },

    async createTask(input) {
      sequence += 1;
      const id = `task-${Date.now().toString(36)}-${sequence}`;
      const row: TaskRow = {
        id,
        title: input.title ?? "Sin titulo",
        detail: input.detail ?? "",
        category: input.category ?? "Operaciones",
        priority: input.priority ?? "Media",
        status: input.status ?? "Pendiente",
        dueDate: input.dueDate ?? todayIso(),
        reminderAt: input.reminderAt ?? "",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        createdBy: input.createdBy,
        assignee: input.assignee ?? "",
        tags: input.tags ?? [],
        estimateHours: input.estimateHours,
      };

      store.push(row);
      return mapRowToTask(row);
    },

    async updateTask(taskId, patch) {
      const row = store.find((item) => item.id === taskId);
      if (!row) throw new Error("Tarea no encontrada");
      applyPatch(row, patch);
      row.updatedAt = nowIso();
      return mapRowToTask(row);
    },

    async moveTask(taskId, status, position) {
      const row = store.find((item) => item.id === taskId);
      if (!row) throw new Error("Tarea no encontrada");
      row.status = status;
      row.updatedAt = nowIso();
      if (typeof position === "number") {
        const same = store.filter((item) => item.status === status);
        const move = same.find((item) => item.id === taskId);
        if (move) {
          const idx = store.indexOf(move);
          store.splice(idx, 1);
          const destIdx =
            store.findIndex((item) => item.status === status && item.id !== taskId) >
            -1
              ? Math.min(position, same.length)
              : store.filter((item) => item.status === status).length;
          store.splice(destIdx, 0, move);
        }
      }

      return mapRowToTask(row);
    },

    async listTeamTasks(userId) {
      return (await this.listTasks()).filter((item) => item.assignee === userId);
    },

    async addCalendarEvent(taskId, event) {
      const row = store.find((item) => item.id === taskId);
      if (!row) throw new Error("Tarea no encontrada");
      row.detail = `${row.detail}\n\nEvento: ${event.title} (${event.startsAt} -> ${event.endsAt})`.trim();
      row.updatedAt = nowIso();
      return mapRowToTask(row);
    },

    async sendNotification(taskId, channel) {
      const task = await this.getTask(taskId);
      if (!task) return;
      console.log(`[notification] channel=${channel} taskId=${task.id} title=${task.title}`);
      return;
    },
  };
}

function mapRowToTask(row: TaskRow): DashboardTask {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    category: row.category,
    priority: row.priority,
    status: row.status,
    dueDate: row.dueDate,
    reminderAt: row.reminderAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
  };
}

function applyPatch(row: TaskRow, patch: Partial<DashboardTask>) {
  const keys = Object.keys(patch) as Array<keyof TaskRow>;
  for (const key of keys) {
    if (key === "id") continue;
    if ((patch as any)[key] !== undefined) {
      (row as any)[key] = (patch as any)[key];
    }
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}


