import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { registerAgentApiRoutes } from "./backend/agentApi/routes";
import { registerAmazonMessagesRoutes } from "./backend/amazonMessages/routes";
import { registerGeneiRoutes } from "./backend/genei/routes";
import {
  getExternalOrderRef,
  getFulfillmentBy,
  getSendcloudStatuses,
  type SendcloudStatus,
} from "./backend/odooOrderContext";
import { isSendcloudReadyToValidate } from "./backend/odooDeliveryStatus";

type OdooRecord = {
  id: number;
  name?: string;
  date_order?: string;
  create_date?: string;
  write_date?: string;
  partner_id?: false | [number, string];
  partner_shipping_id?: false | [number, string];
  team_id?: false | [number, string];
  amount_total?: number;
  amount_tax?: number;
  origin?: string | false;
  client_order_ref?: string | false;
  amz_fulfillment_by?: string | false;
  state?: string;
  invoice_status?: string;
  delivery_is_printed?: boolean;
  delivery_print_count?: number;
  delivery_last_print_date?: string | false;
  picking_ids?: number[];
};

type OdooPickingRecord = {
  id: number;
  name?: string;
  state?: string;
  printed?: boolean;
  scheduled_date?: string | false;
  origin?: string;
  date_done?: string | false;
  move_ids_without_package?: number[];
};

type OdooMoveRecord = {
  id: number;
  name?: string;
  state?: string;
  product_id?: false | [number, string];
  product_uom_qty?: number;
  quantity?: number;
  picked?: boolean;
  scrapped?: boolean;
};

type OdooInvoiceRecord = {
  id: number;
  name?: string;
  invoice_date?: string | false;
  date?: string | false;
  partner_id?: false | [number, string];
  team_id?: false | [number, string];
  amount_untaxed?: number;
  amount_tax?: number;
  amount_total?: number;
  amount_residual?: number;
  payment_state?: string;
  state?: string;
  move_type?: string;
  invoice_date_due?: string | false;
  country_code?: string | false;
  invoice_origin?: string | false;
};

type OdooOrderLine = {
  id: number;
  order_id?: false | [number, string];
  product_id?: false | [number, string];
  name?: string;
  product_uom_qty?: number;
  price_unit?: number;
  price_subtotal?: number;
};

type ProductRecord = {
  id: number;
  product_tmpl_id?: false | [number, string];
  image_128?: string | false;
};

type BomRecord = {
  id: number;
  product_tmpl_id?: false | [number, string];
  product_id?: false | [number, string];
  product_qty?: number;
  type?: string;
};

type BomLineRecord = {
  id: number;
  bom_id?: false | [number, string];
  product_id?: false | [number, string];
  product_qty?: number;
  product_uom_id?: false | [number, string];
};

type PartnerRecord = {
  id: number;
  name?: string | false;
  street?: string | false;
  street2?: string | false;
  zip?: string | false;
  city?: string | false;
  country_id?: false | [number, string];
  phone?: string | false;
  mobile?: string | false;
  email?: string | false;
};

type ReadGroupRow = {
  __count?: number;
  amount_total?: number;
  amount_residual?: number;
  price_subtotal?: number;
  product_uom_qty?: number;
  team_id?: false | [number, string];
  product_id?: false | [number, string];
  partner_shipping_id?: false | [number, string];
  date_order?: string | false;
  "date_order:day"?: string | false;
  invoice_date?: string | false;
  "invoice_date:day"?: string | false;
  payment_state?: string | false;
  country_code?: string | false;
};

type DashboardUserRole = "viewer" | "printer" | "admin";
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
type StoredDashboardUser = {
  id: string;
  username: string;
  name: string;
  role: DashboardUserRole;
  active: boolean;
  passwordHash: string;
  passwordSalt: string;
  permissions: DashboardPermission[];
};
type DashboardSession = {
  id: string;
  userId: string;
  expiresAt: number;
};
type AuthStore = {
  users: StoredDashboardUser[];
  sessions: DashboardSession[];
};
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
  assignee?: string;
  tags?: string[];
  attachments?: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};
type TaskStore = {
  tasks: DashboardTask[];
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
  createdBy: string;
};
type StoredGoogleCalendarAccount = {
  refreshToken?: string;
  accessToken?: string;
  tokenExpiresAt?: number;
  email?: string;
};
type CalendarStore = {
  events: DashboardCalendarEvent[];
  google: Record<"gmail1" | "gmail2", StoredGoogleCalendarAccount>;
};

type OrdersCacheStore = {
  version: 1;
  updatedAt: string;
  range?: { from?: string; to?: string };
  sync: {
    lastStartedAt?: string;
    lastFinishedAt?: string;
    durationMs?: number;
    status: "never" | "running" | "ok" | "error";
    ordersScanned: number;
    ordersNew: number;
    ordersUpdated: number;
    sendcloudLabels: number;
    sendcloudStatuses?: number;
    sendcloudTracking?: number;
    deliveriesValidated: number;
    incidents: number;
    dryRunCandidates?: number;
    dryRunValidables?: number;
    dryRunIncidents?: number;
    triggerOrigins?: Record<string, number>;
    odooCalls: number;
    sendcloudCalls: number;
    errors: string[];
  };
  orders: Array<ReturnType<typeof buildCachedOrder>>;
  incidents: DeliveryValidationIncident[];
  audit: DeliveryValidationAuditEntry[];
  metrics: OrdersPerformanceMetric[];
};

type DeliveryValidationIncident = {
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
  resolvedBy?: string;
};

type DeliveryValidationAuditEntry = {
  id: string;
  createdAt: string;
  orderId?: number;
  orderName?: string;
  pickingId?: string;
  tracking?: string;
  mode: "manual" | "automatic";
  trigger?: "manual" | "sync-incremental" | "sync-full" | "sendcloud-webhook";
  dryRun?: boolean;
  idempotencyKey?: string;
  durationMs: number;
  result: "validated" | "incident" | "skipped" | "error";
  reason?: string;
};

type OrdersPerformanceMetric = {
  id: string;
  createdAt: string;
  scope: "home" | "orders" | "sync" | "print" | "grouping";
  durationMs: number;
  odooCalls: number;
  sendcloudCalls: number;
  orders: number;
  error?: string;
};
type LightweightOrdersSyncResult = {
  orders: Array<ReturnType<typeof buildCachedOrder>>;
  changedRefs: Set<string>;
  incremental: boolean;
};
const ORDERS_LIGHTWEIGHT_SYNC_LIMIT = 2000;

type DemandPhase =
  | "odoo"
  | "sendcloud"
  | "lines"
  | "images"
  | "bomKits"
  | "partners"
  | "serialization";
type DemandPhaseMetric = {
  phase: DemandPhase;
  durationMs: number;
  calls: number;
};
type DemandProfiler = {
  scope: "detail" | "print" | "grouping";
  startedAt: number;
  phases: Record<DemandPhase, DemandPhaseMetric>;
};

type CacheSendcloudMeta = {
  status: "not_checked" | "not_found" | "found";
  tracking: "not_checked" | "not_found" | "present";
  reference?: string;
  carrier?: string;
  checkedAt?: string;
};

const readOnlyModels = new Set([
  "account.move",
  "sale.order",
  "sale.order.line",
  "stock.picking",
  "stock.move",
  "res.partner",
  "product.product",
  "mrp.bom",
  "mrp.bom.line",
]);
const readOnlyMethods = new Set([
  "search_read",
  "search_count",
  "read",
  "fields_get",
  "read_group",
]);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), odooReadOnlyApi(env)],
    server: {
      port: 5173,
      strictPort: true,
      allowedHosts: [
        "212.47.76.180",
        "dashboard.todoelectrico.net",
        "dashboard.todoelectrico.es",
      ],
    },
  };
});

function odooReadOnlyApi(env: Record<string, string>) {
  return {
    name: "odoo-read-only-api",
    configureServer(server) {
      const auth = createAuthRepository(env);
      const tasks = createTaskRepository(env);
      const calendar = createCalendarRepository(env);
      registerGeneiRoutes(server, auth, env);
      registerAmazonMessagesRoutes(server, auth, {
        dataDir: env.DASHBOARD_DATA_DIR,
      });
      registerAgentApiRoutes(server, {
        env,
        tasks,
        amazonDataDir: env.DASHBOARD_DATA_DIR,
      });

      registerHermesUpdatedRoutes(server, env, tasks);

      server.middlewares.use("/api/auth/me", async (request, response) => {
        const user = auth.getSessionUser(request.headers.cookie);
        sendJson(response, 200, user ? { authenticated: true, user } : { authenticated: false });
      });

      server.middlewares.use("/api/auth/login", async (request, response) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { message: "Metodo no permitido" });
          return;
        }
        try {
          const payload = await readJsonBody<{
            username?: string;
            password?: string;
          }>(request);
          const result = auth.login(payload.username ?? "", payload.password ?? "");
          if (!result) {
            sendJson(response, 401, {
              authenticated: false,
              message: "Usuario o contrasena incorrectos",
            });
            return;
          }
          response.setHeader("Set-Cookie", buildSessionCookie(result.sessionId));
          sendJson(response, 200, { authenticated: true, user: result.user });
        } catch (error) {
          sendJson(response, 400, {
            authenticated: false,
            message: error instanceof Error ? error.message : "Login no valido",
          });
        }
      });

      server.middlewares.use("/api/auth/logout", async (request, response) => {
        auth.logout(request.headers.cookie);
        response.setHeader("Set-Cookie", clearSessionCookie());
        sendJson(response, 200, { ok: true });
      });

      server.middlewares.use("/api/dashboard-users", async (request, response) => {
        const user = auth.getSessionUser(request.headers.cookie);
        if (!user || !user.permissions.includes("settings")) {
          sendJson(response, 403, { message: "Sin permiso de configuracion" });
          return;
        }

        try {
          const url = new URL(request.url ?? "/", "http://local");
          const [userId] = url.pathname.split("/").filter(Boolean);

          if (request.method === "GET") {
            sendJson(response, 200, auth.listUsers());
            return;
          }

          if (request.method === "POST") {
            const payload = await readJsonBody<{
              username?: string;
              name?: string;
              password?: string;
              role?: DashboardUserRole;
            }>(request);
            sendJson(response, 201, auth.createUser(payload));
            return;
          }

          if (request.method === "PATCH" && userId) {
            const payload = await readJsonBody<{
              active?: boolean;
              role?: DashboardUserRole;
              permissions?: DashboardPermission[];
              password?: string;
            }>(request);
            if (
              userId === user.id &&
              (payload.active === false ||
                (payload.permissions &&
                  !payload.permissions.includes("settings")))
            ) {
              throw new Error("No puedes quitarte acceso a Configuracion");
            }
            sendJson(response, 200, auth.updateUser(userId, payload));
            return;
          }

          if (request.method === "DELETE" && userId) {
            auth.deleteUser(userId, user.id);
            sendJson(response, 200, { ok: true });
            return;
          }

          sendJson(response, 405, { message: "Metodo no permitido" });
        } catch (error) {
          sendJson(response, 400, {
            message:
              error instanceof Error ? error.message : "Error gestionando usuario",
          });
        }
      });

      server.middlewares.use("/api/tasks", async (request, response) => {
        const user = auth.getSessionUser(request.headers.cookie);
        if (!user || !user.permissions.includes("tasks")) {
          sendJson(response, 403, { message: "Sin permiso de tareas" });
          return;
        }

        try {
          const url = new URL(request.url ?? "/", "http://local");
          const [taskId] = url.pathname.split("/").filter(Boolean);

          if (request.method === "GET") {
            sendJson(response, 200, tasks.listTasks());
            return;
          }

          if (request.method === "POST") {
            const payload = await readJsonBody<Partial<DashboardTask>>(request);
            sendJson(response, 201, tasks.createTask(payload, user.id));
            return;
          }

          if (request.method === "PATCH" && taskId) {
            const payload = await readJsonBody<Partial<DashboardTask>>(request);
            sendJson(response, 200, tasks.updateTask(taskId, payload));
            return;
          }

          if (request.method === "DELETE" && taskId) {
            tasks.deleteTask(taskId);
            sendJson(response, 200, { ok: true });
            return;
          }

          sendJson(response, 405, { message: "Metodo no permitido" });
        } catch (error) {
          sendJson(response, 400, {
            message:
              error instanceof Error ? error.message : "Error gestionando tarea",
          });
        }
      });

      server.middlewares.use("/api/calendar/google/start", async (request, response) => {
        const user = auth.getSessionUser(request.headers.cookie);
        if (!user || !user.permissions.includes("tasks")) {
          sendJson(response, 403, { message: "Sin permiso de tareas" });
          return;
        }

        try {
          const url = new URL(request.url ?? "/", "http://local");
          const accountId = normalizeCalendarAccount(url.searchParams.get("account"));
          if (accountId === "local") throw new Error("Cuenta no valida");
          const authUrl = calendar.getGoogleAuthUrl(accountId);
          response.statusCode = 302;
          response.setHeader("Location", authUrl);
          response.end();
        } catch (error) {
          sendJson(response, 400, {
            message:
              error instanceof Error
                ? error.message
                : "No se pudo iniciar OAuth de Calendar",
          });
        }
      });

      const hermesGoogleOAuth = createHermesGoogleOAuthService(env);

      const finishGoogleCalendarCallback = async (request: any, response: any) => {
        try {
          const url = new URL(request.url ?? "/", "http://local");
          if (isHermesGoogleState(url.searchParams.get("state"))) {
            const result = await hermesGoogleOAuth.handleCallback(url, request);
            response.statusCode = 302;
            response.setHeader(
              "Location",
              `/hermes-updated?google_oauth=${encodeURIComponent(result.status)}&account=${encodeURIComponent(result.accountKey)}`,
            );
            response.end();
            return;
          }
          const accountId = normalizeCalendarAccount(url.searchParams.get("state"));
          const code = url.searchParams.get("code");
          if (accountId === "local" || !code) throw new Error("Callback OAuth no valido");
          await calendar.finishGoogleAuth(accountId, code);
          response.statusCode = 302;
          response.setHeader("Location", "/?calendar=connected");
          response.end();
        } catch (error) {
          sendJson(response, 400, {
            message:
              error instanceof Error
                ? error.message
                : "No se pudo completar OAuth de Calendar",
          });
        }
      };

      server.middlewares.use(
        "/api/calendar/google/callback",
        finishGoogleCalendarCallback,
      );

      server.middlewares.use("/oauth2/callback", finishGoogleCalendarCallback);

      server.middlewares.use("/api/calendar", async (request, response) => {
        const user = auth.getSessionUser(request.headers.cookie);
        if (!user || !user.permissions.includes("tasks")) {
          sendJson(response, 403, { message: "Sin permiso de calendario" });
          return;
        }

        try {
          const url = new URL(request.url ?? "/", "http://local");
          const [eventId] = url.pathname.split("/").filter(Boolean);

          if (request.method === "GET") {
            sendJson(response, 200, await calendar.listEvents({
              from: url.searchParams.get("from") ?? undefined,
              to: url.searchParams.get("to") ?? undefined,
            }));
            return;
          }

          if (request.method === "POST") {
            const payload = await readJsonBody<Partial<DashboardCalendarEvent>>(request);
            sendJson(response, 201, await calendar.createEvent(payload, user.id));
            return;
          }

          if (request.method === "DELETE" && eventId) {
            calendar.deleteLocalEvent(eventId);
            sendJson(response, 200, { ok: true });
            return;
          }

          sendJson(response, 405, { message: "Metodo no permitido" });
        } catch (error) {
          sendJson(response, 400, {
            message:
              error instanceof Error
                ? error.message
                : "Error gestionando calendario",
          });
        }
      });

      server.middlewares.use(
        "/api/odoo/dashboard",
        async (request, response) => {
          const user = auth.getSessionUser(request.headers.cookie);
          if (!user || !user.permissions.includes("dashboard")) {
            sendJson(response, 401, { message: "Login requerido" });
            return;
          }
          try {
            const url = new URL(request.url ?? "/", "http://local");
            if (url.pathname === "/v2") {
              const payload = await getOdooDashboardV2(env, {
                from: url.searchParams.get("from") ?? undefined,
                to: url.searchParams.get("to") ?? undefined,
              });
              sendJson(response, 200, payload);
              return;
            }
            const payload = await getOdooDashboard(env, {
              from: url.searchParams.get("from") ?? undefined,
              to: url.searchParams.get("to") ?? undefined,
            });
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(payload));
          } catch (error) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                mode: "demo",
                totalOrders: 0,
                totalRevenue: 0,
                todayOrders: 0,
                soldUnitsToday: 0,
                soldAmountToday: 0,
                activeCountries: 0,
                daily: [],
                channels: [],
                countries: [],
                topProducts: [],
                message:
                  error instanceof Error ? error.message : "Error leyendo Odoo",
              }),
            );
          }
        },
      );

      server.middlewares.use(
        "/api/odoo/customer-invoices",
        async (request, response) => {
          const user = auth.getSessionUser(request.headers.cookie);
          if (!user || !user.permissions.includes("billing")) {
            sendJson(response, 401, { message: "Login requerido" });
            return;
          }
          try {
            const url = new URL(request.url ?? "/", "http://local");
            sendJson(
              response,
              200,
              await getOdooCustomerInvoices(env, {
                from: url.searchParams.get("from") ?? undefined,
                to: url.searchParams.get("to") ?? undefined,
                limit: Number(url.searchParams.get("limit") ?? 50),
                offset: Number(url.searchParams.get("offset") ?? 0),
                sortKey: url.searchParams.get("sortKey") ?? undefined,
                sortDir: url.searchParams.get("sortDir") ?? undefined,
              }),
            );
          } catch (error) {
            sendJson(response, 500, {
              mode: "demo",
              total: 0,
              amountTotal: 0,
              amountResidual: 0,
              invoices: [],
              daily: [],
              channels: [],
              countries: [],
              statuses: [],
              trends: {
                channels: [],
                countries: [],
                statuses: [],
              },
              message:
                error instanceof Error ? error.message : "Error leyendo facturas",
            });
          }
        },
      );

      server.middlewares.use("/api/odoo/orders", async (request, response) => {
        const user = auth.getSessionUser(request.headers.cookie);
        if (!user || !user.permissions.includes("orders")) {
          sendJson(response, 401, { message: "Login requerido" });
          return;
        }
          try {
            const url = new URL(request.url ?? "/", "http://local");
            if (url.pathname === "/v2") {
              const payload = await getOdooOrdersV2(env, {
                from: url.searchParams.get("from") ?? undefined,
                to: url.searchParams.get("to") ?? undefined,
                limit: Number(url.searchParams.get("limit") ?? 80),
                offset: Number(url.searchParams.get("offset") ?? 0),
                search: url.searchParams.get("search") ?? undefined,
              });
              sendJson(response, 200, payload);
              return;
            }

            if (url.pathname === "/v2/sync") {
              if (request.method !== "POST") {
                sendJson(response, 405, { message: "Metodo no permitido" });
                return;
              }
              const payload = await readJsonBody<{
                from?: string;
                to?: string;
                search?: string;
                autoValidate?: boolean;
              }>(request);
              sendJson(
                response,
                200,
                await syncOrdersCache(env, {
                  from: payload.from,
                  to: payload.to,
                  search: payload.search,
                  autoValidate: payload.autoValidate !== false,
                }),
              );
              return;
            }

            if (url.pathname === "/v2/performance") {
              sendJson(response, 200, getOrdersV2Performance(env));
              return;
            }

            if (url.pathname === "/mark-printed") {
            if (request.method !== "POST") {
              sendJson(response, 405, { message: "Metodo no permitido" });
              return;
            }
            if (!user.permissions.includes("odooWrite")) {
              sendJson(response, 403, { message: "Sin permiso para escribir en Odoo" });
              return;
            }
            try {
              const payload = await readJsonBody<{
                orderRefs?: string[];
                orderIds?: Array<string | number>;
              }>(request);
              const orderIds = normalizeOdooOrderIds([
                ...(payload.orderRefs ?? []),
                ...(payload.orderIds ?? []),
              ]);
              sendJson(response, 200, await markOdooOrdersPrinted(env, orderIds));
            } catch (error) {
              sendJson(response, 400, {
                message:
                  error instanceof Error
                    ? error.message
                    : "No se pudo marcar Delivery print en Odoo",
              });
            }
              return;
            }

            if (url.pathname === "/validate-delivery") {
              if (request.method !== "POST") {
                sendJson(response, 405, { message: "Metodo no permitido" });
                return;
              }
              if (!user.permissions.includes("odooWrite")) {
                sendJson(response, 403, { message: "Sin permiso para escribir en Odoo" });
                return;
              }
              try {
                const payload = await readJsonBody<{
                  orderRefs?: string[];
                  orderIds?: Array<string | number>;
                  source?: "sendcloud" | "genei-label";
                  tracking?: string;
                }>(request);
                const startedAt = Date.now();
                const result = await validateOdooDeliveries(
                  env,
                  payload.orderIds ?? [],
                  payload.orderRefs ?? [],
                  {
                    source: payload.source,
                    tracking: payload.tracking,
                  },
                );
                recordManualDeliveryValidationAudit(env, result, Date.now() - startedAt);
                sendJson(response, 200, result);
              } catch (error) {
                sendJson(response, 400, {
                  message:
                    error instanceof Error
                      ? error.message
                      : "No se pudo validar entrega en Odoo",
                });
              }
              return;
            }

            if (url.pathname === "/validate-delivery-diagnosis") {
              if (request.method !== "POST") {
                sendJson(response, 405, { message: "Metodo no permitido" });
                return;
              }
              try {
                const payload = await readJsonBody<{
                  orderRefs?: string[];
                  orderIds?: Array<string | number>;
                }>(request);
                sendJson(
                  response,
                  200,
                  await diagnoseOdooDeliveryValidation(
                    env,
                    payload.orderIds ?? [],
                    payload.orderRefs ?? [],
                  ),
                );
              } catch (error) {
                sendJson(response, 400, {
                  message:
                    error instanceof Error
                      ? error.message
                      : "No se pudo diagnosticar validacion de entrega en Odoo",
                });
              }
              return;
            }

            if (url.pathname === "/sync") {
              if (request.method !== "POST") {
                sendJson(response, 405, { message: "Metodo no permitido" });
                return;
              }
              const payload = await readJsonBody<{
                from?: string;
                to?: string;
                search?: string;
                autoValidate?: boolean;
              }>(request);
              sendJson(
                response,
                200,
                await syncOrdersCache(env, {
                  from: payload.from,
                  to: payload.to,
                  search: payload.search,
                  autoValidate: payload.autoValidate !== false,
                }),
              );
              return;
            }

            if (url.pathname === "/detail") {
              const orderRef = cleanText(url.searchParams.get("orderRef"));
              if (!orderRef) {
                sendJson(response, 400, { message: "Falta orderRef" });
                return;
              }
              const profiler = createDemandProfiler("detail");
              const payload = await getOdooOrdersFull(env, {
                search: orderRef,
                limit: 1,
                offset: 0,
              }, profiler);
              sendProfiledJson(response, 200, {
                mode: payload.mode,
                order: payload.orders[0] ?? null,
                message: payload.message,
              }, profiler);
              return;
            }

            if (url.pathname === "/print-context" || url.pathname === "/grouping-context") {
              if (request.method !== "POST") {
                sendJson(response, 405, { message: "Metodo no permitido" });
                return;
              }
              const payload = await readJsonBody<{ orderRefs?: string[] }>(request);
              const scope = url.pathname === "/print-context" ? "print" : "grouping";
              const profiler = createDemandProfiler(scope);
              const context = await getOrdersDemandContext(env, payload.orderRefs ?? [], {
                scope,
                profiler,
              });
              sendProfiledJson(
                response,
                200,
                context,
                profiler,
              );
              return;
            }

            if (url.pathname === "/delivery-incidents") {
              sendJson(response, 200, readOrdersCache(env).incidents);
              return;
            }

            if (url.pathname === "/delivery-incidents/retry") {
              if (request.method !== "POST") {
                sendJson(response, 405, { message: "Metodo no permitido" });
                return;
              }
              sendJson(response, 200, await retryDeliveryIncidents(env));
              return;
            }

            if (url.pathname === "/delivery-incidents/resolve") {
              if (request.method !== "POST") {
                sendJson(response, 405, { message: "Metodo no permitido" });
                return;
              }
              const payload = await readJsonBody<{ incidentIds?: string[] }>(request);
              sendJson(response, 200, resolveDeliveryIncidents(env, payload.incidentIds ?? [], user.name));
              return;
            }

            if (url.pathname === "/open-order") {
              const orderId = Number(url.searchParams.get("orderId"));
              if (!Number.isInteger(orderId) || orderId <= 0) {
                sendJson(response, 400, { message: "Pedido Odoo no valido" });
                return;
              }
              const config = getOdooConfig(env);
              if (!config.url) {
                sendJson(response, 500, { message: "Falta ODOO_URL" });
                return;
              }
              response.statusCode = 302;
              response.setHeader(
                "Location",
                `${config.url.replace(/\/$/, "")}/web#id=${orderId}&model=sale.order&view_type=form`,
              );
              response.end();
              return;
            }

            const payload = await getOdooOrders(env, {
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 80),
            offset: Number(url.searchParams.get("offset") ?? 0),
            search: url.searchParams.get("search") ?? undefined,
          });
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(payload));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              mode: "demo",
              orders: [],
              message:
                error instanceof Error ? error.message : "Error leyendo Odoo",
            }),
          );
        }
      });

    },
  };
}

function createAuthRepository(env: Record<string, string>) {
  const developmentBypassUser = env.DASHBOARD_DEV_BYPASS_AUTH === "true"
    ? {
        id: "development-preview",
        username: "desarrollo",
        name: "Vista de desarrollo",
        role: "admin" as DashboardUserRole,
        active: true,
        permissions: permissionsForRole("admin"),
      }
    : null;
  const storePath =
    env.DASHBOARD_AUTH_STORE ||
    join(
      process.env.HOME || "/home/admin",
      ".openclaw",
      "workspace",
      ".openclaw",
      "odoo-v18-dashboard-auth.json",
    );
  const sessionTtlMs = 12 * 60 * 60 * 1000;

  const readStore = () => {
    ensureAuthStore(storePath, env);
    const store = JSON.parse(readFileSync(storePath, "utf8")) as AuthStore;
    const now = Date.now();
    const activeSessions = store.sessions.filter(
      (session) => session.expiresAt > now,
    );
    const users = store.users.map(migrateStoredUserPermissions);
    const usersChanged = users.some(
      (user, index) =>
        user.permissions.join("|") !== store.users[index].permissions.join("|"),
    );
    if (activeSessions.length !== store.sessions.length || usersChanged) {
      writeStore({ ...store, users, sessions: activeSessions });
    }
    return { ...store, users, sessions: activeSessions };
  };

  const writeStore = (store: AuthStore) => {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
      mode: 0o600,
    });
  };

  const publicUser = (user: StoredDashboardUser) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    active: user.active,
    permissions: user.permissions,
  });

  return {
    getSessionUser(cookieHeader?: string) {
      if (developmentBypassUser) return developmentBypassUser;
      const sessionId = getCookie(cookieHeader, "dashboard_session");
      if (!sessionId) return null;
      const store = readStore();
      const session = store.sessions.find((item) => item.id === sessionId);
      if (!session) return null;
      const user = store.users.find(
        (item) => item.id === session.userId && item.active,
      );
      return user ? publicUser(user) : null;
    },
    login(username: string, password: string) {
      const store = readStore();
      const normalizedUsername = normalizeUsername(username);
      const user = store.users.find(
        (item) =>
          item.active && normalizeUsername(item.username) === normalizedUsername,
      );
      if (!user || !verifyPassword(password, user)) return null;

      const session = {
        id: randomToken(),
        userId: user.id,
        expiresAt: Date.now() + sessionTtlMs,
      };
      writeStore({
        ...store,
        sessions: [...store.sessions, session],
      });
      return { sessionId: session.id, user: publicUser(user) };
    },
    logout(cookieHeader?: string) {
      const sessionId = getCookie(cookieHeader, "dashboard_session");
      if (!sessionId) return;
      const store = readStore();
      writeStore({
        ...store,
        sessions: store.sessions.filter((session) => session.id !== sessionId),
      });
    },
    listUsers() {
      return readStore().users.map(publicUser);
    },
    createUser(input: {
      username?: string;
      name?: string;
      password?: string;
      role?: DashboardUserRole;
    }) {
      const username = cleanText(input.username);
      const name = cleanText(input.name);
      const password = input.password ?? "";
      const role = normalizeRole(input.role);
      if (!username || !name || password.length < 8) {
        throw new Error("Usuario, nombre y contrasena de 8 caracteres son obligatorios");
      }

      const store = readStore();
      if (
        store.users.some(
          (user) => normalizeUsername(user.username) === normalizeUsername(username),
        )
      ) {
        throw new Error("Ese usuario ya existe");
      }

      const passwordData = hashPassword(password);
      const user: StoredDashboardUser = {
        id: randomToken(),
        username,
        name,
        role,
        active: true,
        passwordHash: passwordData.hash,
        passwordSalt: passwordData.salt,
        permissions: permissionsForRole(role),
      };
      writeStore({ ...store, users: [...store.users, user] });
      return publicUser(user);
    },
    updateUser(
      userId: string,
      patch: {
        active?: boolean;
        role?: DashboardUserRole;
        permissions?: DashboardPermission[];
        password?: string;
      },
    ) {
      const store = readStore();
      const user = store.users.find((item) => item.id === userId);
      if (!user) throw new Error("Usuario no encontrado");
      const password = patch.password ?? "";
      if (password && password.length < 8) {
        throw new Error("La nueva contrasena debe tener al menos 8 caracteres");
      }
      const role = patch.role ? normalizeRole(patch.role) : user.role;
      const permissions = patch.permissions
        ? normalizePermissions(patch.permissions)
        : patch.role
          ? permissionsForRole(role)
          : user.permissions;
      const passwordData = password ? hashPassword(password) : undefined;
      const updatedUser: StoredDashboardUser = {
        ...user,
        active:
          typeof patch.active === "boolean" ? patch.active : user.active,
        role,
        permissions,
        passwordHash: passwordData?.hash ?? user.passwordHash,
        passwordSalt: passwordData?.salt ?? user.passwordSalt,
      };
      writeStore({
        ...store,
        users: store.users.map((item) =>
          item.id === userId ? updatedUser : item,
        ),
        sessions: passwordData
          ? store.sessions.filter((session) => session.userId !== userId)
          : store.sessions,
      });
      return publicUser(updatedUser);
    },
    deleteUser(userId: string, currentUserId: string) {
      if (userId === currentUserId) throw new Error("No puedes eliminar tu propia sesion");
      const store = readStore();
      writeStore({
        users: store.users.filter((item) => item.id !== userId),
        sessions: store.sessions.filter((session) => session.userId !== userId),
      });
    },
  };
}

function createCalendarRepository(env: Record<string, string>) {
  const storePath =
    env.DASHBOARD_CALENDAR_STORE ||
    join(
      process.env.HOME || "/home/admin",
      ".openclaw",
      "workspace",
      ".openclaw",
      "odoo-v18-dashboard-calendar.json",
    );

  const readStore = () => {
    ensureCalendarStore(storePath);
    return JSON.parse(readFileSync(storePath, "utf8")) as CalendarStore;
  };

  const writeStore = (store: CalendarStore) => {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
      mode: 0o600,
    });
  };

  const getRedirectUri = () =>
    env.GOOGLE_CALENDAR_REDIRECT_URI ||
    "https://dashboard.todoelectrico.net/oauth2/callback";

  const getClientConfig = () => {
    const clientId = env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("Faltan GOOGLE_CALENDAR_CLIENT_ID y GOOGLE_CALENDAR_CLIENT_SECRET");
    }
    return { clientId, clientSecret, redirectUri: getRedirectUri() };
  };

  const getAccounts = (store: CalendarStore): CalendarAccount[] => [
    {
      id: "local",
      label: "Dashboard",
      email: "Calendario interno",
      provider: "local",
      connected: true,
      status: "Activo",
    },
    ...(["gmail1", "gmail2"] as const).map((id, index) => {
      const saved = store.google[id];
      const label =
        env[`GOOGLE_CALENDAR_ACCOUNT_${index + 1}_LABEL`] ||
        `Gmail ${index + 1}`;
      const email =
        saved.email ||
        env[`GOOGLE_CALENDAR_ACCOUNT_${index + 1}_EMAIL`] ||
        "Pendiente de conectar";
      return {
        id,
        label,
        email,
        provider: "google" as const,
        connected: Boolean(saved.refreshToken),
        status: saved.refreshToken ? "Conectado" : "OAuth pendiente",
      };
    }),
  ];

  const refreshAccessToken = async (
    accountId: "gmail1" | "gmail2",
    store: CalendarStore,
  ) => {
    const account = store.google[accountId];
    if (!account.refreshToken) throw new Error("Cuenta Gmail no conectada");
    if (account.accessToken && account.tokenExpiresAt && account.tokenExpiresAt > Date.now() + 60000) {
      return account.accessToken;
    }

    const { clientId, clientSecret } = getClientConfig();
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error("Google no devolvio access token");
    const token = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    const nextStore = readStore();
    nextStore.google[accountId] = {
      ...nextStore.google[accountId],
      accessToken: token.access_token,
      tokenExpiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    };
    writeStore(nextStore);
    return token.access_token;
  };

  const listGoogleEvents = async (
    accountId: "gmail1" | "gmail2",
    from?: string,
    to?: string,
  ) => {
    const store = readStore();
    if (!store.google[accountId].refreshToken) return [];
    const accessToken = await refreshAccessToken(accountId, store);
    const query = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "80",
      timeMin: new Date(`${from || todayIsoServer()}T00:00:00`).toISOString(),
      timeMax: new Date(`${to || addDaysIsoServer(30)}T23:59:59`).toISOString(),
    });
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) throw new Error("No se pudo leer Google Calendar");
    const payload = (await response.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        location?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        updated?: string;
        created?: string;
      }>;
    };
    return (payload.items ?? []).map((item) => ({
      id: `${accountId}-${item.id}`,
      source: accountId,
      title: item.summary || "Sin titulo",
      detail: item.description || "",
      startsAt: toDateTimeLocal(item.start?.dateTime || item.start?.date || ""),
      endsAt: toDateTimeLocal(item.end?.dateTime || item.end?.date || ""),
      location: item.location || "",
      googleEventId: item.id,
      createdAt: item.created || "",
      updatedAt: item.updated || "",
      createdBy: "google",
    })) satisfies DashboardCalendarEvent[];
  };

  return {
    getGoogleAuthUrl(accountId: "gmail1" | "gmail2") {
      const { clientId, redirectUri } = getClientConfig();
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/calendar",
        access_type: "offline",
        prompt: "consent",
        state: accountId,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    },
    async finishGoogleAuth(accountId: "gmail1" | "gmail2", code: string) {
      const { clientId, clientSecret, redirectUri } = getClientConfig();
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!response.ok) throw new Error("Google no acepto el codigo OAuth");
      const token = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      const calendarInfo = await getPrimaryCalendarInfo(token.access_token);
      const store = readStore();
      store.google[accountId] = {
        ...store.google[accountId],
        email: calendarInfo.id || calendarInfo.summary || store.google[accountId].email,
        refreshToken: token.refresh_token || store.google[accountId].refreshToken,
        accessToken: token.access_token,
        tokenExpiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
      };
      writeStore(store);
    },
    async listEvents({ from, to }: { from?: string; to?: string }) {
      const store = readStore();
      const localEvents = store.events.filter((event) => {
        const day = event.startsAt.slice(0, 10);
        return (!from || day >= from) && (!to || day <= to);
      });
      const googleEvents = (
        await Promise.allSettled([
          listGoogleEvents("gmail1", from, to),
          listGoogleEvents("gmail2", from, to),
        ])
      ).flatMap((result) => (result.status === "fulfilled" ? result.value : []));

      return {
        accounts: getAccounts(readStore()),
        events: [...localEvents, ...googleEvents].sort((left, right) =>
          left.startsAt.localeCompare(right.startsAt),
        ),
      };
    },
    async createEvent(input: Partial<DashboardCalendarEvent>, userId: string) {
      const now = new Date().toISOString();
      const source = normalizeCalendarAccount(input.source);
      const event: DashboardCalendarEvent = {
        id: randomToken(),
        source,
        title: cleanText(input.title),
        detail: cleanText(input.detail),
        startsAt: normalizeDateTime(input.startsAt) || `${todayIsoServer()}T09:00`,
        endsAt: normalizeDateTime(input.endsAt) || `${todayIsoServer()}T10:00`,
        location: cleanText(input.location),
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      };
      if (!event.title) throw new Error("El titulo del evento es obligatorio");
      if (event.endsAt <= event.startsAt) throw new Error("La hora de fin debe ser posterior");

      if (source !== "local") {
        const accountId = source;
        const store = readStore();
        const accessToken = await refreshAccessToken(accountId, store);
        const response = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              summary: event.title,
              description: event.detail,
              location: event.location,
              start: {
                dateTime: `${event.startsAt}:00`,
                timeZone: env.GOOGLE_CALENDAR_TIME_ZONE || "Europe/Madrid",
              },
              end: {
                dateTime: `${event.endsAt}:00`,
                timeZone: env.GOOGLE_CALENDAR_TIME_ZONE || "Europe/Madrid",
              },
            }),
          },
        );
        if (!response.ok) throw new Error("No se pudo crear el evento en Google Calendar");
        const created = (await response.json()) as { id?: string };
        return { ...event, googleEventId: created.id };
      }

      const store = readStore();
      writeStore({ ...store, events: [...store.events, event] });
      return event;
    },
    deleteLocalEvent(eventId: string) {
      const store = readStore();
      writeStore({
        ...store,
        events: store.events.filter((event) => event.id !== eventId || event.source !== "local"),
      });
    },
  };
}

async function getPrimaryCalendarInfo(accessToken: string) {
  try {
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return {};
    return (await response.json()) as { id?: string; summary?: string };
  } catch {
    return {};
  }
}

function registerHermesUpdatedRoutes(
  server: { middlewares: { use: Function } },
  env: Record<string, string>,
  tasks: ReturnType<typeof createTaskRepository>,
) {
  const hermesEnv = loadHermesGmailEnv(env);
  const draftStorePath =
    env.HERMES_DRAFT_STORE ||
    join(
      process.env.HOME || "/home/admin",
      ".openclaw",
      "workspace",
      ".openclaw",
      "hermes-mail-drafts.json",
    );
  const googleOAuth = createHermesGoogleOAuthService(env);

  const readDrafts = () => {
    if (!existsSync(draftStorePath)) return [];
    try {
      return JSON.parse(readFileSync(draftStorePath, "utf8")) as unknown[];
    } catch {
      return [];
    }
  };

  const saveDraft = (draft: Record<string, unknown>) => {
    const drafts = readDrafts();
    mkdirSync(dirname(draftStorePath), { recursive: true });
    writeFileSync(
      draftStorePath,
      `${JSON.stringify([draft, ...drafts].slice(0, 200), null, 2)}\n`,
      { mode: 0o600 },
    );
  };

  server.middlewares.use("/hermes-updated/api", async (request: any, response: any) => {
    try {
      const url = new URL(request.url ?? "/", "http://local");
      const parts = url.pathname.split("/").filter(Boolean);
      const [resource, id] = parts;

      if (resource === "google") {
        const action = id;
        const accountKey = parts[2] as HermesGoogleAccountKey | undefined;
        if (request.method === "GET" && action === "accounts" && !accountKey) {
          sendJson(response, 200, googleOAuth.listAccountStatuses());
          return;
        }
        if (request.method === "GET" && action === "connect" && accountKey) {
          const authUrl = googleOAuth.buildConsentUrl(accountKey, request);
          response.statusCode = 302;
          response.setHeader("Location", authUrl);
          response.end("");
          return;
        }
        if (request.method === "GET" && action === "callback") {
          const result = await googleOAuth.handleCallback(url, request);
          response.statusCode = 302;
          response.setHeader(
            "Location",
            `/hermes-updated?google_oauth=${encodeURIComponent(result.status)}&account=${encodeURIComponent(result.accountKey)}`,
          );
          response.end("");
          return;
        }
        if (request.method === "DELETE" && action === "accounts" && accountKey) {
          googleOAuth.disconnect(accountKey);
          sendJson(response, 200, { ok: true, accountKey });
          return;
        }
        sendJson(response, 404, { message: "Hermes Google OAuth route not found" });
        return;
      }

      if (request.method === "GET" && resource === "inbox") {
        const accountKey = url.searchParams.get("account") as HermesGoogleAccountKey | null;
        sendJson(
          response,
          200,
          await listHermesGmailInbox(
            hermesEnv,
            accountKey && isHermesGoogleAccountKey(accountKey)
              ? googleOAuth.configForAccount(accountKey)
              : undefined,
          ),
        );
        return;
      }

      if (resource === "tasks") {
        if (request.method === "GET") {
          sendJson(response, 200, { tasks: tasks.listTasks() });
          return;
        }
        if (request.method === "POST") {
          const payload = await readJsonBody<Partial<DashboardTask>>(request);
          sendJson(response, 201, tasks.createTask(payload, "hermes-updated"));
          return;
        }
        if (request.method === "PATCH" && id) {
          const payload = await readJsonBody<Partial<DashboardTask>>(request);
          sendJson(response, 200, tasks.updateTask(id, payload));
          return;
        }
        if (request.method === "DELETE" && id) {
          tasks.deleteTask(id);
          sendJson(response, 200, { ok: true });
          return;
        }
      }

      if (
        request.method === "POST" &&
        resource === "mail" &&
        (id === "draft" || id === "send")
      ) {
        const payload = await readJsonBody<Record<string, unknown>>(request);
        const draft = await createHermesGmailDraft(hermesEnv, {
          to: cleanText(payload.to),
          subject: cleanText(payload.subject),
          body: cleanText(payload.body),
          threadId: cleanText(payload.threadId),
        });
        saveDraft(draft);
        let sentMessageId = "";
        if (id === "send" && env.HERMES_GMAIL_SEND_ENABLED === "true") {
          sentMessageId = await sendHermesGmailDraft(hermesEnv, draft.gmailDraftId);
        }
        sendJson(response, 200, {
          ok: true,
          draft_id: draft.gmailDraftId,
          to: draft.to,
          subject: draft.subject,
          mode: id,
          sent: Boolean(sentMessageId),
          sentMessageId,
          message:
            id === "send" && env.HERMES_GMAIL_SEND_ENABLED !== "true"
              ? "Envio real Gmail deshabilitado por flag; guardado como borrador real en Gmail."
              : undefined,
        });
        return;
      }

      if (request.method === "POST" && resource === "mail" && id === "draft-reply") {
        const payload = await readJsonBody<Record<string, unknown>>(request);
        const from = cleanText(payload.from);
        const subject = cleanText(payload.subject);
        const snippet = cleanText(payload.snippet || payload.body);
        sendJson(response, 200, {
          ok: true,
          body: [
            "Hola,",
            "",
            `Gracias por tu correo${from ? `, ${from}` : ""}.`,
            snippet
              ? `He revisado el mensaje sobre "${subject || snippet.slice(0, 60)}" y lo dejamos controlado.`
              : "He revisado el mensaje y lo dejamos controlado.",
            "Te confirmo en cuanto tenga el siguiente paso cerrado.",
            "",
            "Un saludo,",
            "Rafa",
          ].join("\n"),
        });
        return;
      }

      if (request.method === "POST" && resource === "mail" && id === "summary") {
        const payload = await readJsonBody<Record<string, unknown>>(request);
        const from = cleanText(payload.from);
        const subject = cleanText(payload.subject);
        const body = cleanText(payload.body || payload.snippet);
        const compactBody = body.replace(/\s+/g, " ").slice(0, 420);
        sendJson(response, 200, {
          ok: true,
          summary: [
            subject ? `Asunto: ${subject}.` : "",
            from ? `Remitente: ${from}.` : "",
            compactBody
              ? `Resumen: ${compactBody}${body.length > compactBody.length ? "..." : ""}`
              : "Resumen: sin contenido suficiente para resumir.",
          ].filter(Boolean).join(" "),
        });
        return;
      }

      if (request.method === "POST" && resource === "telegram" && id === "send-hermes") {
        const payload = await readJsonBody<{ text?: string }>(request);
        const text = cleanText(payload.text);
        const token = env.TELEGRAM_BOT_TOKEN;
        const chatId = env.HERMES_TELEGRAM_CHAT_ID || "-1004313251535";
        if (token && text) {
          try {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text }),
            });
          } catch {
            // Keep the UI responsive even if Telegram is temporarily unavailable.
          }
        }
        sendJson(response, 200, {
          reply: token
            ? "Mensaje enviado al grupo Hermes."
            : `Hermes API activa. Mensaje recibido: ${text.slice(0, 80)}`,
        });
        return;
      }

      sendJson(response, 404, { message: "Hermes API route not found" });
    } catch (error) {
      sendJson(response, 400, {
        message: error instanceof Error ? error.message : "Error Hermes API",
      });
    }
  });
}

type HermesGoogleAccountKey = "personal" | "work";

type HermesGoogleTokenPayload = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
};

type HermesGoogleStoredAccount = {
  email: string;
  encryptedToken: string;
  connectedAt: string;
  updatedAt: string;
  scopes: string[];
};

type HermesGoogleOAuthStore = {
  version: 1;
  accounts: Partial<Record<HermesGoogleAccountKey, HermesGoogleStoredAccount>>;
};

const HERMES_GOOGLE_ACCOUNTS: Record<
  HermesGoogleAccountKey,
  { label: string; email: string }
> = {
  personal: { label: "Personal", email: "rafitalxx@gmail.com" },
  work: { label: "Trabajo", email: "todoelectrico.es@gmail.com" },
};

const HERMES_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
];

function createHermesGoogleOAuthService(env: Record<string, string>) {
  const oauthEnv = loadHermesGmailEnv(env);
  const storePath =
    env.HERMES_GOOGLE_OAUTH_STORE ||
    join(
      process.env.HOME || "/home/admin",
      ".openclaw",
      "workspace",
      ".openclaw",
      "hermes-google-oauth-store.json",
    );

  const readStore = (): HermesGoogleOAuthStore => {
    if (!existsSync(storePath)) return { version: 1, accounts: {} };
    try {
      const parsed = JSON.parse(readFileSync(storePath, "utf8")) as HermesGoogleOAuthStore;
      return {
        version: 1,
        accounts: parsed.accounts ?? {},
      };
    } catch {
      return { version: 1, accounts: {} };
    }
  };

  const writeStore = (store: HermesGoogleOAuthStore) => {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
      mode: 0o600,
    });
  };

  const getClientConfig = (accountKey?: HermesGoogleAccountKey) => {
    const accountPrefix = accountKey
      ? `HERMES_GOOGLE_${accountKey.toUpperCase()}`
      : undefined;
    const clientId =
      (accountPrefix ? oauthEnv[`${accountPrefix}_CLIENT_ID`] : undefined) ??
      oauthEnv.GMAIL_CLIENT_ID ??
      oauthEnv.GOOGLE_CLIENT_ID ??
      oauthEnv.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret =
      (accountPrefix ? oauthEnv[`${accountPrefix}_CLIENT_SECRET`] : undefined) ??
      oauthEnv.GMAIL_CLIENT_SECRET ??
      oauthEnv.GOOGLE_CLIENT_SECRET ??
      oauthEnv.GOOGLE_CALENDAR_CLIENT_SECRET;
    const encryptionSecret = oauthEnv.HERMES_GOOGLE_OAUTH_ENCRYPTION_KEY;
    return { clientId, clientSecret, encryptionSecret };
  };

  const decryptAccountToken = (
    account: HermesGoogleStoredAccount,
  ): HermesGoogleTokenPayload => {
    const { encryptionSecret } = getClientConfig();
    return decryptHermesGoogleToken(account.encryptedToken, requiredText(
      encryptionSecret,
      "HERMES_GOOGLE_OAUTH_ENCRYPTION_KEY",
    ));
  };

  return {
    listAccountStatuses() {
      const store = readStore();
      return {
        accounts: (Object.keys(HERMES_GOOGLE_ACCOUNTS) as HermesGoogleAccountKey[]).map(
          (accountKey) => {
            const { clientId, clientSecret, encryptionSecret } = getClientConfig(accountKey);
            const meta = HERMES_GOOGLE_ACCOUNTS[accountKey];
            const stored = store.accounts[accountKey];
            if (!clientId || !clientSecret || !encryptionSecret) {
              return {
                accountKey,
                label: meta.label,
                email: meta.email,
                status: "config_missing",
                connected: false,
                missing: {
                  clientId: !clientId,
                  clientSecret: !clientSecret,
                  encryptionKey: !encryptionSecret,
                },
              };
            }
            if (!stored) {
              return {
                accountKey,
                label: meta.label,
                email: meta.email,
                status: "disconnected",
                connected: false,
              };
            }
            try {
              const token = decryptAccountToken(stored);
              const expiresAtMs = token.expiresAt ? Date.parse(token.expiresAt) : 0;
              const hasRefresh = Boolean(token.refreshToken);
              return {
                accountKey,
                label: meta.label,
                email: stored.email || meta.email,
                status: hasRefresh || expiresAtMs > Date.now() ? "connected" : "token_expired",
                connected: hasRefresh || expiresAtMs > Date.now(),
                connectedAt: stored.connectedAt,
                updatedAt: stored.updatedAt,
                expiresAt: token.expiresAt,
                scopes: stored.scopes,
              };
            } catch {
              return {
                accountKey,
                label: meta.label,
                email: stored.email || meta.email,
                status: "auth_error",
                connected: false,
              };
            }
          },
        ),
      };
    },

    buildConsentUrl(accountKey: HermesGoogleAccountKey, request: any) {
      assertHermesGoogleAccountKey(accountKey);
      const { clientId, clientSecret, encryptionSecret } = getClientConfig(accountKey);
      const redirectUri = hermesGoogleRedirectUri(oauthEnv, request);
      const state = signHermesGoogleState(
        {
          accountKey,
          nonce: randomToken(),
          createdAt: new Date().toISOString(),
        },
        requiredText(encryptionSecret, "HERMES_GOOGLE_OAUTH_ENCRYPTION_KEY"),
      );
      const query = new URLSearchParams({
        client_id: requiredText(clientId, "GMAIL_CLIENT_ID"),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: HERMES_GOOGLE_SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent select_account",
        include_granted_scopes: "true",
        state,
      });
      requiredText(clientSecret, "GMAIL_CLIENT_SECRET");
      return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
    },

    async handleCallback(url: URL, request: any) {
      const { encryptionSecret } = getClientConfig();
      const error = url.searchParams.get("error");
      const stateValue = requiredText(url.searchParams.get("state") ?? "", "oauth_state");
      const state = verifyHermesGoogleState(
        stateValue,
        requiredText(encryptionSecret, "HERMES_GOOGLE_OAUTH_ENCRYPTION_KEY"),
      );
      const accountKey = state.accountKey;
      assertHermesGoogleAccountKey(accountKey);
      const { clientId, clientSecret } = getClientConfig(accountKey);
      if (error) {
        return { accountKey, status: "error" };
      }
      const code = requiredText(url.searchParams.get("code") ?? "", "oauth_code");
      const token = await exchangeHermesGoogleCode({
        code,
        clientId: requiredText(clientId, "GMAIL_CLIENT_ID"),
        clientSecret: requiredText(clientSecret, "GMAIL_CLIENT_SECRET"),
        redirectUri: hermesGoogleRedirectUri(oauthEnv, request),
      });
      const selectedEmail = await getHermesGoogleProfileEmail(token.access_token);
      const expectedEmail = HERMES_GOOGLE_ACCOUNTS[accountKey].email;
      if (selectedEmail.toLowerCase() !== expectedEmail.toLowerCase()) {
        throw new Error(
          `Cuenta Google incorrecta. Has elegido ${selectedEmail}, pero este boton espera ${expectedEmail}.`,
        );
      }
      const store = readStore();
      const existing = store.accounts[accountKey];
      let existingRefreshToken = "";
      if (existing) {
        try {
          existingRefreshToken = decryptAccountToken(existing).refreshToken ?? "";
        } catch {
          existingRefreshToken = "";
        }
      }
      const now = new Date().toISOString();
      const payload: HermesGoogleTokenPayload = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? existingRefreshToken,
        expiresAt: token.expires_in
          ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
          : undefined,
        scope: token.scope,
        tokenType: token.token_type,
      };
      if (!payload.refreshToken) {
        throw new Error("Google no devolvio refresh token. Reautoriza con prompt=consent.");
      }
      store.accounts[accountKey] = {
        email: HERMES_GOOGLE_ACCOUNTS[accountKey].email,
        encryptedToken: encryptHermesGoogleToken(
          payload,
          requiredText(encryptionSecret, "HERMES_GOOGLE_OAUTH_ENCRYPTION_KEY"),
        ),
        connectedAt: existing?.connectedAt ?? now,
        updatedAt: now,
        scopes: HERMES_GOOGLE_SCOPES,
      };
      writeStore(store);
      return { accountKey, status: "connected" };
    },

    disconnect(accountKey: HermesGoogleAccountKey) {
      assertHermesGoogleAccountKey(accountKey);
      const store = readStore();
      delete store.accounts[accountKey];
      writeStore(store);
    },

    configForAccount(accountKey: HermesGoogleAccountKey): HermesGmailConfig {
      assertHermesGoogleAccountKey(accountKey);
      const { clientId, clientSecret } = getClientConfig(accountKey);
      const stored = readStore().accounts[accountKey];
      if (!stored) throw new Error(`Cuenta Google no conectada: ${accountKey}`);
      const token = decryptAccountToken(stored);
      return {
        account: stored.email || HERMES_GOOGLE_ACCOUNTS[accountKey].email,
        clientId,
        clientSecret,
        refreshToken: token.refreshToken,
      };
    },
  };
}

function isHermesGoogleAccountKey(value: string): value is HermesGoogleAccountKey {
  return value === "personal" || value === "work";
}

function assertHermesGoogleAccountKey(value: string): asserts value is HermesGoogleAccountKey {
  if (!isHermesGoogleAccountKey(value)) {
    throw new Error("Cuenta Google no soportada");
  }
}

function hermesGoogleRedirectUri(env: HermesGmailEnv, request?: any) {
  if (env.HERMES_GOOGLE_OAUTH_REDIRECT_URI) {
    return env.HERMES_GOOGLE_OAUTH_REDIRECT_URI;
  }
  const host = request?.headers?.host ?? "dashboard.todoelectrico.net";
  const proto =
    request?.headers?.["x-forwarded-proto"] ??
    (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}/hermes-updated/api/google/callback`;
}

function hermesGoogleKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function encryptHermesGoogleToken(payload: HermesGoogleTokenPayload, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", hermesGoogleKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decryptHermesGoogleToken(value: string, secret: string): HermesGoogleTokenPayload {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Token cifrado invalido");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    hermesGoogleKey(secret),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as HermesGoogleTokenPayload;
}

function signHermesGoogleState(
  payload: { accountKey: HermesGoogleAccountKey; nonce: string; createdAt: string },
  secret: string,
) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function isHermesGoogleState(value: string | null) {
  if (!value?.includes(".")) return false;
  const [encoded] = value.split(".");
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      accountKey?: string;
    };
    return payload.accountKey === "personal" || payload.accountKey === "work";
  } catch {
    return false;
  }
}

function verifyHermesGoogleState(value: string, secret: string) {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) throw new Error("OAuth state invalido");
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error("OAuth state no verificado");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
    accountKey: string;
    nonce?: string;
    createdAt?: string;
  };
  assertHermesGoogleAccountKey(payload.accountKey);
  if (!payload.createdAt || Date.now() - Date.parse(payload.createdAt) > 15 * 60 * 1000) {
    throw new Error("OAuth state caducado");
  }
  return {
    accountKey: payload.accountKey,
    nonce: payload.nonce ?? "",
    createdAt: payload.createdAt,
  };
}

async function exchangeHermesGoogleCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    const tokenError = [payload.error, payload.error_description]
      .filter(Boolean)
      .join(": ");
    throw new Error(
      tokenError || `No se pudo completar OAuth Google (${response.status})`,
    );
  }
  return payload;
}

async function getHermesGoogleProfileEmail(accessToken: string) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${requiredText(accessToken, "access_token")}` },
  });
  const payload = (await response.json()) as {
    emailAddress?: string;
    error?: { message?: string };
  };
  if (!response.ok || !payload.emailAddress) {
    throw new Error(
      payload.error?.message ?? "No se pudo verificar la cuenta Google autorizada",
    );
  }
  return payload.emailAddress;
}

type HermesGmailEnv = Record<string, string | undefined>;

type HermesGmailConfig = {
  account: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
};

type HermesGmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: {
    mimeType?: string;
    headers?: Array<{ name?: string; value?: string }>;
    body?: { data?: string };
    parts?: HermesGmailMessage["payload"][];
  };
};

function loadHermesGmailEnv(env: Record<string, string>): HermesGmailEnv {
  return {
    ...readKeyValueEnvFile("/etc/odoo-v18-dashboard/amazon-messages-gmail.env"),
    ...process.env,
    ...env,
  };
}

function readKeyValueEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  let contents = "";
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    console.warn(
      `[hermes-gmail] No se pudo leer ${path}; se usaran solo variables de entorno ya cargadas.`,
      error instanceof Error ? error.message : error,
    );
    return {};
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt <= 0) continue;
    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function hermesGmailConfigFromEnv(env: HermesGmailEnv): HermesGmailConfig {
  return {
    account:
      env.GMAIL_ACCOUNT ??
      env.AMAZON_MESSAGES_GMAIL_ACCOUNT ??
      env.AMAZON_MESSAGES_GMAIL_DRAFT_ACCOUNT ??
      "rafitalxx@gmail.com",
    clientId:
      env.GMAIL_CLIENT_ID ??
      env.GOOGLE_CLIENT_ID ??
      env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret:
      env.GMAIL_CLIENT_SECRET ??
      env.GOOGLE_CLIENT_SECRET ??
      env.GOOGLE_CALENDAR_CLIENT_SECRET,
    refreshToken:
      env.GMAIL_REFRESH_TOKEN ??
      env.AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN ??
      env.AMAZON_MESSAGES_GMAIL_DRAFT_REFRESH_TOKEN,
  };
}

async function listHermesGmailInbox(
  env: HermesGmailEnv,
  accountConfig?: HermesGmailConfig,
) {
  const config = accountConfig ?? hermesGmailConfigFromEnv(env);
  const token = await getHermesGmailAccessToken(config);
  const query = new URLSearchParams({
    maxResults: "10",
    q: "in:inbox newer_than:30d",
  });
  const list = await hermesGmailFetch<{ messages?: Array<{ id?: string; threadId?: string }> }>(
    token,
    `/gmail/v1/users/me/messages?${query.toString()}`,
  );
  const messages = await Promise.all(
    (list.messages ?? []).filter((message) => message.id).map(async (message) => {
      const item = await hermesGmailFetch<HermesGmailMessage>(
        token,
        `/gmail/v1/users/me/messages/${encodeURIComponent(message.id ?? "")}?format=full`,
      );
      const headers = new Map(
        (item.payload?.headers ?? []).map((header) => [
          (header.name ?? "").toLowerCase(),
          header.value ?? "",
        ]),
      );
      return {
        id: item.id,
        threadId: item.threadId,
        from: headers.get("from") ?? "",
        to: headers.get("to") ?? config.account,
        subject: headers.get("subject") ?? "",
        date: headers.get("date")
          ? new Date(headers.get("date") ?? "").toISOString()
          : item.internalDate
            ? new Date(Number(item.internalDate)).toISOString()
            : new Date().toISOString(),
        snippet: item.snippet ?? "",
        read: !(item.labelIds ?? []).includes("UNREAD"),
        body: extractHermesGmailBody(item.payload) || item.snippet || "",
      };
    }),
  );
  return { account: config.account, messages };
}

async function createHermesGmailDraft(
  env: HermesGmailEnv,
  input: { to: string; subject: string; body: string; threadId?: string },
) {
  if (!input.to || !input.subject || !input.body) {
    throw new Error("Faltan Para, Asunto o Mensaje.");
  }
  const config = hermesGmailConfigFromEnv(env);
  const token = await getHermesGmailAccessToken(config);
  const draft = await hermesGmailFetch<{
    id?: string;
    message?: { id?: string; threadId?: string };
  }>(token, "/gmail/v1/users/me/drafts", {
    method: "POST",
    body: JSON.stringify({
      message: {
        raw: encodeBase64Url(
          [
            `From: ${config.account}`,
            `To: ${input.to}`,
            `Subject: ${encodeMimeHeader(input.subject)}`,
            "MIME-Version: 1.0",
            'Content-Type: text/plain; charset="UTF-8"',
            "Content-Transfer-Encoding: 8bit",
            "",
            input.body,
          ].join("\r\n"),
        ),
        threadId: input.threadId || undefined,
      },
    }),
  });
  return {
    id: `gmail-draft-${Date.now()}`,
    gmailDraftId: requiredText(draft.id, "gmailDraftId"),
    gmailMessageId: draft.message?.id,
    threadId: draft.message?.threadId ?? input.threadId,
    mode: "draft",
    to: input.to,
    subject: input.subject,
    body: input.body,
    account: config.account,
    createdAt: new Date().toISOString(),
  };
}

async function sendHermesGmailDraft(env: HermesGmailEnv, draftId?: string) {
  const config = hermesGmailConfigFromEnv(env);
  const token = await getHermesGmailAccessToken(config);
  const sent = await hermesGmailFetch<{ id?: string }>(
    token,
    "/gmail/v1/users/me/drafts/send",
    {
      method: "POST",
      body: JSON.stringify({ id: requiredText(draftId, "gmailDraftId") }),
    },
  );
  return requiredText(sent.id, "sentMessageId");
}

async function getHermesGmailAccessToken(config: HermesGmailConfig) {
  const body = new URLSearchParams({
    client_id: requiredText(config.clientId, "GMAIL_CLIENT_ID"),
    client_secret: requiredText(config.clientSecret, "GMAIL_CLIENT_SECRET"),
    refresh_token: requiredText(config.refreshToken, "GMAIL_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ??
        payload.error ??
        "No se pudo obtener access token Gmail",
    );
  }
  return payload.access_token;
}

async function hermesGmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Error leyendo Gmail API");
  }
  return payload;
}

function extractHermesGmailBody(payload?: HermesGmailMessage["payload"]): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const text = extractHermesGmailBody(part);
    if (text) return text;
  }
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeMimeHeader(value: string) {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function requiredText(value: string | undefined, field: string) {
  if (!value) throw new Error(`Campo requerido: ${field}`);
  return value;
}

function ensureCalendarStore(storePath: string) {
  if (existsSync(storePath)) return;
  const now = new Date().toISOString();
  const store: CalendarStore = {
    events: [
      {
        id: randomToken(),
        source: "local",
        title: "Conectar 2 cuentas Gmail Calendar",
        detail:
          "Crear OAuth client web, activar Google Calendar API y conectar las dos cuentas desde Tareas.",
        startsAt: "2026-06-10T11:30",
        endsAt: "2026-06-10T12:00",
        location: "Dashboard",
        createdAt: now,
        updatedAt: now,
        createdBy: "system",
      },
    ],
    google: { gmail1: {}, gmail2: {} },
  };
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
}

function createTaskRepository(env: Record<string, string>) {
  const storePath =
    env.DASHBOARD_TASK_STORE ||
    join(
      process.env.HOME || "/home/admin",
      ".openclaw",
      "workspace",
      ".openclaw",
      "odoo-v18-dashboard-tasks.json",
    );

  const readStore = () => {
    ensureTaskStore(storePath);
    return JSON.parse(readFileSync(storePath, "utf8")) as TaskStore;
  };

  const writeStore = (store: TaskStore) => {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
      mode: 0o600,
    });
  };

  return {
    listTasks() {
      return readStore().tasks.sort(sortTasks);
    },
    createTask(input: Partial<DashboardTask>, userId: string) {
      const now = new Date().toISOString();
      const task: DashboardTask = {
        id: randomToken(),
        title: cleanText(input.title),
        detail: cleanText(input.detail),
        category: normalizeTaskCategory(input.category),
        priority: normalizeTaskPriority(input.priority),
        status: normalizeTaskStatus(input.status),
        dueDate: normalizeDate(input.dueDate),
        reminderAt: normalizeDateTime(input.reminderAt),
        assignee: cleanText(input.assignee),
        tags: Array.isArray(input.tags) ? input.tags.map(cleanText).filter(Boolean) : [],
        attachments: Array.isArray(input.attachments)
          ? input.attachments.map(cleanText).filter(Boolean)
          : [],
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      };
      if (!task.title) throw new Error("El titulo de la tarea es obligatorio");
      const store = readStore();
      writeStore({ tasks: [...store.tasks, task] });
      return task;
    },
    updateTask(taskId: string, patch: Partial<DashboardTask>) {
      const store = readStore();
      const task = store.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("Tarea no encontrada");
      const updated: DashboardTask = {
        ...task,
        title: patch.title === undefined ? task.title : cleanText(patch.title),
        detail:
          patch.detail === undefined ? task.detail : cleanText(patch.detail),
        category:
          patch.category === undefined
            ? task.category
            : normalizeTaskCategory(patch.category),
        priority:
          patch.priority === undefined
            ? task.priority
            : normalizeTaskPriority(patch.priority),
        status:
          patch.status === undefined
            ? task.status
            : normalizeTaskStatus(patch.status),
        dueDate:
          patch.dueDate === undefined ? task.dueDate : normalizeDate(patch.dueDate),
        reminderAt:
          patch.reminderAt === undefined
            ? task.reminderAt
            : normalizeDateTime(patch.reminderAt),
        assignee:
          patch.assignee === undefined ? task.assignee : cleanText(patch.assignee),
        tags:
          patch.tags === undefined
            ? task.tags
            : Array.isArray(patch.tags)
              ? patch.tags.map(cleanText).filter(Boolean)
              : [],
        attachments:
          patch.attachments === undefined
            ? task.attachments
            : Array.isArray(patch.attachments)
              ? patch.attachments.map(cleanText).filter(Boolean)
              : [],
        updatedAt: new Date().toISOString(),
      };
      if (!updated.title) throw new Error("El titulo de la tarea es obligatorio");
      writeStore({
        tasks: store.tasks.map((item) => (item.id === taskId ? updated : item)),
      });
      return updated;
    },
    deleteTask(taskId: string) {
      const store = readStore();
      writeStore({ tasks: store.tasks.filter((item) => item.id !== taskId) });
    },
  };
}

function ensureTaskStore(storePath: string) {
  if (existsSync(storePath)) return;
  const now = new Date().toISOString();
  const seedTasks: Array<
    Omit<DashboardTask, "id" | "createdAt" | "updatedAt" | "createdBy">
  > = [
    {
      title: "Crear registro DNS dashboard.todoelectrico.es",
      detail:
        "En DonDominio crear A record: host dashboard -> 212.47.76.180. Despues activar proxy HTTPS.",
      category: "Dominio",
      priority: "Alta",
      status: "Pendiente",
      dueDate: "2026-06-10",
      reminderAt: "2026-06-10T10:00",
    },
    {
      title: "Configurar OAuth JSON para Gmail readonly",
      detail:
        "Crear OAuth client tipo Aplicacion de escritorio, activar Gmail API y entregar el JSON para autorizar juanitoopenclaw@gmail.com.",
      category: "Gmail",
      priority: "Alta",
      status: "Bloqueada",
      dueDate: "2026-06-10",
      reminderAt: "2026-06-10T11:00",
    },
    {
      title: "Cambiar contrasena temporal del dashboard",
      detail:
        "Anadir pantalla de cambio de contrasena para sustituir la clave temporal del usuario rafa.",
      category: "Dashboard",
      priority: "Alta",
      status: "Pendiente",
      dueDate: "2026-06-10",
      reminderAt: "",
    },
    {
      title: "Activar HTTPS y proxy del dashboard",
      detail:
        "Cuando el subdominio resuelva, configurar proxy con certificado y mantener systemd como servicio estable.",
      category: "Dominio",
      priority: "Alta",
      status: "Bloqueada",
      dueDate: "2026-06-11",
      reminderAt: "",
    },
    {
      title: "Crear Centro Operativo IA",
      detail:
        "Nueva seccion Asistente IA: insights Odoo, compras sugeridas, incidencias y cola de confirmaciones.",
      category: "IA",
      priority: "Media",
      status: "Pendiente",
      dueDate: "2026-06-12",
      reminderAt: "",
    },
    {
      title: "Preparar gestion de compras asistida",
      detail:
        "Definir reglas: stock minimo, venta reciente, proveedor, coste, margen y propuesta de cantidad sin comprar automaticamente.",
      category: "Compras",
      priority: "Media",
      status: "Pendiente",
      dueDate: "2026-06-13",
      reminderAt: "",
    },
    {
      title: "Conectar mensajes de Amazon",
      detail:
        "Investigar acceso a mensajes Amazon/Seller Central y traerlos a una bandeja de atencion sin responder automaticamente.",
      category: "Amazon",
      priority: "Media",
      status: "Pendiente",
      dueDate: "2026-06-14",
      reminderAt: "",
    },
    {
      title: "Crear avisos Telegram para tareas",
      detail:
        "Fase 2: cron/OpenClaw revisa vencimientos y avisa por Telegram sin spamear.",
      category: "Operaciones",
      priority: "Media",
      status: "Pendiente",
      dueDate: "2026-06-14",
      reminderAt: "",
    },
  ];
  const store: TaskStore = {
    tasks: seedTasks.map((task) => ({
      ...task,
      id: randomToken(),
      createdAt: now,
      updatedAt: now,
      createdBy: "system",
    })),
  };
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
}

function normalizeTaskCategory(value?: string): DashboardTaskCategory {
  const allowed: DashboardTaskCategory[] = [
    "Dashboard",
    "Odoo",
    "Compras",
    "Gmail",
    "Amazon",
    "Dominio",
    "IA",
    "Operaciones",
  ];
  return allowed.includes(value as DashboardTaskCategory)
    ? (value as DashboardTaskCategory)
    : "Operaciones";
}

function normalizeTaskPriority(value?: string): DashboardTaskPriority {
  return value === "Crítica" || value === "Alta" || value === "Baja"
    ? value
    : "Media";
}

function normalizeTaskStatus(value?: string): DashboardTaskStatus {
  if (
    value === "En curso" ||
    value === "Bloqueada" ||
    value === "Hecha"
  ) {
    return value;
  }
  return "Pendiente";
}

function normalizeDate(value?: string) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : "";
}

function normalizeDateTime(value?: string) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? value
    : "";
}

function normalizeCalendarAccount(value?: string | null): CalendarAccountId {
  if (value === "gmail1" || value === "gmail2") return value;
  return "local";
}

function todayIsoServer() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIsoServer(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function toDateTimeLocal(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00`;
  return value.slice(0, 16);
}

function sortTasks(left: DashboardTask, right: DashboardTask) {
  const statusRank: Record<DashboardTaskStatus, number> = {
    Bloqueada: 0,
    "En curso": 1,
    Pendiente: 2,
    Hecha: 3,
  };
  const priorityRank: Record<DashboardTaskPriority, number> = {
    Crítica: 0,
    Alta: 1,
    Media: 2,
    Baja: 3,
  };
  return (
    statusRank[left.status] - statusRank[right.status] ||
    priorityRank[left.priority] - priorityRank[right.priority] ||
    (left.dueDate || "9999-12-31").localeCompare(
      right.dueDate || "9999-12-31",
    ) ||
    left.title.localeCompare(right.title)
  );
}

function ensureAuthStore(storePath: string, env: Record<string, string>) {
  if (existsSync(storePath)) return;
  const username = env.DASHBOARD_ADMIN_USERNAME || "admin";
  const password = env.DASHBOARD_ADMIN_PASSWORD || "Cambiar-Esta-Clave-2026";
  const passwordData = hashPassword(password);
  const store: AuthStore = {
    users: [
      {
        id: randomToken(),
        username,
        name: env.DASHBOARD_ADMIN_NAME || "Rafa",
        role: "admin",
        active: true,
        passwordHash: passwordData.hash,
        passwordSalt: passwordData.salt,
        permissions: permissionsForRole("admin"),
      },
    ],
    sessions: [],
  };
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
}

function permissionsForRole(role: DashboardUserRole): DashboardPermission[] {
  if (role === "admin") {
    return [
      "dashboard",
      "tasks",
      "orders",
      "expeditions",
      "billing",
      "supplierBilling",
      "purchases",
      "products",
      "settings",
      "odooWrite",
      "amazonMessagesSendFinal",
    ];
  }
  if (role === "printer") return ["dashboard", "orders", "expeditions", "odooWrite"];
  return ["dashboard", "orders"];
}

function normalizePermissions(values: DashboardPermission[]) {
  const allowed = new Set<DashboardPermission>([
    "dashboard",
    "tasks",
    "orders",
    "expeditions",
    "billing",
    "supplierBilling",
    "purchases",
    "products",
    "settings",
    "odooWrite",
    "amazonMessagesSendFinal",
  ]);
  return Array.from(new Set(values.filter((value) => allowed.has(value))));
}

function migrateStoredUserPermissions(user: StoredDashboardUser): StoredDashboardUser {
  const permissions = normalizePermissions(user.permissions);
  if (
    (user.role === "admin" || user.role === "printer") &&
    !permissions.includes("expeditions")
  ) {
    permissions.push("expeditions");
  }
  return permissions.join("|") === user.permissions.join("|")
    ? user
    : { ...user, permissions };
}

function normalizeRole(role?: DashboardUserRole) {
  return role === "admin" || role === "printer" || role === "viewer"
    ? role
    : "viewer";
}

function hashPassword(password: string, salt = randomToken()) {
  return {
    salt,
    hash: createHash("sha256").update(`${salt}:${password}`).digest("hex"),
  };
}

function verifyPassword(password: string, user: StoredDashboardUser) {
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(hashPassword(password, user.passwordSalt).hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function randomToken() {
  return randomBytes(24).toString("hex");
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function getCookie(header: string | undefined, name: string) {
  return (header ?? "")
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function buildSessionCookie(sessionId: string) {
  return `dashboard_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`;
}

function clearSessionCookie() {
  return "dashboard_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

async function readJsonBody<T>(request: { on: Function }): Promise<T> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", resolve);
    request.on("error", reject);
  });
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function sendJson(
  response: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body: string) => void;
  },
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function sendProfiledJson(
  response: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body: string) => void;
  },
  statusCode: number,
  payload: Record<string, unknown>,
  profiler: DemandProfiler,
) {
  const previewPayload = { ...payload, performance: finishDemandProfiler(profiler) };
  measureDemandPhaseSync(profiler, "serialization", 0, () =>
    JSON.stringify(previewPayload),
  );
  sendJson(response, statusCode, {
    ...payload,
    performance: finishDemandProfiler(profiler),
  });
}

function createDemandProfiler(scope: DemandProfiler["scope"]): DemandProfiler {
  const phases = {} as Record<DemandPhase, DemandPhaseMetric>;
  ([
    "odoo",
    "sendcloud",
    "lines",
    "images",
    "bomKits",
    "partners",
    "serialization",
  ] as DemandPhase[]).forEach((phase) => {
    phases[phase] = { phase, durationMs: 0, calls: 0 };
  });
  return {
    scope,
    startedAt: performance.now(),
    phases,
  };
}

async function measureDemandPhase<T>(
  profiler: DemandProfiler | undefined,
  phase: DemandPhase,
  calls: number,
  fn: () => Promise<T>,
) {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    addDemandPhase(profiler, phase, performance.now() - startedAt, calls);
  }
}

function measureDemandPhaseSync<T>(
  profiler: DemandProfiler | undefined,
  phase: DemandPhase,
  calls: number,
  fn: () => T,
) {
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    addDemandPhase(profiler, phase, performance.now() - startedAt, calls);
  }
}

function addDemandPhase(
  profiler: DemandProfiler | undefined,
  phase: DemandPhase,
  durationMs: number,
  calls: number,
) {
  if (!profiler) return;
  profiler.phases[phase].durationMs += durationMs;
  profiler.phases[phase].calls += calls;
}

async function executeKwProfiled(
  profiler: DemandProfiler | undefined,
  phase: DemandPhase,
  config: ReturnType<typeof getOdooConfig>,
  uid: number,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
) {
  return measureDemandPhase(profiler, phase, 1, () =>
    executeKw(config, uid, model, method, args, kwargs),
  );
}

function finishDemandProfiler(profiler: DemandProfiler) {
  const phases = Object.values(profiler.phases).map((phase) => ({
    phase: phase.phase,
    durationMs: Math.round(phase.durationMs),
    calls: phase.calls,
  }));
  return {
    scope: profiler.scope,
    totalMs: Math.round(performance.now() - profiler.startedAt),
    totalCalls: {
      odoo: phases
        .filter((phase) => phase.phase !== "sendcloud" && phase.phase !== "serialization")
        .reduce((total, phase) => total + phase.calls, 0),
      sendcloud: profiler.phases.sendcloud.calls,
    },
    phases,
  };
}

async function getOdooOrdersFull(
  env: Record<string, string>,
  range: {
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    search?: string;
  },
  profiler?: DemandProfiler,
) {
  const config = getOdooConfig(env);
  if (!config.url || !config.database || !config.username || !config.apiKey) {
    return {
      mode: "demo",
      orders: [],
      message:
        "Faltan variables ODOO_URL, ODOO_DATABASE, ODOO_USERNAME u ODOO_API_KEY",
    };
  }

  const uid = await measureDemandPhase(profiler, "odoo", 1, () =>
    authenticate(config),
  );
  const domain = buildOrderDomain(range);
  const limit = clampNumber(range.limit ?? 80, 1, 500);
  const offset = Math.max(
    0,
    Number.isFinite(range.offset ?? 0) ? (range.offset ?? 0) : 0,
  );

  const total = (await executeKwProfiled(profiler, "odoo", config, uid, "sale.order", "search_count", [
    domain,
  ])) as number;
  const saleOrders = (await executeKwProfiled(
    profiler,
    "odoo",
    config,
    uid,
    "sale.order",
    "search_read",
    [domain],
    {
      fields: [
        "id",
        "name",
        "date_order",
        "partner_id",
        "partner_shipping_id",
        "team_id",
        "amount_total",
        "amount_tax",
        "origin",
        "client_order_ref",
        "amz_fulfillment_by",
        "state",
        "invoice_status",
        "delivery_is_printed",
        "delivery_print_count",
        "delivery_last_print_date",
        "picking_ids",
      ],
      order: "date_order desc",
      limit,
      offset,
    },
  )) as OdooRecord[];

  const pickingIds = Array.from(
    new Set(saleOrders.flatMap((order) => order.picking_ids ?? [])),
  );
  const pickings = pickingIds.length
    ? ((await executeKwProfiled(profiler, "odoo", config, uid, "stock.picking", "read", [pickingIds], {
        fields: [
          "id",
          "name",
          "state",
          "printed",
          "scheduled_date",
          "origin",
          "date_done",
        ],
      })) as OdooPickingRecord[])
    : [];
  const pickingsById = new Map(
    pickings.map((picking) => [picking.id, picking]),
  );
  const orderIds = saleOrders.map((order) => order.id);
  const orderLines = orderIds.length
    ? ((await executeKwProfiled(
        profiler,
        "lines",
        config,
        uid,
        "sale.order.line",
        "search_read",
        [
          [
            ["order_id", "in", orderIds],
            ["display_type", "=", false],
          ],
        ],
        {
          fields: [
            "order_id",
            "product_id",
            "name",
            "product_uom_qty",
            "price_unit",
            "price_subtotal",
          ],
          order: "sequence asc, id asc",
        },
      )) as OdooOrderLine[])
    : [];
  const linesByOrderId = new Map<number, OdooOrderLine[]>();
  orderLines.forEach((line) => {
    const orderId = getRelationId(line.order_id);
    if (!orderId) return;
    const lines = linesByOrderId.get(orderId) ?? [];
    lines.push(line);
    linesByOrderId.set(orderId, lines);
  });
  const productIds = Array.from(
    new Set(
      orderLines
        .map((line) => getRelationId(line.product_id))
        .filter((id): id is number => typeof id === "number"),
    ),
  );
  const products = productIds.length
    ? ((await executeKwProfiled(profiler, "images", config, uid, "product.product", "read", [productIds], {
        fields: ["id", "product_tmpl_id", "image_128"],
      })) as ProductRecord[])
    : [];
  const productImagesById = new Map(
    products.map((product) => [product.id, formatProductImage(product.image_128)]),
  );
  const productTemplateById = new Map(
    products
      .map((product) => [product.id, getRelationId(product.product_tmpl_id)])
      .filter((entry): entry is [number, number] => typeof entry[1] === "number"),
  );
  const templateIds = Array.from(new Set(productTemplateById.values()));
  const bomRecords = templateIds.length
    ? ((await executeKwProfiled(
        profiler,
        "bomKits",
        config,
        uid,
        "mrp.bom",
        "search_read",
        [
          [
            "|",
            ["product_id", "in", productIds],
            ["product_tmpl_id", "in", templateIds],
          ],
        ],
        {
          fields: [
            "id",
            "product_tmpl_id",
            "product_id",
            "product_qty",
            "type",
          ],
        },
      )) as BomRecord[])
    : [];
  const bomLines = bomRecords.length
    ? ((await executeKwProfiled(
        profiler,
        "bomKits",
        config,
        uid,
        "mrp.bom.line",
        "search_read",
        [[["bom_id", "in", bomRecords.map((bom) => bom.id)]]],
        {
          fields: ["id", "bom_id", "product_id", "product_qty", "product_uom_id"],
          order: "sequence asc, id asc",
        },
      )) as BomLineRecord[])
    : [];
  const componentProductIds = Array.from(
    new Set(
      bomLines
        .map((line) => getRelationId(line.product_id))
        .filter((id): id is number => typeof id === "number"),
    ),
  );
  const componentProducts = componentProductIds.length
    ? ((await executeKwProfiled(
        profiler,
        "images",
        config,
        uid,
        "product.product",
        "read",
        [componentProductIds],
        { fields: ["id", "image_128"] },
      )) as ProductRecord[])
    : [];
  const componentImagesById = new Map(
    componentProducts.map((product) => [
      product.id,
      formatProductImage(product.image_128),
    ]),
  );
  const bomLinesByBomId = new Map<number, BomLineRecord[]>();
  bomLines.forEach((line) => {
    const bomId = getRelationId(line.bom_id);
    if (!bomId) return;
    const lines = bomLinesByBomId.get(bomId) ?? [];
    lines.push(line);
    bomLinesByBomId.set(bomId, lines);
  });
  const bomByProductId = mapBomByProduct(productIds, productTemplateById, bomRecords);
  const partnerIds = Array.from(
    new Set(
      saleOrders.flatMap(
        (order) =>
          getRelationId(order.partner_shipping_id) ??
          getRelationId(order.partner_id) ??
          [],
      ),
    ),
  );
  const partners = partnerIds.length
    ? ((await executeKwProfiled(profiler, "partners", config, uid, "res.partner", "read", [partnerIds], {
        fields: [
          "id",
          "name",
          "street",
          "street2",
          "zip",
          "city",
          "country_id",
          "phone",
          "mobile",
          "email",
        ],
      })) as PartnerRecord[])
    : [];
  const partnersById = new Map(
    partners.map((partner) => [partner.id, partner]),
  );
  const sendcloudReferences = Array.from(
      new Set(
        saleOrders
          .map((order) => getExternalOrderRef(order))
          .map(cleanText)
          .filter(Boolean),
      ),
    );
  const sendcloudMetrics = { calls: 0 };
  const sendcloudByReference = await measureDemandPhase(
    profiler,
    "sendcloud",
    0,
    () =>
      getSendcloudStatuses(env, sendcloudReferences, {
        metrics: sendcloudMetrics,
      }),
  );
  addDemandPhase(profiler, "sendcloud", 0, sendcloudMetrics.calls);

  const orders = measureDemandPhaseSync(profiler, "serialization", 0, () =>
    saleOrders.map((order) => {
      const relatedPickings = (order.picking_ids ?? [])
        .map((id) => pickingsById.get(id))
        .filter(Boolean);
      const printed =
        typeof order.delivery_is_printed === "boolean"
          ? order.delivery_is_printed
          : relatedPickings.some((picking) => picking?.printed);
      const deliveryStatus = relatedPickings.length
        ? summarizePickings(relatedPickings)
        : "Sin albaran";
      const partner = partnersById.get(
        getRelationId(order.partner_shipping_id) ??
          getRelationId(order.partner_id) ??
          0,
      );

      const sendcloud = sendcloudByReference.get(getExternalOrderRef(order));

      return {
        id: order.name ?? `SO-${order.id}`,
        odooRef: `#${order.id}`,
        date: formatDate(order.date_order ?? order.create_date),
        client: getRelationName(order.partner_id),
        channel: getRelationName(order.team_id) || "Odoo",
        externalRef: getExternalOrderRef(order),
        fulfillmentBy: getFulfillmentBy(order),
        sendcloud,
        odooActions: buildOdooActionPreview(order, relatedPickings, printed, sendcloud),
        odooDeliveryValidation: buildOdooDeliveryValidation(
          order,
          relatedPickings,
          sendcloud,
        ),
        deliveryPrinted: printed,
        deliveryPrintCount: order.delivery_print_count ?? 0,
        deliveryLastPrintDate: formatDate(order.delivery_last_print_date || ""),
        total: order.amount_total ?? 0,
        taxTotal: order.amount_tax ?? 0,
        status: translateSaleState(order.state),
        invoiceStatus: translateInvoiceStatus(order.invoice_status),
        deliveryStatus,
        city: formatLocation(partner),
        shippingAddress: formatShippingAddress(partner),
        shippingPhone: formatPhone(partner),
        shippingEmail: cleanText(partner?.email),
        shippingPostalCode: cleanText(partner?.zip),
        shippingCountryCode: getCountryCode(partner),
        items: (linesByOrderId.get(order.id) ?? []).map((line) => {
          const productId = getRelationId(line.product_id);
          const bom = productId ? bomByProductId.get(productId) : undefined;
          const bomQuantity = bom?.product_qty && bom.product_qty > 0
            ? bom.product_qty
            : 1;
          const orderQuantity = line.product_uom_qty ?? 0;

          return {
            sku:
              getProductCode(getRelationName(line.product_id)) ||
              getRelationName(line.product_id) ||
              `Linea ${line.id}`,
            name:
              line.name || getRelationName(line.product_id) || "Sin producto",
            quantity: orderQuantity,
            price: line.price_unit ?? line.price_subtotal ?? 0,
            subtotal: line.price_subtotal ?? 0,
            stock: 0,
            imageUrl: productImagesById.get(productId ?? 0),
            components: bom
              ? (bomLinesByBomId.get(bom.id) ?? []).map((component) => ({
                  sku:
                    getProductCode(getRelationName(component.product_id)) ||
                    getRelationName(component.product_id) ||
                    `Componente ${component.id}`,
                  name:
                    stripProductCode(getRelationName(component.product_id)) ||
                    getRelationName(component.product_id) ||
                    `Componente ${component.id}`,
                  quantity:
                    ((component.product_qty ?? 0) * orderQuantity) /
                    bomQuantity,
                  uom: formatUom(getRelationName(component.product_uom_id)),
                  imageUrl: componentImagesById.get(
                    getRelationId(component.product_id) ?? 0,
                  ),
                }))
              : undefined,
          };
        }),
      };
    }),
  );

  return {
    mode: "live",
    total,
    limit,
    offset,
    orders,
  };
}

async function getOdooOrders(
  env: Record<string, string>,
  range: {
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    search?: string;
  },
) {
  if (!ordersFastCacheEnabled(env)) {
    return getOdooOrdersFull(env, range);
  }

  const startedAt = Date.now();
  const cache = readOrdersCache(env);
  const filtered = filterCachedOrders(cache.orders, range);
  const limit = clampNumber(range.limit ?? 80, 1, 500);
  const offset = Math.max(0, Number.isFinite(range.offset ?? 0) ? (range.offset ?? 0) : 0);
  recordOrdersMetric(env, {
    scope: "orders",
    durationMs: Date.now() - startedAt,
    odooCalls: 0,
    sendcloudCalls: 0,
    orders: filtered.length,
  });

  if (cache.sync.status === "never") {
    void syncOrdersCache(env, { from: range.from, to: range.to, autoValidate: false }).catch(() => {});
  }

  return {
    mode: "live" as const,
    source: "dashboard-cache" as const,
    total: filtered.length,
    limit,
    offset,
    orders: filtered.slice(offset, offset + limit),
    cache: {
      updatedAt: cache.updatedAt,
      sync: cache.sync,
      incidentCount: cache.incidents.filter((incident) => !incident.resolvedAt).length,
    },
    message:
      cache.sync.status === "never"
        ? "Cache vacia; sincronizacion en segundo plano iniciada."
        : undefined,
  };
}

async function getOdooOrdersV2(
  env: Record<string, string>,
  range: {
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    search?: string;
  },
) {
  const startedAt = Date.now();
  const cache = readOrdersCache(env);
  const filtered = filterCachedOrders(cache.orders, range);
  const limit = clampNumber(range.limit ?? 80, 1, 500);
  const offset = Math.max(0, Number.isFinite(range.offset ?? 0) ? (range.offset ?? 0) : 0);

  recordOrdersMetric(env, {
    scope: "orders",
    durationMs: Date.now() - startedAt,
    odooCalls: 0,
    sendcloudCalls: 0,
    orders: filtered.length,
  });

  return {
    mode: "live" as const,
    source: "dashboard-cache" as const,
    version: "v2" as const,
    total: filtered.length,
    limit,
    offset,
    orders: filtered.slice(offset, offset + limit).map(toOrdersV2ListOrder),
    cache: {
      updatedAt: cache.updatedAt,
      sync: cache.sync,
      incidentCount: cache.incidents.filter((incident) => !incident.resolvedAt).length,
    },
    metrics: getOrdersV2Performance(env),
    message:
      cache.sync.status === "never"
        ? "Cache V2 vacia. Pulsa Actualizar para sincronizar sin bloquear la pantalla."
        : undefined,
  };
}

function toOrdersV2ListOrder(order: OrdersCacheStore["orders"][number]) {
  return {
    id: order.id,
    odooRef: order.odooRef,
    date: order.date,
    client: order.client,
    channel: order.channel,
    externalRef: order.externalRef,
    fulfillmentBy: order.fulfillmentBy,
    sendcloud: order.sendcloud
      ? {
          status: order.sendcloud.status,
          trackingNumber: order.sendcloud.trackingNumber,
          trackingUrl: order.sendcloud.trackingUrl,
        }
      : undefined,
    odooDeliveryValidation: order.odooDeliveryValidation
      ? {
          status: order.odooDeliveryValidation.status,
          label: order.odooDeliveryValidation.label,
          reason: order.odooDeliveryValidation.reason,
          dateDone: order.odooDeliveryValidation.dateDone,
          pickingId: order.odooDeliveryValidation.pickingId,
        }
      : undefined,
    deliveryPrinted: order.deliveryPrinted,
    deliveryPrintCount: order.deliveryPrintCount,
    deliveryLastPrintDate: order.deliveryLastPrintDate,
    total: order.total,
    status: order.status,
    invoiceStatus: order.invoiceStatus,
    deliveryStatus: order.deliveryStatus,
    city: order.city,
    items: [],
  };
}

async function getOrdersDemandContext(
  env: Record<string, string>,
  orderRefs: string[],
  options: { scope: "print" | "grouping"; profiler?: DemandProfiler },
) {
  const startedAt = Date.now();
  const cleanRefs = Array.from(new Set(orderRefs.map(cleanText).filter(Boolean)));
  const context = await getOdooOrdersBatchDemandContext(
    env,
    cleanRefs,
    options.profiler,
  );

  recordOrdersMetric(env, {
    scope: options.scope,
    durationMs: Date.now() - startedAt,
    odooCalls: context.performance.totalCalls.odoo,
    sendcloudCalls: context.performance.totalCalls.sendcloud,
    orders: context.orders.length,
  });

  return {
    mode: "live" as const,
    orders: context.orders,
    total: context.orders.length,
    requested: cleanRefs.length,
    batch: {
      readOnly: true,
      requestedRefs: cleanRefs.length,
      matchedRefs: context.orders.length,
    },
  };
}

async function getOdooOrdersBatchDemandContext(
  env: Record<string, string>,
  orderRefs: string[],
  profiler?: DemandProfiler,
) {
  if (orderRefs.length === 0) {
    return { orders: [], performance: finishDemandProfiler(profiler ?? createDemandProfiler("print")) };
  }

  const config = getOdooConfig(env);
  if (!config.url || !config.database || !config.username || !config.apiKey) {
    return {
      orders: [],
      performance: finishDemandProfiler(profiler ?? createDemandProfiler("print")),
    };
  }

  const uid = await measureDemandPhase(profiler, "odoo", 1, () =>
    authenticate(config),
  );
  const numericIds = orderRefs
    .map((ref) => ref.match(/^#?(\d+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  const textualRefs = orderRefs.filter((ref) => !/^#?\d+$/.test(ref));
  const searchTerms: unknown[] = [];
  if (numericIds.length) searchTerms.push(["id", "in", numericIds]);
  textualRefs.forEach((ref) => {
    searchTerms.push(["name", "ilike", ref]);
    searchTerms.push(["client_order_ref", "ilike", ref]);
    searchTerms.push(["origin", "ilike", ref]);
  });
  const refDomain =
    searchTerms.length > 1
      ? [...Array(searchTerms.length - 1).fill("|"), ...searchTerms]
      : searchTerms;
  const domain: unknown[] = [["state", "in", ["sale", "done"]], ...refDomain];

  const saleOrders = (await executeKwProfiled(
    profiler,
    "odoo",
    config,
    uid,
    "sale.order",
    "search_read",
    [domain],
    {
      fields: [
        "id",
        "name",
        "date_order",
        "partner_id",
        "partner_shipping_id",
        "team_id",
        "amount_total",
        "amount_tax",
        "origin",
        "client_order_ref",
        "amz_fulfillment_by",
        "state",
        "invoice_status",
        "delivery_is_printed",
        "delivery_print_count",
        "delivery_last_print_date",
        "picking_ids",
      ],
      order: "date_order desc",
      limit: Math.max(orderRefs.length * 5, orderRefs.length),
    },
  )) as OdooRecord[];

  const pickingIds = Array.from(
    new Set(saleOrders.flatMap((order) => order.picking_ids ?? [])),
  );
  const pickings = pickingIds.length
    ? ((await executeKwProfiled(profiler, "odoo", config, uid, "stock.picking", "read", [pickingIds], {
        fields: [
          "id",
          "name",
          "state",
          "printed",
          "scheduled_date",
          "origin",
          "date_done",
        ],
      })) as OdooPickingRecord[])
    : [];
  const pickingsById = new Map(pickings.map((picking) => [picking.id, picking]));
  const orderIds = saleOrders.map((order) => order.id);
  const orderLines = orderIds.length
    ? ((await executeKwProfiled(
        profiler,
        "lines",
        config,
        uid,
        "sale.order.line",
        "search_read",
        [
          [
            ["order_id", "in", orderIds],
            ["display_type", "=", false],
          ],
        ],
        {
          fields: [
            "order_id",
            "product_id",
            "name",
            "product_uom_qty",
            "price_unit",
            "price_subtotal",
          ],
          order: "sequence asc, id asc",
        },
      )) as OdooOrderLine[])
    : [];
  const linesByOrderId = new Map<number, OdooOrderLine[]>();
  orderLines.forEach((line) => {
    const orderId = getRelationId(line.order_id);
    if (!orderId) return;
    const lines = linesByOrderId.get(orderId) ?? [];
    lines.push(line);
    linesByOrderId.set(orderId, lines);
  });
  const productIds = Array.from(
    new Set(
      orderLines
        .map((line) => getRelationId(line.product_id))
        .filter((id): id is number => typeof id === "number"),
    ),
  );
  const products = productIds.length
    ? ((await executeKwProfiled(profiler, "images", config, uid, "product.product", "read", [productIds], {
        fields: ["id", "product_tmpl_id", "image_128"],
      })) as ProductRecord[])
    : [];
  const productImagesById = new Map(
    products.map((product) => [product.id, formatProductImage(product.image_128)]),
  );
  const productTemplateById = new Map(
    products
      .map((product) => [product.id, getRelationId(product.product_tmpl_id)])
      .filter((entry): entry is [number, number] => typeof entry[1] === "number"),
  );
  const templateIds = Array.from(new Set(productTemplateById.values()));
  const bomRecords = templateIds.length
    ? ((await executeKwProfiled(
        profiler,
        "bomKits",
        config,
        uid,
        "mrp.bom",
        "search_read",
        [
          [
            "|",
            ["product_id", "in", productIds],
            ["product_tmpl_id", "in", templateIds],
          ],
        ],
        {
          fields: [
            "id",
            "product_tmpl_id",
            "product_id",
            "product_qty",
            "type",
          ],
        },
      )) as BomRecord[])
    : [];
  const bomLines = bomRecords.length
    ? ((await executeKwProfiled(
        profiler,
        "bomKits",
        config,
        uid,
        "mrp.bom.line",
        "search_read",
        [[["bom_id", "in", bomRecords.map((bom) => bom.id)]]],
        {
          fields: ["id", "bom_id", "product_id", "product_qty", "product_uom_id"],
          order: "sequence asc, id asc",
        },
      )) as BomLineRecord[])
    : [];
  const componentProductIds = Array.from(
    new Set(
      bomLines
        .map((line) => getRelationId(line.product_id))
        .filter((id): id is number => typeof id === "number"),
    ),
  );
  const componentProducts = componentProductIds.length
    ? ((await executeKwProfiled(
        profiler,
        "images",
        config,
        uid,
        "product.product",
        "read",
        [componentProductIds],
        { fields: ["id", "image_128"] },
      )) as ProductRecord[])
    : [];
  const componentImagesById = new Map(
    componentProducts.map((product) => [
      product.id,
      formatProductImage(product.image_128),
    ]),
  );
  const bomLinesByBomId = new Map<number, BomLineRecord[]>();
  bomLines.forEach((line) => {
    const bomId = getRelationId(line.bom_id);
    if (!bomId) return;
    const lines = bomLinesByBomId.get(bomId) ?? [];
    lines.push(line);
    bomLinesByBomId.set(bomId, lines);
  });
  const bomByProductId = mapBomByProduct(productIds, productTemplateById, bomRecords);
  const partnerIds = Array.from(
    new Set(
      saleOrders.flatMap(
        (order) =>
          getRelationId(order.partner_shipping_id) ??
          getRelationId(order.partner_id) ??
          [],
      ),
    ),
  );
  const partners = partnerIds.length
    ? ((await executeKwProfiled(profiler, "partners", config, uid, "res.partner", "read", [partnerIds], {
        fields: [
          "id",
          "name",
          "street",
          "street2",
          "zip",
          "city",
          "country_id",
          "phone",
          "mobile",
          "email",
        ],
      })) as PartnerRecord[])
    : [];
  const partnersById = new Map(partners.map((partner) => [partner.id, partner]));
  const sendcloudReferences = Array.from(
    new Set(
      saleOrders
        .map((order) => getExternalOrderRef(order))
        .map(cleanText)
        .filter(Boolean),
    ),
  );
  const sendcloudMetrics = { calls: 0 };
  const sendcloudByReference = await measureDemandPhase(
    profiler,
    "sendcloud",
    0,
    () =>
      getSendcloudStatuses(env, sendcloudReferences, {
        metrics: sendcloudMetrics,
      }),
  );
  addDemandPhase(profiler, "sendcloud", 0, sendcloudMetrics.calls);

  const ordersByRef = measureDemandPhaseSync(profiler, "serialization", 0, () => {
    const serialized = saleOrders.map((order) => {
      const relatedPickings = (order.picking_ids ?? [])
        .map((id) => pickingsById.get(id))
        .filter(Boolean);
      const printed =
        typeof order.delivery_is_printed === "boolean"
          ? order.delivery_is_printed
          : relatedPickings.some((picking) => picking?.printed);
      const deliveryStatus = relatedPickings.length
        ? summarizePickings(relatedPickings)
        : "Sin albaran";
      const partner = partnersById.get(
        getRelationId(order.partner_shipping_id) ??
          getRelationId(order.partner_id) ??
          0,
      );
      const sendcloud = sendcloudByReference.get(getExternalOrderRef(order));

      return {
        id: order.name ?? `SO-${order.id}`,
        odooRef: `#${order.id}`,
        date: formatDate(order.date_order ?? order.create_date),
        client: getRelationName(order.partner_id),
        channel: getRelationName(order.team_id) || "Odoo",
        externalRef: getExternalOrderRef(order),
        fulfillmentBy: getFulfillmentBy(order),
        sendcloud,
        odooActions: buildOdooActionPreview(order, relatedPickings, printed, sendcloud),
        odooDeliveryValidation: buildOdooDeliveryValidation(
          order,
          relatedPickings,
          sendcloud,
        ),
        deliveryPrinted: printed,
        deliveryPrintCount: order.delivery_print_count ?? 0,
        deliveryLastPrintDate: formatDate(order.delivery_last_print_date || ""),
        total: order.amount_total ?? 0,
        taxTotal: order.amount_tax ?? 0,
        status: translateSaleState(order.state),
        invoiceStatus: translateInvoiceStatus(order.invoice_status),
        deliveryStatus,
        city: formatLocation(partner),
        shippingAddress: formatShippingAddress(partner),
        shippingPhone: formatPhone(partner),
        shippingEmail: cleanText(partner?.email),
        shippingPostalCode: cleanText(partner?.zip),
        shippingCountryCode: getCountryCode(partner),
        items: (linesByOrderId.get(order.id) ?? []).map((line) => {
          const productId = getRelationId(line.product_id);
          const bom = productId ? bomByProductId.get(productId) : undefined;
          const bomQuantity = bom?.product_qty && bom.product_qty > 0
            ? bom.product_qty
            : 1;
          const orderQuantity = line.product_uom_qty ?? 0;

          return {
            sku:
              getProductCode(getRelationName(line.product_id)) ||
              getRelationName(line.product_id) ||
              `Linea ${line.id}`,
            name:
              line.name || getRelationName(line.product_id) || "Sin producto",
            quantity: orderQuantity,
            price: line.price_unit ?? line.price_subtotal ?? 0,
            subtotal: line.price_subtotal ?? 0,
            stock: 0,
            imageUrl: productImagesById.get(productId ?? 0),
            components: bom
              ? (bomLinesByBomId.get(bom.id) ?? []).map((component) => ({
                  sku:
                    getProductCode(getRelationName(component.product_id)) ||
                    getRelationName(component.product_id) ||
                    `Componente ${component.id}`,
                  name:
                    stripProductCode(getRelationName(component.product_id)) ||
                    getRelationName(component.product_id) ||
                    `Componente ${component.id}`,
                  quantity:
                    ((component.product_qty ?? 0) * orderQuantity) /
                    bomQuantity,
                  uom: formatUom(getRelationName(component.product_uom_id)),
                  imageUrl: componentImagesById.get(
                    getRelationId(component.product_id) ?? 0,
                  ),
                }))
              : undefined,
          };
        }),
      };
    });
    return new Map(serialized.flatMap((order) => [
      [order.odooRef, order],
      [order.id, order],
      [order.externalRef, order],
    ]));
  });

  return {
    orders: orderRefs
      .map((ref) => ordersByRef.get(ref))
      .filter((order): order is NonNullable<typeof order> => Boolean(order)),
    performance: finishDemandProfiler(profiler ?? createDemandProfiler("print")),
  };
}

async function syncOrdersCache(
  env: Record<string, string>,
  range: {
    from?: string;
    to?: string;
    search?: string;
    autoValidate?: boolean;
  },
) {
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  const previous = readOrdersCache(env);
  writeOrdersCache(env, {
    ...previous,
    sync: {
      ...previous.sync,
      lastStartedAt: startedIso,
      status: "running",
      errors: [],
    },
  });

  const stats = {
    ordersScanned: 0,
    ordersNew: 0,
    ordersUpdated: 0,
    sendcloudLabels: 0,
    sendcloudStatuses: 0,
    sendcloudTracking: 0,
    deliveriesValidated: 0,
    incidents: 0,
    triggerOrigins: {} as Record<string, number>,
    odooCalls: 0,
    sendcloudCalls: 0,
    errors: [] as string[],
  };

  try {
    const incrementalSince = getIncrementalSyncWatermark(previous, range);
    const synced = await readLightweightOrdersFromOdoo(
      env,
      { ...range, incrementalSince },
      stats,
    );
    const previousById = new Map(previous.orders.map((order) => [order.odooRef, order]));
    const syncedRefs = new Set(synced.orders.map((order) => order.odooRef));
    const nextOrders = synced.incremental
      ? new Map(previous.orders.map((order) => [order.odooRef, order]))
      : new Map(
          previous.orders
            .filter((order) => !isOrderInCacheRefreshScope(order, range) || syncedRefs.has(order.odooRef))
            .map((order) => [order.odooRef, order]),
        );

    if (synced.incremental) {
      synced.changedRefs.forEach((ref) => {
        const previousOrder = previousById.get(ref);
        if (previousOrder && isOrderInCacheRefreshScope(previousOrder, range) && !syncedRefs.has(ref)) {
          nextOrders.delete(ref);
        }
      });
    }

    synced.orders.forEach((order) => {
      const previousOrder = previousById.get(order.odooRef);
      if (!previousOrder) {
        stats.ordersNew += 1;
      } else if (JSON.stringify(previousOrder) !== JSON.stringify(order)) {
        stats.ordersUpdated += 1;
      }
      nextOrders.set(order.odooRef, order);
    });
    stats.ordersScanned = synced.incremental ? synced.changedRefs.size : synced.orders.length;
    stats.sendcloudStatuses = synced.orders.filter((order) => order.sendcloud?.status).length;
    stats.sendcloudTracking = synced.orders.filter(
      (order) => order.sendcloud?.trackingNumber || order.sendcloud?.trackingUrl,
    ).length;
    stats.sendcloudLabels = stats.sendcloudTracking;

    let incidents = previous.incidents;
    let audit = previous.audit;
    if (range.autoValidate !== false) {
      const trigger = synced.incremental ? "sync-incremental" : "sync-full";
      const validation = await runAutomaticDeliveryValidation(env, synced.orders, trigger);
      stats.deliveriesValidated = validation.validated;
      stats.incidents = validation.incidents.length;
      stats.triggerOrigins = validation.triggerOrigins;
      incidents = mergeDeliveryIncidents(incidents, validation.incidents);
      audit = [...audit, ...validation.audit].slice(-1000);
    }

    const finishedAt = new Date().toISOString();
    const sortedOrders = Array.from(nextOrders.values()).sort((left, right) =>
      right.date.localeCompare(left.date) || right.id.localeCompare(left.id),
    );
    const nextStore: OrdersCacheStore = {
      ...previous,
      updatedAt: finishedAt,
      range: { from: range.from, to: range.to },
      orders: shouldTrimOrdersToSyncLimit(range)
        ? sortedOrders.slice(0, ORDERS_LIGHTWEIGHT_SYNC_LIMIT)
        : sortedOrders,
      incidents,
      audit,
      sync: {
        lastStartedAt: startedIso,
        lastFinishedAt: finishedAt,
        durationMs: Date.now() - startedAt,
        status: "ok",
        ...stats,
      },
      metrics: [
        ...previous.metrics,
        {
          id: randomToken(),
          createdAt: finishedAt,
          scope: "sync",
          durationMs: Date.now() - startedAt,
          odooCalls: stats.odooCalls,
          sendcloudCalls: stats.sendcloudCalls,
          orders: synced.orders.length,
        },
      ].slice(-500),
    };
    writeOrdersCache(env, nextStore);

    return {
      ok: true,
      cache: {
        updatedAt: nextStore.updatedAt,
        sync: nextStore.sync,
        incidentCount: nextStore.incidents.filter((incident) => !incident.resolvedAt).length,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error sincronizando pedidos";
    const failedStore: OrdersCacheStore = {
      ...previous,
      sync: {
        ...previous.sync,
        lastStartedAt: startedIso,
        lastFinishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        status: "error",
        errors: [message],
      },
    };
    writeOrdersCache(env, failedStore);
    throw error;
  }
}

function shouldTrimOrdersToSyncLimit(range: { from?: string; to?: string; search?: string }) {
  return !range.from && !range.to && !cleanText(range.search);
}

function isOrderInCacheRefreshScope(
  order: OrdersCacheStore["orders"][number],
  range: {
    from?: string;
    to?: string;
    search?: string;
  },
) {
  return filterCachedOrders([order], range).length > 0;
}

function getIncrementalSyncWatermark(
  previous: OrdersCacheStore,
  range: {
    from?: string;
    to?: string;
    search?: string;
  },
) {
  if (cleanText(range.search) || !previous.orders.length || previous.sync.status !== "ok") {
    return undefined;
  }
  const lastWriteDate = previous.orders
    .map((order) => order.cacheMeta?.writeDate)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const timestamp = lastWriteDate ? Date.parse(`${lastWriteDate.replace(" ", "T")}Z`) : NaN;
  if (!Number.isFinite(timestamp)) return undefined;
  return formatOdooDateTime(new Date(Math.max(0, timestamp - 2 * 60 * 1000)));
}

async function readLightweightOrdersFromOdoo(
  env: Record<string, string>,
  range: {
    from?: string;
    to?: string;
    search?: string;
    incrementalSince?: string;
  },
  stats: { odooCalls: number; sendcloudCalls: number },
): Promise<LightweightOrdersSyncResult> {
  const config = getOdooConfig(env);
  if (!config.url || !config.database || !config.username || !config.apiKey) {
    throw new Error(
      "Faltan variables ODOO_URL, ODOO_DATABASE, ODOO_USERNAME u ODOO_API_KEY",
    );
  }

  const uid = await authenticate(config);
  const incremental = Boolean(range.incrementalSince);
  const domain = incremental
    ? buildIncrementalOrderDomain(range, range.incrementalSince!)
    : buildOrderDomain(range);
  stats.odooCalls += 1;
  const saleOrders = (await executeKw(
    config,
    uid,
    "sale.order",
    "search_read",
    [domain],
    {
      fields: [
        "id",
        "name",
        "date_order",
        "write_date",
        "partner_id",
        "partner_shipping_id",
        "team_id",
        "amount_total",
        "amount_tax",
        "origin",
        "client_order_ref",
        "amz_fulfillment_by",
        "state",
        "invoice_status",
        "delivery_is_printed",
        "delivery_print_count",
        "delivery_last_print_date",
        "picking_ids",
      ],
      order: "date_order desc",
      limit: ORDERS_LIGHTWEIGHT_SYNC_LIMIT,
    },
  )) as OdooRecord[];

  const cacheableSaleOrders = saleOrders.filter((order) =>
    order.state === "sale" || order.state === "done",
  );
  const pickingIds = Array.from(new Set(cacheableSaleOrders.flatMap((order) => order.picking_ids ?? [])));
  stats.odooCalls += pickingIds.length ? 1 : 0;
  const pickings = pickingIds.length
    ? ((await executeKw(config, uid, "stock.picking", "read", [pickingIds], {
        fields: ["id", "name", "state", "printed", "scheduled_date", "origin", "date_done"],
      })) as OdooPickingRecord[])
    : [];
  const pickingsById = new Map(pickings.map((picking) => [picking.id, picking]));

  const partnerIds = Array.from(
    new Set(
      saleOrders.flatMap((order) => [
        getRelationId(order.partner_shipping_id),
        getRelationId(order.partner_id),
      ]).filter((id): id is number => typeof id === "number"),
    ),
  );
  stats.odooCalls += partnerIds.length ? 1 : 0;
  const partners = partnerIds.length
    ? ((await executeKw(config, uid, "res.partner", "read", [partnerIds], {
        fields: ["id", "street", "street2", "zip", "city", "country_id", "phone", "mobile", "email"],
      })) as PartnerRecord[])
    : [];
  const partnersById = new Map(partners.map((partner) => [partner.id, partner]));

  const sendcloudLimit = clampNumber(
    Number(env.ORDERS_SYNC_SENDCLOUD_LIMIT ?? 500),
    0,
    500,
  );
  const sendcloudReferences = Array.from(
    new Set(
      cacheableSaleOrders
        .filter((order) => getFulfillmentBy(order) !== "FBA")
        .filter((order) => order.state !== "cancel" && order.state !== "draft")
        .map((order) => getExternalOrderRef(order))
        .map(cleanText)
        .filter(Boolean),
    ),
  ).slice(0, sendcloudLimit);
  stats.sendcloudCalls += sendcloudReferences.length ? 1 : 0;
  const sendcloudByReference = await getSendcloudStatuses(env, sendcloudReferences, {
    exactLookupLimit: 0,
  });
  const changedRefs = new Set(saleOrders.map((order) => `#${order.id}`));

  return {
    orders: cacheableSaleOrders.map((order) => {
      const relatedPickings = (order.picking_ids ?? [])
        .map((id) => pickingsById.get(id))
        .filter((picking): picking is OdooPickingRecord => Boolean(picking));
      const partner = partnersById.get(
        getRelationId(order.partner_shipping_id) ?? getRelationId(order.partner_id) ?? 0,
      );
      const sendcloud = sendcloudByReference.get(getExternalOrderRef(order));
      return buildCachedOrder(order, relatedPickings, partner, sendcloud);
    }),
    changedRefs,
    incremental,
  };
}

function buildCachedOrder(
  order: OdooRecord,
  relatedPickings: OdooPickingRecord[],
  partner?: PartnerRecord,
  sendcloud?: SendcloudStatus,
) {
  const printed =
    typeof order.delivery_is_printed === "boolean"
      ? order.delivery_is_printed
      : relatedPickings.some((picking) => picking.printed);
  const deliveryStatus = relatedPickings.length
    ? summarizePickings(relatedPickings)
    : "Sin albaran";
  const sendcloudMeta = buildCacheSendcloudMeta(
    getExternalOrderRef(order),
    Boolean(getFulfillmentBy(order) !== "FBA" && order.state !== "cancel" && order.state !== "draft"),
    sendcloud,
  );

  return {
    id: order.name ?? `SO-${order.id}`,
    odooRef: `#${order.id}`,
    date: formatDate(order.date_order ?? order.create_date),
    client: getRelationName(order.partner_id),
    channel: getRelationName(order.team_id) || "Odoo",
    externalRef: getExternalOrderRef(order),
    fulfillmentBy: getFulfillmentBy(order),
    sendcloud,
    odooActions: buildOdooActionPreview(order, relatedPickings, printed, sendcloud),
    odooDeliveryValidation: buildOdooDeliveryValidation(order, relatedPickings, sendcloud),
    deliveryPrinted: printed,
    deliveryPrintCount: order.delivery_print_count ?? 0,
    deliveryLastPrintDate: formatDate(order.delivery_last_print_date || ""),
    total: order.amount_total ?? 0,
    taxTotal: order.amount_tax ?? 0,
    status: translateSaleState(order.state),
    invoiceStatus: translateInvoiceStatus(order.invoice_status),
    deliveryStatus,
    city: formatLocation(partner),
    shippingAddress: formatShippingAddress(partner),
    shippingPhone: formatPhone(partner),
    shippingEmail: cleanText(partner?.email),
    shippingPostalCode: cleanText(partner?.zip),
    shippingCountryCode: getCountryCode(partner),
    items: [],
    cacheMeta: {
      lightweight: true,
      updatedAt: new Date().toISOString(),
      writeDate: order.write_date,
      sendcloud: sendcloudMeta,
    },
  };
}

function buildCacheSendcloudMeta(
  reference: string,
  checked: boolean,
  sendcloud?: SendcloudStatus,
): CacheSendcloudMeta {
  if (!checked || !cleanText(reference)) {
    return {
      status: "not_checked",
      tracking: "not_checked",
    };
  }
  if (!sendcloud) {
    return {
      status: "not_found",
      tracking: "not_found",
      reference: cleanText(reference),
      checkedAt: new Date().toISOString(),
    };
  }
  const hasTracking = Boolean(sendcloud.trackingNumber || sendcloud.trackingUrl);
  return {
    status: "found",
    tracking: hasTracking ? "present" : "not_found",
    reference: sendcloud.reference || cleanText(reference),
    carrier: sendcloud.carrier,
    checkedAt: new Date().toISOString(),
  };
}

function ordersFastCacheEnabled(env: Record<string, string>) {
  return env.ORDERS_FAST_CACHE_ENABLED !== "false";
}

function getOrdersCachePath(env: Record<string, string>) {
  return (
    env.ORDERS_CACHE_STORE ||
    join(
      env.DASHBOARD_DATA_DIR || join(process.cwd(), ".dashboard-data"),
      "orders-cache.json",
    )
  );
}

function createEmptyOrdersCache(): OrdersCacheStore {
  return {
    version: 1,
    updatedAt: "",
    sync: {
      status: "never",
      ordersScanned: 0,
      ordersNew: 0,
      ordersUpdated: 0,
      sendcloudLabels: 0,
      sendcloudStatuses: 0,
      sendcloudTracking: 0,
      deliveriesValidated: 0,
      incidents: 0,
      odooCalls: 0,
      sendcloudCalls: 0,
      errors: [],
    },
    orders: [],
    incidents: [],
    audit: [],
    metrics: [],
  };
}

function readOrdersCache(env: Record<string, string>): OrdersCacheStore {
  const storePath = getOrdersCachePath(env);
  if (!existsSync(storePath)) return createEmptyOrdersCache();
  try {
    return {
      ...createEmptyOrdersCache(),
      ...(JSON.parse(readFileSync(storePath, "utf8")) as OrdersCacheStore),
    };
  } catch {
    return createEmptyOrdersCache();
  }
}

function writeOrdersCache(env: Record<string, string>, store: OrdersCacheStore) {
  const storePath = getOrdersCachePath(env);
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
}

type CachedOrderSearchIndex = {
  key: string;
  rows: Array<{
    order: OrdersCacheStore["orders"][number];
    day: string;
    searchText: string;
  }>;
};

let cachedOrderSearchIndex: CachedOrderSearchIndex | null = null;

function filterCachedOrders(
  orders: OrdersCacheStore["orders"],
  range: { from?: string; to?: string; search?: string },
) {
  const text = cleanText(range.search).toLowerCase();
  const index = getCachedOrderSearchIndex(orders);
  const matches: OrdersCacheStore["orders"] = [];
  for (const { order, day, searchText } of index.rows) {
    const matchesRange =
      (!range.from || day >= range.from) && (!range.to || day <= range.to);
    if (!matchesRange) continue;
    if (text && !searchText.includes(text)) continue;
    matches.push(order);
  }
  return matches;
}

function getCachedOrderSearchIndex(
  orders: OrdersCacheStore["orders"],
): CachedOrderSearchIndex {
  const first = orders[0];
  const last = orders[orders.length - 1];
  const key = [
    orders.length,
    first?.odooRef ?? "",
    first?.cacheMeta?.updatedAt ?? "",
    last?.odooRef ?? "",
    last?.cacheMeta?.updatedAt ?? "",
  ].join("|");
  if (cachedOrderSearchIndex?.key === key) return cachedOrderSearchIndex;
  cachedOrderSearchIndex = {
    key,
    rows: orders.map((order) => ({
      order,
      day: order.date,
      searchText: [
      order.id,
      order.odooRef,
      order.client,
      order.city,
      order.channel,
      order.externalRef,
      order.fulfillmentBy,
      order.sendcloud?.status,
      order.sendcloud?.trackingNumber,
      order.sendcloud?.trackingUrl,
      order.cacheMeta?.sendcloud?.status,
      order.cacheMeta?.sendcloud?.tracking,
      order.status,
    ]
      .join(" ")
        .toLowerCase(),
    })),
  };
  return cachedOrderSearchIndex;
}

function recordOrdersMetric(
  env: Record<string, string>,
  metric: Omit<OrdersPerformanceMetric, "id" | "createdAt">,
) {
  const store = readOrdersCache(env);
  writeOrdersCache(env, {
    ...store,
    metrics: [
      ...store.metrics,
      {
        id: randomToken(),
        createdAt: new Date().toISOString(),
        ...metric,
      },
    ].slice(-500),
  });
}

function getOrdersV2Performance(env: Record<string, string>) {
  const store = readOrdersCache(env);
  const metrics = store.metrics.slice(-120);
  return {
    mode: "lab" as const,
    cache: {
      updatedAt: store.updatedAt,
      orders: store.orders.length,
      sync: store.sync,
    },
    scopes: {
      home: summarizePerformanceMetrics(metrics, "home"),
      orders: summarizePerformanceMetrics(metrics, "orders"),
      sync: summarizePerformanceMetrics(metrics, "sync"),
      print: summarizePerformanceMetrics(metrics, "print"),
      grouping: summarizePerformanceMetrics(metrics, "grouping"),
    },
    comparison: {
      v1: {
        source: "pending-measurement" as const,
        note:
          "La medicion V1 completa queda pendiente para evitar llamadas pesadas a Odoo durante la construccion de V2.",
      },
      v2: {
        source: "dashboard-cache" as const,
        home: summarizePerformanceMetrics(metrics, "home").last,
        orders: summarizePerformanceMetrics(metrics, "orders").last,
        sync: summarizePerformanceMetrics(metrics, "sync").last,
      },
    },
  };
}

function summarizePerformanceMetrics(
  metrics: OrdersPerformanceMetric[],
  scope: OrdersPerformanceMetric["scope"],
) {
  const scoped = metrics.filter((metric) => metric.scope === scope);
  const last = scoped[scoped.length - 1];
  const averageDurationMs = scoped.length
    ? Math.round(scoped.reduce((total, metric) => total + metric.durationMs, 0) / scoped.length)
    : 0;
  return {
    count: scoped.length,
    averageDurationMs,
    last: last
      ? {
          createdAt: last.createdAt,
          durationMs: last.durationMs,
          odooCalls: last.odooCalls,
          sendcloudCalls: last.sendcloudCalls,
          orders: last.orders,
        }
      : null,
  };
}

async function runAutomaticDeliveryValidation(
  env: Record<string, string>,
  orders: OrdersCacheStore["orders"],
  trigger: "sync-incremental" | "sync-full" | "sendcloud-webhook" = "sync-incremental",
) {
  const candidates = orders.filter(
    (order) =>
      order.odooDeliveryValidation?.status === "ready" &&
      Boolean(order.sendcloud?.trackingNumber),
  );
  if (candidates.length === 0) {
    return {
      candidates: 0,
      validables: 0,
      validated: 0,
      incidents: [] as DeliveryValidationIncident[],
      audit: [] as DeliveryValidationAuditEntry[],
      triggerOrigins: { [trigger]: 0 },
    };
  }

  const startedAt = Date.now();
  const result = await validateOdooDeliveries(
    env,
    [],
    candidates.map((order) => order.odooRef),
    { dryRun: false, mode: "automatic", trigger },
  );
  const now = new Date().toISOString();
  const validatedNames = new Set(
    (result.validatedOrders ?? []).map((item) => item.orderName).filter(Boolean),
  );
  const incidents = (result.incidents ?? []).map((incident) => {
    const order = candidates.find(
      (candidate) =>
        candidate.odooRef === `#${incident.orderId}` ||
        candidate.id === incident.orderName,
    );
    return {
      id: createDeliveryIncidentId(incident.orderId, incident.reason),
      orderId: incident.orderId,
      orderName: incident.orderName,
      client: order?.client,
      channel: order?.channel,
      tracking: order?.sendcloud?.trackingNumber,
      pickingId: order?.odooDeliveryValidation?.pickingId,
      pickingState: order?.odooDeliveryValidation?.label,
      labelCreatedAt: order?.sendcloud?.rawStatus,
      reason: classifyDeliveryIncidentReason(incident.reason),
      lastAttemptAt: now,
    } satisfies DeliveryValidationIncident;
  });
  const audit: DeliveryValidationAuditEntry[] = [
    ...candidates
      .filter((order) => validatedNames.has(order.id))
      .map((order) => ({
        id: randomToken(),
        createdAt: now,
        orderName: order.id,
        pickingId: order.odooDeliveryValidation?.pickingId,
        tracking: order.sendcloud?.trackingNumber,
        mode: "automatic" as const,
        trigger,
        dryRun: result.dryRun ?? false,
        idempotencyKey: createDeliveryValidationIdempotencyKey(
          order.odooRef,
          order.odooDeliveryValidation?.pickingId,
          order.sendcloud?.trackingNumber,
        ),
        durationMs: Date.now() - startedAt,
        result: "validated" as const,
      })),
    ...incidents.map((incident) => ({
      id: randomToken(),
      createdAt: now,
      orderId: incident.orderId,
      orderName: incident.orderName,
      pickingId: incident.pickingId,
      tracking: incident.tracking,
      mode: "automatic" as const,
      trigger,
      dryRun: result.dryRun ?? false,
      idempotencyKey: createDeliveryValidationIdempotencyKey(
        incident.orderId ? `#${incident.orderId}` : incident.orderName,
        incident.pickingId,
        incident.tracking,
      ),
      durationMs: Date.now() - startedAt,
      result: "incident" as const,
      reason: incident.reason,
    })),
  ];

  return {
    candidates: result.candidates ?? candidates.length,
    validables: result.validables ?? result.validated ?? 0,
    validated: result.validated ?? 0,
    incidents,
    audit,
    triggerOrigins: { [trigger]: result.candidates ?? candidates.length },
  };
}

function mergeDeliveryIncidents(
  current: DeliveryValidationIncident[],
  incoming: DeliveryValidationIncident[],
) {
  const rows = new Map(current.map((incident) => [incident.id, incident]));
  incoming.forEach((incident) => {
    const previous = rows.get(incident.id);
    rows.set(incident.id, {
      ...previous,
      ...incident,
      resolvedAt: undefined,
      resolvedBy: undefined,
    });
  });
  return Array.from(rows.values()).sort((left, right) =>
    right.lastAttemptAt.localeCompare(left.lastAttemptAt),
  );
}

function recordManualDeliveryValidationAudit(
  env: Record<string, string>,
  result: Awaited<ReturnType<typeof validateOdooDeliveries>>,
  durationMs: number,
) {
  const now = new Date().toISOString();
  const store = readOrdersCache(env);
  const incidents = (result.incidents ?? []).map((incident) => ({
    id: createDeliveryIncidentId(incident.orderId, incident.reason),
    orderId: incident.orderId,
    orderName: incident.orderName,
    reason: classifyDeliveryIncidentReason(incident.reason),
    lastAttemptAt: now,
  }));
  const audit: DeliveryValidationAuditEntry[] = [
    ...(result.validatedOrders ?? []).map((order) => ({
      id: randomToken(),
      createdAt: now,
      orderId: order.orderId,
      orderName: order.orderName,
      pickingId: String(order.pickingId),
      mode: "manual" as const,
      trigger: "manual" as const,
      dryRun: result.dryRun ?? false,
      idempotencyKey: createDeliveryValidationIdempotencyKey(
        order.orderId ? `#${order.orderId}` : order.orderName,
        String(order.pickingId),
        undefined,
      ),
      durationMs,
      result: "validated" as const,
    })),
    ...incidents.map((incident) => ({
      id: randomToken(),
      createdAt: now,
      orderId: incident.orderId,
      orderName: incident.orderName,
      mode: "manual" as const,
      trigger: "manual" as const,
      dryRun: result.dryRun ?? false,
      idempotencyKey: createDeliveryValidationIdempotencyKey(
        incident.orderId ? `#${incident.orderId}` : incident.orderName,
        undefined,
        undefined,
      ),
      durationMs,
      result: "incident" as const,
      reason: incident.reason,
    })),
  ];
  const validatedKeys = new Set(
    (result.validatedOrders ?? []).flatMap((order) =>
      [order.orderName, order.orderId ? `#${order.orderId}` : ""]
        .map(cleanText)
        .filter(Boolean),
    ),
  );
  const orders = store.orders.map((order) =>
    validatedKeys.has(cleanText(order.id)) ||
    validatedKeys.has(cleanText(order.odooRef))
      ? {
          ...order,
          deliveryStatus: "Entregado",
          odooDeliveryValidation: {
            status: "validated" as const,
            tone: "ok" as const,
            label: "Validado Odoo ahora",
            reason: "Entrega validada desde Expediciones.",
            dateDone: formatDate(now),
            pickingId: order.odooDeliveryValidation?.pickingId,
            canValidate: false,
            validationMethod: "manual" as const,
          },
        }
      : order,
  );
  writeOrdersCache(env, {
    ...store,
    updatedAt: now,
    orders,
    incidents: mergeDeliveryIncidents(store.incidents, incidents),
    audit: [...store.audit, ...audit].slice(-1000),
  });
}

function createDeliveryIncidentId(orderId: number, reason: string) {
  return createHash("sha1")
    .update(`${orderId}:${classifyDeliveryIncidentReason(reason)}`)
    .digest("hex")
    .slice(0, 16);
}

function createDeliveryValidationIdempotencyKey(
  orderRef?: string | number,
  pickingId?: string | number,
  tracking?: string,
) {
  return createHash("sha1")
    .update(
      [cleanText(String(orderRef ?? "")), cleanText(String(pickingId ?? "")), cleanText(tracking)]
        .join(":")
        .toLowerCase(),
    )
    .digest("hex")
    .slice(0, 20);
}

function classifyDeliveryIncidentReason(reason: string) {
  const value = cleanText(reason).toLowerCase();
  if (value.includes("stock") || value.includes("reserv")) return "falta de stock";
  if (value.includes("sin albaran") || value.includes("no hay albaran")) return "picking no encontrado";
  if (value.includes("cancel")) return "picking bloqueado";
  if (value.includes("hecho") || value.includes("done") || value.includes("validado")) return "picking ya validado";
  if (value.includes("tracking")) return "pedido sin tracking";
  if (value.includes("sendcloud") || value.includes("etiqueta")) return "etiqueta Sendcloud no encontrada";
  if (value.includes("odoo")) return "error de Odoo";
  if (value.includes("comunic")) return "error de comunicación";
  if (value.includes("dato")) return "datos incompletos";
  return reason || "otra excepción";
}

async function retryDeliveryIncidents(env: Record<string, string>) {
  const store = readOrdersCache(env);
  const activeIncidents = store.incidents.filter((incident) => !incident.resolvedAt);
  const orderRefs = activeIncidents
    .map((incident) => (incident.orderId ? `#${incident.orderId}` : ""))
    .filter(Boolean);
  const startedAt = Date.now();
  const result = await validateOdooDeliveries(env, [], orderRefs);
  const validatedOrderIds = new Set(
    (result.validatedOrders ?? []).map((item) => item.orderId),
  );
  const now = new Date().toISOString();
  const nextIncidents = store.incidents.map((incident) =>
    validatedOrderIds.has(incident.orderId)
      ? { ...incident, resolvedAt: now, resolvedBy: "retry" }
      : incident,
  );
  const newIncidents = (result.incidents ?? []).map((incident) => ({
    id: createDeliveryIncidentId(incident.orderId, incident.reason),
    orderId: incident.orderId,
    orderName: incident.orderName,
    reason: classifyDeliveryIncidentReason(incident.reason),
    lastAttemptAt: now,
  }));
  const audit: DeliveryValidationAuditEntry[] = [
    ...(result.validatedOrders ?? []).map((order) => ({
      id: randomToken(),
      createdAt: now,
      orderId: order.orderId,
      orderName: order.orderName,
      pickingId: String(order.pickingId),
      mode: "manual" as const,
      durationMs: Date.now() - startedAt,
      result: "validated" as const,
    })),
    ...newIncidents.map((incident) => ({
      id: randomToken(),
      createdAt: now,
      orderId: incident.orderId,
      orderName: incident.orderName,
      mode: "manual" as const,
      durationMs: Date.now() - startedAt,
      result: "incident" as const,
      reason: incident.reason,
    })),
  ];
  writeOrdersCache(env, {
    ...store,
    incidents: mergeDeliveryIncidents(nextIncidents, newIncidents),
    audit: [...store.audit, ...audit].slice(-1000),
  });

  return {
    ok: true,
    retried: orderRefs.length,
    validated: result.validated ?? 0,
    incidents: result.incidents ?? [],
  };
}

function resolveDeliveryIncidents(
  env: Record<string, string>,
  incidentIds: string[],
  userName: string,
) {
  const ids = new Set(incidentIds);
  const now = new Date().toISOString();
  const store = readOrdersCache(env);
  const incidents = store.incidents.map((incident) =>
    ids.size === 0 || ids.has(incident.id)
      ? { ...incident, resolvedAt: now, resolvedBy: userName }
      : incident,
  );
  writeOrdersCache(env, { ...store, incidents });
  return {
    ok: true,
    resolved: incidents.filter((incident) => incident.resolvedAt === now).length,
  };
}

async function getOdooDashboard(
  env: Record<string, string>,
  range: { from?: string; to?: string },
) {
  if (!ordersFastCacheEnabled(env)) {
    return getOdooDashboardFull(env, range);
  }

  const startedAt = Date.now();
  const cache = readOrdersCache(env);
  const orders = filterCachedOrders(cache.orders, range);
  const today = new Date().toISOString().slice(0, 10);
  const activeIncidents = cache.incidents.filter((incident) => !incident.resolvedAt);
  recordOrdersMetric(env, {
    scope: "home",
    durationMs: Date.now() - startedAt,
    odooCalls: 0,
    sendcloudCalls: 0,
    orders: orders.length,
  });

  if (cache.sync.status === "never") {
    void syncOrdersCache(env, { from: range.from, to: range.to, autoValidate: false }).catch(() => {});
  }

  return {
    mode: "live" as const,
    source: "dashboard-cache" as const,
    totalOrders: orders.length,
    totalRevenue: sumNumbers(orders.map((order) => order.total)),
    todayOrders: orders.filter((order) => order.date === today).length,
    soldUnitsToday: 0,
    soldAmountToday: 0,
    activeCountries: 0,
    daily: groupCachedOrders(orders, (order) => order.date.slice(0, 10)).sort((left, right) =>
      left.label.localeCompare(right.label),
    ),
    channels: groupCachedOrders(orders, (order) => order.channel),
    countries: [],
    topProducts: [],
    cache: {
      updatedAt: cache.updatedAt,
      sync: cache.sync,
      incidentCount: activeIncidents.length,
      lastIncidentAt: activeIncidents[0]?.lastAttemptAt,
    },
    message:
      cache.sync.status === "never"
        ? "Cache vacia; sincronizacion en segundo plano iniciada."
        : undefined,
  };
}

async function getOdooDashboardV2(
  env: Record<string, string>,
  range: { from?: string; to?: string },
) {
  const startedAt = Date.now();
  const cache = readOrdersCache(env);
  const orders = filterCachedOrders(cache.orders, range);
  const today = new Date().toISOString().slice(0, 10);
  const activeIncidents = cache.incidents.filter((incident) => !incident.resolvedAt);

  recordOrdersMetric(env, {
    scope: "home",
    durationMs: Date.now() - startedAt,
    odooCalls: 0,
    sendcloudCalls: 0,
    orders: orders.length,
  });

  return {
    mode: "live" as const,
    source: "dashboard-cache" as const,
    version: "v2" as const,
    totalOrders: orders.length,
    totalRevenue: sumNumbers(orders.map((order) => order.total)),
    todayOrders: orders.filter((order) => order.date === today).length,
    soldUnitsToday: 0,
    soldAmountToday: 0,
    activeCountries: 0,
    daily: groupCachedOrders(orders, (order) => order.date.slice(0, 10)).sort((left, right) =>
      left.label.localeCompare(right.label),
    ),
    channels: groupCachedOrders(orders, (order) => order.channel),
    countries: [],
    topProducts: [],
    cache: {
      updatedAt: cache.updatedAt,
      sync: cache.sync,
      incidentCount: activeIncidents.length,
      lastIncidentAt: activeIncidents[0]?.lastAttemptAt,
    },
    metrics: getOrdersV2Performance(env),
    message:
      cache.sync.status === "never"
        ? "Cache V2 vacia. Pulsa Actualizar para sincronizar sin bloquear Home."
        : undefined,
  };
}

function groupCachedOrders(
  orders: OrdersCacheStore["orders"],
  getLabel: (order: OrdersCacheStore["orders"][number]) => string,
) {
  const rows = new Map<string, { label: string; orders: number; amount: number }>();
  orders.forEach((order) => {
    const label = getLabel(order) || "Sin dato";
    const row = rows.get(label) ?? { label, orders: 0, amount: 0 };
    row.orders += 1;
    row.amount += order.total;
    rows.set(label, row);
  });
  return Array.from(rows.values()).sort((left, right) => right.amount - left.amount);
}

function sumNumbers(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}


async function getOdooDashboardFull(
  env: Record<string, string>,
  range: { from?: string; to?: string },
) {
  const config = getOdooConfig(env);
  if (!config.url || !config.database || !config.username || !config.apiKey) {
    return {
      mode: "demo",
      totalOrders: 0,
      totalRevenue: 0,
      todayOrders: 0,
      soldUnitsToday: 0,
      soldAmountToday: 0,
      activeCountries: 0,
      daily: [],
      channels: [],
      countries: [],
      topProducts: [],
      message:
        "Faltan variables ODOO_URL, ODOO_DATABASE, ODOO_USERNAME u ODOO_API_KEY",
    };
  }

  const uid = await authenticate(config);
  const domain = buildOrderDomain(range);
  const today = new Date().toISOString().slice(0, 10);
  const todayDomain = buildOrderDomain({ from: today, to: today });

  const [
    totalOrders,
    totalRows,
    todayOrders,
    dailyRows,
    channelRows,
    shippingPartnerRows,
    topProductRows,
    soldTodayRows,
  ] = await Promise.all([
    executeKw(config, uid, "sale.order", "search_count", [
      domain,
    ]) as Promise<number>,
    executeKw(config, uid, "sale.order", "read_group", [
      domain,
      ["amount_total:sum"],
      [],
    ]) as Promise<ReadGroupRow[]>,
    executeKw(config, uid, "sale.order", "search_count", [
      todayDomain,
    ]) as Promise<number>,
    executeKw(
      config,
      uid,
      "sale.order",
      "read_group",
      [domain, ["amount_total:sum"], ["date_order:day"]],
      {
        lazy: false,
      },
    ) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "sale.order",
      "read_group",
      [domain, ["amount_total:sum"], ["team_id"]],
      {
        lazy: false,
        limit: 12,
      },
    ) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "sale.order",
      "read_group",
      [domain, ["amount_total:sum"], ["partner_shipping_id"]],
      {
        lazy: false,
        limit: 300,
      },
    ) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "sale.order.line",
      "read_group",
      [
        buildOrderLineDomain(range),
        ["product_uom_qty:sum", "price_subtotal:sum"],
        ["product_id"],
      ],
      {
        lazy: false,
        limit: 12,
      },
    ) as Promise<ReadGroupRow[]>,
    executeKw(config, uid, "sale.order.line", "read_group", [
      buildOrderLineDomain({ from: today, to: today }),
      ["product_uom_qty:sum", "price_subtotal:sum"],
      [],
    ]) as Promise<ReadGroupRow[]>,
  ]);

  const partnerIds = shippingPartnerRows
    .map((row) => getRelationId(row.partner_shipping_id))
    .filter((id): id is number => typeof id === "number");
  const partners = partnerIds.length
    ? ((await executeKw(config, uid, "res.partner", "read", [partnerIds], {
        fields: ["id", "country_id"],
      })) as PartnerRecord[])
    : [];
  const countryByPartnerId = new Map(
    partners.map((partner) => [
      partner.id,
      getRelationName(partner.country_id) || "Sin pais",
    ]),
  );
  const countryMap = new Map<
    string,
    { label: string; orders: number; amount: number }
  >();

  shippingPartnerRows.forEach((row) => {
    const partnerId = getRelationId(row.partner_shipping_id);
    const country = partnerId
      ? (countryByPartnerId.get(partnerId) ?? "Sin pais")
      : "Sin pais";
    const aggregate = countryMap.get(country) ?? {
      label: country,
      orders: 0,
      amount: 0,
    };
    aggregate.orders += row.__count ?? 0;
    aggregate.amount += row.amount_total ?? 0;
    countryMap.set(country, aggregate);
  });

  const countries = Array.from(countryMap.values()).sort(
    (left, right) => right.amount - left.amount,
  );

  return {
    mode: "live",
    totalOrders,
    totalRevenue: totalRows[0]?.amount_total ?? 0,
    todayOrders,
    soldUnitsToday: soldTodayRows[0]?.product_uom_qty ?? 0,
    soldAmountToday: soldTodayRows[0]?.price_subtotal ?? 0,
    activeCountries: countries.filter((country) => country.label !== "Sin pais")
      .length,
    daily: dailyRows.map((row) => ({
      label: String(row["date_order:day"] ?? row.date_order ?? "Sin fecha"),
      orders: row.__count ?? 0,
      amount: row.amount_total ?? 0,
    })),
    channels: channelRows.map((row) => ({
      label: getRelationName(row.team_id) || "Odoo",
      orders: row.__count ?? 0,
      amount: row.amount_total ?? 0,
    })),
    countries,
    topProducts: topProductRows
      .map((row) => ({
        label: getRelationName(row.product_id) || "Sin producto",
        quantity: row.product_uom_qty ?? 0,
        amount: row.price_subtotal ?? 0,
      }))
      .sort((left, right) => right.amount - left.amount),
  };
}

async function getOdooCustomerInvoices(
  env: Record<string, string>,
  range: {
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    sortKey?: string;
    sortDir?: string;
  },
) {
  const limit = parseInvoiceLimit(range.limit);
  const offset = parseInvoiceOffset(range.offset);
  const sortDir = range.sortDir === "asc" ? "asc" : "desc";
  const sortField = getInvoiceSortField(range.sortKey);
  const invoiceOrder = `${sortField} ${sortDir}, id ${sortDir}`;
  const config = getOdooConfig(env);
  if (!config.url || !config.database || !config.username || !config.apiKey) {
    return {
      mode: "demo",
      total: 0,
      limit,
      offset,
      amountTotal: 0,
      amountResidual: 0,
      invoices: [],
      daily: [],
      channels: [],
      countries: [],
      statuses: [],
      trends: {
        channels: [],
        countries: [],
        statuses: [],
      },
      message:
        "Faltan variables ODOO_URL, ODOO_DATABASE, ODOO_USERNAME u ODOO_API_KEY",
    };
  }

  const uid = await authenticate(config);
  const domain = buildInvoiceDomain(range);
  const fields = ["amount_total:sum", "amount_residual:sum"];
  const [
    total,
    totalRows,
    dailyRows,
    channelRows,
    countryRows,
    statusRows,
    channelTrendRows,
    countryTrendRows,
    statusTrendRows,
    invoiceRows,
  ] = await Promise.all([
    executeKw(config, uid, "account.move", "search_count", [domain]) as Promise<number>,
    executeKw(config, uid, "account.move", "read_group", [
      domain,
      fields,
      [],
    ]) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "account.move",
      "read_group",
      [domain, fields, ["invoice_date:day"]],
      { lazy: false, orderby: "invoice_date:day asc" },
    ) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "account.move",
      "read_group",
      [domain, fields, ["team_id"]],
      { lazy: false, limit: 12, orderby: "amount_total desc" },
    ) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "account.move",
      "read_group",
      [domain, fields, ["country_code"]],
      { lazy: false, limit: 12, orderby: "amount_total desc" },
    ) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "account.move",
      "read_group",
      [domain, fields, ["payment_state"]],
      { lazy: false, orderby: "amount_total desc" },
    ) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "account.move",
      "read_group",
      [domain, fields, ["invoice_date:day", "team_id"]],
      { lazy: false, orderby: "invoice_date:day asc" },
    ) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "account.move",
      "read_group",
      [domain, fields, ["invoice_date:day", "country_code"]],
      { lazy: false, orderby: "invoice_date:day asc" },
    ) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "account.move",
      "read_group",
      [domain, fields, ["invoice_date:day", "payment_state"]],
      { lazy: false, orderby: "invoice_date:day asc" },
    ) as Promise<ReadGroupRow[]>,
    executeKw(
      config,
      uid,
      "account.move",
      "search_read",
      [domain],
      {
        fields: [
          "id",
          "name",
          "invoice_date",
          "date",
          "partner_id",
          "team_id",
          "amount_untaxed",
          "amount_tax",
          "amount_total",
          "amount_residual",
          "payment_state",
          "state",
          "invoice_date_due",
          "country_code",
          "invoice_origin",
        ],
        order: invoiceOrder,
        limit,
        offset,
      },
    ) as Promise<OdooInvoiceRecord[]>,
  ]);

  const daily = dailyRows
    .map((row) => ({
      label: String(row["invoice_date:day"] ?? row.invoice_date ?? "Sin fecha"),
      count: row.__count ?? 0,
      total: row.amount_total ?? 0,
      residual: row.amount_residual ?? 0,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const channels = mapInvoiceMetricRows(channelRows, (row) =>
    getRelationName(row.team_id) || "Odoo",
  );
  const countries = mapInvoiceMetricRows(countryRows, (row) =>
    String(row.country_code || "Sin pais"),
  );
  const statuses = mapInvoiceMetricRows(statusRows, (row) =>
    translatePaymentState(String(row.payment_state || "")),
  );

  return {
    mode: "live",
    total,
    limit,
    offset,
    amountTotal: totalRows[0]?.amount_total ?? 0,
    amountResidual: totalRows[0]?.amount_residual ?? 0,
    invoices: invoiceRows.map((invoice) => ({
      id: String(invoice.id),
      ref: invoice.name || `Factura ${invoice.id}`,
      date: String(invoice.invoice_date || invoice.date || ""),
      partner: getRelationName(invoice.partner_id) || "Sin cliente",
      base: invoice.amount_untaxed ?? 0,
      tax: invoice.amount_tax ?? 0,
      total: invoice.amount_total ?? 0,
      residual: invoice.amount_residual ?? 0,
      status: translatePaymentState(invoice.payment_state),
      paymentState: invoice.payment_state,
      dueDate: String(invoice.invoice_date_due || ""),
      channel: getRelationName(invoice.team_id) || "Odoo",
      country: invoice.country_code || "Sin pais",
      origin: cleanText(invoice.invoice_origin),
    })),
    daily,
    channels,
    countries,
    statuses,
    trends: {
      channels: mapInvoiceTrendSeries(
        channelTrendRows,
        daily,
        channels,
        (row) => getRelationName(row.team_id) || "Odoo",
      ),
      countries: mapInvoiceTrendSeries(countryTrendRows, daily, countries, (row) =>
        String(row.country_code || "Sin pais"),
      ),
      statuses: mapInvoiceTrendSeries(statusTrendRows, daily, statuses, (row) =>
        translatePaymentState(String(row.payment_state || "")),
      ),
    },
  };
}

async function markOdooOrdersPrinted(
  env: Record<string, string>,
  orderIds: number[],
) {
  if (orderIds.length === 0) {
    throw new Error("No hay pedidos Odoo validos para marcar");
  }
  const config = getOdooConfig(env);
  if (!config.url || !config.database || !config.username || !config.apiKey) {
    throw new Error(
      "Faltan variables ODOO_URL, ODOO_DATABASE, ODOO_USERNAME u ODOO_API_KEY",
    );
  }

  const uid = await authenticate(config);
  const orders = (await executeKw(config, uid, "sale.order", "read", [orderIds], {
    fields: ["id", "picking_ids"],
  })) as Array<{ id: number; picking_ids?: number[] }>;
  if (orders.length === 0) {
    throw new Error("No se encontraron los pedidos seleccionados en Odoo");
  }

  const pickingIds = Array.from(
    new Set(orders.flatMap((order) => order.picking_ids ?? [])),
  );
  const now = formatOdooDateTime(new Date());

  await Promise.all(
    orders.map((order) =>
      executeKwStrictWrite(
        config,
        uid,
        "sale.order.delivery.print.history",
        "create",
        [
          {
            sale_order_id: order.id,
            print_date: now,
            user_id: uid,
            picking_ids: [[6, 0, order.picking_ids ?? []]],
          },
        ],
      ),
    ),
  );

  if (pickingIds.length > 0) {
    await executeKwStrictWrite(
      config,
      uid,
      "stock.picking",
      "write",
      [pickingIds, { printed: true }],
    );
  }

  const refreshed = (await executeKw(config, uid, "sale.order", "read", [orderIds], {
    fields: ["id", "delivery_is_printed", "delivery_print_count"],
  })) as Array<{
    id: number;
    delivery_is_printed?: boolean;
    delivery_print_count?: number;
  }>;
  const printedOrders = refreshed.filter((order) => order.delivery_is_printed);

  const updated = printedOrders.length;
  if (updated === 0) {
    throw new Error("Odoo creo el historial, pero no recalculo Delivery print");
  }

  return {
    ok: true,
    updated,
    orderIds,
    pickingIds,
    fields: ["delivery_print_history_ids", "printed"],
  };
}

async function diagnoseOdooDeliveryValidation(
  env: Record<string, string>,
  orderIdsInput: Array<string | number>,
  orderRefsInput: string[],
) {
  const config = getOdooConfig(env);
  if (!config.url || !config.database || !config.username || !config.apiKey) {
    throw new Error(
      "Faltan variables ODOO_URL, ODOO_DATABASE, ODOO_USERNAME u ODOO_API_KEY",
    );
  }

  const uid = await authenticate(config);
  const orderIds = normalizeOdooOrderIds([
    ...orderIdsInput,
    ...orderRefsInput,
  ]);
  const orderNames = orderRefsInput
    .map(cleanText)
    .filter((value) => value && !value.startsWith("#"));
  const domain: unknown[] = [];
  if (orderIds.length && orderNames.length) {
    domain.push("|", ["id", "in", orderIds], ["name", "in", orderNames]);
  } else if (orderIds.length) {
    domain.push(["id", "in", orderIds]);
  } else if (orderNames.length) {
    domain.push(["name", "in", orderNames]);
  } else {
    throw new Error("No hay pedidos Odoo validos para diagnosticar entrega");
  }

  const orders = (await executeKw(
    config,
    uid,
    "sale.order",
    "search_read",
    [domain],
    {
      fields: [
        "id",
        "name",
        "team_id",
        "origin",
        "client_order_ref",
        "amz_fulfillment_by",
        "state",
        "picking_ids",
      ],
      limit: 100,
    },
  )) as OdooRecord[];
  if (orders.length === 0) {
    throw new Error("No se encontraron pedidos seleccionados en Odoo");
  }

  const pickingIds = Array.from(
    new Set(orders.flatMap((order) => order.picking_ids ?? [])),
  );
  const pickings = pickingIds.length
    ? ((await executeKw(config, uid, "stock.picking", "read", [pickingIds], {
        fields: [
          "id",
          "name",
          "state",
          "origin",
          "date_done",
          "scheduled_date",
          "move_ids_without_package",
        ],
      })) as OdooPickingRecord[])
    : [];
  const pickingsById = new Map(pickings.map((picking) => [picking.id, picking]));
  const moveIds = Array.from(
    new Set(pickings.flatMap((picking) => picking.move_ids_without_package ?? [])),
  );
  const moves = moveIds.length
    ? ((await executeKw(config, uid, "stock.move", "read", [moveIds], {
        fields: [
          "id",
          "name",
          "state",
          "product_id",
          "product_uom_qty",
          "quantity",
          "picked",
          "scrapped",
        ],
      })) as OdooMoveRecord[])
    : [];
  const movesById = new Map(moves.map((move) => [move.id, move]));
  const sendcloudByReference = await getSendcloudStatuses(
    env,
    Array.from(
      new Set(
        orders
          .map((order) => getExternalOrderRef(order))
          .map(cleanText)
          .filter(Boolean),
      ),
    ),
  );

  const diagnostics = orders.map((order) => {
    const relatedPickings = (order.picking_ids ?? [])
      .map((id) => pickingsById.get(id))
      .filter((picking): picking is OdooPickingRecord => Boolean(picking));
    const sendcloud = sendcloudByReference.get(getExternalOrderRef(order));
    const dashboardPrecheck = buildOdooDeliveryValidation(
      order,
      relatedPickings,
      sendcloud,
    );

    return {
      orderId: order.id,
      orderName: order.name,
      orderState: order.state,
      externalReference: getExternalOrderRef(order),
      fulfillment: getFulfillmentBy(order),
      sendcloud: sendcloud
        ? {
            status: sendcloud.status,
            rawStatus: sendcloud.rawStatus,
            trackingNumber: sendcloud.trackingNumber,
          }
        : null,
      dashboardPrecheck,
      pickings: relatedPickings.map((picking) =>
        diagnosePickingForNativeValidation(
          picking,
          (picking.move_ids_without_package ?? [])
            .map((id) => movesById.get(id))
            .filter((move): move is OdooMoveRecord => Boolean(move)),
        ),
      ),
    };
  });

  return {
    ok: true,
    mode: "diagnosis-only",
    nativeMethod: "stock.picking.button_validate",
    notes: [
      "No se llama a button_validate en este diagnostico.",
      "No se escriben campos ni estados en Odoo.",
      "La prediccion de wizard se calcula con datos leidos y reglas nativas conocidas.",
    ],
    orders: diagnostics,
  };
}

function diagnosePickingForNativeValidation(
  picking: OdooPickingRecord,
  moves: OdooMoveRecord[],
) {
  const actionableMoves = moves.filter(
    (move) => move.state !== "done" && move.state !== "cancel",
  );
  const hasQuantity = actionableMoves.some((move) => Number(move.quantity ?? 0) > 0);
  const hasPicked = actionableMoves.some((move) => move.picked && !move.scrapped);
  const withoutQuantities =
    actionableMoves.length > 0 &&
    actionableMoves
      .filter((move) => !hasPicked || move.picked)
      .every((move) => Number(move.quantity ?? 0) <= 0);
  const partialMoves = actionableMoves.filter((move) => {
    const demanded = Number(move.product_uom_qty ?? 0);
    const quantity = Number(move.quantity ?? 0);
    return quantity > 0 && demanded > 0 && quantity < demanded;
  });

  let expectedNativeResult:
    | { type: "already_done"; detail: string }
    | { type: "blocked"; detail: string }
    | { type: "wizard"; resModel: string; detail: string }
    | { type: "button_validate"; detail: string };

  if (picking.state === "done") {
    expectedNativeResult = {
      type: "already_done",
      detail: "Odoo filtraria este picking porque ya esta en estado done.",
    };
  } else if (picking.state === "cancel") {
    expectedNativeResult = {
      type: "blocked",
      detail: "Picking cancelado; no se debe validar desde Dashboard.",
    };
  } else if (moves.length === 0) {
    expectedNativeResult = {
      type: "blocked",
      detail: "Odoo no validaria un traslado sin movimientos.",
    };
  } else if (withoutQuantities) {
    expectedNativeResult = {
      type: "blocked",
      detail:
        "Odoo lanzaria error de sanity check: no hay cantidades hechas/reservadas validables.",
    };
  } else if (partialMoves.length > 0) {
    expectedNativeResult = {
      type: "wizard",
      resModel: "stock.backorder.confirmation",
      detail:
        "Hay cantidades menores que la demanda; Odoo pediria decidir backorder/cancelar restante.",
    };
  } else if (hasQuantity && !hasPicked) {
    expectedNativeResult = {
      type: "button_validate",
      detail:
        "Odoo _pre_action_done_hook marcaria picked automaticamente antes de _action_done.",
    };
  } else {
    expectedNativeResult = {
      type: "button_validate",
      detail: "Odoo deberia entrar en _action_done si no aparece otro wizard de modulos instalados.",
    };
  }

  return {
    pickingId: picking.id,
    pickingName: picking.name,
    state: picking.state,
    scheduledDate: picking.scheduled_date,
    dateDone: picking.date_done,
    expectedNativeResult,
    summary: {
      moveCount: moves.length,
      actionableMoveCount: actionableMoves.length,
      hasQuantity,
      hasPicked,
      withoutQuantities,
      partialMoveCount: partialMoves.length,
    },
    moves: moves.map((move) => ({
      id: move.id,
      name: move.name,
      product: getRelationName(move.product_id),
      state: move.state,
      demand: Number(move.product_uom_qty ?? 0),
      quantity: Number(move.quantity ?? 0),
      picked: Boolean(move.picked),
      scrapped: Boolean(move.scrapped),
    })),
  };
}

async function validateOdooDeliveries(
  env: Record<string, string>,
  orderIdsInput: Array<string | number>,
  orderRefsInput: string[],
  options: {
    dryRun?: boolean;
    mode?: "manual" | "automatic";
    trigger?: "manual" | "sync-incremental" | "sync-full" | "sendcloud-webhook";
    source?: "sendcloud" | "genei-label";
    tracking?: string;
  } = {},
) {
  const dryRun = options.dryRun ?? false;
  const trigger = options.trigger ?? (options.mode === "automatic" ? "sync-incremental" : "manual");
  const config = getOdooConfig(env);
  if (!config.url || !config.database || !config.username || !config.apiKey) {
    throw new Error(
      "Faltan variables ODOO_URL, ODOO_DATABASE, ODOO_USERNAME u ODOO_API_KEY",
    );
  }

  const uid = await authenticate(config);
  const orderIds = normalizeOdooOrderIds([
    ...orderIdsInput,
    ...orderRefsInput,
  ]);
  const orderNames = orderRefsInput
    .map(cleanText)
    .filter((value) => value && !value.startsWith("#"));
  const domain: unknown[] = [];
  if (orderIds.length && orderNames.length) {
    domain.push("|", ["id", "in", orderIds], ["name", "in", orderNames]);
  } else if (orderIds.length) {
    domain.push(["id", "in", orderIds]);
  } else if (orderNames.length) {
    domain.push(["name", "in", orderNames]);
  } else {
    throw new Error("No hay pedidos Odoo validos para validar entrega");
  }

  const orders = (await executeKw(
    config,
    uid,
    "sale.order",
    "search_read",
    [domain],
    {
      fields: [
        "id",
        "name",
        "team_id",
        "origin",
        "client_order_ref",
        "amz_fulfillment_by",
        "state",
        "picking_ids",
      ],
      limit: 100,
    },
  )) as OdooRecord[];
  if (orders.length === 0) {
    throw new Error("No se encontraron pedidos seleccionados en Odoo");
  }

  const pickingIds = Array.from(
    new Set(orders.flatMap((order) => order.picking_ids ?? [])),
  );
  const pickings = pickingIds.length
    ? ((await executeKw(config, uid, "stock.picking", "read", [pickingIds], {
        fields: ["id", "name", "state", "origin", "date_done", "scheduled_date"],
      })) as OdooPickingRecord[])
    : [];
  const pickingsById = new Map(pickings.map((picking) => [picking.id, picking]));
  const sendcloudByReference = await getSendcloudStatuses(
    env,
    Array.from(
      new Set(
        orders
          .map((order) => getExternalOrderRef(order))
          .map(cleanText)
          .filter(Boolean),
      ),
    ),
  );

  const validated: Array<{ orderId: number; orderName?: string; pickingId: number }> =
    [];
  const incidents: Array<{ orderId: number; orderName?: string; reason: string }> = [];
  const seenIdempotencyKeys = new Set<string>();

  for (const order of orders) {
    const relatedPickings = (order.picking_ids ?? [])
      .map((id) => pickingsById.get(id))
      .filter((picking): picking is OdooPickingRecord => Boolean(picking));
    const sendcloud =
      options.source === "genei-label"
        ? buildGeneiLabelValidationStatus(order, options.tracking)
        : sendcloudByReference.get(getExternalOrderRef(order));
    const precheck = buildOdooDeliveryValidation(order, relatedPickings, sendcloud);
    const idempotencyKey = createDeliveryValidationIdempotencyKey(
      `#${order.id}`,
      precheck.pickingId,
      sendcloud?.trackingNumber,
    );
    if (seenIdempotencyKeys.has(idempotencyKey)) {
      incidents.push({
        orderId: order.id,
        orderName: order.name,
        reason: "Validacion duplicada ignorada por idempotencia.",
      });
      continue;
    }
    seenIdempotencyKeys.add(idempotencyKey);
    if (precheck.status === "validated" && relatedPickings.length === 1) {
      validated.push({
        orderId: order.id,
        orderName: order.name,
        pickingId: relatedPickings[0].id,
      });
      continue;
    }
    if (!precheck.canValidate || relatedPickings.length !== 1) {
      incidents.push({
        orderId: order.id,
        orderName: order.name,
        reason: precheck.reason,
      });
      continue;
    }

    const pickingId = relatedPickings[0].id;
    if (dryRun) {
      validated.push({ orderId: order.id, orderName: order.name, pickingId });
      continue;
    }

    await executeKwStrictWrite(config, uid, "stock.picking", "action_assign", [
      [pickingId],
    ]);
    const [reservedPicking] = (await executeKw(
      config,
      uid,
      "stock.picking",
      "read",
      [[pickingId]],
      { fields: ["id", "state", "date_done"] },
    )) as OdooPickingRecord[];
    if (reservedPicking?.state !== "assigned") {
      incidents.push({
        orderId: order.id,
        orderName: order.name,
        reason: `Odoo dejo el albaran en estado ${translatePickingState(
          reservedPicking?.state,
        )}; no se valida automaticamente.`,
      });
      continue;
    }

    const result = await executeKwStrictWrite(
      config,
      uid,
      "stock.picking",
      "button_validate",
      [[pickingId]],
      { context: { button_validate_picking_ids: [pickingId] } },
    );
    if (result && typeof result === "object") {
      if (isPackageNumberWizard(result)) {
        await processSinglePackageValidationWizard(config, uid, pickingId);
      } else {
        incidents.push({
          orderId: order.id,
          orderName: order.name,
          reason:
            "Odoo requiere asistente de validacion/backorder; se deja como incidencia manual.",
        });
        continue;
      }
    }

    const [donePicking] = (await executeKw(
      config,
      uid,
      "stock.picking",
      "read",
      [[pickingId]],
      { fields: ["id", "state", "date_done"] },
    )) as OdooPickingRecord[];
    if (donePicking?.state === "done") {
      validated.push({ orderId: order.id, orderName: order.name, pickingId });
    } else {
      incidents.push({
        orderId: order.id,
        orderName: order.name,
        reason: `Odoo no dejo el albaran como hecho; estado actual ${translatePickingState(
          donePicking?.state,
        )}.`,
      });
    }
  }

  return {
    ok: true,
    mode: options.mode ?? "manual",
    dryRun,
    trigger,
    candidates: orders.length,
    validables: validated.length,
    validated: validated.length,
    incidents,
    validatedOrders: validated,
  };
}

async function executeKwStrictWrite(
  config: ReturnType<typeof getOdooConfig>,
  uid: number,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
) {
  if (
    model === "stock.picking" &&
    (method === "action_assign" || method === "button_validate")
  ) {
    const ids = Array.isArray(args) ? args[0] : undefined;
    if (
      !Array.isArray(ids) ||
      ids.some((id) => !Number.isInteger(id) || Number(id) <= 0)
    ) {
      throw new Error("Operacion Odoo bloqueada: albaranes no validos");
    }
    return rpc(config.url, "object", "execute_kw", [
      config.database,
      uid,
      config.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  if (model === "stock.picking" && method === "write") {
    const values = Array.isArray(args) ? args[1] : undefined;
    if (
      !values ||
      typeof values !== "object" ||
      Array.isArray(values) ||
      Object.keys(values).some((field) => field !== "printed")
    ) {
      throw new Error("Operacion Odoo bloqueada: campos no permitidos");
    }

    return rpc(config.url, "object", "execute_kw", [
      config.database,
      uid,
      config.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  if (model === "stock.move" && method === "write") {
    const ids = Array.isArray(args) ? args[0] : undefined;
    const values = Array.isArray(args) ? args[1] : undefined;
    if (
      !Array.isArray(ids) ||
      ids.some((id) => !Number.isInteger(id) || Number(id) <= 0) ||
      !values ||
      typeof values !== "object" ||
      Array.isArray(values) ||
      Object.keys(values).some((field) => field !== "picked") ||
      (values as { picked?: unknown }).picked !== true
    ) {
      throw new Error("Operacion Odoo bloqueada: movimientos no validos");
    }

    return rpc(config.url, "object", "execute_kw", [
      config.database,
      uid,
      config.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  if (
    model === "stock.number.package.validate.wizard" &&
    (method === "create" || method === "process")
  ) {
    const context = kwargs.context;
    const pickingIds =
      context &&
      typeof context === "object" &&
      !Array.isArray(context) &&
      Array.isArray(
        (context as { button_validate_picking_ids?: unknown })
          .button_validate_picking_ids,
      )
        ? (context as { button_validate_picking_ids: unknown[] })
            .button_validate_picking_ids
        : [];
    if (
      pickingIds.length !== 1 ||
      pickingIds.some((id) => !Number.isInteger(id) || Number(id) <= 0)
    ) {
      throw new Error("Operacion Odoo bloqueada: wizard sin albaran valido");
    }

    if (method === "create") {
      const values = Array.isArray(args) ? args[0] : undefined;
      if (
        !values ||
        typeof values !== "object" ||
        Array.isArray(values) ||
        (values as { number_of_packages?: unknown }).number_of_packages !== 1 ||
        (values as { print_package_label?: unknown }).print_package_label !== false
      ) {
        throw new Error("Operacion Odoo bloqueada: wizard no valido");
      }
    } else {
      const ids = Array.isArray(args) ? args[0] : undefined;
      if (
        !Array.isArray(ids) ||
        ids.some((id) => !Number.isInteger(id) || Number(id) <= 0)
      ) {
        throw new Error("Operacion Odoo bloqueada: wizard no valido");
      }
    }

    return rpc(config.url, "object", "execute_kw", [
      config.database,
      uid,
      config.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  if (model === "sale.order.delivery.print.history" && method === "create") {
    const values = Array.isArray(args) ? args[0] : undefined;
    const allowedFields = new Set([
      "sale_order_id",
      "print_date",
      "user_id",
      "picking_ids",
    ]);
    if (
      !values ||
      typeof values !== "object" ||
      Array.isArray(values) ||
      Object.keys(values).some((field) => !allowedFields.has(field))
    ) {
      throw new Error("Operacion Odoo bloqueada: historial no permitido");
    }

    return rpc(config.url, "object", "execute_kw", [
      config.database,
      uid,
      config.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  throw new Error("Operacion Odoo bloqueada: escritura no permitida");
}

async function markReservedPickingMovesPicked(
  config: ReturnType<typeof getOdooConfig>,
  uid: number,
  pickingId: number,
) {
  const [picking] = (await executeKw(
    config,
    uid,
    "stock.picking",
    "read",
    [[pickingId]],
    { fields: ["id", "state", "move_ids_without_package"] },
  )) as Array<OdooPickingRecord & { move_ids_without_package?: number[] }>;
  if (picking?.state !== "assigned") {
    throw new Error("Odoo no tiene el albaran reservado para marcar picked");
  }

  const moveIds = picking.move_ids_without_package ?? [];
  if (moveIds.length === 0) {
    throw new Error("El albaran no tiene movimientos para validar");
  }

  const moves = (await executeKw(config, uid, "stock.move", "read", [moveIds], {
    fields: ["id", "state", "product_uom_qty", "quantity", "picked"],
  })) as Array<{
    id: number;
    state?: string;
    product_uom_qty?: number;
    quantity?: number;
    picked?: boolean;
  }>;

  const unsafeMove = moves.find((move) => {
    const demanded = Number(move.product_uom_qty ?? 0);
    const reservedOrDone = Number(move.quantity ?? 0);
    return move.state !== "assigned" || demanded <= 0 || reservedOrDone < demanded;
  });
  if (unsafeMove) {
    throw new Error(
      "Odoo no tiene todas las cantidades reservadas; requiere revision manual.",
    );
  }

  const movesToPick = moves
    .filter((move) => !move.picked)
    .map((move) => move.id);
  if (movesToPick.length === 0) return;

  await executeKwStrictWrite(config, uid, "stock.move", "write", [
    movesToPick,
    { picked: true },
  ]);
}

function isPackageNumberWizard(result: unknown) {
  return (
    Boolean(result) &&
    typeof result === "object" &&
    (result as { res_model?: string }).res_model ===
      "stock.number.package.validate.wizard"
  );
}

async function processSinglePackageValidationWizard(
  config: ReturnType<typeof getOdooConfig>,
  uid: number,
  pickingId: number,
) {
  const context = {
    button_validate_picking_ids: [pickingId],
    default_pick_ids: [[4, pickingId]],
  };
  const wizardId = (await executeKwStrictWrite(
    config,
    uid,
    "stock.number.package.validate.wizard",
    "create",
    [
      {
        pick_ids: [[4, pickingId]],
        number_of_packages: 1,
        print_package_label: false,
      },
    ],
    { context },
  )) as number;
  await executeKwStrictWrite(
    config,
    uid,
    "stock.number.package.validate.wizard",
    "process",
    [[wizardId]],
    { context },
  );
}

function buildOrderDomain(range: { from?: string; to?: string; search?: string }) {
  const domain: unknown[] = [["state", "in", ["sale", "done"]]];
  if (range.from) domain.push(["date_order", ">=", `${range.from} 00:00:00`]);
  if (range.to) domain.push(["date_order", "<=", `${range.to} 23:59:59`]);
  const search = cleanText(range.search);
  if (search) {
    const numericId = /^#?\d+$/.test(search) ? Number(search.replace("#", "")) : null;
    const searchTerms: unknown[] = [
      ["name", "ilike", search],
      ["client_order_ref", "ilike", search],
      ["origin", "ilike", search],
      ["partner_id", "ilike", search],
    ];
    if (numericId) searchTerms.unshift(["id", "=", numericId]);
    domain.push(...Array(Math.max(0, searchTerms.length - 1)).fill("|"), ...searchTerms);
  }
  return domain;
}

function buildIncrementalOrderDomain(
  range: { from?: string; to?: string },
  incrementalSince: string,
) {
  const domain: unknown[] = [["write_date", ">=", incrementalSince]];
  if (range.from) domain.push(["date_order", ">=", `${range.from} 00:00:00`]);
  if (range.to) domain.push(["date_order", "<=", `${range.to} 23:59:59`]);
  return domain;
}

function buildOrderLineDomain(range: { from?: string; to?: string }) {
  const domain: unknown[] = [
    ["state", "in", ["sale", "done"]],
    ["display_type", "=", false],
  ];
  if (range.from)
    domain.push(["order_id.date_order", ">=", `${range.from} 00:00:00`]);
  if (range.to)
    domain.push(["order_id.date_order", "<=", `${range.to} 23:59:59`]);
  return domain;
}

function parseInvoiceLimit(value?: number) {
  const allowed = [20, 50, 100, 200];
  return allowed.includes(value ?? 50) ? (value ?? 50) : 50;
}

function parseInvoiceOffset(value?: number) {
  return Number.isFinite(value ?? 0) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function getInvoiceSortField(sortKey?: string) {
  const fields: Record<string, string> = {
    date: "invoice_date",
    ref: "name",
    partner: "partner_id",
    channel: "team_id",
    status: "payment_state",
    total: "amount_total",
    residual: "amount_residual",
  };
  return fields[sortKey ?? "date"] ?? fields.date;
}

function buildInvoiceDomain(range: { from?: string; to?: string }) {
  const domain: unknown[] = [
    ["move_type", "=", "out_invoice"],
    ["state", "!=", "cancel"],
  ];
  if (range.from) domain.push(["invoice_date", ">=", range.from]);
  if (range.to) domain.push(["invoice_date", "<=", range.to]);
  return domain;
}

function mapInvoiceMetricRows(
  rows: ReadGroupRow[],
  getLabel: (row: ReadGroupRow) => string,
) {
  return rows
    .map((row) => ({
      label: getLabel(row),
      count: row.__count ?? 0,
      total: row.amount_total ?? 0,
      residual: row.amount_residual ?? 0,
    }))
    .sort((left, right) => right.total - left.total);
}

function mapInvoiceTrendSeries(
  rows: ReadGroupRow[],
  dailyRows: Array<{ label: string }>,
  metricRows: Array<{ label: string }>,
  getLabel: (row: ReadGroupRow) => string,
) {
  const dates = dailyRows.map((row) => row.label);
  const labels = metricRows.slice(0, 6).map((row) => row.label);
  const byLabelAndDate = new Map<
    string,
    Map<string, { date: string; total: number; residual: number; count: number }>
  >();

  rows.forEach((row) => {
    const label = getLabel(row);
    if (!labels.includes(label)) return;
    const date = String(row["invoice_date:day"] ?? row.invoice_date ?? "Sin fecha");
    const points = byLabelAndDate.get(label) ?? new Map();
    const point = points.get(date) ?? { date, total: 0, residual: 0, count: 0 };
    point.total += row.amount_total ?? 0;
    point.residual += row.amount_residual ?? 0;
    point.count += row.__count ?? 0;
    points.set(date, point);
    byLabelAndDate.set(label, points);
  });

  return labels.map((label) => {
    const points = byLabelAndDate.get(label) ?? new Map();
    return {
      label,
      points: dates.map(
        (date) => points.get(date) ?? { date, total: 0, residual: 0, count: 0 },
      ),
    };
  });
}

function normalizeOdooOrderIds(values: Array<string | number>) {
  return Array.from(
    new Set(
      values
        .map((value) => {
          if (typeof value === "number" && Number.isInteger(value)) return value;
          const text = String(value).trim();
          const match = text.match(/^#?(\d+)$/);
          return match ? Number(match[1]) : 0;
        })
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}

function formatOdooDateTime(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function getOdooConfig(env: Record<string, string>) {
  return {
    url: trimTrailingSlash(env.ODOO_URL ?? ""),
    database: env.ODOO_DATABASE ?? "",
    username: env.ODOO_USERNAME ?? "",
    apiKey: env.ODOO_API_KEY ?? "",
  };
}

function getSendcloudConfig(env: Record<string, string>) {
  return {
    publicKey: env.SENDCLOUD_PUBLIC_KEY ?? "",
    secretKey: env.SENDCLOUD_SECRET_KEY ?? "",
  };
}

async function authenticate(config: ReturnType<typeof getOdooConfig>) {
  const uid = await rpc(config.url, "common", "authenticate", [
    config.database,
    config.username,
    config.apiKey,
    {},
  ]);
  if (!uid) {
    throw new Error("Odoo no ha aceptado el usuario/API key");
  }
  return uid as number;
}

async function executeKw(
  config: ReturnType<typeof getOdooConfig>,
  uid: number,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
) {
  if (!readOnlyModels.has(model) || !readOnlyMethods.has(method)) {
    throw new Error("Operacion Odoo bloqueada: solo lectura");
  }

  return rpc(config.url, "object", "execute_kw", [
    config.database,
    uid,
    config.apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function rpc(
  url: string,
  service: string,
  method: string,
  args: unknown[],
) {
  const result = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: Date.now(),
    }),
  });
  const payload = await result.json();

  if (payload.error) {
    throw new Error(
      payload.error.data?.message ?? payload.error.message ?? "Error RPC Odoo",
    );
  }

  return payload.result;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getRelationName(value: OdooRecord["partner_id"]) {
  return Array.isArray(value) ? value[1] : "";
}

function getRelationId(value: OdooRecord["partner_id"]) {
  return Array.isArray(value) ? value[0] : undefined;
}

function mapBomByProduct(
  productIds: number[],
  productTemplateById: Map<number, number>,
  bomRecords: BomRecord[],
) {
  const byProduct = new Map<number, BomRecord>();

  productIds.forEach((productId) => {
    const templateId = productTemplateById.get(productId);
    const exactBom = bomRecords.find(
      (bom) => getRelationId(bom.product_id) === productId,
    );
    const templateBom = bomRecords.find(
      (bom) =>
        getRelationId(bom.product_tmpl_id) === templateId &&
        !getRelationId(bom.product_id),
    );
    const bom = exactBom ?? templateBom;
    if (bom) byProduct.set(productId, bom);
  });

  return byProduct;
}

function getProductCode(value: string) {
  const match = value.match(/^\[([^\]]+)\]/);
  return match?.[1] ?? "";
}

function stripProductCode(value: string) {
  return value.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function formatUom(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "unit" || normalized === "units" || normalized === "unidad") {
    return "uds";
  }
  return value || "uds";
}

function formatLocation(partner?: PartnerRecord) {
  if (!partner) return "";
  const city = cleanText(partner.city);
  const country = getRelationName(partner.country_id);
  return [city, country].filter(Boolean).join(", ");
}

function formatShippingAddress(partner?: PartnerRecord) {
  if (!partner) return "";
  const street = cleanText(partner.street);
  const street2 = cleanText(partner.street2);
  const zip = cleanText(partner.zip);
  const city = cleanText(partner.city);
  const country = getRelationName(partner.country_id);
  return [street, street2, [zip, city].filter(Boolean).join(" "), country]
    .filter(Boolean)
    .join(", ");
}

function formatPhone(partner?: PartnerRecord) {
  if (!partner) return "";
  const mobile = cleanText(partner.mobile);
  const phone = cleanText(partner.phone);
  return mobile || phone;
}

function getCountryCode(partner?: PartnerRecord) {
  const country = getRelationName(partner?.country_id).toUpperCase();
  const codes: Record<string, string> = {
    "ESPAÑA": "ES",
    SPAIN: "ES",
    FRANCIA: "FR",
    FRANCE: "FR",
    PORTUGAL: "PT",
    ITALIA: "IT",
    ITALY: "IT",
    ALEMANIA: "DE",
    GERMANY: "DE",
  };
  return codes[country] ?? "";
}

function cleanText(value?: string | false) {
  return typeof value === "string" ? value.trim() : "";
}

function formatProductImage(value?: string | false) {
  return typeof value === "string" && value
    ? `data:image/png;base64,${value}`
    : undefined;
}

function formatDate(value?: string) {
  if (!value) return "";
  return value.slice(0, 16).replace("T", " ");
}

function buildOdooActionPreview(
  order: OdooRecord,
  pickings: Array<{ state?: string } | undefined>,
  printed: boolean,
  sendcloud?: SendcloudStatus,
) {
  const fulfillment = getFulfillmentBy(order);
  const saleState = order.state ?? "";
  const hasPickings = pickings.length > 0;
  const pickingStates = pickings.map((picking) => picking?.state).filter(Boolean);
  const sendcloudReadyToValidate = isSendcloudReadyToValidate(sendcloud?.status);
  const hasAssignedPicking = pickingStates.includes("assigned");
  const hasDonePicking = pickingStates.includes("done");

  let printMark:
    | { status: "ready"; label: string; reason: string }
    | { status: "blocked"; label: string; reason: string }
    | { status: "review"; label: string; reason: string };

  if (printed) {
    printMark = {
      status: "blocked",
      label: "Ya marcado como impreso",
      reason: "Odoo ya indica que el albaran esta impreso.",
    };
  } else if (!hasPickings) {
    printMark = {
      status: "blocked",
      label: "No se puede marcar impreso",
      reason: "El pedido no tiene albaran asociado.",
    };
  } else {
    printMark = {
      status: "ready",
      label: "Se podria marcar como impreso",
      reason: "Tiene albaran asociado y aun no figura como impreso.",
    };
  }

  let deliveryValidation:
    | { status: "ready"; label: string; reason: string }
    | { status: "blocked"; label: string; reason: string }
    | { status: "review"; label: string; reason: string };

  if (fulfillment === "FBA") {
    deliveryValidation = {
      status: "blocked",
      label: "Bloqueado",
      reason: "Amazon FBA lo gestiona Amazon, no se valida desde Sendcloud.",
    };
  } else if (saleState === "cancel" || saleState === "draft") {
    deliveryValidation = {
      status: "blocked",
      label: "Bloqueado",
      reason: "Pedido cancelado/borrador.",
    };
  } else if (!hasPickings) {
    deliveryValidation = {
      status: "blocked",
      label: "Bloqueado",
      reason: "Sin albaran asociado en Odoo.",
    };
  } else if (hasDonePicking) {
    deliveryValidation = {
      status: "blocked",
      label: "Ya validado",
      reason: "El albaran ya esta en estado hecho.",
    };
  } else if (!sendcloud) {
    deliveryValidation = {
      status: "review",
      label: "Revisar",
      reason: "No hay estado de Sendcloud para confirmar etiqueta.",
    };
  } else if (!sendcloudReadyToValidate) {
    deliveryValidation = {
      status: "blocked",
      label: "Bloqueado",
      reason: `Sendcloud esta en "${sendcloud.status}", aun no tiene etiqueta validable.`,
    };
  } else if (!hasAssignedPicking) {
    deliveryValidation = {
      status: "review",
      label: "Revisar stock/albaran",
      reason: `Estado albaran: ${pickingStates.join(", ") || "sin estado"}. No se forzaria validacion.`,
    };
  } else {
    deliveryValidation = {
      status: "ready",
      label: "Se podria validar entrega",
      reason: "Sendcloud tiene etiqueta creada o envio confirmado y Odoo tiene albaran reservado/validable.",
    };
  }

  return { printMark, deliveryValidation };
}

function buildOdooDeliveryValidation(
  order: OdooRecord,
  pickings: OdooPickingRecord[],
  sendcloud?: SendcloudStatus,
) {
  const fulfillment = getFulfillmentBy(order);
  const saleState = order.state ?? "";
  const pickingStates = pickings.map((picking) => picking.state).filter(Boolean);
  const donePickings = pickings.filter((picking) => picking.state === "done");
  const firstPicking = pickings[0];

  if (donePickings.length === pickings.length && donePickings.length > 0) {
    const dateDone = donePickings
      .map((picking) => formatDate(picking.date_done || ""))
      .filter(Boolean)
      .sort()
      .slice(-1)[0];
    return {
      status: "validated" as const,
      tone: "ok" as const,
      label: dateDone ? `Validado Odoo ${dateDone}` : "Validado Odoo",
      reason: "El albaran ya esta en estado hecho.",
      dateDone,
      pickingId: firstPicking ? String(firstPicking.id) : undefined,
      canValidate: false,
    };
  }

  if (fulfillment === "FBA") {
    return {
      status: "incident" as const,
      tone: "neutral" as const,
      label: "Gestion Amazon",
      reason: "Amazon FBA lo gestiona Amazon, no se valida desde Sendcloud.",
      canValidate: false,
    };
  }

  if (saleState === "cancel" || saleState === "draft") {
    return {
      status: "incident" as const,
      tone: "danger" as const,
      label: "Incidencia",
      reason: "Pedido cancelado/borrador.",
      canValidate: false,
    };
  }

  if (pickings.length === 0) {
    return {
      status: "incident" as const,
      tone: "danger" as const,
      label: "Sin albaran",
      reason: "No hay albaran asociado en Odoo.",
      canValidate: false,
    };
  }

  if (pickings.length > 1) {
    return {
      status: "incident" as const,
      tone: "warning" as const,
      label: "Revisar parcial",
      reason: `Hay ${pickings.length} albaranes (${pickingStates.join(", ")}); requiere revision manual.`,
      canValidate: false,
    };
  }

  if (firstPicking.state === "cancel") {
    return {
      status: "incident" as const,
      tone: "danger" as const,
      label: "Albaran cancelado",
      reason: "El albaran esta cancelado en Odoo.",
      pickingId: String(firstPicking.id),
      canValidate: false,
    };
  }

  if (!sendcloud) {
    return {
      status: "pending" as const,
      tone: "neutral" as const,
      label: "Sin Sendcloud",
      reason: "No hay estado de Sendcloud para confirmar etiqueta.",
      pickingId: String(firstPicking.id),
      canValidate: false,
    };
  }

  if (!isSendcloudReadyToValidate(sendcloud.status)) {
    return {
      status: "pending" as const,
      tone: "neutral" as const,
      label: "Pendiente etiqueta",
      reason: `Sendcloud esta en "${sendcloud.status}".`,
      pickingId: String(firstPicking.id),
      canValidate: false,
    };
  }

  if (firstPicking.state !== "assigned") {
    return {
      status: "incident" as const,
      tone: "warning" as const,
      label: "Revisar stock",
      reason: `Estado albaran: ${translatePickingState(firstPicking.state)}. No se fuerza validacion.`,
      pickingId: String(firstPicking.id),
      canValidate: false,
    };
  }

  return {
    status: "ready" as const,
    tone: "info" as const,
    label: "Listo validar",
    reason: "Sendcloud tiene etiqueta creada o envio confirmado y Odoo tiene un unico albaran reservado.",
    pickingId: String(firstPicking.id),
    canValidate: true,
    validationMethod: "manual" as const,
  };
}

function buildGeneiLabelValidationStatus(
  order: OdooRecord,
  tracking?: string,
): SendcloudStatus {
  const reference = getExternalOrderRef(order) || order.name || `#${order.id}`;
  return {
    reference,
    status: "Etiqueta Genei creada",
    rawStatus: "genei-label-created",
    trackingNumber: cleanText(tracking),
    carrier: "Genei",
    hasTracking: Boolean(cleanText(tracking)),
  };
}

function summarizePickings(pickings: Array<{ state?: string }>) {
  if (pickings.every((picking) => picking.state === "done")) return "Entregado";
  if (pickings.some((picking) => picking.state === "assigned"))
    return "Albaran reservado";
  if (
    pickings.some(
      (picking) => picking.state === "waiting" || picking.state === "confirmed",
    )
  )
    return "Pendiente stock";
  return translatePickingState(pickings[0]?.state);
}

function translateSaleState(state?: string) {
  const labels: Record<string, string> = {
    draft: "Presupuesto",
    sent: "Presupuesto enviado",
    sale: "Confirmado",
    done: "Bloqueado",
    cancel: "Cancelado",
  };
  return state ? (labels[state] ?? state) : "Sin estado";
}

function translateInvoiceStatus(status?: string) {
  const labels: Record<string, string> = {
    upselling: "Pendiente upselling",
    invoiced: "Facturado",
    to_invoice: "Pendiente emitir",
    "to invoice": "Pendiente emitir",
    no: "Sin factura",
  };
  return status ? (labels[status] ?? status) : "Sin factura";
}

function translatePaymentState(status?: string) {
  const labels: Record<string, string> = {
    paid: "Pagada",
    not_paid: "Pendiente cobro",
    partial: "Parcial",
    in_payment: "En pago",
    reversed: "Rectificada",
    blocked: "Bloqueada",
    legacy: "Estado anterior",
  };
  return status ? (labels[status] ?? status) : "Sin estado";
}

function translatePickingState(state?: string) {
  const labels: Record<string, string> = {
    draft: "Borrador",
    waiting: "Esperando otra operacion",
    confirmed: "Pendiente stock",
    assigned: "Albaran reservado",
    done: "Entregado",
    cancel: "Cancelado",
  };
  return state ? (labels[state] ?? state) : "Sin albaran";
}
