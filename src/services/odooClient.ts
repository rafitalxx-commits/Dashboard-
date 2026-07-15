import {
  customerInvoices,
  orders,
  products,
  purchases,
  supplierInvoices,
} from "../data/demoData";
import type {
  DashboardRow,
  DashboardSummary,
  InvoiceAnalytics,
  InvoiceMetricRow,
  Order,
  OrdersSyncStats,
  OrdersV2Performance,
} from "./odooTypes";

type DashboardUserRole = "viewer" | "printer" | "admin";
type DashboardPermission =
  | "dashboard"
  | "tasks"
  | "orders"
  | "billing"
  | "supplierBilling"
  | "purchases"
  | "products"
  | "settings"
  | "odooWrite"
  | "amazonMessagesSendFinal";
type DashboardUser = {
  id: string;
  username: string;
  name: string;
  role: DashboardUserRole;
  active: boolean;
  permissions: DashboardPermission[];
};
type AuthUser = Pick<
  DashboardUser,
  "id" | "username" | "name" | "role" | "permissions"
>;
type DashboardTaskCategory =
  | "Dashboard"
  | "Odoo"
  | "Compras"
  | "Gmail"
  | "Amazon"
  | "Dominio"
  | "IA"
  | "Operaciones";
type DashboardTaskPriority = "Alta" | "Media" | "Baja";
type DashboardTaskStatus = "Pendiente" | "En curso" | "Bloqueada" | "Hecha";
type DashboardTask = {
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
};
type CalendarAccountId = "local" | "gmail1" | "gmail2";
type CalendarAccount = {
  id: CalendarAccountId;
  label: string;
  email: string;
  provider: "local" | "google";
  connected: boolean;
  status: string;
};
type DashboardCalendarEvent = {
  id: string;
  source: CalendarAccountId;
  title: string;
  detail: string;
  startsAt: string;
  endsAt: string;
  location: string;
  googleEventId?: string;
  createdAt: string;
  updatedAt: string;
};

export type OdooConnectionConfig = {
  url: string;
  database: string;
  username: string;
  apiKey: string;
  company?: string;
};

export const odooClient = {
  mode: "demo",
  async getCurrentUser() {
    try {
      const response = await fetch("/api/auth/me");
      if (!response.ok) return { authenticated: false as const };
      return (await response.json()) as {
        authenticated: boolean;
        user?: AuthUser;
      };
    } catch {
      return { authenticated: false as const };
    }
  },
  async login(username: string, password: string) {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json()) as {
        authenticated: boolean;
        user?: AuthUser;
        message?: string;
      };
      if (!response.ok) return { ...payload, authenticated: false as const };
      return payload;
    } catch (error) {
      return {
        authenticated: false as const,
        message:
          error instanceof Error ? error.message : "No se pudo iniciar sesion",
      };
    }
  },
  async logout() {
    await fetch("/api/auth/logout", { method: "POST" });
  },
  async getDashboardUsers() {
    const response = await fetch("/api/dashboard-users");
    if (!response.ok) return [];
    return (await response.json()) as DashboardUser[];
  },
  async createDashboardUser(input: {
    name: string;
    username: string;
    password: string;
    role: DashboardUserRole;
  }) {
    const response = await fetch("/api/dashboard-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("No se pudo crear el usuario");
    return (await response.json()) as DashboardUser;
  },
  async updateDashboardUser(
    userId: string,
    patch: Partial<Pick<DashboardUser, "active" | "role" | "permissions">> & {
      password?: string;
    },
  ) {
    const response = await fetch(`/api/dashboard-users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error("No se pudo actualizar el usuario");
    return (await response.json()) as DashboardUser;
  },
  async deleteDashboardUser(userId: string) {
    const response = await fetch(`/api/dashboard-users/${userId}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("No se pudo eliminar el usuario");
  },
  async getTasks() {
    const response = await fetch("/api/tasks");
    if (!response.ok) return [];
    return (await response.json()) as DashboardTask[];
  },
  async createTask(input: {
    title: string;
    detail: string;
    category: DashboardTaskCategory;
    priority: DashboardTaskPriority;
    dueDate: string;
    reminderAt: string;
  }) {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("No se pudo crear la tarea");
    return (await response.json()) as DashboardTask;
  },
  async updateTask(taskId: string, patch: Partial<DashboardTask>) {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error("No se pudo actualizar la tarea");
    return (await response.json()) as DashboardTask;
  },
  async deleteTask(taskId: string) {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("No se pudo eliminar la tarea");
  },
  async getCalendar(params?: { from?: string; to?: string }) {
    const query = new URLSearchParams();
    if (params?.from) query.set("from", params.from);
    if (params?.to) query.set("to", params.to);
    const response = await fetch(`/api/calendar?${query.toString()}`);
    if (!response.ok) {
      return { accounts: [], events: [] } as {
        accounts: CalendarAccount[];
        events: DashboardCalendarEvent[];
      };
    }
    return (await response.json()) as {
      accounts: CalendarAccount[];
      events: DashboardCalendarEvent[];
    };
  },
  async createCalendarEvent(input: {
    source: CalendarAccountId;
    title: string;
    detail: string;
    startsAt: string;
    endsAt: string;
    location: string;
  }) {
    const response = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("No se pudo crear el evento");
    return (await response.json()) as DashboardCalendarEvent;
  },
  async deleteCalendarEvent(eventId: string) {
    const response = await fetch(`/api/calendar/${eventId}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("No se pudo eliminar el evento");
  },
  async markOrdersPrinted(orderRefs: string[]) {
    const response = await fetch("/api/odoo/orders/mark-printed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderRefs }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      updated?: number;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(payload.message ?? "No se pudo marcar Delivery print");
    }
    return payload;
  },
  async validateOdooDeliveries(orderRefs: string[]) {
    const response = await fetch("/api/odoo/orders/validate-delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderRefs }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      dryRun?: boolean;
      candidates?: number;
      validables?: number;
      validated?: number;
      incidents?: Array<{ orderId: number; orderName?: string; reason: string }>;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(payload.message ?? "No se pudo validar entrega en Odoo");
    }
    return payload;
  },
  async syncOrders(params?: {
    from?: string;
    to?: string;
    search?: string;
    autoValidate?: boolean;
  }) {
    const response = await fetch("/api/odoo/orders/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params ?? {}),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      cache?: {
        updatedAt?: string;
        incidentCount?: number;
        sync?: OrdersSyncStats;
      };
      message?: string;
    };
    if (!response.ok) {
      throw new Error(payload.message ?? "No se pudo sincronizar pedidos");
    }
    return payload;
  },
  async syncOrdersV2(params?: {
    from?: string;
    to?: string;
    search?: string;
    autoValidate?: boolean;
  }) {
    const response = await fetch("/api/odoo/orders/v2/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params ?? {}),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      cache?: {
        updatedAt?: string;
        incidentCount?: number;
        sync?: OrdersSyncStats;
      };
      message?: string;
    };
    if (!response.ok) {
      throw new Error(payload.message ?? "No se pudo sincronizar Pedidos V2");
    }
    return payload;
  },
  async getOrderDetail(orderRef: string) {
    const query = new URLSearchParams({ orderRef });
    const response = await fetch(`/api/odoo/orders/detail?${query.toString()}`);
    if (!response.ok) throw new Error("No se pudo cargar detalle del pedido");
    return (await response.json()) as {
      mode: "live" | "demo";
      order: Order | null;
      message?: string;
    };
  },
  async getOrdersPrintContext(orderRefs: string[]) {
    const response = await fetch("/api/odoo/orders/print-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderRefs }),
    });
    if (!response.ok) throw new Error("No se pudo cargar contexto de impresion");
    return (await response.json()) as {
      mode: "live" | "demo";
      orders: Order[];
      total: number;
      requested: number;
    };
  },
  async getDeliveryIncidents() {
    const response = await fetch("/api/odoo/orders/delivery-incidents");
    if (!response.ok) return [];
    return (await response.json()) as Array<{
      id: string;
      orderId: number;
      orderName?: string;
      client?: string;
      channel?: string;
      tracking?: string;
      pickingId?: string;
      pickingState?: string;
      labelCreatedAt?: string;
      reason: string;
      lastAttemptAt: string;
      resolvedAt?: string;
    }>;
  },
  async retryDeliveryIncidents() {
    const response = await fetch("/api/odoo/orders/delivery-incidents/retry", {
      method: "POST",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "No se pudo reintentar incidencias");
    return payload as { ok: boolean; retried: number; validated: number; incidents: unknown[] };
  },
  async resolveDeliveryIncidents(incidentIds: string[]) {
    const response = await fetch("/api/odoo/orders/delivery-incidents/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentIds }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "No se pudo resolver incidencias");
    return payload as { ok: boolean; resolved: number };
  },
  async getDashboard(params?: { from?: string; to?: string }) {
    try {
      const query = new URLSearchParams();
      if (params?.from) query.set("from", params.from);
      if (params?.to) query.set("to", params.to);

      const response = await fetch(`/api/odoo/dashboard?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Odoo API returned ${response.status}`);
      }

      return (await response.json()) as DashboardSummary;
    } catch (error) {
      return {
        ...buildDashboardFromOrders(orders),
        mode: "demo" as const,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo conectar con Odoo",
      };
    }
  },
  async getDashboardV2(params?: { from?: string; to?: string }) {
    const query = new URLSearchParams();
    if (params?.from) query.set("from", params.from);
    if (params?.to) query.set("to", params.to);

    const response = await fetch(`/api/odoo/dashboard/v2?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Odoo V2 API returned ${response.status}`);
    }

    return (await response.json()) as DashboardSummary & {
      version?: "v2";
      metrics?: OrdersV2Performance;
    };
  },
  async getOrders(params?: {
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    search?: string;
  }) {
    try {
      const query = new URLSearchParams();
      if (params?.from) query.set("from", params.from);
      if (params?.to) query.set("to", params.to);
      if (params?.limit) query.set("limit", params.limit.toString());
      if (params?.offset) query.set("offset", params.offset.toString());
      if (params?.search) query.set("search", params.search);

      const response = await fetch(`/api/odoo/orders?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Odoo API returned ${response.status}`);
      }

      return (await response.json()) as {
        mode: "live" | "demo";
        source?: "dashboard-cache";
        orders: Order[];
        total?: number;
        limit?: number;
        offset?: number;
        cache?: {
          updatedAt?: string;
          incidentCount?: number;
          sync?: OrdersSyncStats;
        };
        message?: string;
      };
    } catch (error) {
      return {
        mode: "demo" as const,
        orders,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo conectar con Odoo",
      };
    }
  },
  async getOrdersV2(params?: {
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    search?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.from) query.set("from", params.from);
    if (params?.to) query.set("to", params.to);
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.offset) query.set("offset", params.offset.toString());
    if (params?.search) query.set("search", params.search);

    const response = await fetch(`/api/odoo/orders/v2?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Pedidos V2 API returned ${response.status}`);
    }

    return (await response.json()) as {
      mode: "live" | "demo";
      source?: "dashboard-cache";
      version?: "v2";
      orders: Order[];
      total?: number;
      limit?: number;
      offset?: number;
      cache?: {
        updatedAt?: string;
        incidentCount?: number;
        sync?: OrdersSyncStats;
      };
      metrics?: OrdersV2Performance;
      message?: string;
    };
  },
  async getOrdersV2Performance() {
    const response = await fetch("/api/odoo/orders/v2/performance");
    if (!response.ok) {
      throw new Error(`Metricas V2 API returned ${response.status}`);
    }
    return (await response.json()) as OrdersV2Performance;
  },
  async getCustomerInvoices(params?: { from?: string; to?: string; limit?: number; offset?: number; sortKey?: string; sortDir?: string }) {
    try {
      const query = new URLSearchParams();
      if (params?.from) query.set("from", params.from);
      if (params?.to) query.set("to", params.to);
      if (params?.limit) query.set("limit", params.limit.toString());
      if (params?.offset) query.set("offset", params.offset.toString());
      if (params?.sortKey) query.set("sortKey", params.sortKey);
      if (params?.sortDir) query.set("sortDir", params.sortDir);
      const response = await fetch(
        `/api/odoo/customer-invoices?${query.toString()}`,
      );
      if (!response.ok) throw new Error(`Odoo API returned ${response.status}`);
      return (await response.json()) as InvoiceAnalytics;
    } catch (error) {
      return buildInvoiceAnalyticsFromDemo(
        error instanceof Error ? error.message : "No se pudo leer facturacion",
      );
    }
  },
  async getSupplierInvoices() {
    return supplierInvoices;
  },
  async getPurchases() {
    return purchases;
  },
  async getProducts() {
    return products;
  },
};

function buildDashboardFromOrders(sourceOrders: Order[]): DashboardSummary {
  const today = new Date().toISOString().slice(0, 10);

  return {
    mode: "demo",
    totalOrders: sourceOrders.length,
    totalRevenue: sum(sourceOrders.map((order) => order.total)),
    todayOrders: sourceOrders.filter((order) => order.date === today).length,
    activeCountries: 0,
    daily: groupOrders(sourceOrders, (order) => order.date).sort(
      (left, right) => left.label.localeCompare(right.label),
    ),
    channels: groupOrders(sourceOrders, (order) => order.channel),
    countries: [],
    soldUnitsToday: sum(
      sourceOrders
        .filter((order) => order.date === today)
        .flatMap((order) => order.items.map((item) => item.quantity)),
    ),
    soldAmountToday: sum(
      sourceOrders
        .filter((order) => order.date === today)
        .flatMap((order) => order.items.map((item) => item.quantity * item.price)),
    ),
    topProducts: groupProducts(sourceOrders),
  };
}

function groupOrders(
  sourceOrders: Order[],
  getLabel: (order: Order) => string,
): DashboardRow[] {
  const rows = new Map<string, DashboardRow>();

  sourceOrders.forEach((order) => {
    const label = getLabel(order) || "Sin dato";
    const row = rows.get(label) ?? { label, orders: 0, amount: 0 };
    row.orders += 1;
    row.amount += order.total;
    rows.set(label, row);
  });

  return Array.from(rows.values()).sort(
    (left, right) => right.amount - left.amount,
  );
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function groupProducts(sourceOrders: Order[]) {
  const rows = new Map<string, { label: string; quantity: number; amount: number }>();

  sourceOrders.forEach((order) => {
    order.items.forEach((item) => {
      const label = item.name || item.sku || "Sin producto";
      const row = rows.get(label) ?? { label, quantity: 0, amount: 0 };
      row.quantity += item.quantity;
      row.amount += item.quantity * item.price;
      rows.set(label, row);
    });
  });

  return Array.from(rows.values())
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 8);
}

function buildInvoiceAnalyticsFromDemo(message?: string): InvoiceAnalytics {
  const daily = new Map<string, InvoiceMetricRow>();
  const statuses = new Map<string, InvoiceMetricRow>();
  const channels = new Map<string, InvoiceMetricRow>();
  const countries = new Map<string, InvoiceMetricRow>();

  customerInvoices.forEach((invoice) => {
    addInvoiceMetric(daily, invoice.date, invoice.total, invoice.residual ?? 0);
    addInvoiceMetric(statuses, invoice.status, invoice.total, invoice.residual ?? 0);
    addInvoiceMetric(channels, invoice.channel || "Sin canal", invoice.total, invoice.residual ?? 0);
    addInvoiceMetric(countries, invoice.country || "Sin país", invoice.total, invoice.residual ?? 0);
  });

  const demoDates = Array.from(
    new Set(customerInvoices.map((invoice) => invoice.date)),
  ).sort();
  const buildTrendSeries = (
    items: InvoiceMetricRow[],
    getLabel: (invoice: (typeof customerInvoices)[number]) => string,
  ) =>
    items.slice(0, 6).map((item) => ({
      label: item.label,
      points: demoDates.map((date) => {
        const filtered = customerInvoices.filter(
          (invoice) => invoice.date === date && getLabel(invoice) === item.label,
        );
        return {
          date,
          total: sum(filtered.map((invoice) => invoice.total)),
          residual: sum(
            filtered.map((invoice) => invoice.residual ?? invoice.total),
          ),
          count: filtered.length,
        };
      }),
    }));

  return {
    mode: "demo",
    total: customerInvoices.length,
    amountTotal: sum(customerInvoices.map((invoice) => invoice.total)),
    amountResidual: sum(
      customerInvoices.map((invoice) => invoice.residual ?? invoice.total),
    ),
    invoices: customerInvoices,
    daily: Array.from(daily.values()).sort((left, right) =>
      left.label.localeCompare(right.label),
    ),
    channels: Array.from(channels.values()).sort(
      (left, right) => right.total - left.total,
    ),
    countries: Array.from(countries.values()).sort(
      (left, right) => right.total - left.total,
    ),
    statuses: Array.from(statuses.values()).sort(
      (left, right) => right.total - left.total,
    ),
    trends: {
      channels: buildTrendSeries(
        Array.from(channels.values()).sort((a, b) => b.total - a.total),
        (invoice) => invoice.channel || "Sin canal",
      ),
      countries: buildTrendSeries(
        Array.from(countries.values()).sort((a, b) => b.total - a.total),
        (invoice) => invoice.country || "Sin pais",
      ),
      statuses: buildTrendSeries(
        Array.from(statuses.values()).sort((a, b) => b.total - a.total),
        (invoice) => invoice.status,
      ),
    },
    message,
  };
}

function addInvoiceMetric(
  rows: Map<string, InvoiceMetricRow>,
  label: string,
  total: number,
  residual: number,
) {
  const row = rows.get(label) ?? { label, count: 0, total: 0, residual: 0 };
  row.count += 1;
  row.total += total;
  row.residual += residual;
  rows.set(label, row);
}
