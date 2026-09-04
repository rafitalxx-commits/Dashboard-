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
  InventoryReceptionsPayload,
  PurchaseReceptionsPayload,
  ReceptionOperator,
  ReceptionSession,
} from "./odooTypes";

type DashboardUserRole = "viewer" | "printer" | "admin";
const receptionsApiPath = (path: string) =>
  typeof window !== "undefined" && window.location.pathname.startsWith("/inventory-lab/")
    ? `/inventory-lab${path}`
    : path;
type DashboardPermission =
  | "dashboard"
  | "tasks"
  | "orders"
  | "expeditions"
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
type DashboardTaskPriority = "Crítica" | "Alta" | "Media" | "Baja";
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

/**
 * A proxy/service restart can briefly return an HTML error page for an API URL.
 * Never let that become a raw `Unexpected token < in JSON` crash in the UI.
 */
async function readJson<T = any>(response: Response): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    const contentType = response.headers.get("content-type") || "desconocido";
    throw new Error(
      `El servidor devolvió una respuesta no válida (${response.status}, ${contentType}). Reintenta en unos segundos.`,
    );
  }
}
const productsApi = (path = "") =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/odoo/products${path}`;
const inventoriesApi = () =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/odoo/inventories`;
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
  async getProductCatalog() {
    const response = await fetch(productsApi());
    if (!response.ok)
      throw new Error("No se pudo leer el catálogo de Productos");
    return (await readJson(response)) as CatalogStore;
  },
  async syncProductCatalog(full = false) {
    const response = await fetch(
      productsApi(`/sync${full ? "?full=true" : ""}`),
      { method: "POST" },
    );
    const payload = (await readJson(response)) as CatalogStore & {
      message?: string;
    };
    if (!response.ok)
      throw new Error(payload.message ?? "No se pudo sincronizar Productos");
    return payload;
  },
  async updateProductBarcode(productId: number, barcode: string) {
    const response = await fetch(productsApi("/barcode"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, barcode }),
    });
    const payload = (await readJson(response)) as {
      id?: number;
      name?: string;
      reference?: string;
      barcode?: string;
      message?: string;
    };
    if (!response.ok)
      throw new Error(payload.message ?? "No se pudo guardar el EAN en Odoo");
    return payload;
  },
  async getProductCatalogDetail(id: number) {
    const response = await fetch(productsApi(`/detail?id=${id}`));
    const payload = (await readJson(response)) as CatalogProductDetail & {
      message?: string;
    };
    if (!response.ok)
      throw new Error(
        payload.message ?? "No se pudo leer el detalle del producto",
      );
    return payload;
  },
  async getProductCatalogImages(ids: number[]) {
    const response = await fetch(productsApi(`/images?ids=${ids.join(",")}`));
    if (!response.ok) throw new Error("No se pudieron cargar las imágenes");
    const images = (await readJson(response)) as Record<string, string>;
    // Odoo entrega image_128 como base64 sin prefijo MIME. Un <img> necesita
    // una URL real para que la miniatura se pinte en el catálogo.
    return Object.fromEntries(
      Object.entries(images).map(([id, image]) => [
        id,
        /^(data:|https?:)/.test(image)
          ? image
          : `data:image/png;base64,${image}`,
      ]),
    );
  },
  async getProductLocations(productId: number) {
    const response = await fetch(
      productsApi(`/locations?productId=${productId}`),
    );
    const payload = (await readJson(response)) as {
      locations?: ProductLocation[];
      message?: string;
    };
    if (!response.ok)
      throw new Error(payload.message ?? "No se pudieron leer las ubicaciones");
    return payload.locations ?? [];
  },
  async saveProductLocation(
    input: Pick<ProductLocation, "productId" | "code" | "quantity"> & {
      preferred?: boolean;
      replenishmentMin?: number;
    },
  ) {
    const response = await fetch(productsApi("/locations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = (await readJson(response)) as {
      locations?: ProductLocation[];
      message?: string;
    };
    if (!response.ok)
      throw new Error(payload.message ?? "No se pudo guardar la ubicación");
    return payload.locations ?? [];
  },
  async adjustProductLocationAndOdoo(
    input: Pick<ProductLocation, "productId" | "code" | "quantity"> & {
      preferred?: boolean;
      replenishmentMin?: number;
    },
  ) {
    const response = await fetch(productsApi("/locations/adjust-odoo"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = (await readJson(response)) as { locations?: ProductLocation[]; message?: string };
    if (!response.ok) throw new Error(payload.message ?? "No se pudo ajustar el stock en Odoo");
    return payload.locations ?? [];
  },
  async removeProductLocation(productId: number, code: string) {
    const response = await fetch(productsApi("/locations"), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, code }),
    });
    const payload = (await readJson(response)) as {
      locations?: ProductLocation[];
      message?: string;
    };
    if (!response.ok)
      throw new Error(payload.message ?? "No se pudo eliminar la ubicación");
    return payload.locations ?? [];
  },
  async transferProductLocation(
    productId: number,
    fromCode: string,
    toCode: string,
    quantity: number,
  ) {
    const response = await fetch(productsApi("/locations/transfer"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, fromCode, toCode, quantity }),
    });
    const payload = (await readJson(response)) as {
      locations?: ProductLocation[];
      message?: string;
    };
    if (!response.ok)
      throw new Error(payload.message ?? "No se pudo registrar la reposición");
    return payload.locations ?? [];
  },
  async syncProductLocationMovements() {
    const response = await fetch(productsApi("/locations/sync-odoo"), {
      method: "POST",
    });
    const payload = (await readJson(response)) as {
      processed?: number;
      applied?: number;
      skipped?: number;
      warnings?: string[];
      message?: string;
    };
    if (!response.ok)
      throw new Error(payload.message ?? "No se pudieron sincronizar los movimientos de Odoo");
    return payload;
  },
  async getProductInventories() {
    const response = await fetch(inventoriesApi());
    const payload = (await readJson(response)) as {
      inventories?: import("./odooTypes").ProductInventory[];
      message?: string;
    };
    if (!response.ok)
      throw new Error(payload.message ?? "No se pudieron leer los inventarios");
    return payload.inventories ?? [];
  },
  async createProductInventory(input: {
    name: string;
    scope: import("./odooTypes").InventoryScope;
  }) {
    const response = await fetch(inventoriesApi(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload =
      (await readJson(response)) as import("./odooTypes").ProductInventory & {
        message?: string;
      };
    if (!response.ok)
      throw new Error(payload.message ?? "No se pudo crear el inventario");
    return payload;
  },
  async getProductInventory(id: string) {
    const response = await fetch(`${inventoriesApi()}/${encodeURIComponent(id)}`);
    const payload = (await readJson(response)) as import("./odooTypes").ProductInventory & { message?: string };
    if (!response.ok) throw new Error(payload.message ?? "No se pudo leer el inventario");
    return payload;
  },
  async inventoryAction(id: string, action: "start" | "review" | "validate", body: Record<string, unknown> = {}) {
    const response = await fetch(`${inventoriesApi()}/${encodeURIComponent(id)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = (await readJson(response)) as import("./odooTypes").ProductInventory & { message?: string };
    if (!response.ok) throw new Error(payload.message ?? "No se pudo actualizar el inventario");
    return payload;
  },
  async saveInventoryCount(id: string, body: { productId: number; locationCode: string; quantity: number; operator: import("./odooTypes").InventoryOperator; revision?: number }) {
    const response = await fetch(`${inventoriesApi()}/${encodeURIComponent(id)}/counts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = (await readJson(response)) as import("./odooTypes").ProductInventory & { message?: string };
    if (!response.ok) throw new Error(payload.message ?? "No se pudo guardar el conteo");
    return payload;
  },
  async startInventoryRecount(id: string, productIds: number[]) {
    const response = await fetch(`${inventoriesApi()}/${encodeURIComponent(id)}/recount`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productIds }) });
    const payload = (await readJson(response)) as import("./odooTypes").ProductInventory & { message?: string };
    if (!response.ok) throw new Error(payload.message ?? "No se pudo iniciar el reconteo");
    return payload;
  },
  async sendInventoryToOdoo(id: string, operator: import("./odooTypes").InventoryOperator) {
    const response = await fetch(`${inventoriesApi()}/${encodeURIComponent(id)}/send-odoo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operator }) });
    const payload = (await readJson(response)) as import("./odooTypes").ProductInventory & { message?: string };
    if (!response.ok) throw new Error(payload.message ?? "No se pudo enviar el inventario a Odoo");
    return payload;
  },
  async getCurrentUser() {
    try {
      const response = await fetch("/api/auth/me");
      if (!response.ok) return { authenticated: false as const };
      return (await readJson(response)) as {
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
      const payload = (await readJson(response)) as {
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
    return (await readJson(response)) as DashboardUser[];
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
    return (await readJson(response)) as DashboardUser;
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
    return (await readJson(response)) as DashboardUser;
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
    return (await readJson(response)) as DashboardTask[];
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
    return (await readJson(response)) as DashboardTask;
  },
  async updateTask(taskId: string, patch: Partial<DashboardTask>) {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error("No se pudo actualizar la tarea");
    return (await readJson(response)) as DashboardTask;
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
    return (await readJson(response)) as {
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
    return (await readJson(response)) as DashboardCalendarEvent;
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
    const payload = (await readJson(response)) as {
      ok?: boolean;
      updated?: number;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(payload.message ?? "No se pudo marcar Delivery print");
    }
    return payload;
  },
  async validateOdooDeliveries(
    orderRefs: string[],
    options?: { source?: "sendcloud" | "genei-label"; tracking?: string },
  ) {
    const response = await fetch("/api/odoo/orders/validate-delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderRefs, ...options }),
    });
    const payload = (await readJson(response)) as {
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
    const payload = (await readJson(response)) as {
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
    const payload = (await readJson(response)) as {
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
    const payload = (await readJson(response)) as {
      mode: "live" | "demo";
      order: Order | null;
      message?: string;
    };
    if (!response.ok) throw new Error(payload.message || "No se pudo cargar detalle del pedido");
    return payload;
  },
  async getOrdersPrintContext(orderRefs: string[]) {
    const response = await fetch("/api/odoo/orders/print-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderRefs }),
    });
    if (!response.ok) throw new Error("No se pudo cargar contexto de impresion");
    return (await readJson(response)) as {
      mode: "live" | "demo";
      orders: Order[];
      total: number;
      requested: number;
    };
  },
  async getDeliveryIncidents() {
    const response = await fetch("/api/odoo/orders/delivery-incidents");
    if (!response.ok) return [];
    return (await readJson(response)) as Array<{
      id: string;
      orderId: number;
      orderName?: string;
      client?: string;
      channel?: string;
      tracking?: string;
      pickingId?: string;
      pickingName?: string;
      pickingState?: string;
      labelCreatedAt?: string;
      reason: string;
      lastAttemptAt: string;
      resolvedAt?: string;
    }>;
  },
  async retryDeliveryIncidents(incidentIds?: string[]) {
    const response = await fetch("/api/odoo/orders/delivery-incidents/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentIds }),
    });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(payload.message ?? "No se pudo reintentar incidencias");
    return payload as { ok: boolean; retried: number; validated: number; incidents: unknown[] };
  },
  async resolveDeliveryIncidents(incidentIds: string[]) {
    const response = await fetch("/api/odoo/orders/delivery-incidents/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentIds }),
    });
    const payload = await readJson(response);
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

      return (await readJson(response)) as DashboardSummary;
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

    return (await readJson(response)) as DashboardSummary & {
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

      return (await readJson(response)) as {
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

    return (await readJson(response)) as {
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
    return (await readJson(response)) as OrdersV2Performance;
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
      return (await readJson(response)) as InvoiceAnalytics;
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
  async getPendingPurchases() {
    const response = await fetch(receptionsApiPath("/api/odoo/pending-purchases"));
    const payload = (await response.json()) as PurchaseReceptionsPayload;
    if (!response.ok) {
      throw new Error(payload.message ?? "No se pudieron leer las recepciones de Odoo");
    }
    return payload;
  },
  async getInventoryReceptions() {
    const response = await fetch(receptionsApiPath("/api/odoo/inventory-receptions"));
    const payload = (await response.json()) as InventoryReceptionsPayload;
    if (!response.ok) {
      throw new Error(payload.message ?? "No se pudieron leer las recepciones de Inventario");
    }
    return payload;
  },
  async getReceptionSessions() {
    const response = await fetch(receptionsApiPath("/api/odoo/reception-sessions"));
    const payload = await readJson<{ sessions?: ReceptionSession[]; message?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.message ?? "No se pudieron leer las sesiones de recepción");
    }
    return payload.sessions ?? [];
  },
  async startReceptionSession(input: {
    receptionId: string;
    receptionRef: string;
    purchaseRef: string;
    operator: ReceptionOperator;
  }) {
    const response = await fetch(receptionsApiPath("/api/odoo/reception-sessions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await readJson<ReceptionSession & { message?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.message ?? "No se pudo iniciar la recepción");
    }
    return payload;
  },
  async completeReceptionSession(receptionId: string) {
    const response = await fetch(receptionsApiPath("/api/odoo/reception-sessions"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receptionId }),
    });
    const payload = await readJson<ReceptionSession & { message?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.message ?? "No se pudo finalizar la recepción");
    }
    return payload;
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
