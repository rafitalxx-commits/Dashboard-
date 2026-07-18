import { Fragment, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Globe2,
  Home,
  ListTodo,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  MessagesSquare,
  Bell,
  Plus,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { money, orders as demoOrders, statusTone } from "./data/demoData";
// import { AmazonMessagesView } from "./modules/amazonMessages";
import { TasksView } from "./modules/tasks/TasksView";
import { odooClient } from "./services/odooClient";
import type {
  InvoiceAnalytics,
  InvoiceMetricRow,
  InvoiceTrendSeries,
  DashboardProductRow,
  DashboardRow,
  DashboardSummary,
  Order,
  OrdersSyncStats,
} from "./services/odooTypes";

const navItems = [
  { label: "Inicio", icon: Home, view: "dashboard", permission: "dashboard" },
  { label: "Tareas", icon: ListTodo, view: "tasks", permission: "tasks" },
  { label: "Pedidos", icon: ClipboardList, view: "orders", permission: "orders" },
  { label: "Facturas cliente", icon: ReceiptText, view: "customerInvoices", permission: "billing" },
  { label: "Facturas proveedor", icon: FileText, view: "supplierInvoices", permission: "supplierBilling" },
  { label: "Compras", icon: ShoppingCart, view: "purchases", permission: "purchases" },
  { label: "Productos / stock", icon: Boxes, view: "products", permission: "products" },
  { label: "Amazon Messages", icon: MessagesSquare, view: "amazonMessages", permission: "orders" },
  { label: "Configuracion", icon: Settings, view: "settings", permission: "settings" },
] as const;
type ActiveView = (typeof navItems)[number]["view"];
const viewRoutes: Record<ActiveView, string> = {
  dashboard: "home",
  tasks: "tareas",
  orders: "pedidos",
  customerInvoices: "facturacion",
  supplierInvoices: "facturas-proveedor",
  purchases: "compras",
  products: "productos",
  amazonMessages: "amazon-messages",
  settings: "configuracion",
};
const routeViews = Object.fromEntries(
  Object.entries(viewRoutes).map(([view, route]) => [route, view]),
) as Record<string, ActiveView>;

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
export type DashboardTaskCategory =
  | "Dashboard"
  | "Odoo"
  | "Compras"
  | "Gmail"
  | "Amazon"
  | "Dominio"
  | "IA"
  | "Operaciones";
export type DashboardTaskPriority = "Alta" | "Media" | "Baja";
export type DashboardTaskStatus = "Pendiente" | "En curso" | "Bloqueada" | "Hecha";
export type DashboardTask = {
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
type OrderSortKey =
  | "id"
  | "date"
  | "client"
  | "channel"
  | "status"
  | "delivery"
  | "odooDelivery"
  | "printed"
  | "invoice"
  | "total";
type InvoiceSortKey =
  | "date"
  | "ref"
  | "partner"
  | "channel"
  | "status"
  | "total"
  | "residual";
type SortDirection = "asc" | "desc";
type PrintBatch = {
  id: string;
  printedAt: string;
  orders: Array<Pick<Order, "id" | "odooRef">>;
};
type DeliveryIncident = Awaited<ReturnType<typeof odooClient.getDeliveryIncidents>>[number];

const pageSizeOptions = [80, 200, 500];
const deliveryOptions = ["Todos", "Entregados", "No entregados"];
const printOptions = ["Todos", "Impresos", "Sin imprimir"];
const odooDeliveryOptions = [
  "Todos",
  "Validado",
  "No validado",
  "Listo para validar",
  "Incidencia",
  "Incidencia entrega Odoo",
];
const rangePresets = [
  { label: "1 dia", value: "1d" },
  { label: "Ayer", value: "yesterday" },
  { label: "7 dias", value: "7d" },
  { label: "30 dias", value: "30d" },
  { label: "1 mes", value: "1m" },
  { label: "Este mes", value: "thisMonth" },
  { label: "Mes anterior", value: "previousMonth" },
  { label: "1 ano", value: "1y" },
  { label: "Rango", value: "custom" },
] as const;
type RangePreset = (typeof rangePresets)[number]["value"];
type ControlChannel = "Todos" | "Amazon FBM" | "Amazon DBA" | "Website" | "Sales";
type DashboardOrderFilter = {
  channel?: ControlChannel;
  delivery?: string;
  printed?: string;
  odooDelivery?: string;
  range?: { from: string; to: string };
};
const buildLabel = "Juanito build control home";
const taskCategories: DashboardTaskCategory[] = [
  "Dashboard",
  "Odoo",
  "Compras",
  "Gmail",
  "Amazon",
  "Dominio",
  "IA",
  "Operaciones",
];
const taskPriorities: DashboardTaskPriority[] = ["Alta", "Media", "Baja"];
const taskStatuses: DashboardTaskStatus[] = [
  "Pendiente",
  "En curso",
  "Bloqueada",
  "Hecha",
];
const permissionLabels: Record<DashboardPermission, string> = {
  dashboard: "Inicio",
  tasks: "Tareas",
  orders: "Pedidos",
  billing: "Facturas cliente",
  supplierBilling: "Facturas proveedor",
  purchases: "Compras",
  products: "Productos / stock",
  settings: "Configuracion",
  odooWrite: "Acciones Odoo",
  amazonMessagesSendFinal: "Amazon Messages: envio final",
};
const editablePermissions: DashboardPermission[] = [
  "dashboard",
  "tasks",
  "orders",
  "billing",
  "supplierBilling",
  "purchases",
  "products",
  "settings",
  "odooWrite",
  "amazonMessagesSendFinal",
];

function App() {
  const [authMode, setAuthMode] = useState<"loading" | "logged-out" | "logged-in">(
    "loading",
  );
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [controlOrders, setControlOrders] = useState<Order[]>([]);
  const [controlOrdersLoading, setControlOrdersLoading] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [invoiceAnalytics, setInvoiceAnalytics] =
    useState<InvoiceAnalytics | null>(null);
  const [invoiceGroupBy, setInvoiceGroupBy] = useState<
    "channels" | "countries" | "statuses"
  >("channels");
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoicePageSize, setInvoicePageSize] = useState(50);
  const [invoiceOffset, setInvoiceOffset] = useState(0);
  const [invoiceSort, setInvoiceSort] = useState<{
    key: InvoiceSortKey;
    direction: SortDirection;
  }>({ key: "date", direction: "desc" });
  const [dataMode, setDataMode] = useState<"loading" | "live" | "demo">(
    "loading",
  );
  const [connectionMessage, setConnectionMessage] = useState(
    "Conectando con Odoo",
  );
  const [syncSummary, setSyncSummary] = useState("Esperando respuesta de Odoo");
  const [ordersSyncStats, setOrdersSyncStats] = useState<OrdersSyncStats | null>(null);
  const [ordersSyncLoading, setOrdersSyncLoading] = useState(false);
  const [deliveryIncidents, setDeliveryIncidents] = useState<DeliveryIncident[]>([]);
  const [deliveryIncidentsLoading, setDeliveryIncidentsLoading] = useState(false);
  const [orderRefreshKey, setOrderRefreshKey] = useState(0);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPage, setServerPage] = useState(1);
  const [pageSize, setPageSize] = useState(200);
  const [query, setQuery] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [delivery, setDelivery] = useState("Todos");
  const [printed, setPrinted] = useState("Todos");
  const [odooDelivery, setOdooDelivery] = useState("Todos");
  const [orderSort, setOrderSort] = useState<{
    key: OrderSortKey;
    direction: SortDirection;
  }>({ key: "date", direction: "desc" });
  const [odooActionMessage, setOdooActionMessage] = useState("");
  const [odooActionLoading, setOdooActionLoading] = useState(false);
  const [rangePreset, setRangePreset] = useState<RangePreset>("1d");
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());
  const [page, setPage] = useState(1);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>(() => getViewFromHash());
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetailsById, setOrderDetailsById] = useState<Record<string, Order>>({});
  const [selectedPrintOrderIds, setSelectedPrintOrderIds] = useState<string[]>(
    [],
  );
  const [printContextById, setPrintContextById] = useState<Record<string, Order>>({});
  const [printContextLoading, setPrintContextLoading] = useState(false);
  const [printView, setPrintView] = useState<"products" | "orders">(
    "products",
  );
  const [pendingPrintBatch, setPendingPrintBatch] = useState<PrintBatch | null>(
    null,
  );
  const [dashboardUsers, setDashboardUsers] = useState<DashboardUser[]>(() =>
    [],
  );
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [taskFilter, setTaskFilter] = useState<"Activas" | "Todas" | "Hechas">(
    "Activas",
  );
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDetail, setNewTaskDetail] = useState("");
  const [newTaskCategory, setNewTaskCategory] =
    useState<DashboardTaskCategory>("Dashboard");
  const [newTaskPriority, setNewTaskPriority] =
    useState<DashboardTaskPriority>("Media");
  const [newTaskDueDate, setNewTaskDueDate] = useState(todayIso());
  const [newTaskReminderAt, setNewTaskReminderAt] = useState("");
  const [taskSection, setTaskSection] = useState<"Tareas" | "Calendario">(
    "Tareas",
  );
  const [calendarAccounts, setCalendarAccounts] = useState<CalendarAccount[]>(
    [],
  );
  const [calendarEvents, setCalendarEvents] = useState<DashboardCalendarEvent[]>(
    [],
  );
  const [calendarMonth, setCalendarMonth] = useState(todayIso().slice(0, 7));
  const [newEventSource, setNewEventSource] =
    useState<CalendarAccountId>("local");
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDetail, setNewEventDetail] = useState("");
  const [newEventStartsAt, setNewEventStartsAt] = useState(`${todayIso()}T09:00`);
  const [newEventEndsAt, setNewEventEndsAt] = useState(`${todayIso()}T10:00`);
  const [newEventLocation, setNewEventLocation] = useState("");
  const [calendarMessage, setCalendarMessage] = useState("");
  const [newDashboardUserName, setNewDashboardUserName] = useState("");
  const [newDashboardUsername, setNewDashboardUsername] = useState("");
  const [newDashboardUserPassword, setNewDashboardUserPassword] = useState("");
  const [newDashboardUserRole, setNewDashboardUserRole] =
    useState<DashboardUserRole>("printer");
  const dateRange = useMemo(
    () => getDateRange(rangePreset, customFrom, customTo),
    [customFrom, customTo, rangePreset],
  );
  const serverSearch = query.trim();

  const navigateToView = (view: ActiveView) => {
    setActiveView(view);
    const route = viewRoutes[view];
    if (window.location.hash !== `#/${route}`) {
      window.history.pushState(null, "", `#/${route}`);
    }
  };

  useEffect(() => {
    odooClient.getCurrentUser().then((result) => {
      if (result.authenticated && result.user) {
        setAuthUser(result.user);
        setAuthMode("logged-in");
      } else {
        setAuthUser(null);
        setAuthMode("logged-out");
      }
    });
  }, []);

  useEffect(() => {
    const syncFromHash = () => setActiveView(getViewFromHash());
    window.addEventListener("hashchange", syncFromHash);
    if (!window.location.hash) {
      window.history.replaceState(null, "", `#/${viewRoutes.dashboard}`);
    }
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  useEffect(() => {
    setServerPage(1);
  }, [customFrom, customTo, query, rangePreset]);

  useEffect(() => {
    setInvoiceOffset(0);
  }, [dateRange]);

  useEffect(() => {
    if (authMode !== "logged-in") return;

    let mounted = true;

    if (activeView === "dashboard") {
      setDashboard(null);
      setDataMode("loading");
      setConnectionMessage("Conectando con Odoo");
      setSyncSummary(`Resumen: ${dateRange.from} a ${dateRange.to}`);

      odooClient.getDashboard(dateRange).then((dashboardResult) => {
        if (!mounted) return;
        setDashboard(dashboardResult);
        setDataMode(dashboardResult.mode);
        if (dashboardResult.cache?.sync) {
          setOrdersSyncStats(dashboardResult.cache.sync);
        }
        if (dashboardResult.mode === "live") {
          setConnectionMessage("Odoo real · resumen cargado");
          setSyncSummary(
            dashboardResult.cache?.updatedAt
              ? `Cache ${formatSyncTime(dashboardResult.cache.updatedAt)} · ${dashboardResult.totalOrders} pedidos`
              : `Rango ${dateRange.from} a ${dateRange.to} · ${dashboardResult.totalOrders} pedidos`,
          );
          return;
        }
        setOrders(demoOrders);
        setServerTotal(demoOrders.length);
        setConnectionMessage(dashboardResult.message ?? "Usando datos demo");
        setSyncSummary("Mostrando datos demo porque no se pudo leer Odoo");
      });
      return () => {
        mounted = false;
      };
    }

    if (activeView !== "orders") {
      return () => {
        mounted = false;
      };
    }

    setOrders([]);
    setDataMode("loading");
    setConnectionMessage("Conectando con Odoo");
    setSyncSummary(`Pedidos: ${dateRange.from} a ${dateRange.to}`);
    setSelectedOrderId(null);

    const offset = (serverPage - 1) * pageSize;

    odooClient.getOrders({
      ...dateRange,
      limit: pageSize,
      offset,
      search: serverSearch,
    }).then((result) => {
      if (!mounted) return;

      if (result.mode === "live") {
        const total = result.total ?? result.orders.length;
        setOrders(result.orders);
        setServerTotal(total);
        setDataMode("live");
        if (result.cache?.sync) {
          setOrdersSyncStats(result.cache.sync);
        }
        setConnectionMessage(
          result.source === "dashboard-cache"
            ? `Cache Dashboard · ${result.orders.length} de ${total} pedidos`
            : `Odoo real · ${result.orders.length} de ${total} pedidos`,
        );
        setSyncSummary(
          result.cache?.updatedAt
            ? `Cache ${formatSyncTime(result.cache.updatedAt)} · bloque ${serverPage}`
            : `Rango ${dateRange.from} a ${dateRange.to} · bloque ${serverPage} · ultimos: ${result.orders
                .slice(0, 3)
                .map((order) => order.id)
                .join(", ")}`,
        );
        return;
      }

      setOrders(demoOrders);
      setServerTotal(demoOrders.length);
      setDataMode("demo");
      setConnectionMessage(result.message ?? "Usando datos demo");
      setSyncSummary("Mostrando datos demo porque no se pudo leer Odoo");
    });

    return () => {
      mounted = false;
    };
  }, [
    activeView,
    authMode,
    dateRange,
    orderRefreshKey,
    pageSize,
    serverPage,
    serverSearch,
  ]);

  useEffect(() => {
    if (authMode !== "logged-in" || activeView !== "dashboard") return;

    let mounted = true;
    const range = lastDaysRange(4);
    setControlOrders([]);
    setControlOrdersLoading(true);

    async function loadControlOrders() {
      const pageLimit = 500;
      const collected: Order[] = [];

      for (let offset = 0; offset < 5000; offset += pageLimit) {
        const result = await odooClient.getOrders({
          ...range,
          limit: pageLimit,
          offset,
        });
        if (!mounted) return;
        if (result.mode !== "live") {
          setControlOrders(result.orders);
          setControlOrdersLoading(false);
          return;
        }
        collected.push(...result.orders);
        const total = result.total ?? result.orders.length;
        if (collected.length >= total || result.orders.length === 0) break;
      }

      if (mounted) {
        setControlOrders(collected);
        setControlOrdersLoading(false);
      }
    }

    loadControlOrders();

    return () => {
      mounted = false;
      setControlOrdersLoading(false);
    };
  }, [activeView, authMode, orderRefreshKey]);

  useEffect(() => {
    if (
      authMode !== "logged-in" ||
      (activeView !== "customerInvoices" && activeView !== "dashboard")
    ) return;

    let mounted = true;
    const delay = activeView === "dashboard" ? 900 : 0;
    if (activeView === "customerInvoices") {
      setDataMode("loading");
      setConnectionMessage("Conectando con Odoo");
      setSyncSummary(`Facturacion: ${dateRange.from} a ${dateRange.to}`);
    }
    const timer = window.setTimeout(() => {
      if (!mounted) return;
      setInvoiceLoading(true);
      setInvoiceAnalytics(null);

      odooClient.getCustomerInvoices({
        ...dateRange,
        limit: activeView === "dashboard" ? 20 : invoicePageSize,
        offset: activeView === "dashboard" ? 0 : invoiceOffset,
        sortKey: invoiceSort.key,
        sortDir: invoiceSort.direction,
      }).then((result) => {
        if (!mounted) return;
        setInvoiceAnalytics(result);
        setInvoiceLoading(false);
        if (activeView === "customerInvoices") {
          setDataMode(result.mode);
          setConnectionMessage(
            result.mode === "live"
              ? `Odoo real · ${result.total} facturas`
              : result.message ?? "Usando datos demo",
          );
          setSyncSummary(
            result.mode === "live"
              ? `Rango ${dateRange.from} a ${dateRange.to} · facturacion cargada`
              : "Mostrando facturacion demo porque no se pudo leer Odoo",
          );
        }
      });
    }, delay);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [
    activeView,
    authMode,
    dateRange,
    invoiceOffset,
    invoicePageSize,
    invoiceSort.direction,
    invoiceSort.key,
  ]);

  useEffect(() => {
    if (authMode !== "logged-in") return;
    if (activeView !== "dashboard" && activeView !== "orders") return;
    refreshDeliveryIncidents();
  }, [activeView, authMode, orderRefreshKey]);

  const openOrdersFromHome = (input: {
    channel?: ControlChannel;
    delivery?: string;
    printed?: string;
    odooDelivery?: string;
    range?: { from: string; to: string };
  }) => {
    if (input.range) {
      setRangePreset("custom");
      setCustomFrom(input.range.from);
      setCustomTo(input.range.to);
    }
    setSelectedChannels(channelToFilterValues(input.channel ?? "Todos"));
    setDelivery(input.delivery ?? "Todos");
    setPrinted(input.printed ?? "Todos");
    setOdooDelivery(input.odooDelivery ?? "Todos");
    setQuery("");
    setServerPage(1);
    setPage(1);
    setSelectedPrintOrderIds([]);
    navigateToView("orders");
  };

  useEffect(() => {
    if (!authUser) return;
    const canSeeActiveView = navItems.some(
      (item) =>
        item.view === activeView && authUser.permissions.includes(item.permission),
    );
    if (!canSeeActiveView) {
      navigateToView("dashboard");
    }
  }, [activeView, authUser]);

  const channels = useMemo(
    () => {
      const fulfillmentOptions = [
        orders.some((order) => order.fulfillmentBy === "FBA")
          ? "Amazon FBA"
          : "",
        orders.some((order) => order.fulfillmentBy === "FBM")
          ? "Amazon FBM"
          : "",
      ].filter(Boolean);

      return [
        ...fulfillmentOptions,
        ...Array.from(new Set(orders.map((order) => order.channel))),
      ];
    },
    [orders],
  );

  const filteredOrders = useMemo(() => {
    const text = query.trim().toLowerCase();

    return orders.filter((order) => {
      const delivered = isDelivered(getEffectiveDeliveryStatus(order));
      const matchesSearch =
        !text ||
        [
          order.id,
          order.odooRef,
          order.client,
          order.city,
          order.channel,
          order.fulfillmentBy,
          order.sendcloud?.status,
          order.sendcloud?.trackingNumber,
          order.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(text);
      const matchesChannel =
        selectedChannels.length === 0 ||
        selectedChannels.some((option) => matchesChannelOption(order, option));
      const matchesDelivery =
        delivery === "Todos" ||
        (delivery === "Entregados" && delivered) ||
        (delivery === "No entregados" && !delivered);
      const matchesPrinted =
        printed === "Todos" ||
        (printed === "Impresos" && order.deliveryPrinted) ||
        (printed === "Sin imprimir" && !order.deliveryPrinted);
      const odooDeliveryStatus = order.odooDeliveryValidation?.status;
      const matchesOdooDelivery =
        odooDelivery === "Todos" ||
        (odooDelivery === "Validado" && odooDeliveryStatus === "validated") ||
        (odooDelivery === "No validado" && odooDeliveryStatus !== "validated") ||
        (odooDelivery === "Listo para validar" && odooDeliveryStatus === "ready") ||
        ((odooDelivery === "Incidencia" ||
          odooDelivery === "Incidencia entrega Odoo") &&
          odooDeliveryStatus === "incident");

      return (
        matchesSearch &&
        matchesChannel &&
        matchesDelivery &&
        matchesPrinted &&
        matchesOdooDelivery
      );
    });
  }, [delivery, odooDelivery, orders, printed, query, selectedChannels]);

  const sortedOrders = useMemo(
    () => sortOrders(filteredOrders, orderSort.key, orderSort.direction),
    [filteredOrders, orderSort],
  );
  const pageCount = Math.max(1, Math.ceil(sortedOrders.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleOrders = sortedOrders.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const selectedPrintOrders = sortedOrders
    .filter((order) => selectedPrintOrderIds.includes(order.id))
    .map((order) => printContextById[order.id] ?? orderDetailsById[order.id] ?? order);
  const autoValidatableOrders = sortedOrders.filter(
    (order) => order.odooDeliveryValidation?.status === "ready",
  );
  const allVisibleSelected =
    visibleOrders.length > 0 &&
    visibleOrders.every((order) => selectedPrintOrderIds.includes(order.id));
  const serverFrom = serverTotal === 0 ? 0 : (serverPage - 1) * pageSize + 1;
  const serverTo = Math.min(serverPage * pageSize, serverTotal);
  const canMoveBack = serverPage > 1;
  const canMoveForward = serverPage * pageSize < serverTotal;

  const deliveredCount = filteredOrders.filter((order) =>
    isDelivered(getEffectiveDeliveryStatus(order)),
  ).length;
  const printedCount = filteredOrders.filter((order) => order.deliveryPrinted).length;
  const unprintedConfirmed = filteredOrders.filter(
    (order) =>
      !order.deliveryPrinted &&
      !isDelivered(getEffectiveDeliveryStatus(order)) &&
      order.status !== "Bloqueado",
  ).length;

  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
    setSelectedPrintOrderIds([]);
  };
  const clearFilters = () => {
    setQuery("");
    setSelectedChannels([]);
    setDelivery("Todos");
    setPrinted("Todos");
    setOdooDelivery("Todos");
    setPage(1);
    setSelectedPrintOrderIds([]);
  };
  const toggleChannel = (option: string) => {
    setSelectedChannels((current) =>
      current.includes(option)
        ? current.filter((value) => value !== option)
        : [...current, option],
    );
    setPage(1);
    setSelectedPrintOrderIds([]);
  };
  const togglePrintOrder = (orderId: string) => {
    setSelectedPrintOrderIds((current) =>
      current.includes(orderId)
        ? current.filter((value) => value !== orderId)
        : [...current, orderId],
    );
  };
  const toggleVisiblePrintOrders = () => {
    const visibleIds = visibleOrders.map((order) => order.id);
    setSelectedPrintOrderIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds])),
    );
  };

  useEffect(() => {
    if (!selectedOrderId) return;
    const selected = orders.find((order) => order.id === selectedOrderId);
    if (!selected || selected.items.length > 0 || orderDetailsById[selected.id]) return;
    let mounted = true;
    odooClient
      .getOrderDetail(selected.odooRef)
      .then((result) => {
        if (!mounted || !result.order) return;
        const detailedOrder = result.order;
        setOrderDetailsById((current) => ({
          ...current,
          [selected.id]: detailedOrder,
        }));
      })
      .catch((error) => {
        setOdooActionMessage(
          error instanceof Error ? error.message : "No se pudo cargar detalle del pedido.",
        );
      });
    return () => {
      mounted = false;
    };
  }, [orderDetailsById, orders, selectedOrderId]);

  useEffect(() => {
    const refsToLoad = sortedOrders
      .filter((order) => selectedPrintOrderIds.includes(order.id))
      .filter((order) => (printContextById[order.id] ?? order).items.length === 0)
      .map((order) => order.odooRef);
    if (refsToLoad.length === 0) return;
    let mounted = true;
    setPrintContextLoading(true);
    odooClient
      .getOrdersPrintContext(refsToLoad)
      .then((result) => {
        if (!mounted) return;
        setPrintContextById((current) => {
          const next = { ...current };
          result.orders.forEach((order) => {
            next[order.id] = order;
          });
          return next;
        });
      })
      .catch((error) => {
        setOdooActionMessage(
          error instanceof Error
            ? error.message
            : "No se pudo cargar datos para impresion.",
        );
      })
      .finally(() => {
        if (mounted) setPrintContextLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [printContextById, selectedPrintOrderIds, sortedOrders]);

  const toggleOrderSort = (key: OrderSortKey) => {
    setOrderSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
    setPage(1);
  };
  const printDeliveryNotes = () => {
    const printArea = document.querySelector<HTMLElement>(".print-area");
    if (!printArea) {
      setOdooActionMessage("Cambia a Por producto o Por pedido para imprimir albaranes.");
      return;
    }

    const previousTitle = document.title;
    const printRoot = document.createElement("div");
    printRoot.className = "print-sheet-root";
    printRoot.innerHTML = printArea.innerHTML;

    document.title = "";
    document.body.classList.add("dashboard-printing");
    document.body.appendChild(printRoot);
    window.print();
    const printedAt = new Date().toISOString();
    const batch: PrintBatch = {
      id: printedAt,
      printedAt,
      orders: selectedPrintOrders.map((order) => ({
        id: order.id,
        odooRef: order.odooRef,
      })),
    };
    setPendingPrintBatch(batch);
    setOdooActionMessage(
      `Tanda impresa a las ${formatPrintTime(printedAt)} · ${batch.orders.length} pedidos pendientes de confirmar en Odoo.`,
    );
    window.setTimeout(() => {
      document.title = previousTitle;
      document.body.classList.remove("dashboard-printing");
      printRoot.remove();
    }, 500);
  };
  const markOrdersPrintedInOdoo = async (
    ordersToMark: Array<Pick<Order, "id" | "odooRef">>,
  ) => {
    if (ordersToMark.length === 0 || odooActionLoading) return;
    setOdooActionLoading(true);
    setOdooActionMessage("");
    try {
      const result = await odooClient.markOrdersPrinted(
        ordersToMark.map((order) => order.odooRef),
      );
      const markedIds = ordersToMark.map((order) => order.id);
      setOrders((current) =>
        current.map((order) =>
          markedIds.includes(order.id)
            ? { ...order, deliveryPrinted: true }
            : order,
        ),
      );
      setOdooActionMessage(
        `Odoo marcado: ${result.updated ?? ordersToMark.length} albaranes con Delivery print.`,
      );
      setSelectedPrintOrderIds([]);
      setPendingPrintBatch(null);
      refreshOrders();
    } catch (error) {
      setOdooActionMessage(
        error instanceof Error
          ? error.message
          : "No se pudo marcar Delivery print en Odoo.",
      );
    } finally {
      setOdooActionLoading(false);
    }
  };
  const markSelectedOrdersPrinted = () =>
    markOrdersPrintedInOdoo(selectedPrintOrders);
  const validateOdooDeliveryBatch = async (
    ordersToValidate: Array<Pick<Order, "id" | "odooRef">>,
    label = "Entrega Odoo validada",
  ) => {
    if (ordersToValidate.length === 0 || odooActionLoading) return;
    setOdooActionLoading(true);
    setOdooActionMessage("");
    try {
      const result = await odooClient.validateOdooDeliveries(
        ordersToValidate.map((order) => order.odooRef),
      );
      const incidentText =
        result.incidents && result.incidents.length > 0
          ? ` · ${result.incidents.length} incidencia(s): ${result.incidents
              .slice(0, 3)
              .map((item) => item.orderName || item.orderId)
              .join(", ")}`
          : "";
      setOdooActionMessage(
        `${label}: ${result.validated ?? 0} pedido(s)${incidentText}.`,
      );
      setSelectedPrintOrderIds([]);
      refreshOrders();
    } catch (error) {
      setOdooActionMessage(
        error instanceof Error
          ? error.message
          : "No se pudo validar entrega en Odoo.",
      );
    } finally {
      setOdooActionLoading(false);
    }
  };
  const validateSelectedOdooDeliveries = () =>
    validateOdooDeliveryBatch(selectedPrintOrders);
  const validateAutoValidatableOdooDeliveries = () => {
    if (autoValidatableOrders.length === 0 || odooActionLoading) return;
    const confirmed = window.confirm(
      `Validar ${autoValidatableOrders.length} pedido(s) auto-validable(s) con el flujo nativo de Odoo?`,
    );
    if (!confirmed) return;
    validateOdooDeliveryBatch(
      autoValidatableOrders,
      "Auto-validables validados en Odoo",
    );
  };
  const confirmPendingPrintBatch = () => {
    if (!pendingPrintBatch) return;
    markOrdersPrintedInOdoo(pendingPrintBatch.orders);
  };
  const can = (permission: DashboardPermission) =>
    Boolean(authUser?.permissions.includes(permission));
  const visibleNavItems = authUser
    ? navItems.filter((item) => can(item.permission))
    : [];
  const showOrderRange =
    activeView === "dashboard" ||
    activeView === "orders" ||
    activeView === "customerInvoices";
  const refreshOrders = async () => {
    if (!showOrderRange || ordersSyncLoading) return;
    setOrdersSyncLoading(true);
    setConnectionMessage("Sincronizando Odoo y Sendcloud en segundo plano");
    setSyncSummary("Actualizacion manual iniciada");
    try {
      const result = await odooClient.syncOrders({
        ...dateRange,
        search: serverSearch,
        autoValidate: true,
      });
      if (result.cache?.sync) {
        setOrdersSyncStats(result.cache.sync);
        setSyncSummary(formatOrdersSyncSummary(result.cache.sync));
      }
      setDeliveryIncidents(await odooClient.getDeliveryIncidents());
      setOrderRefreshKey((value) => value + 1);
    } catch (error) {
      setSyncSummary(
        error instanceof Error ? error.message : "No se pudo sincronizar pedidos",
      );
    } finally {
      setOrdersSyncLoading(false);
    }
  };
  const refreshDeliveryIncidents = async () => {
    setDeliveryIncidentsLoading(true);
    try {
      setDeliveryIncidents(await odooClient.getDeliveryIncidents());
    } finally {
      setDeliveryIncidentsLoading(false);
    }
  };
  const retryDeliveryIncidents = async () => {
    if (deliveryIncidentsLoading) return;
    setDeliveryIncidentsLoading(true);
    setOdooActionMessage("Reintentando incidencias de entrega Odoo...");
    try {
      const result = await odooClient.retryDeliveryIncidents();
      setOdooActionMessage(
        `Reintento incidencias: ${result.validated} validada(s), ${result.incidents.length} siguen con incidencia.`,
      );
      setDeliveryIncidents(await odooClient.getDeliveryIncidents());
      setOrderRefreshKey((value) => value + 1);
    } catch (error) {
      setOdooActionMessage(
        error instanceof Error ? error.message : "No se pudo reintentar incidencias.",
      );
    } finally {
      setDeliveryIncidentsLoading(false);
    }
  };
  const resolveDeliveryIncident = async (incidentId: string) => {
    setDeliveryIncidentsLoading(true);
    try {
      await odooClient.resolveDeliveryIncidents([incidentId]);
      setDeliveryIncidents(await odooClient.getDeliveryIncidents());
    } catch (error) {
      setOdooActionMessage(
        error instanceof Error ? error.message : "No se pudo marcar incidencia resuelta.",
      );
    } finally {
      setDeliveryIncidentsLoading(false);
    }
  };
  const refreshDashboardUsers = async () => {
    if (!can("settings")) return;
    const users = await odooClient.getDashboardUsers();
    setDashboardUsers(users);
  };
  const refreshTasks = async () => {
    if (!can("tasks")) return;
    setTasks(await odooClient.getTasks());
  };
  const refreshCalendar = async () => {
    if (!can("tasks")) return;
    const range = getMonthRange(calendarMonth);
    const result = await odooClient.getCalendar(range);
    setCalendarAccounts(result.accounts);
    setCalendarEvents(result.events);
  };
  const addTask = async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    await odooClient.createTask({
      title,
      detail: newTaskDetail.trim(),
      category: newTaskCategory,
      priority: newTaskPriority,
      dueDate: newTaskDueDate,
      reminderAt: newTaskReminderAt,
    });
    setNewTaskTitle("");
    setNewTaskDetail("");
    setNewTaskCategory("Dashboard");
    setNewTaskPriority("Media");
    setNewTaskDueDate(todayIso());
    setNewTaskReminderAt("");
    await refreshTasks();
  };
  const updateTask = async (taskId: string, patch: Partial<DashboardTask>) => {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    );
    await odooClient.updateTask(taskId, patch);
    await refreshTasks();
  };
  const deleteTask = async (taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    await odooClient.deleteTask(taskId);
    await refreshTasks();
  };
  const addCalendarEvent = async () => {
    const title = newEventTitle.trim();
    if (!title) return;
    setCalendarMessage("");
    try {
      await odooClient.createCalendarEvent({
        source: newEventSource,
        title,
        detail: newEventDetail.trim(),
        startsAt: newEventStartsAt,
        endsAt: newEventEndsAt,
        location: newEventLocation.trim(),
      });
      setNewEventTitle("");
      setNewEventDetail("");
      setNewEventLocation("");
      setCalendarMessage(
        newEventSource === "local"
          ? "Evento creado en el calendario interno."
          : "Evento creado en Google Calendar.",
      );
      await refreshCalendar();
    } catch (error) {
      setCalendarMessage(
        error instanceof Error
          ? error.message
          : "No se pudo crear el evento.",
      );
    }
  };
  const deleteCalendarEvent = async (eventId: string) => {
    await odooClient.deleteCalendarEvent(eventId);
    await refreshCalendar();
  };
  const saveDashboardUsers = (users: DashboardUser[]) => {
    setDashboardUsers(users);
  };
  const addDashboardUser = async () => {
    const name = newDashboardUserName.trim();
    const username = newDashboardUsername.trim();
    const password = newDashboardUserPassword.trim();
    if (!name || !username || !password) return;
    await odooClient.createDashboardUser({
      name,
      username,
      password,
      role: newDashboardUserRole,
    });
    await refreshDashboardUsers();
    setNewDashboardUserName("");
    setNewDashboardUsername("");
    setNewDashboardUserPassword("");
    setNewDashboardUserRole("printer");
  };
  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError("");
    const result = await odooClient.login(loginUsername, loginPassword);
    if (!result.authenticated || !result.user) {
      setLoginError(result.message ?? "Usuario o contrasena incorrectos");
      return;
    }
    setAuthUser(result.user);
    setAuthMode("logged-in");
    setLoginPassword("");
  };
  const logout = async () => {
    await odooClient.logout();
    setAuthUser(null);
    setAuthMode("logged-out");
    setOrders([]);
    setDashboard(null);
  };

  useEffect(() => {
    if (activeView === "settings" && can("settings")) {
      refreshDashboardUsers();
    }
    if (activeView === "tasks" && can("tasks")) {
      refreshTasks();
      refreshCalendar();
    }
  }, [activeView, authUser, calendarMonth]);

  if (authMode !== "logged-in" || !authUser) {
    return (
      <LoginView
        error={loginError}
        loading={authMode === "loading"}
        onChangePassword={setLoginPassword}
        onChangeUsername={setLoginUsername}
        onSubmit={login}
        password={loginPassword}
        username={loginUsername}
      />
    );
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">OD</div>
          <div className="brand-copy">
            <strong>Odoo v18</strong>
            <span>Dashboard interno</span>
          </div>
        </div>
        <button
          aria-label={
            sidebarCollapsed ? "Ampliar menu lateral" : "Recoger menu lateral"
          }
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((value) => !value)}
          title={sidebarCollapsed ? "Ampliar menu" : "Recoger menu"}
          type="button"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
        <nav className="nav-list">
          {visibleNavItems.map((item) => (
            <button
              className={item.view === activeView ? "active" : ""}
              key={item.label}
              onClick={() => navigateToView(item.view)}
              title={item.label}
              type="button"
            >
              <item.icon size={18} />
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              Pedidos de venta ·{" "}
              {dataMode === "live" ? "Odoo real" : "datos demo Odoo"}
            </p>
            <h1>
              {activeView === "dashboard"
                ? "Inicio"
                : activeView === "orders"
                  ? "Pedidos"
                  : activeView === "amazonMessages"
                    ? "Amazon Messages"
                  : activeView === "settings"
                    ? "Configuracion"
                    : navItems.find((item) => item.view === activeView)?.label}
            </h1>
          </div>
          <div className="topbar-actions">
            {showOrderRange && (
              <button
                className="refresh-orders-button"
                disabled={ordersSyncLoading}
                onClick={refreshOrders}
                title="Actualizar pedidos"
                type="button"
              >
                <RefreshCw size={16} />
                {ordersSyncLoading ? "Sincronizando" : "Actualizar"}
              </button>
            )}
            <div className={`connection-pill ${dataMode}`}>
              <span />
              {connectionMessage}
            </div>
            <div className="session-pill">
              <User size={16} />
              <span>{authUser.name}</span>
              <button
                aria-label="Cerrar sesion"
                onClick={logout}
                title="Cerrar sesion"
                type="button"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>

        {showOrderRange && (
          <>
            <section className="range-bar">
              <div className="segmented-control" aria-label="Rango de fechas">
                {rangePresets.map((preset) => (
                  <button
                    className={rangePreset === preset.value ? "active" : ""}
                    key={preset.value}
                    onClick={() => {
                      setRangePreset(preset.value);
                      setServerPage(1);
                      setPage(1);
                    }}
                    type="button"
                  >
                    <CalendarDays size={15} />
                    {preset.label}
                  </button>
                ))}
              </div>
              {rangePreset === "custom" && (
                <div className="custom-range">
                  <input
                    aria-label="Fecha desde"
                    onChange={(event) => {
                      setCustomFrom(event.target.value);
                      setServerPage(1);
                      setPage(1);
                    }}
                    type="date"
                    value={customFrom}
                  />
                  <input
                    aria-label="Fecha hasta"
                    onChange={(event) => {
                      setCustomTo(event.target.value);
                      setServerPage(1);
                      setPage(1);
                    }}
                    type="date"
                    value={customTo}
                  />
                </div>
              )}
            </section>

            <section className={`source-strip ${dataMode}`}>
              <strong>
                {dataMode === "live"
                  ? "Fuente real activa"
                  : dataMode === "loading"
                    ? "Cargando fuente"
                    : "Fuente demo"}
              </strong>
              <span>
                {syncSummary} · {buildLabel}
              </span>
            </section>
          </>
        )}

        {activeView === "dashboard" ? (
          <DashboardView
            controlOrders={controlOrders}
            controlOrdersLoading={controlOrdersLoading}
            dashboard={dashboard}
            dataMode={dataMode}
            dateRange={dateRange}
            invoiceAnalytics={invoiceAnalytics}
            loadedOrders={orders.length}
            onOpenInvoices={() => navigateToView("customerInvoices")}
            onOpenOrders={openOrdersFromHome}
            orders={orders}
            syncStats={ordersSyncStats}
          />
        ) : activeView === "tasks" ? (
          <TasksViewInline
            calendarEvents={calendarEvents}
            taskSection={taskSection}
            tasks={(tasks ?? []).filter(
              (t): t is DashboardTask => "id" in t && "title" in t && "dueDate" in t,
            )}
            calendarAccounts={calendarAccounts}
            calendarMessage={calendarMessage}
            calendarMonth={calendarMonth}
            filter={taskFilter}
            newTaskCategory={newTaskCategory}
            newTaskDetail={newTaskDetail}
            newTaskDueDate={newTaskDueDate}
            newTaskPriority={newTaskPriority}
            newTaskReminderAt={newTaskReminderAt}
            newTaskTitle={newTaskTitle}
            newEventDetail={newEventDetail}
            newEventEndsAt={newEventEndsAt}
            newEventLocation={newEventLocation}
            newEventSource={newEventSource}
            newEventStartsAt={newEventStartsAt}
            newEventTitle={newEventTitle}
            onAddCalendarEvent={addCalendarEvent}
            onAddTask={addTask}
            onChangeFilter={setTaskFilter}
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
            onChangeTaskSection={setTaskSection}
            onDeleteCalendarEvent={deleteCalendarEvent}
            onDeleteTask={deleteTask}
            onUpdateTask={updateTask}
          />
        ) : activeView === "customerInvoices" ? (
          <CustomerInvoicesView
            analytics={invoiceAnalytics}
            groupBy={invoiceGroupBy}
            loading={invoiceLoading}
            onChangeGroupBy={setInvoiceGroupBy}
            onChangePageSize={(size) => {
              setInvoicePageSize(size);
              setInvoiceOffset(0);
            }}
            onChangeSort={(key) => {
              setInvoiceSort((current) => ({
                key,
                direction:
                  current.key === key && current.direction === "asc"
                    ? "desc"
                    : "asc",
              }));
              setInvoiceOffset(0);
            }}
            onPageChange={(newOffset) => setInvoiceOffset(newOffset)}
            pageSize={invoicePageSize}
            range={dateRange}
            sort={invoiceSort}
          />
        ) : activeView === "settings" ? (
          <SettingsView
            currentUser={authUser}
            newUserName={newDashboardUserName}
            newUsername={newDashboardUsername}
            newUserPassword={newDashboardUserPassword}
            newUserRole={newDashboardUserRole}
            onAddUser={addDashboardUser}
            onChangeNewUserName={setNewDashboardUserName}
            onChangeNewUsername={setNewDashboardUsername}
            onChangeNewUserPassword={setNewDashboardUserPassword}
            onChangeNewUserRole={setNewDashboardUserRole}
            onRefreshUsers={refreshDashboardUsers}
            onSaveUsers={saveDashboardUsers}
            users={dashboardUsers}
          />
        ) : activeView === "amazonMessages" ? (
          <AmazonMessagesView
            currentUser={authUser}
            orders={orders.length > 0 ? orders : demoOrders}
          />
        ) : activeView === "customerInvoices" ? (
          <>
            <section className="kpi-grid order-kpis">
              <Kpi
                title="Pedidos visibles"
                value={
                  dataMode === "loading"
                    ? "..."
                    : filteredOrders.length.toString()
                }
                detail={`${orders.length} pedidos ${dataMode === "live" ? "Odoo" : "demo"}`}
              />
              <Kpi
                title="Entregados"
                value={deliveredCount.toString()}
                detail="visibles entregados"
              />
              <Kpi
                  title="Print alb."
                value={printedCount.toString()}
                detail="visibles impresos"
              />
              <Kpi
                title="Sin imprimir"
                value={unprintedConfirmed.toString()}
                detail="visibles pendientes"
              />
            </section>

            <section className="panel orders-panel">
              <div className="orders-toolbar">
                <label className="search-box">
                  <Search size={18} />
                  <input
                    aria-label="Buscar pedidos"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                      setSelectedPrintOrderIds([]);
                    }}
                    placeholder="Buscar por pedido, cliente, ciudad, canal o estado"
                    value={query}
                  />
                </label>

                <ChannelMultiFilter
                  label="Canal ventas"
                  onClear={() => {
                    setSelectedChannels([]);
                    setPage(1);
                    setSelectedPrintOrderIds([]);
                  }}
                  onToggle={toggleChannel}
                  options={channels}
                  values={selectedChannels}
                />
                <SelectFilter
                  label="Entrega"
                  onChange={(value) => updateFilter(setDelivery, value)}
                  options={deliveryOptions}
                  value={delivery}
                />
                <SelectFilter
                  label="Print alb."
                  onChange={(value) => updateFilter(setPrinted, value)}
                  options={printOptions}
                  value={printed}
                />
                <SelectFilter
                  label="Odoo"
                  onChange={(value) => updateFilter(setOdooDelivery, value)}
                  options={odooDeliveryOptions}
                  value={odooDelivery}
                />
                {can("odooWrite") && (
                  <button
                    className="auto-validate-button"
                    disabled={odooActionLoading || autoValidatableOrders.length === 0}
                    onClick={validateAutoValidatableOdooDeliveries}
                    type="button"
                  >
                    <Truck size={16} />
                    Validar auto-validables ({autoValidatableOrders.length})
                  </button>
                )}
                <button
                  className="clear-filters"
                  onClick={clearFilters}
                  type="button"
                >
                  <XCircle size={16} />
                  Limpiar filtros
                </button>
              </div>

              {selectedPrintOrders.length > 0 && (
                <div className="print-selection-bar">
                  <strong>{selectedPrintOrders.length} pedidos seleccionados</strong>
                  <div className="print-selection-actions">
                    <button
                      className={printView === "products" ? "active" : ""}
                      onClick={() => setPrintView("products")}
                      type="button"
                    >
                      Por producto
                    </button>
                    <button
                      className={printView === "orders" ? "active" : ""}
                      onClick={() => setPrintView("orders")}
                      type="button"
                    >
                      Por pedido
                    </button>
                    <button onClick={printDeliveryNotes} type="button">
                      <Printer size={16} />
                      Imprimir
                    </button>
                    {can("odooWrite") && (
                      <button
                        disabled={odooActionLoading}
                        onClick={markSelectedOrdersPrinted}
                        type="button"
                      >
                        <CheckCircle2 size={16} />
                        Confirmar en Odoo
                      </button>
                    )}
                    {can("odooWrite") && (
                      <button
                        disabled={odooActionLoading}
                        onClick={validateSelectedOdooDeliveries}
                        type="button"
                      >
                        <Truck size={16} />
                        Validar entrega Odoo
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedPrintOrderIds([])}
                      type="button"
                    >
                      <XCircle size={16} />
                      Quitar seleccion
                    </button>
                  </div>
                </div>
              )}
              {pendingPrintBatch && (
                <div className="print-confirmation-panel">
                  <div>
                    <strong>
                      Tanda impresa a las {formatPrintTime(pendingPrintBatch.printedAt)}
                    </strong>
                    <span>
                      {pendingPrintBatch.orders.length} pedidos pendientes de confirmar en Odoo.
                    </span>
                  </div>
                  <div className="print-confirmation-actions">
                    {can("odooWrite") && (
                      <button
                        disabled={odooActionLoading}
                        onClick={confirmPendingPrintBatch}
                        type="button"
                      >
                        <CheckCircle2 size={16} />
                        Confirmar tanda en Odoo
                      </button>
                    )}
                    <button
                      onClick={() => setPendingPrintBatch(null)}
                      type="button"
                    >
                      <XCircle size={16} />
                      Descartar tanda
                    </button>
                  </div>
                </div>
              )}
              {odooActionMessage && (
                <div className="odoo-action-message">{odooActionMessage}</div>
              )}
              {odooDelivery === "Incidencia entrega Odoo" && (
                <DeliveryIncidentsPanel
                  incidents={deliveryIncidents}
                  loading={deliveryIncidentsLoading}
                  onRefresh={refreshDeliveryIncidents}
                  onResolve={resolveDeliveryIncident}
                  onRetry={retryDeliveryIncidents}
                />
              )}

              <div className="table-scroll">
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          aria-label="Seleccionar pedidos visibles"
                          checked={allVisibleSelected}
                          onChange={toggleVisiblePrintOrders}
                          type="checkbox"
                        />
                      </th>
                      <SortableTh
                        activeSort={orderSort}
                        label="Pedido Odoo"
                        onSort={toggleOrderSort}
                        sortKey="id"
                      />
                      <SortableTh
                        activeSort={orderSort}
                        label="Fecha"
                        onSort={toggleOrderSort}
                        sortKey="date"
                      />
                      <SortableTh
                        activeSort={orderSort}
                        label="Cliente"
                        onSort={toggleOrderSort}
                        sortKey="client"
                      />
                      <SortableTh
                        activeSort={orderSort}
                        label="Canal ventas"
                        onSort={toggleOrderSort}
                        sortKey="channel"
                      />
                      <SortableTh
                        activeSort={orderSort}
                        label="Estado pedido"
                        onSort={toggleOrderSort}
                        sortKey="status"
                      />
                      <SortableTh
                        activeSort={orderSort}
                        label="Entregado"
                        onSort={toggleOrderSort}
                        sortKey="delivery"
                      />
                      <SortableTh
                        activeSort={orderSort}
                        label="Odoo"
                        onSort={toggleOrderSort}
                        sortKey="odooDelivery"
                      />
                      <SortableTh
                        activeSort={orderSort}
                        label="Print alb."
                        onSort={toggleOrderSort}
                        sortKey="printed"
                      />
                      <SortableTh
                        activeSort={orderSort}
                        label="Factura"
                        onSort={toggleOrderSort}
                        sortKey="invoice"
                      />
                      <SortableTh
                        activeSort={orderSort}
                        label="Total"
                        onSort={toggleOrderSort}
                        sortKey="total"
                      />
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataMode === "loading" && (
                      <tr>
                        <td className="empty-state" colSpan={12}>
                          Cargando pedidos reales desde Odoo...
                        </td>
                      </tr>
                    )}
                    {visibleOrders.map((order) => {
                      const detailedOrder = orderDetailsById[order.id] ?? order;
                      const deliveryStatus = getEffectiveDeliveryStatus(order);
                      const delivered = isDelivered(deliveryStatus);
                      const isSelected = selectedOrderId === order.id;

                      return (
                        <Fragment key={order.id}>
                          <tr className={isSelected ? "selected-row" : ""}>
                            <td>
                              <input
                                aria-label={`Seleccionar ${order.id} para imprimir`}
                                checked={selectedPrintOrderIds.includes(order.id)}
                                onChange={() => togglePrintOrder(order.id)}
                                type="checkbox"
                              />
                            </td>
                            <td>
                              <strong>{order.id}</strong>
                              <small>{order.odooRef}</small>
                            </td>
                            <td>{order.date}</td>
                            <td>
                              <strong>{order.client}</strong>
                              <small>{order.city}</small>
                            </td>
                            <td>
                              <div className="channel-cell">
                                <span className="channel-pill">
                                  {order.channel}
                                </span>
                                {order.externalRef && (
                                  <small>{order.externalRef}</small>
                                )}
                                {order.fulfillmentBy && (
                                  <small>{formatFulfillment(order.fulfillmentBy)}</small>
                                )}
                              </div>
                            </td>
                            <td>
                              <Status value={order.status} />
                            </td>
                            <td>
                              <DeliveryStatusCell value={deliveryStatus} />
                              <TrackingLink order={order} />
                            </td>
                            <td>
                              <OdooDeliveryCell order={order} />
                            </td>
                            <td>
                              <BooleanCell
                                active={order.deliveryPrinted}
                                label={getDeliveryPrintLabel(
                                  order,
                                  pendingPrintBatch,
                                )}
                                type="print"
                              />
                            </td>
                            <td>{order.invoiceStatus}</td>
                            <td>
                              <strong>{money(order.total)}</strong>
                            </td>
                            <td>
                              <button
                                aria-expanded={isSelected}
                                aria-label={`Ver detalle del pedido ${order.id}`}
                                className="icon-button"
                                onClick={() =>
                                  setSelectedOrderId(isSelected ? null : order.id)
                                }
                                title="Ver detalle"
                                type="button"
                              >
                                <Search size={16} />
                              </button>
                            </td>
                          </tr>
                          {isSelected && (
                            <tr className="order-detail-row">
                              <td colSpan={11}>
                                <OrderDetailPanel
                                  loading={detailedOrder.items.length === 0}
                                  order={detailedOrder}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {dataMode !== "loading" && visibleOrders.length === 0 && (
                      <tr>
                        <td className="empty-state" colSpan={11}>
                          No hay pedidos visibles con los filtros actuales.
                          <button onClick={clearFilters} type="button">
                            Limpiar filtros
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {selectedPrintOrders.length > 0 && (
                <>
                  {printContextLoading && (
                    <div className="odoo-action-message">
                      Cargando imagenes, lineas y kits para impresion...
                    </div>
                  )}
                  <PrintPreview
                    orders={selectedPrintOrders}
                    view={printView}
                  />
                </>
              )}

              <footer className="pagination">
                <span>
                  Mostrando {serverFrom}-{serverTo} de {serverTotal} pedidos
                  Odoo
                </span>
                <div>
                  <label className="page-size-select">
                    Pedidos
                    <select
                      onChange={(event) => {
                        setPageSize(Number(event.target.value));
                        setServerPage(1);
                        setPage(1);
                        setSelectedPrintOrderIds([]);
                      }}
                      value={pageSize}
                    >
                      {pageSizeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={!canMoveBack}
                    onClick={() => {
                      setServerPage((value) => Math.max(1, value - 1));
                      setPage(1);
                    }}
                    type="button"
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <strong>Bloque {serverPage}</strong>
                  <button
                    disabled={!canMoveForward}
                    onClick={() => {
                      setServerPage((value) => value + 1);
                      setPage(1);
                    }}
                    type="button"
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </footer>
            </section>
          </>
        ) : (
          <RestrictedModuleView
            label={navItems.find((item) => item.view === activeView)?.label ?? ""}
          />
        )}
      </main>
    </div>
  );
}

function LoginView({
  error,
  loading,
  onChangePassword,
  onChangeUsername,
  onSubmit,
  password,
  username,
}: {
  error: string;
  loading: boolean;
  onChangePassword: (value: string) => void;
  onChangeUsername: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  password: string;
  username: string;
}) {
  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={onSubmit}>
        <div className="brand-mark">OD</div>
        <div>
          <p className="eyebrow">Dashboard interno</p>
          <h1>Acceso TodoElectrico</h1>
        </div>
        <label>
          Usuario
          <input
            autoComplete="username"
            autoFocus
            disabled={loading}
            onChange={(event) => onChangeUsername(event.target.value)}
            value={username}
          />
        </label>
        <label>
          Contrasena
          <input
            autoComplete="current-password"
            disabled={loading}
            onChange={(event) => onChangePassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button disabled={loading} type="submit">
          <ShieldCheck size={17} />
          {loading ? "Comprobando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}

function RestrictedModuleView({ label }: { label: string }) {
  return (
    <section className="panel module-placeholder">
      <div className="section-heading">
        <span>Modulo protegido</span>
        <h2>{label}</h2>
        <p>
          El acceso por rol ya esta preparado. Este modulo se conectara cuando
          definamos los datos y acciones reales que debe mostrar.
        </p>
      </div>
    </section>
  );
}

function TasksViewInline({
  calendarAccounts,
  calendarEvents,
  calendarMessage,
  calendarMonth,
  filter,
  taskSection,
  newEventDetail,
  newEventEndsAt,
  newEventLocation,
  newEventSource,
  newEventStartsAt,
  newEventTitle,
  newTaskCategory,
  newTaskDetail,
  newTaskDueDate,
  newTaskPriority,
  newTaskReminderAt,
  newTaskTitle,
  onAddCalendarEvent,
  onAddTask,
  onChangeCalendarMonth,
  onChangeFilter,
  onChangeNewEventDetail,
  onChangeNewEventEndsAt,
  onChangeNewEventLocation,
  onChangeNewEventSource,
  onChangeNewEventStartsAt,
  onChangeNewEventTitle,
  onChangeNewTaskCategory,
  onChangeNewTaskDetail,
  onChangeNewTaskDueDate,
  onChangeNewTaskPriority,
  onChangeNewTaskReminderAt,
  onChangeNewTaskTitle,
  onChangeTaskSection,
  onDeleteCalendarEvent,
  onDeleteTask,
  onUpdateTask,
  tasks,
}: {
  calendarAccounts: CalendarAccount[];
  calendarEvents: DashboardCalendarEvent[];
  calendarMessage: string;
  calendarMonth: string;
  filter: "Activas" | "Todas" | "Hechas";
  taskSection: "Tareas" | "Calendario";
  newEventDetail: string;
  newEventEndsAt: string;
  newEventLocation: string;
  newEventSource: CalendarAccountId;
  newEventStartsAt: string;
  newEventTitle: string;
  newTaskCategory: DashboardTaskCategory;
  newTaskDetail: string;
  newTaskDueDate: string;
  newTaskPriority: DashboardTaskPriority;
  newTaskReminderAt: string;
  newTaskTitle: string;
  onAddCalendarEvent: () => void | Promise<void>;
  onAddTask: () => void | Promise<void>;
  onChangeCalendarMonth: (value: string) => void;
  onChangeFilter: (value: "Activas" | "Todas" | "Hechas") => void;
  onChangeNewEventDetail: (value: string) => void;
  onChangeNewEventEndsAt: (value: string) => void;
  onChangeNewEventLocation: (value: string) => void;
  onChangeNewEventSource: (value: CalendarAccountId) => void;
  onChangeNewEventStartsAt: (value: string) => void;
  onChangeNewEventTitle: (value: string) => void;
  onChangeNewTaskCategory: (value: DashboardTaskCategory) => void;
  onChangeNewTaskDetail: (value: string) => void;
  onChangeNewTaskDueDate: (value: string) => void;
  onChangeNewTaskPriority: (value: DashboardTaskPriority) => void;
  onChangeNewTaskReminderAt: (value: string) => void;
  onChangeNewTaskTitle: (value: string) => void;
  onChangeTaskSection: (value: "Tareas" | "Calendario") => void;
  onDeleteCalendarEvent: (eventId: string) => void | Promise<void>;
  onDeleteTask: (taskId: string) => void | Promise<void>;
  onUpdateTask: (
    taskId: string,
    patch: Partial<DashboardTask>,
  ) => void | Promise<void>;
  tasks: DashboardTask[];
}) {
  const [notificationStatus, setNotificationStatus] = useState(
    getNotificationPermission(),
  );
  const [quickMode, setQuickMode] = useState<"task" | "event" | "mail">("task");
  const [quickTitle, setQuickTitle] = useState("");
  const [mailPanelOpen, setMailPanelOpen] = useState(false);
  const [mailAccountIdx, setMailAccountIdx] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"list" | "compose" | "view">("list");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeAttachments, setComposeAttachments] = useState<string[]>([]);
  const visibleTasks = tasks.filter((task) => {
    if (filter === "Todas") return true;
    if (filter === "Hechas") return task.status === "Hecha";
    return task.status !== "Hecha";
  });
  const activeTasks = tasks.filter((task) => task.status !== "Hecha");
  const overdueTasks = activeTasks.filter(isTaskOverdue);
  const todayTasks = activeTasks.filter(isTaskDueToday);
  const blockedTasks = activeTasks.filter((task) => task.status === "Bloqueada");
  const remindedTasks = activeTasks.filter(isTaskReminderDue);
  const googleConnected = calendarAccounts.filter(
    (account) => account.provider === "google" && account.connected,
  ).length;

  const requestNotifications = async () => {
    if (!("Notification" in window)) {
      setNotificationStatus("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationStatus(permission);
    if (permission === "granted") {
      const task = remindedTasks[0] ?? todayTasks[0] ?? overdueTasks[0];
      new Notification("Tareas TodoElectrico", {
        body: task
          ? `${task.title} · ${task.priority}`
          : "Notificaciones activadas para recordatorios del dashboard.",
      });
    }
  };

  return (
    <>
      <section className="tasks-tabs">
        {(["Tareas", "Calendario"] as const).map((section) => (
          <button
            className={taskSection === section ? "active" : ""}
            key={section}
            onClick={() => onChangeTaskSection(section)}
            type="button"
          >
            {section === "Tareas" ? <ListTodo size={16} /> : <CalendarDays size={16} />}
            {section}
          </button>
        ))}
      </section>

      <section className="kpi-grid task-kpis">
        <Kpi
          title="Activas"
          value={activeTasks.length.toString()}
          detail="pendientes, en curso o bloqueadas"
        />
        <Kpi
          title="Vencidas"
          value={overdueTasks.length.toString()}
          detail="requieren revision"
        />
        <Kpi
          title="Hoy"
          value={todayTasks.length.toString()}
          detail="con fecha limite hoy"
        />
        <Kpi
          title="Bloqueadas"
          value={blockedTasks.length.toString()}
          detail="esperan dato o decision"
        />
        <Kpi
          title="Gmail Calendar"
          value={`${googleConnected}/2`}
          detail="cuentas conectadas"
        />
      </section>

      {taskSection === "Tareas" ? (
        <>
          <section className="tasks-layout">
            <article className="panel task-create-panel">
              <div className="section-heading">
                <span>Alta rapida</span>
                <h2>Nueva tarea</h2>
              </div>
              <label className="label">
                <span>Tipo</span>
                <select
                  aria-label="Tipo"
                  value={quickMode}
                  onChange={(event) => setQuickMode(event.target.value as "task" | "event" | "mail")}
                >
                  <option value="task">Tarea</option>
                  <option value="event">Evento</option>
                  <option value="mail">Correo</option>
                </select>
              </label>
              <input
                aria-label="Titulo"
                onChange={(event) => onChangeNewTaskTitle(event.target.value)}
                placeholder={quickMode === "task" ? "Tarea rapida" : quickMode === "event" ? "Evento" : "Asunto / mensaje"}
                value={newTaskTitle}
              />
              <textarea
                aria-label="Detalle"
                onChange={(event) => onChangeNewTaskDetail(event.target.value)}
                placeholder="Indicaciones, bloqueo o siguiente paso"
                value={newTaskDetail}
                rows={3}
              />
              <div className="task-form-grid">
                {quickMode === "task" && (
                  <>
                    <select
                      aria-label="Categoría"
                      onChange={(event) => onChangeNewTaskCategory(event.target.value as DashboardTaskCategory)}
                      value={newTaskCategory}
                    >
                      {taskCategories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Prioridad"
                      onChange={(event) => onChangeNewTaskPriority(event.target.value as DashboardTaskPriority)}
                      value={newTaskPriority}
                    >
                      {taskPriorities.map((priority) => (
                        <option key={priority} value={priority}>{priority}</option>
                      ))}
                    </select>
                    <input aria-label="Fecha limite" onChange={(event) => onChangeNewTaskDueDate(event.target.value)} type="date" value={newTaskDueDate} />
                    <input aria-label="Recordatorio" onChange={(event) => onChangeNewTaskReminderAt(event.target.value)} type="datetime-local" value={newTaskReminderAt} />
                  </>
                )}
                {quickMode === "event" && (
                  <>
                    <input aria-label="Inicio" onChange={(event) => onChangeNewEventStartsAt(event.target.value)} type="datetime-local" value={newEventStartsAt} />
                    <input aria-label="Fin" onChange={(event) => onChangeNewEventEndsAt(event.target.value)} type="datetime-local" value={newEventEndsAt} />
                    <input aria-label="Ubicacion" onChange={(event) => onChangeNewEventLocation(event.target.value)} placeholder="Lugar o llamada" value={newEventLocation} />
                  </>
                )}
                {quickMode === "mail" && (
                  <div className="quick-mail-hint">Usa el botón <strong>Correo</strong> del panel inferior.</div>
                )}
              </div>
              {quickMode !== "mail" && (
                <button className="primary-action" onClick={onAddTask} type="button">
                  <Plus size={16} />
                  {quickMode === "task" ? "Anadir tarea" : "Crear evento"}
                </button>
              )}
            </article>

            <article className="panel task-alert-panel">
              <div className="section-heading">
                <span>Avisos</span>
                <h2>Recordatorios</h2>
                <p>
                  Los avisos del navegador funcionan si este equipo tiene la pagina
                  abierta o permitida. Telegram se puede automatizar en una segunda
                  fase con OpenClaw.
                </p>
              </div>
              <button
                className="clear-filters"
                onClick={requestNotifications}
                type="button"
              >
                <Bell size={16} />
                Activar avisos navegador
              </button>
              <div className="task-alert-list">
                <TaskAlert label="Vencidas" tasks={overdueTasks} tone="danger" />
                <TaskAlert label="Para hoy" tasks={todayTasks} tone="warning" />
                <TaskAlert label="Recordatorio" tasks={remindedTasks} tone="info" />
              </div>
              <small>
                Estado navegador: {formatNotificationPermission(notificationStatus)}
              </small>
            </article>
          </section>

          <section className="panel tasks-panel">
            <div className="panel-header">
              <div>
                <h2>Tareas pendientes</h2>
                <span>Lista operativa de lo hablado y siguientes pasos</span>
              </div>
              <div className="segmented-control compact">
                {(["Activas", "Todas", "Hechas"] as const).map((option) => (
                  <button
                    className={filter === option ? "active" : ""}
                    key={option}
                    onClick={() => onChangeFilter(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="task-list">
              {visibleTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  onDeleteTask={onDeleteTask}
                  onUpdateTask={onUpdateTask}
                  task={task}
                />
              ))}
              {visibleTasks.length === 0 && (
                <div className="empty-state">No hay tareas en este filtro.</div>
              )}
            </div>
          </section>
        </>
      ) : (
        <CalendarView
          accounts={calendarAccounts}
          events={calendarEvents}
          message={calendarMessage}
          month={calendarMonth}
          newEventDetail={newEventDetail}
          newEventEndsAt={newEventEndsAt}
          newEventLocation={newEventLocation}
          newEventSource={newEventSource}
          newEventStartsAt={newEventStartsAt}
          newEventTitle={newEventTitle}
          onAddEvent={onAddCalendarEvent}
          onChangeMonth={onChangeCalendarMonth}
          onChangeNewEventDetail={onChangeNewEventDetail}
          onChangeNewEventEndsAt={onChangeNewEventEndsAt}
          onChangeNewEventLocation={onChangeNewEventLocation}
          onChangeNewEventSource={onChangeNewEventSource}
          onChangeNewEventStartsAt={onChangeNewEventStartsAt}
          onChangeNewEventTitle={onChangeNewEventTitle}
          onDeleteEvent={onDeleteCalendarEvent}
        />
      )}

      {taskSection === "Tareas" && (
        <>
          <button
            className="fab"
            onClick={() => setMailPanelOpen(true)}
            type="button"
          >
            Correo
          </button>
        </>
      )}

      {mailPanelOpen && (
        <div className="backdrop" onClick={() => { setMailPanelOpen(false); setComposeMode("list"); }}>
          <div className="sheet mail-sheet">
            <div className="sheet-header">
              <span>Correo</span>
              <button className="ghost close" onClick={() => { setMailPanelOpen(false); setComposeMode("list"); }} type="button">×</button>
            </div>
            <div className="mail-accounts">
              {(calendarAccounts ?? []).map((account, idx) => (
                <button
                  key={account.id}
                  className={`mail-card ${idx === mailAccountIdx ? "active" : ""}`}
                  onClick={() => setMailAccountIdx(idx)}
                  type="button"
                >
                  <div className="mail-header">
                    <span className="mail-name">{account.label}</span>
                    <span className="mail-unread">{account.connected ? "conectado" : "desconectado"}</span>
                  </div>
                  <div className="mail-email">{account.email}</div>
                </button>
              ))}
            </div>
            <div className="mail-actions">
              <button className="button primary" onClick={() => setComposeMode("compose")} type="button">Nuevo correo</button>
              <button className="ghost" onClick={() => setComposeMode("list")} type="button">Limpiar</button>
            </div>
            {composeMode === "compose" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setComposeMode("list");
                  alert(`Borrador guardado para ${composeTo || "destinatario"}\nAsunto: ${composeSubject || "(sin asunto)"}`);
                }}
              >
                <label className="label">
                  Para
                  <input
                    className="input"
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    placeholder="destinatario@correo.es"
                  />
                </label>
                <label className="label">
                  Asunto
                  <input
                    className="input"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="Asunto del correo"
                  />
                </label>
                <label className="label">
                  Cuerpo
                  <textarea
                    className="input"
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    rows={4}
                  />
                </label>
                <label className="label">
                  Adjuntos
                  <input
                    type="file"
                    className="input"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      setComposeAttachments(files.map((f) => f.name));
                    }}
                  />
                  {composeAttachments.length > 0 && (
                    <div className="att-thumb">{composeAttachments.join(", ")}</div>
                  )}
                </label>
                <div className="actions">
                  <button className="ghost" onClick={() => setComposeMode("list")} type="button">Cancelar</button>
                  <button className="button primary" type="submit">Guardar borrador</button>
                  <button className="button primary" type="button" onClick={() => alert(`Correo enviado a ${composeTo || "destinatario"}`)}>Enviar</button>
                  <button className="ghost" type="button" onClick={() => alert("Responder a todos simulado")}>Responder a todos</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function TaskAlert({
  label,
  tasks,
  tone,
}: {
  label: string;
  tasks: DashboardTask[];
  tone: "danger" | "warning" | "info";
}) {
  return (
    <div className={`task-alert ${tone}`}>
      <strong>{tasks.length}</strong>
      <span>{label}</span>
    </div>
  );
}

function CalendarView({
  accounts,
  events,
  message,
  month,
  newEventDetail,
  newEventEndsAt,
  newEventLocation,
  newEventSource,
  newEventStartsAt,
  newEventTitle,
  onAddEvent,
  onChangeMonth,
  onChangeNewEventDetail,
  onChangeNewEventEndsAt,
  onChangeNewEventLocation,
  onChangeNewEventSource,
  onChangeNewEventStartsAt,
  onChangeNewEventTitle,
  onDeleteEvent,
}: {
  accounts: CalendarAccount[];
  events: DashboardCalendarEvent[];
  message: string;
  month: string;
  newEventDetail: string;
  newEventEndsAt: string;
  newEventLocation: string;
  newEventSource: CalendarAccountId;
  newEventStartsAt: string;
  newEventTitle: string;
  onAddEvent: () => void | Promise<void>;
  onChangeMonth: (value: string) => void;
  onChangeNewEventDetail: (value: string) => void;
  onChangeNewEventEndsAt: (value: string) => void;
  onChangeNewEventLocation: (value: string) => void;
  onChangeNewEventSource: (value: CalendarAccountId) => void;
  onChangeNewEventStartsAt: (value: string) => void;
  onChangeNewEventTitle: (value: string) => void;
  onDeleteEvent: (eventId: string) => void | Promise<void>;
}) {
  const days = getCalendarDays(month);
  const connectedAccounts = accounts.filter(
    (account) => account.id === "local" || account.connected,
  );

  return (
    <>
      <section className="calendar-layout">
        <article className="panel calendar-create-panel">
          <div className="section-heading">
            <span>Agenda</span>
            <h2>Nuevo evento</h2>
          </div>
          <input
            aria-label="Titulo del evento"
            onChange={(event) => onChangeNewEventTitle(event.target.value)}
            placeholder="Ej. Revisar compras con proveedor"
            value={newEventTitle}
          />
          <div className="task-form-grid calendar-form-grid">
            <select
              aria-label="Calendario"
              onChange={(event) =>
                onChangeNewEventSource(event.target.value as CalendarAccountId)
              }
              value={newEventSource}
            >
              {connectedAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Inicio"
              onChange={(event) => onChangeNewEventStartsAt(event.target.value)}
              type="datetime-local"
              value={newEventStartsAt}
            />
            <input
              aria-label="Fin"
              onChange={(event) => onChangeNewEventEndsAt(event.target.value)}
              type="datetime-local"
              value={newEventEndsAt}
            />
            <input
              aria-label="Ubicacion"
              onChange={(event) => onChangeNewEventLocation(event.target.value)}
              placeholder="Lugar o llamada"
              value={newEventLocation}
            />
          </div>
          <textarea
            aria-label="Detalle del evento"
            onChange={(event) => onChangeNewEventDetail(event.target.value)}
            placeholder="Notas del evento"
            value={newEventDetail}
          />
          <button className="primary-action" onClick={onAddEvent} type="button">
            <Plus size={16} />
            Crear evento
          </button>
          {message && <small className="calendar-message">{message}</small>}
        </article>

        <article className="panel calendar-accounts-panel">
          <div className="section-heading">
            <span>Google Calendar</span>
            <h2>Cuentas</h2>
          </div>
          <div className="calendar-account-list">
            {accounts.map((account) => (
              <div className="calendar-account" key={account.id}>
                <div>
                  <strong>{account.label}</strong>
                  <span>{account.email}</span>
                </div>
                {account.provider === "google" && !account.connected ? (
                  <a
                    className="clear-filters"
                    href={`/api/calendar/google/start?account=${account.id}`}
                  >
                    Conectar
                  </a>
                ) : (
                  <span className="calendar-account-status">
                    {account.status}
                  </span>
                )}
              </div>
            ))}
          </div>
          <small>
            Para crear eventos en Gmail hay que conectar cada cuenta con OAuth de
            Google Calendar.
          </small>
        </article>
      </section>

      <section className="panel calendar-panel">
        <div className="panel-header">
          <div>
            <h2>Calendario</h2>
            <span>Eventos internos y Gmail autorizados</span>
          </div>
          <input
            aria-label="Mes del calendario"
            onChange={(event) => onChangeMonth(event.target.value)}
            type="month"
            value={month}
          />
        </div>

        <div className="calendar-grid">
          {["L", "M", "X", "J", "V", "S", "D"].map((day) => (
            <strong className="calendar-weekday" key={day}>
              {day}
            </strong>
          ))}
          {days.map((day) => {
            const dayEvents = events.filter(
              (event) => event.startsAt.slice(0, 10) === day.iso,
            );
            return (
              <div
                className={`calendar-day ${day.inMonth ? "" : "muted"} ${
                  day.iso === todayIso() ? "today" : ""
                }`}
                key={day.iso}
              >
                <span>{day.label}</span>
                <div>
                  {dayEvents.slice(0, 4).map((event) => (
                    <article className={`calendar-event ${event.source}`} key={event.id}>
                      <strong>{event.title}</strong>
                      <small>
                        {formatCalendarTime(event.startsAt)} ·{" "}
                        {formatCalendarSource(event.source)}
                      </small>
                      {event.source === "local" && (
                        <button
                          aria-label={`Eliminar ${event.title}`}
                          onClick={() => onDeleteEvent(event.id)}
                          type="button"
                        >
                          <XCircle size={13} />
                        </button>
                      )}
                    </article>
                  ))}
                  {dayEvents.length > 4 && (
                    <small className="calendar-more">
                      +{dayEvents.length - 4} mas
                    </small>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function TaskRow({
  onDeleteTask,
  onUpdateTask,
  task,
}: {
  onDeleteTask: (taskId: string) => void | Promise<void>;
  onUpdateTask: (
    taskId: string,
    patch: Partial<DashboardTask>,
  ) => void | Promise<void>;
  task: DashboardTask;
}) {
  return (
    <article className={`task-row ${task.status === "Hecha" ? "done" : ""}`}>
      <div className="task-main">
        <div>
          <span className={`task-priority ${task.priority.toLowerCase()}`}>
            {task.priority}
          </span>
          <span className="task-category">{task.category}</span>
        </div>
        <strong>{task.title}</strong>
        {task.detail && <p>{task.detail}</p>}
        <small>
          Limite: {task.dueDate || "Sin fecha"} · Recordatorio:{" "}
          {formatReminder(task.reminderAt)}
        </small>
      </div>
      <div className="task-controls">
        <select
          aria-label={`Estado de ${task.title}`}
          onChange={(event) =>
            onUpdateTask(task.id, {
              status: event.target.value as DashboardTaskStatus,
            })
          }
          value={task.status}
        >
          {taskStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          aria-label={`Prioridad de ${task.title}`}
          onChange={(event) =>
            onUpdateTask(task.id, {
              priority: event.target.value as DashboardTaskPriority,
            })
          }
          value={task.priority}
        >
          {taskPriorities.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            onUpdateTask(task.id, {
              status: task.status === "Hecha" ? "Pendiente" : "Hecha",
            })
          }
          type="button"
        >
          {task.status === "Hecha" ? "Reabrir" : "Hecha"}
        </button>
        <button onClick={() => onDeleteTask(task.id)} type="button">
          Eliminar
        </button>
      </div>
    </article>
  );
}

function DeliveryIncidentsPanel({
  incidents,
  loading,
  onRefresh,
  onResolve,
  onRetry,
}: {
  incidents: DeliveryIncident[];
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  onResolve: (incidentId: string) => void | Promise<void>;
  onRetry: () => void | Promise<void>;
}) {
  const activeIncidents = incidents.filter((incident) => !incident.resolvedAt);

  return (
    <section className="incident-panel">
      <div className="incident-panel-header">
        <div>
          <strong>Incidencia entrega Odoo</strong>
          <small>
            {loading
              ? "Actualizando incidencias..."
              : `${activeIncidents.length} pendiente(s) de revisar`}
          </small>
        </div>
        <div className="incident-actions">
          <button disabled={loading} onClick={onRefresh} type="button">
            <RefreshCw size={15} />
            Actualizar estado
          </button>
          <button disabled={loading || activeIncidents.length === 0} onClick={onRetry} type="button">
            <ShieldCheck size={15} />
            Reintentar incidencias
          </button>
        </div>
      </div>
      <div className="incident-table-wrap">
        <table className="incident-table">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Canal</th>
              <th>Tracking</th>
              <th>Picking</th>
              <th>Motivo</th>
              <th>Ultimo intento</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {activeIncidents.map((incident) => (
              <tr key={incident.id}>
                <td>
                  <strong>{incident.orderName ?? `#${incident.orderId}`}</strong>
                  <small>#{incident.orderId}</small>
                </td>
                <td>{incident.client || "Sin dato"}</td>
                <td>{incident.channel || "Sin dato"}</td>
                <td>{incident.tracking || "Sin tracking"}</td>
                <td>
                  <strong>{incident.pickingId || "Sin picking"}</strong>
                  <small>{incident.pickingState || "Sin estado"}</small>
                </td>
                <td>{incident.reason}</td>
                <td>{formatSyncTime(incident.lastAttemptAt)}</td>
                <td>
                  <div className="incident-row-actions">
                    <a
                      href={`/api/odoo/orders/open-order?orderId=${incident.orderId}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Abrir Odoo
                    </a>
                    <button
                      disabled={loading}
                      onClick={() => onResolve(incident.id)}
                      type="button"
                    >
                      Resuelta
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && activeIncidents.length === 0 && (
              <tr>
                <td className="empty-state" colSpan={8}>
                  No hay incidencias de entrega Odoo pendientes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OrderDetailPanel({ loading, order }: { loading?: boolean; order: Order }) {
  const [openComponents, setOpenComponents] = useState<string | null>(null);

  return (
    <div className="order-detail-panel">
      <div className="detail-list">
        <div>
          <span>Pedido</span>
          <strong>{order.id}</strong>
          <small>{order.odooRef}</small>
        </div>
        <div>
          <span>Cliente</span>
          <strong>{order.client}</strong>
          <small>{order.shippingPhone || "Sin telefono registrado"}</small>
        </div>
        <div>
          <span>Direccion envio</span>
          <strong>{order.shippingAddress || "Sin direccion registrada"}</strong>
          <small>{order.city || "Sin ciudad registrada"}</small>
        </div>
        <div>
          <span>Canal</span>
          <strong>{order.channel}</strong>
          <small>
            {[order.externalRef, formatFulfillment(order.fulfillmentBy)]
              .filter(Boolean)
              .join(" · ") || "Sin referencia externa"}
          </small>
        </div>
        <div>
          <span>Sendcloud</span>
          <strong>{order.sendcloud?.status || "Sin dato Sendcloud"}</strong>
          <small>
            {order.sendcloud?.trackingUrl ? (
              <a
                href={order.sendcloud.trackingUrl}
                rel="noreferrer"
                target="_blank"
              >
                {order.sendcloud.trackingNumber || "Ver tracking"}
              </a>
            ) : (
              order.sendcloud?.rawStatus || order.sendcloud?.reference || "No encontrado"
            )}
          </small>
        </div>
        <div>
          <span>Total</span>
          <strong>{money(order.total)}</strong>
          <small>
            Impuestos: {money(order.taxTotal ?? 0)} · {order.invoiceStatus}
          </small>
        </div>
      </div>

      <div className="line-items">
        {order.items.length > 0 ? (
          order.items.map((item) => {
            const itemKey = `${item.sku}-${item.name}`;
            const hasComponents = Boolean(item.components?.length);
            const componentsOpen = openComponents === itemKey;

            return (
              <div className="line-item" key={itemKey}>
                <div className="line-item-main">
                  <div className="line-product">
                    {item.imageUrl ? (
                      <img alt="" src={item.imageUrl} />
                    ) : (
                      <span className="product-thumb-placeholder" />
                    )}
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.sku}</small>
                    </span>
                  </div>
                  <span className="line-price">
                    {formatDecimal(item.quantity)} uds · {money(item.price)} ·{" "}
                    {money(item.subtotal ?? item.quantity * item.price)}
                  </span>
                  {hasComponents && (
                    <button
                      aria-expanded={componentsOpen}
                      aria-label={`Ver componentes de ${item.sku}`}
                      className="icon-button component-button"
                      onClick={() =>
                        setOpenComponents(componentsOpen ? null : itemKey)
                      }
                      title="Ver componentes del kit"
                      type="button"
                    >
                      <Search size={15} />
                    </button>
                  )}
                </div>
                {componentsOpen && (
                  <div className="component-list">
                    {item.components?.map((component) => (
                      <div
                        className="component-row"
                        key={`${component.sku}-${component.name}`}
                      >
                        <span>
                          <strong>{component.name}</strong>
                          <small>{component.sku}</small>
                        </span>
                        <strong>
                          {formatDecimal(component.quantity)} {component.uom}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div>
            <span>
              <strong>{loading ? "Cargando lineas..." : "Lineas no cargadas"}</strong>
              <small>
                {loading
                  ? "Leyendo detalle completo de Odoo bajo demanda."
                  : "Este bloque de Odoo trae el resumen del pedido."}
              </small>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsView({
  currentUser,
  newUserName,
  newUsername,
  newUserPassword,
  newUserRole,
  onAddUser,
  onChangeNewUserName,
  onChangeNewUsername,
  onChangeNewUserPassword,
  onChangeNewUserRole,
  onRefreshUsers,
  onSaveUsers,
  users,
}: {
  currentUser: AuthUser;
  newUserName: string;
  newUsername: string;
  newUserPassword: string;
  newUserRole: DashboardUserRole;
  onAddUser: () => void | Promise<void>;
  onChangeNewUserName: (value: string) => void;
  onChangeNewUsername: (value: string) => void;
  onChangeNewUserPassword: (value: string) => void;
  onChangeNewUserRole: (value: DashboardUserRole) => void;
  onRefreshUsers: () => void | Promise<void>;
  onSaveUsers: (users: DashboardUser[]) => void;
  users: DashboardUser[];
}) {
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const updateUser = async (
    userId: string,
    patch: Partial<DashboardUser> & { password?: string },
  ) => {
    const { password: _password, ...visiblePatch } = patch;
    const updatedUsers = users.map((user) =>
      user.id === userId ? { ...user, ...visiblePatch } : user,
    );
    onSaveUsers(updatedUsers);
    await odooClient.updateDashboardUser(userId, patch);
    await onRefreshUsers();
  };
  const deleteUser = async (userId: string) => {
    const updatedUsers = users.filter((item) => item.id !== userId);
    onSaveUsers(updatedUsers);
    await odooClient.deleteDashboardUser(userId);
    await onRefreshUsers();
  };

  return (
    <section className="settings-grid">
      <article className="panel settings-panel">
        <div className="section-heading">
          <span>Usuarios dashboard</span>
          <h2>Login y permisos por area</h2>
          <p>
            Las sesiones y contrasenas ya se validan en backend. Odoo sigue
            protegido por allowlist y sin escrituras activas.
          </p>
        </div>

        <div className="user-create-row">
          <input
            aria-label="Nombre visible"
            onChange={(event) => onChangeNewUserName(event.target.value)}
            placeholder="Nombre o email"
            value={newUserName}
          />
          <input
            aria-label="Usuario de login"
            onChange={(event) => onChangeNewUsername(event.target.value)}
            placeholder="Usuario login"
            value={newUsername}
          />
          <input
            aria-label="Contrasena inicial"
            onChange={(event) => onChangeNewUserPassword(event.target.value)}
            placeholder="Contrasena inicial"
            type="password"
            value={newUserPassword}
          />
          <select
            aria-label="Rol"
            onChange={(event) =>
              onChangeNewUserRole(event.target.value as DashboardUserRole)
            }
            value={newUserRole}
          >
            <option value="viewer">viewer</option>
            <option value="printer">printer</option>
            <option value="admin">admin</option>
          </select>
          <button onClick={onAddUser} type="button">
            Anadir usuario
          </button>
        </div>

        <div className="dashboard-user-list">
          {users.map((user) => (
            <div className="dashboard-user-row" key={user.id}>
              <span>
                <strong>{user.name}</strong>
                <small>
                  {user.username} · {user.active ? "Activo" : "Desactivado"}
                </small>
              </span>
              <select
                aria-label={`Rol de ${user.name}`}
                onChange={(event) =>
                  updateUser(user.id, {
                    role: event.target.value as DashboardUserRole,
                    permissions: permissionsForRole(
                      event.target.value as DashboardUserRole,
                    ),
                  })
                }
                value={user.role}
              >
                <option value="viewer">viewer</option>
                <option value="printer">printer</option>
                <option value="admin">admin</option>
              </select>
              <div className="permission-tags">
                {editablePermissions.map((permission) => (
                  <label key={permission}>
                    <input
                      checked={user.permissions.includes(permission)}
                      disabled={
                        user.id === currentUser.id && permission === "settings"
                      }
                      onChange={() => {
                        const nextPermissions = user.permissions.includes(permission)
                          ? user.permissions.filter((item) => item !== permission)
                          : [...user.permissions, permission];
                        updateUser(user.id, { permissions: nextPermissions });
                      }}
                      type="checkbox"
                    />
                    {permissionLabels[permission]}
                  </label>
                ))}
              </div>
              <button
                disabled={user.id === currentUser.id}
                onClick={() => updateUser(user.id, { active: !user.active })}
                type="button"
              >
                {user.active ? "Desactivar" : "Activar"}
              </button>
              <input
                aria-label={`Nueva contrasena para ${user.name}`}
                onChange={(event) =>
                  setPasswordDrafts((current) => ({
                    ...current,
                    [user.id]: event.target.value,
                  }))
                }
                placeholder="Nueva contrasena"
                type="password"
                value={passwordDrafts[user.id] ?? ""}
              />
              <button
                disabled={(passwordDrafts[user.id] ?? "").length < 8}
                onClick={async () => {
                  const password = passwordDrafts[user.id] ?? "";
                  await updateUser(user.id, { password });
                  setPasswordDrafts((current) => ({ ...current, [user.id]: "" }));
                }}
                type="button"
              >
                Cambiar contrasena
              </button>
              <button
                disabled={user.id === currentUser.id}
                onClick={() => deleteUser(user.id)}
                type="button"
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      </article>

      <article className="panel settings-panel">
        <div className="section-heading">
          <span>Roles</span>
          <h2>Permisos previstos</h2>
        </div>
        <div className="role-list">
          <div>
            <strong>viewer</strong>
            <small>Ver dashboard, pedidos y estados.</small>
          </div>
          <div>
            <strong>printer</strong>
            <small>Imprimir albaranes y, en el futuro, marcar impresos.</small>
          </div>
          <div>
            <strong>admin</strong>
            <small>Gestionar usuarios y autorizar acciones delicadas.</small>
          </div>
        </div>
      </article>
    </section>
  );
}

function PrintPreview({
  orders,
  view,
}: {
  orders: Order[];
  view: "products" | "orders";
}) {
  const orderGroups = useMemo(() => buildOrderGroupsByProduct(orders), [orders]);

  return (
    <section className="print-preview-panel print-area">
      {view === "products" ? (
        <div className="print-product-blocks">
          {orderGroups.map((group) => (
            <section className="print-product-group" key={group.sku}>
              <div className="delivery-note-stack">
                {group.orders.map(({ order }) => (
                  <DeliveryNote order={order} key={`${group.sku}-${order.id}`} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="delivery-note-stack">
          {orders.map((order) => (
            <DeliveryNote order={order} key={order.id} />
          ))}
        </div>
      )}
    </section>
  );
}

type ProductPrintGroupData = {
  sku: string;
  name: string;
  imageUrl?: string;
  quantity: number;
  orders: Array<{
    order: Order;
    quantity: number;
  }>;
};

function DeliveryNote({ order }: { order: Order }) {
  const printableItems = order.items.filter((item) => !isServiceLine(item));

  return (
    <article className="delivery-note">
      <header className="delivery-note-header">
        <div>
          <strong>Todoelectrico Sum e Ins SL</strong>
          <span>C/Yunque 27 · 03690 Sant Vicent del Raspeig</span>
          <span>CIF: ESB54685144 · +34 965 670 786</span>
        </div>
        <div className="delivery-note-refs">
          <strong>Pedido: {order.id}</strong>
          <span>{order.externalRef ? `Referencia: ${order.externalRef}` : "Sin referencia externa"}</span>
          <span>{order.sendcloud?.trackingNumber ? `Tracking: ${order.sendcloud.trackingNumber}` : getEffectiveDeliveryStatus(order)}</span>
        </div>
      </header>

      <section className="delivery-note-customer">
        <div>
          <span className="customer-label">Cliente</span>
          <strong>{order.client}</strong>
          <small>{order.shippingAddress || order.city || "Sin direccion"}</small>
          <small>{order.shippingPhone || "Sin telefono"}</small>
        </div>
        <div className="delivery-note-qr-list">
          {order.externalRef && (
            <QrBox value={order.externalRef} />
          )}
          <QrBox value={order.id} />
        </div>
      </section>

      <div className="delivery-note-lines">
        <div className="delivery-note-line head">
          <span>Imagen</span>
          <span>Codigo</span>
          <span>Descripcion</span>
          <span>Cantidad</span>
        </div>
        {printableItems.length === 0 && (
          <div className="delivery-note-empty">
            Sin lineas imprimibles detectadas para este pedido.
          </div>
        )}
        {printableItems.map((item) => {
          if (item.components?.length) {
            return item.components
              .filter((component) => !isServiceLine(component))
              .map((component) => (
                <div
                  className="delivery-note-line component"
                  key={`${order.id}-${item.sku}-${component.sku}`}
                >
                  {component.imageUrl ? (
                    <img alt="" src={component.imageUrl} />
                  ) : (
                    <span className="product-thumb-placeholder" />
                  )}
                  <strong>{component.sku}</strong>
                  <span>{component.name}</span>
                <strong>
                    <QuantityBadge
                      quantity={component.quantity}
                      suffix={component.uom}
                    />
                </strong>
              </div>
            ));
          }

          return (
            <div className="delivery-note-line" key={`${order.id}-${item.sku}-${item.name}`}>
              {item.imageUrl ? (
                <img alt="" src={item.imageUrl} />
              ) : (
                <span className="product-thumb-placeholder" />
              )}
              <strong>{item.sku}</strong>
              <span>{item.name}</span>
              <strong>
                <QuantityBadge quantity={item.quantity} />
              </strong>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function QrBox({ value }: { value: string }) {
  return (
    <div className="qr-box">
      <img alt="" src={qrImageUrl(value)} />
    </div>
  );
}

function QuantityBadge({
  quantity,
  suffix,
}: {
  quantity: number;
  suffix?: string;
}) {
  const value = `${formatDecimal(quantity)}${suffix ? ` ${suffix}` : ""}`;
  return (
    <span className={quantity > 1 ? "quantity-badge multiple" : "quantity-badge"}>
      {value}
    </span>
  );
}

function CustomerInvoicesView({
  analytics,
  groupBy,
  loading,
  onChangePageSize,
  onChangeSort,
  onChangeGroupBy,
  onPageChange,
  pageSize,
  range,
  sort,
}: {
  analytics: InvoiceAnalytics | null;
  groupBy: "channels" | "countries" | "statuses";
  loading: boolean;
  onChangeGroupBy: (value: "channels" | "countries" | "statuses") => void;
  onChangePageSize: (value: number) => void;
  onChangeSort: (value: InvoiceSortKey) => void;
  onPageChange: (offset: number) => void;
  pageSize: number;
  range: { from: string; to: string };
  sort: { key: InvoiceSortKey; direction: SortDirection };
}) {
  const rows = analytics?.[groupBy] ?? [];
  const groupLabels = {
    channels: "Canales",
    countries: "Paises",
    statuses: "Estados",
  };

  if (loading) {
    return <div className="chart-empty compact">Cargando facturacion real...</div>;
  }

  if (!analytics) {
    return <div className="chart-empty compact">Sin datos de facturacion.</div>;
  }

  const currentLimit = analytics.limit ?? pageSize;
  const currentOffset = analytics.offset ?? 0;
  const fromItem = analytics.total === 0 ? 0 : currentOffset + 1;
  const toItem = Math.min(currentOffset + analytics.invoices.length, analytics.total);
  const canGoBack = currentOffset > 0;
  const canGoForward = currentOffset + currentLimit < analytics.total;

  return (
    <>
      <section className="kpi-grid order-kpis">
        <Kpi
          title="Facturado"
          value={money(analytics.amountTotal)}
          detail={`${formatInteger(analytics.total)} facturas`}
        />
        <Kpi
          title="Pendiente cobro"
          value={money(analytics.amountResidual)}
          detail={`rango ${range.from} a ${range.to}`}
        />
        <Kpi
          title="Cobrado"
          value={money(analytics.amountTotal - analytics.amountResidual)}
          detail={analytics.mode === "live" ? "Odoo real" : "datos demo"}
        />
      </section>

      <section className="billing-layout">
        <article className="panel billing-chart-panel">
          <div className="section-heading">
            <span>Facturacion cliente</span>
            <h2>Evolucion del importe facturado</h2>
          </div>
          <AreaChart rows={analytics.daily} />
          <div className="billing-trend-block">
            <div className="section-heading compact">
              <span>Comparativa lineal</span>
              <h3>Venta por {groupLabels[groupBy].toLowerCase()}</h3>
            </div>
            <InvoiceTrendChart series={analytics.trends?.[groupBy] ?? []} />
          </div>
        </article>

        <article className="panel billing-breakdown-panel">
          <div className="section-heading">
            <span>Desglose</span>
            <h2>{groupLabels[groupBy]}</h2>
          </div>
          <div className="segmented-control compact">
            <button
              className={groupBy === "channels" ? "active" : ""}
              onClick={() => onChangeGroupBy("channels")}
              type="button"
            >
              Canal
            </button>
            <button
              className={groupBy === "countries" ? "active" : ""}
              onClick={() => onChangeGroupBy("countries")}
              type="button"
            >
              Pais
            </button>
            <button
              className={groupBy === "statuses" ? "active" : ""}
              onClick={() => onChangeGroupBy("statuses")}
              type="button"
            >
              Estado
            </button>
          </div>
          <MetricRanking rows={rows} />
        </article>
      </section>

      <section className="panel orders-panel">
        <div className="section-heading">
          <span>Ultimas facturas</span>
          <h2>Detalle de comprobacion</h2>
        </div>
        <footer className="pagination invoice-pagination">
          <label className="page-size-select">
            Ver
            <select
              onChange={(event) => onChangePageSize(Number(event.target.value))}
              value={pageSize}
            >
              {[20, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span>
            Mostrando {fromItem}-{toItem} de {analytics.total} facturas
          </span>
          <div>
            <button
              aria-label="Pagina anterior"
              disabled={!canGoBack}
              onClick={() => onPageChange(Math.max(0, currentOffset - currentLimit))}
              type="button"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              aria-label="Pagina siguiente"
              disabled={!canGoForward}
              onClick={() => onPageChange(currentOffset + currentLimit)}
              type="button"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </footer>
        <div className="table-scroll">
          <table className="orders-table">
            <thead>
              <tr>
                <InvoiceSortableTh
                  activeSort={sort}
                  label="Factura"
                  onSort={onChangeSort}
                  sortKey="ref"
                />
                <InvoiceSortableTh
                  activeSort={sort}
                  label="Fecha"
                  onSort={onChangeSort}
                  sortKey="date"
                />
                <InvoiceSortableTh
                  activeSort={sort}
                  label="Cliente"
                  onSort={onChangeSort}
                  sortKey="partner"
                />
                <InvoiceSortableTh
                  activeSort={sort}
                  label="Canal"
                  onSort={onChangeSort}
                  sortKey="channel"
                />
                <InvoiceSortableTh
                  activeSort={sort}
                  label="Estado"
                  onSort={onChangeSort}
                  sortKey="status"
                />
                <InvoiceSortableTh
                  activeSort={sort}
                  label="Total"
                  onSort={onChangeSort}
                  sortKey="total"
                />
                <InvoiceSortableTh
                  activeSort={sort}
                  label="Pendiente"
                  onSort={onChangeSort}
                  sortKey="residual"
                />
              </tr>
            </thead>
            <tbody>
              {analytics.invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <strong>{invoice.ref}</strong>
                    <small>{invoice.origin || invoice.id}</small>
                  </td>
                  <td>{invoice.date}</td>
                  <td>
                    <strong>{invoice.partner}</strong>
                    <small>{invoice.country || "Sin pais"}</small>
                  </td>
                  <td>{invoice.channel || "Odoo"}</td>
                  <td>
                    <Status value={invoice.status} />
                  </td>
                  <td>
                    <strong>{money(invoice.total)}</strong>
                  </td>
                  <td>{money(invoice.residual ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function InvoiceSortableTh({
  activeSort,
  label,
  onSort,
  sortKey,
}: {
  activeSort: { key: InvoiceSortKey; direction: SortDirection };
  label: string;
  onSort: (key: InvoiceSortKey) => void;
  sortKey: InvoiceSortKey;
}) {
  const active = activeSort.key === sortKey;
  return (
    <th>
      <button
        className={`sort-header ${active ? "active" : ""}`}
        onClick={() => onSort(sortKey)}
        type="button"
      >
        {label}
        <span>{active ? (activeSort.direction === "asc" ? "ASC" : "DESC") : "-"}</span>
      </button>
    </th>
  );
}

function InvoiceTrendChart({ series }: { series: InvoiceTrendSeries[] }) {
  const visibleSeries = series.filter((item) =>
    item.points.some((point) => point.total > 0),
  );
  if (visibleSeries.length === 0) {
    return <div className="chart-empty compact">Sin facturas en el rango</div>;
  }

  const width = 760;
  const height = 280;
  const padX = 34;
  const padY = 28;
  const dates = Array.from(
    new Set(visibleSeries.flatMap((item) => item.points.map((point) => point.date))),
  ).sort((left, right) => left.localeCompare(right));
  const max = Math.max(
    ...visibleSeries.flatMap((item) => item.points.map((point) => point.total)),
    1,
  );
  const colors = ["#0f766e", "#2563eb", "#b45309", "#7c3aed", "#be123c", "#475569"];
  const xFor = (date: string) =>
    dates.length === 1
      ? width / 2
      : padX + (dates.indexOf(date) * (width - padX * 2)) / (dates.length - 1);
  const yFor = (value: number) =>
    height - padY - (value / max) * (height - padY * 2);

  return (
    <div className="trend-chart">
      <svg aria-label="Grafica lineal de facturacion" viewBox={`0 0 ${width} ${height}`}>
        <line
          stroke="#e2e8f0"
          strokeWidth="1"
          x1={padX}
          x2={width - padX}
          y1={height - padY}
          y2={height - padY}
        />
        {visibleSeries.map((item, index) => {
          const pointsByDate = new Map(item.points.map((point) => [point.date, point]));
          const path = dates
            .map((date, pointIndex) => {
              const point = pointsByDate.get(date);
              const x = xFor(date);
              const y = yFor(point?.total ?? 0);
              return `${pointIndex === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");
          const color = colors[index % colors.length];
          return (
            <g key={item.label}>
              <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeWidth="3" />
              {dates.map((date) => {
                const point = pointsByDate.get(date);
                const total = point?.total ?? 0;
                return (
                  <circle
                    cx={xFor(date)}
                    cy={yFor(total)}
                    fill="#ffffff"
                    key={`${item.label}-${date}`}
                    r="3"
                    stroke={color}
                    strokeWidth="2"
                  >
                    <title>{`${item.label} · ${date} · ${money(total)}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="trend-legend">
        {visibleSeries.map((item, index) => (
          <span key={item.label}>
            <i style={{ background: colors[index % colors.length] }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function AreaChart({ rows }: { rows: InvoiceMetricRow[] }) {
  if (rows.length === 0) {
    return <div className="chart-empty compact">Sin facturas en el rango</div>;
  }

  const width = 760;
  const height = 260;
  const padX = 24;
  const padY = 24;
  const max = Math.max(...rows.map((row) => row.total), 1);
  const points = rows.map((row, index) => {
    const x =
      rows.length === 1
        ? width / 2
        : padX + (index * (width - padX * 2)) / (rows.length - 1);
    const y = height - padY - (row.total / max) * (height - padY * 2);
    return { x, y, row };
  });
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const area = `${line} L ${points[points.length - 1].x} ${height - padY} L ${points[0].x} ${
    height - padY
  } Z`;

  return (
    <div className="area-chart">
      <svg aria-label="Grafica de facturacion" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="billingArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#billingArea)" />
        <path d={line} fill="none" stroke="#0f766e" strokeLinecap="round" strokeWidth="3" />
        {points.map((point) => (
          <circle cx={point.x} cy={point.y} fill="#ffffff" key={point.row.label} r="4" stroke="#0f766e" strokeWidth="2" />
        ))}
      </svg>
      <div className="area-chart-labels">
        <span>{rows[0]?.label}</span>
        <strong>{money(rows.reduce((total, row) => total + row.total, 0))}</strong>
        <span>{rows[rows.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function MetricRanking({ rows }: { rows: InvoiceMetricRow[] }) {
  const max = Math.max(...rows.map((row) => row.total), 1);

  if (rows.length === 0) {
    return <div className="chart-empty compact">Sin desglose disponible</div>;
  }

  return (
    <div className="metric-ranking">
      {rows.map((row) => (
        <div className="metric-ranking-row" key={row.label}>
          <span>
            <strong>{row.label}</strong>
            <small>{formatInteger(row.count)} facturas</small>
          </span>
          <div>
            <strong>{money(row.total)}</strong>
            <i style={{ width: `${Math.max(4, (row.total / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardView({
  controlOrders,
  controlOrdersLoading,
  dashboard,
  dataMode,
  dateRange,
  invoiceAnalytics,
  loadedOrders,
  onOpenInvoices,
  orders,
  onOpenOrders,
  syncStats,
}: {
  controlOrders: Order[];
  controlOrdersLoading: boolean;
  dashboard: DashboardSummary | null;
  dataMode: "loading" | "live" | "demo";
  dateRange: { from: string; to: string };
  invoiceAnalytics: InvoiceAnalytics | null;
  loadedOrders: number;
  onOpenInvoices: () => void;
  orders: Order[];
  onOpenOrders: (filter: DashboardOrderFilter) => void;
  syncStats: OrdersSyncStats | null;
}) {
  const loading = dataMode === "loading" || !dashboard;
  const opsLoading = loading || controlOrdersLoading;
  const daily = (Array.isArray(dashboard?.daily) ? dashboard.daily : []).slice(-14);
  const controlRange = lastDaysRange(4);
  const salesOrders = orders;
  const liveInvoiceAnalytics =
    invoiceAnalytics?.mode === "live" ? invoiceAnalytics : null;
  const invoiceStatuses = Array.isArray(liveInvoiceAnalytics?.statuses)
    ? liveInvoiceAnalytics.statuses
    : [];
  const invoiceDaily = Array.isArray(liveInvoiceAnalytics?.daily)
    ? liveInvoiceAnalytics.daily
    : [];
  const dashboardTopProducts = Array.isArray(dashboard?.topProducts)
    ? dashboard.topProducts
    : [];
  const shippingRows = buildChannelRows(controlOrders, {
    delivery: "No entregados",
  });
  const unprintedRows = buildChannelRows(controlOrders, {
    delivery: "No entregados",
    printed: "Sin imprimir",
  });
  const ordersToShip = shippingRows.find((row) => row.channel === "Todos")?.count ?? 0;
  const unprintedTotal =
    unprintedRows.find((row) => row.channel === "Todos")?.count ?? 0;
  const salesTotal =
    dashboard?.mode === "live"
      ? dashboard.totalRevenue
      : sum(salesOrders.map((order) => order.total));
  const salesOrderCount =
    dashboard?.mode === "live" ? dashboard.totalOrders : salesOrders.length;
  const averageTicket = salesOrderCount ? salesTotal / salesOrderCount : 0;
  const readyToValidate = controlOrders.filter(
    (order) => order.odooDeliveryValidation?.status === "ready",
  ).length;
  const operationalIssues = controlOrders.filter(
    (order) =>
      order.odooDeliveryValidation?.status === "incident" ||
      deliveryTone(getEffectiveDeliveryStatus(order)) === "issue",
  ).length;
  const deliveryIncidents = dashboard?.cache?.incidentCount ?? operationalIssues;
  const lastSync = syncStats?.lastFinishedAt || dashboard?.cache?.updatedAt;
  const sendcloudPending = controlOrders.filter((order) => {
    const status = getEffectiveDeliveryStatus(order).toLowerCase();
    return (
      !isDelivered(status) &&
      (status.includes("sin etiqueta") ||
        status.includes("pago aceptado") ||
        status.includes("prepar") ||
        status.includes("pendiente"))
    );
  }).length;
  const sendcloudErrors = controlOrders.filter(
    (order) => deliveryTone(getEffectiveDeliveryStatus(order)) === "issue",
  ).length;
  const sendcloudCreatedNotSent = controlOrders.filter((order) => {
    const status = getEffectiveDeliveryStatus(order).toLowerCase();
    return (
      !isDelivered(status) &&
      (status.includes("sin etiqueta") ||
        status.includes("cread") ||
        status.includes("pago aceptado"))
    );
  }).length;
  const topProducts =
    dashboard?.mode === "live" && dashboardTopProducts.length > 0
      ? dashboardTopProducts.map(mapDashboardProductToControlRow).slice(0, 8)
      : buildControlProducts(salesOrders, "amount").slice(0, 8);
  const lowStockProducts = buildControlProducts(salesOrders, "quantity")
    .filter(
      (product) =>
        product.stock !== null &&
        (product.stock <= 0 || product.stock < product.quantity),
    )
    .slice(0, 6);
  const invoiceErrors =
    invoiceStatuses
      .filter((row) => {
        const label = row.label.toLowerCase();
        return label.includes("error") || label.includes("cancel") || label.includes("revers");
      })
      .reduce((total, row) => total + row.count, 0);
  const blockedOrders = controlOrders.filter((order) => order.status === "Bloqueado").length;
  const alerts = buildOperationalAlerts({
    blockedOrders,
    dataMode,
    lowStockCount: lowStockProducts.length,
    operationalIssues,
    ordersToShip,
    sendcloudErrors,
    unprintedTotal,
  });

  return (
    <>
      <section className="control-hero">
        <div>
          <p className="eyebrow">Centro de Control</p>
          <h2>Estado operativo TodoElectrico</h2>
          <span>
            Ventas del rango {dateRange.from} a {dateRange.to} · preparacion
            de los ultimos 4 dias
          </span>
        </div>
        <button
          className="clear-filters"
          onClick={() => onOpenOrders({})}
          type="button"
        >
          <ClipboardList size={16} />
          Ver pedidos
        </button>
      </section>

      <section className="control-kpi-grid">
        <ControlKpi
          detail="No entregados en ventana operativa"
          icon={<Truck size={18} />}
          label="Pedidos por enviar"
          onClick={() =>
            onOpenOrders({ delivery: "No entregados", range: controlRange })
          }
          tone="blue"
          value={opsLoading ? "..." : formatInteger(ordersToShip)}
        />
        <ControlKpi
          detail={`Pendientes ${controlRange.from} a ${controlRange.to}`}
          icon={<Printer size={18} />}
          label="Sin imprimir 4 dias"
          onClick={() =>
            onOpenOrders({
              delivery: "No entregados",
              printed: "Sin imprimir",
              range: controlRange,
            })
          }
          tone="amber"
          value={opsLoading ? "..." : formatInteger(unprintedTotal)}
        />
        <ControlKpi
          detail={`${formatInteger(salesOrderCount)} pedidos · ticket ${money(
            averageTicket,
          )}`}
          icon={<BarChart3 size={18} />}
          label="Ventas realizadas"
          onClick={() => onOpenOrders({})}
          tone="green"
          value={loading ? "..." : money(salesTotal)}
        />
        <ControlKpi
          detail={`${formatInteger(liveInvoiceAnalytics?.total ?? 0)} facturas · ${formatInteger(
            invoiceErrors,
          )} errores`}
          icon={<ReceiptText size={18} />}
          label="Facturacion"
          onClick={onOpenInvoices}
          tone="slate"
          value={
            liveInvoiceAnalytics
              ? money(liveInvoiceAnalytics.amountTotal)
              : loading
                ? "..."
                : "Sin dato"
          }
        />
        <ControlKpi
          detail={`${formatInteger(topProducts[0]?.quantity ?? 0)} uds del primero`}
          icon={<Boxes size={18} />}
          label="Mejores productos"
          onClick={() => onOpenOrders({})}
          tone="violet"
          value={
            topProducts[0]?.sku && topProducts[0].sku !== "SKU s/d"
              ? topProducts[0].sku
              : topProducts[0]
                ? "Ver listado"
                : "..."
          }
        />
        <ControlKpi
          detail="Derivado de ventas y stock disponible"
          icon={<ShoppingCart size={18} />}
          label="Compras / proveedores"
          onClick={() => onOpenOrders({})}
          tone="rose"
          value={formatInteger(lowStockProducts.length)}
        />
        <ControlKpi
          detail="Sin etiqueta, pendiente o preparacion"
          icon={<Truck size={18} />}
          label="Pendiente Sendcloud"
          onClick={() => onOpenOrders({ delivery: "No entregados", range: controlRange })}
          tone="cyan"
          value={formatInteger(sendcloudPending)}
        />
        <ControlKpi
          detail={`${formatInteger(readyToValidate)} listos para validar albaran`}
          icon={<ShieldCheck size={18} />}
          label="Entregas Odoo con incidencia"
          onClick={() =>
            onOpenOrders({ odooDelivery: "Incidencia entrega Odoo", range: controlRange })
          }
          tone="red"
          value={formatInteger(deliveryIncidents)}
        />
        <ControlKpi
          detail={
            syncStats
              ? `${formatDuration(syncStats.durationMs)} · Odoo ${syncStats.odooCalls} · Sendcloud ${syncStats.sendcloudCalls}`
              : "Sin sincronizacion registrada"
          }
          icon={<RefreshCw size={18} />}
          label="Sincronizacion"
          onClick={() => onOpenOrders({})}
          tone="slate"
          value={lastSync ? formatSyncTime(lastSync) : "Pendiente"}
        />
      </section>

      <section className="control-grid control-ops-grid">
        <ControlChannelPanel
          icon={<Truck size={18} />}
          rows={shippingRows}
          loading={opsLoading}
          title="Pedidos por enviar"
          subtitle="Preparacion por canal de venta"
          onOpen={(channel) =>
            onOpenOrders({
              channel,
              delivery: "No entregados",
              range: controlRange,
            })
          }
        />
        <ControlChannelPanel
          icon={<Printer size={18} />}
          rows={unprintedRows}
          loading={opsLoading}
          title="Pedidos sin imprimir ultimos 4 dias"
          subtitle={`${controlRange.from} a ${controlRange.to}`}
          onOpen={(channel) =>
            onOpenOrders({
              channel,
              delivery: "No entregados",
              printed: "Sin imprimir",
              range: controlRange,
            })
          }
        />
        <ControlAlertsPanel
          alerts={alerts}
          onOpenOrders={(filter) => onOpenOrders({ ...filter, range: controlRange })}
        />
      </section>

      <section className="control-grid two-columns">
        <article className="panel control-panel">
          <div className="panel-header">
            <div>
              <h2>Ventas</h2>
              <span>Total, pedidos, ticket medio y evolucion</span>
            </div>
            <BarChart3 size={19} />
          </div>
          <div className="control-metrics">
            <MetricTile label="Total ventas" value={money(salesTotal)} />
            <MetricTile label="Pedidos" value={formatInteger(salesOrderCount)} />
            <MetricTile label="Ticket medio" value={money(averageTicket)} />
          </div>
          <DailyChart rows={daily} loading={loading} />
        </article>

        <article className="panel control-panel">
          <div className="panel-header">
            <div>
              <h2>Facturacion</h2>
              <span>Emitido, pendiente y errores del rango</span>
            </div>
            <ReceiptText size={19} />
          </div>
          <div className="control-metrics">
            <MetricTile
              label="Total facturado"
              value={liveInvoiceAnalytics ? money(liveInvoiceAnalytics.amountTotal) : "Sin dato"}
            />
            <MetricTile
              label="Pendiente"
              value={
                liveInvoiceAnalytics
                  ? money(liveInvoiceAnalytics.amountResidual)
                  : "Sin dato"
              }
            />
            <MetricTile
              label="Facturas"
              value={formatInteger(liveInvoiceAnalytics?.total ?? 0)}
            />
            <MetricTile label="Errores" value={formatInteger(invoiceErrors)} />
          </div>
          <AreaChart rows={invoiceDaily} />
        </article>

        <article className="panel control-panel">
          <div className="panel-header">
            <div>
              <h2>Sendcloud</h2>
              <span>Estado simple de envios conectados</span>
            </div>
            <Truck size={19} />
          </div>
          <div className="control-metrics three">
            <MetricTile label="Pendientes" value={formatInteger(sendcloudPending)} />
            <MetricTile label="Errores" value={formatInteger(sendcloudErrors)} />
            <MetricTile
              label="Creados no enviados"
              value={formatInteger(sendcloudCreatedNotSent)}
            />
          </div>
          <button
            className="clear-filters"
            onClick={() => onOpenOrders({ delivery: "No entregados", range: controlRange })}
            type="button"
          >
            <Truck size={16} />
            Ver pendientes
          </button>
        </article>
      </section>

      <section className="control-grid products-grid">
        <article className="panel control-panel">
          <div className="panel-header">
            <div>
              <h2>Mejores productos</h2>
              <span>Calculado desde lineas reales del rango cargado</span>
            </div>
            <Boxes size={19} />
          </div>
          <ProductControlTable rows={topProducts} />
        </article>

        <article className="panel control-panel">
          <div className="panel-header">
            <div>
              <h2>Compras / Proveedores</h2>
              <span>Preparado para conectar pedidos de proveedor Odoo</span>
            </div>
            <ShoppingCart size={19} />
          </div>
          <SupplierPreparedTable />
          <div className="control-note">
            <strong>{loadedOrders}</strong>
            <span>
              pedidos cargados en el bloque actual. No se muestran proveedores,
              importes ni fechas hasta conectar compras reales de Odoo.
            </span>
          </div>
          <button
            className="clear-filters"
            onClick={() => onOpenOrders({})}
            type="button"
          >
            <ClipboardList size={16} />
            Ver pedidos
          </button>
        </article>
      </section>
    </>
  );
}

function ControlKpi({
  detail,
  icon,
  label,
  onClick,
  tone,
  value,
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone: string;
  value: string;
}) {
  return (
    <button className={`control-kpi ${tone}`} onClick={onClick} type="button">
      <span className="control-kpi-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <em>Ver detalle</em>
    </button>
  );
}

function ControlChannelPanel({
  icon,
  loading,
  onOpen,
  rows,
  subtitle,
  title,
}: {
  icon: ReactNode;
  loading: boolean;
  onOpen: (channel: ControlChannel) => void;
  rows: Array<{ channel: ControlChannel; count: number }>;
  subtitle: string;
  title: string;
}) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <article className="panel control-panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <span>{subtitle}</span>
        </div>
        {icon}
      </div>
      <div className="control-channel-list">
        {rows.map((row) => (
          <button key={row.channel} onClick={() => onOpen(row.channel)} type="button">
            <span>{row.channel}</span>
            <div className="ranking-meter" aria-hidden="true">
              <span style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }} />
            </div>
            <strong>{loading ? "..." : formatInteger(row.count)}</strong>
          </button>
        ))}
      </div>
    </article>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ControlAlertsPanel({
  alerts,
  onOpenOrders,
}: {
  alerts: ControlAlert[];
  onOpenOrders: (filter: DashboardOrderFilter) => void;
}) {
  return (
    <article className="panel control-panel alerts-panel">
      <div className="panel-header">
        <div>
          <h2>Alertas operativas</h2>
          <span>Solo avisos con datos reales disponibles</span>
        </div>
        <Bell size={19} />
      </div>
      <div className="alert-list">
        {alerts.map((alert) => (
          <button
            className={`alert-row ${alert.tone}`}
            key={alert.label}
            onClick={() => onOpenOrders(alert.filter ?? {})}
            type="button"
          >
            <strong>{formatInteger(alert.count)}</strong>
            <span>{alert.label}</span>
            <small>{alert.detail}</small>
          </button>
        ))}
        {alerts.length === 0 && (
          <div className="empty-alerts">
            Sin alertas activas con los datos disponibles.
          </div>
        )}
      </div>
    </article>
  );
}

function SupplierPreparedTable() {
  return (
    <div className="supplier-prepared-table">
      <div className="supplier-prepared-row head">
        <span>Proveedor</span>
        <span>Importe estimado</span>
        <span>Fecha prevista</span>
      </div>
      <div className="supplier-prepared-empty">
        Pendiente de conectar compras/proveedores reales de Odoo.
      </div>
    </div>
  );
}

function ProductControlTable({
  compact = false,
  rows,
}: {
  compact?: boolean;
  rows: ControlProductRow[];
}) {
  if (rows.length === 0) {
    return <div className="chart-empty compact">Sin productos en el rango</div>;
  }

  return (
    <div className={`control-product-table ${compact ? "compact" : ""}`}>
      {rows.map((row) => (
        <div className="control-product-row" key={row.sku}>
          <div>
            <strong title={row.name}>{row.name}</strong>
            <span>{row.sku}</span>
          </div>
          <span>{formatDecimal(row.quantity)} uds</span>
          <span>{money(row.amount)}</span>
          <span>{row.stock === null ? "Stock s/d" : `Stock ${formatDecimal(row.stock)}`}</span>
        </div>
      ))}
    </div>
  );
}

type ControlProductRow = {
  sku: string;
  name: string;
  quantity: number;
  amount: number;
  stock: number | null;
};
type ControlAlert = {
  count: number;
  detail: string;
  filter?: DashboardOrderFilter;
  label: string;
  tone: "danger" | "warning" | "info";
};

function buildOperationalAlerts({
  blockedOrders,
  dataMode,
  lowStockCount,
  operationalIssues,
  ordersToShip,
  sendcloudErrors,
  unprintedTotal,
}: {
  blockedOrders: number;
  dataMode: "loading" | "live" | "demo";
  lowStockCount: number;
  operationalIssues: number;
  ordersToShip: number;
  sendcloudErrors: number;
  unprintedTotal: number;
}): ControlAlert[] {
  const alerts: ControlAlert[] = [];
  if (unprintedTotal > 0) {
    alerts.push({
      count: unprintedTotal,
      detail: "Pendientes de imprimir",
      filter: { delivery: "No entregados", printed: "Sin imprimir" },
      label: "Pedidos sin imprimir",
      tone: "warning",
    });
  }
  if (ordersToShip > 0) {
    alerts.push({
      count: ordersToShip,
      detail: "No entregados",
      filter: { delivery: "No entregados" },
      label: "Pedidos pendientes de enviar",
      tone: "info",
    });
  }
  if (blockedOrders > 0) {
    alerts.push({
      count: blockedOrders,
      detail: "Estado de pedido bloqueado",
      filter: {},
      label: "Pedidos bloqueados",
      tone: "danger",
    });
  }
  if (sendcloudErrors > 0 || operationalIssues > 0) {
    alerts.push({
      count: Math.max(sendcloudErrors, operationalIssues),
      detail: "Errores de envio o albaran",
      filter: { odooDelivery: "Incidencia" },
      label: "Errores de envio",
      tone: "danger",
    });
  }
  if (lowStockCount > 0) {
    alerts.push({
      count: lowStockCount,
      detail: "Stock real bajo conectado",
      label: "Stock critico",
      tone: "warning",
    });
  }
  if (dataMode === "demo") {
    alerts.push({
      count: 1,
      detail: "El Dashboard esta usando fallback demo",
      label: "Sincronizacion Odoo",
      tone: "danger",
    });
  }
  return alerts;
}

function buildChannelRows(
  orders: Order[],
  filters: { delivery?: string; printed?: string },
) {
  const channels: ControlChannel[] = [
    "Amazon FBM",
    "Amazon DBA",
    "Website",
    "Sales",
    "Todos",
  ];

  return channels.map((channel) => ({
    channel,
    count: orders.filter(
      (order) =>
        matchesControlChannel(order, channel) &&
        matchesControlDelivery(order, filters.delivery) &&
        matchesControlPrinted(order, filters.printed),
    ).length,
  }));
}

function matchesControlDelivery(order: Order, value?: string) {
  if (!value || value === "Todos") return true;
  const delivered = isDelivered(getEffectiveDeliveryStatus(order));
  return value === "Entregados" ? delivered : !delivered;
}

function matchesControlPrinted(order: Order, value?: string) {
  if (!value || value === "Todos") return true;
  return value === "Impresos" ? order.deliveryPrinted : !order.deliveryPrinted;
}

function matchesControlChannel(order: Order, channel: ControlChannel): boolean {
  if (channel === "Todos") return true;
  const value = `${order.channel} ${order.fulfillmentBy ?? ""}`.toLowerCase();
  if (channel === "Amazon FBM") {
    return order.fulfillmentBy === "FBM" || (value.includes("amazon") && value.includes("fbm"));
  }
  if (channel === "Amazon DBA") {
    return (
      order.fulfillmentBy === "FBA" ||
      (value.includes("amazon") && !matchesControlChannel(order, "Amazon FBM"))
    );
  }
  if (channel === "Website") return value.includes("website");
  if (channel === "Sales") return value.includes("sales");
  return false;
}

function channelToFilterValues(channel: ControlChannel) {
  if (channel === "Todos") return [];
  return [channel];
}

function buildControlProducts(
  orders: Order[],
  sortBy: "amount" | "quantity",
): ControlProductRow[] {
  const rows = new Map<string, ControlProductRow>();

  orders.forEach((order) => {
    order.items.filter((item) => !isServiceLine(item)).forEach((item) => {
      const sku = item.sku || item.name || "SIN-SKU";
      const row = rows.get(sku) ?? {
        sku,
        name: item.name || sku,
        quantity: 0,
        amount: 0,
        stock: null,
      };
      row.quantity += item.quantity;
      row.amount += item.subtotal ?? item.quantity * item.price;
      if ((item.stock ?? 0) > 0) {
        row.stock = Math.max(row.stock ?? 0, item.stock ?? 0);
      }
      rows.set(sku, row);
    });
  });

  return Array.from(rows.values()).sort((left, right) => {
    const metric =
      sortBy === "amount" ? right.amount - left.amount : right.quantity - left.quantity;
    return metric || left.name.localeCompare(right.name);
  });
}

function mapDashboardProductToControlRow(row: DashboardProductRow): ControlProductRow {
  const skuMatch = row.label.match(/^\[([^\]]+)\]\s*(.*)$/);
  const sku = skuMatch?.[1] || "SKU s/d";
  const name = skuMatch?.[2] || row.label;

  return {
    sku,
    name,
    quantity: row.quantity,
    amount: row.amount,
    stock: null,
  };
}

function ProductRankingList({
  rows,
  loading,
}: {
  rows: DashboardProductRow[];
  loading: boolean;
}) {
  if (loading) {
    return <div className="chart-empty compact">Cargando productos...</div>;
  }

  if (rows.length === 0) {
    return <div className="chart-empty compact">Sin productos en el rango</div>;
  }

  const maxAmount = Math.max(...rows.map((row) => row.amount), 1);

  return (
    <div className="product-ranking-list">
      {rows.map((row) => (
        <div className="product-ranking-row" key={row.label}>
          <strong title={row.label}>{row.label}</strong>
          <span>
            {formatDecimal(row.quantity)} uds · {money(row.amount)}
          </span>
          <div className="ranking-meter" aria-hidden="true">
            <span
              style={{
                width: `${Math.max(6, (row.amount / maxAmount) * 100)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DailyChart({
  rows,
  loading,
}: {
  rows: DashboardRow[];
  loading: boolean;
}) {
  if (loading) {
    return <div className="chart-empty">Cargando agregados desde Odoo...</div>;
  }

  if (rows.length === 0) {
    return <div className="chart-empty">Sin pedidos en este rango.</div>;
  }

  const maxAmount = Math.max(...rows.map((row) => row.amount), 1);

  return (
    <div className="daily-chart">
      {rows.map((row) => (
        <div className="daily-bar" key={row.label}>
          <div className="bar-track">
            <span
              style={{
                height: `${Math.max(8, (row.amount / maxAmount) * 100)}%`,
              }}
            />
          </div>
          <strong>{row.orders}</strong>
          <small>{shortDateLabel(row.label)}</small>
        </div>
      ))}
    </div>
  );
}

function RankingList({
  rows,
  loading,
  emptyLabel = "Sin datos en el rango",
}: {
  rows: DashboardRow[];
  loading: boolean;
  emptyLabel?: string;
}) {
  if (loading) {
    return <div className="chart-empty compact">Cargando...</div>;
  }

  if (rows.length === 0) {
    return <div className="chart-empty compact">{emptyLabel}</div>;
  }

  const maxAmount = Math.max(...rows.map((row) => row.amount), 1);

  return (
    <div className="ranking-list">
      {rows.map((row) => (
        <div className="ranking-row" key={row.label}>
          <div>
            <strong>{row.label}</strong>
            <span>{formatInteger(row.orders)} pedidos</span>
          </div>
          <div className="ranking-meter" aria-hidden="true">
            <span
              style={{
                width: `${Math.max(6, (row.amount / maxAmount) * 100)}%`,
              }}
            />
          </div>
          <strong>{money(row.amount)}</strong>
        </div>
      ))}
    </div>
  );
}

function ChannelMultiFilter({
  label,
  onClear,
  onToggle,
  options,
  values,
}: {
  label: string;
  onClear: () => void;
  onToggle: (value: string) => void;
  options: string[];
  values: string[];
}) {
  return (
    <div className="channel-filter">
      <span>{label}</span>
      <div className="channel-options">
        <button
          className={values.length === 0 ? "active" : ""}
          onClick={onClear}
          type="button"
        >
          Todos
        </button>
        {options.map((option) => (
          <button
            className={values.includes(option) ? "active" : ""}
            key={option}
            onClick={() => onToggle(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectFilter({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="select-filter">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function SortableTh({
  activeSort,
  label,
  onSort,
  sortKey,
}: {
  activeSort: { key: OrderSortKey; direction: SortDirection };
  label: string;
  onSort: (key: OrderSortKey) => void;
  sortKey: OrderSortKey;
}) {
  const active = activeSort.key === sortKey;
  return (
    <th>
      <button
        className={`sort-header ${active ? "active" : ""}`}
        onClick={() => onSort(sortKey)}
        type="button"
      >
        {label}
        <span>{active ? (activeSort.direction === "asc" ? "ASC" : "DESC") : "-"}</span>
      </button>
    </th>
  );
}

function TrackingLink({ order }: { order: Order }) {
  const trackingNumber = order.sendcloud?.trackingNumber;
  const trackingUrl = order.sendcloud?.trackingUrl;
  if (!trackingNumber && !trackingUrl) return null;

  if (trackingUrl) {
    return (
      <a
        className="tracking-link"
        href={trackingUrl}
        rel="noreferrer"
        target="_blank"
      >
        {trackingNumber || "Ver tracking"}
      </a>
    );
  }

  return <small>{trackingNumber}</small>;
}

function Kpi({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="kpi">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Status({ value }: { value: string }) {
  return <span className={`status ${statusTone(value)}`}>{value}</span>;
}

function DeliveryStatusCell({ value }: { value: string }) {
  const tone = deliveryTone(value);
  const Icon = tone === "delivered" ? CheckCircle2 : tone === "issue" ? XCircle : Truck;

  return (
    <span className={`delivery-status ${tone}`}>
      <Icon size={15} />
      {value}
    </span>
  );
}

function OdooDeliveryCell({ order }: { order: Order }) {
  const validation = order.odooDeliveryValidation;
  if (!validation) {
    return (
      <span
        aria-label="Sin dato Odoo"
        className="delivery-status neutral icon-status"
        data-tooltip="Entrega Odoo: sin dato Odoo"
        tabIndex={0}
        title="Entrega Odoo: sin dato Odoo"
      >
        <Truck size={15} />
      </span>
    );
  }
  const Icon =
    validation.status === "validated"
      ? CheckCircle2
      : validation.status === "incident"
        ? XCircle
        : Truck;
  const detail =
    validation.status === "validated"
      ? formatShortDateTime(validation.dateDone)
      : validation.reason;
  const tooltip = [
    `Entrega Odoo: ${validation.label}`,
    detail,
    validation.pickingId ? `Picking: ${validation.pickingId}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      className={`delivery-status ${odooDeliveryTone(
        validation.status,
      )} icon-status`}
      aria-label={tooltip}
      data-tooltip={tooltip}
      tabIndex={0}
      title={tooltip}
    >
      <Icon size={15} />
    </span>
  );
}

function BooleanCell({
  active,
  label,
  type,
}: {
  active: boolean;
  label: string;
  type: "delivery" | "print";
}) {
  const isLocalPrint = type === "print" && label.startsWith("Local");
  const Icon = active ? CheckCircle2 : isLocalPrint ? Printer : XCircle;
  const tooltipLabel = label.replace(/\n/g, " ");
  const tooltip =
    type === "print"
      ? `Delivery print: ${tooltipLabel}`
      : `Entrega: ${tooltipLabel}`;

  return (
    <span
      aria-label={tooltip}
      className={`boolean-cell ${active || isLocalPrint ? "yes" : "no"} icon-status`}
      data-tooltip={tooltip}
      tabIndex={0}
      title={tooltip}
    >
      {type === "delivery" && active ? <Truck size={15} /> : <Icon size={15} />}
    </span>
  );
}

function getDeliveryPrintLabel(order: Order, pendingBatch: PrintBatch | null) {
  if (order.deliveryPrinted) {
    const time = formatShortDateTime(order.deliveryLastPrintDate);
    const count =
      typeof order.deliveryPrintCount === "number" && order.deliveryPrintCount > 1
        ? ` x${order.deliveryPrintCount}`
        : "";
    return `OK${count}${time ? `\n${time}` : ""}`;
  }

  const pending = pendingBatch?.orders.some((item) => item.id === order.id);
  if (pending && pendingBatch) {
    return `Local\n${formatShortDateTime(pendingBatch.printedAt)}`;
  }

  return "No";
}

function formatPrintTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return value.slice(11, 16) || value.slice(0, 16);
}

function formatShortDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const day = date.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
    const time = date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${day} ${time}`;
  }

  const datePart = value.slice(0, 10);
  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const shortDate = match ? `${match[3]}/${match[2]}/${match[1].slice(2)}` : "";
  const time = value.slice(11, 16);
  return [shortDate, time].filter(Boolean).join(" ") || value.slice(0, 16);
}

function isDelivered(deliveryStatus: string) {
  return deliveryStatus.toLowerCase().includes("entregado");
}

function deliveryTone(value: string) {
  const status = value.toLowerCase();
  if (status.includes("entregado")) return "delivered";
  if (status.includes("incidencia") || status.includes("cancel")) return "issue";
  if (status.includes("transito") || status.includes("enviado")) return "sent";
  if (status.includes("etiqueta")) return "label";
  if (status.includes("prepar")) return "preparing";
  if (status.includes("sin etiqueta") || status.includes("sin albaran")) {
    return "empty";
  }
  return "neutral";
}

function odooDeliveryTone(status: NonNullable<Order["odooDeliveryValidation"]>["status"]) {
  if (status === "validated") return "delivered";
  if (status === "ready") return "sent";
  if (status === "incident") return "issue";
  return "neutral";
}

function getEffectiveDeliveryStatus(order: Order) {
  return order.sendcloud?.status || order.deliveryStatus;
}

function sortOrders(
  orders: Order[],
  key: OrderSortKey,
  direction: SortDirection,
) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...orders].sort((left, right) => {
    const comparison = compareOrderValue(
      getOrderSortValue(left, key),
      getOrderSortValue(right, key),
    );
    return comparison * multiplier || left.id.localeCompare(right.id);
  });
}

function getOrderSortValue(order: Order, key: OrderSortKey) {
  if (key === "id") return order.id;
  if (key === "date") return order.date;
  if (key === "client") return order.client;
  if (key === "channel") return order.channel;
  if (key === "status") return order.status;
  if (key === "delivery") return getEffectiveDeliveryStatus(order);
  if (key === "odooDelivery") {
    return `${order.odooDeliveryValidation?.status ?? ""} ${
      order.odooDeliveryValidation?.dateDone ?? ""
    }`;
  }
  if (key === "printed") return order.deliveryPrinted ? 1 : 0;
  if (key === "invoice") return order.invoiceStatus;
  return order.total;
}

function compareOrderValue(left: string | number, right: string | number) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right), "es", {
    numeric: true,
    sensitivity: "base",
  });
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("es-ES").format(value);
}

function formatDuration(value?: number) {
  if (!value && value !== 0) return "Sin duracion";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}

function formatSyncTime(value: string) {
  if (!value) return "Pendiente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}

function formatOrdersSyncSummary(sync: OrdersSyncStats) {
  return [
    `Sync ${formatDuration(sync.durationMs)}`,
    `${formatInteger(sync.ordersNew)} nuevos`,
    `${formatInteger(sync.ordersUpdated)} actualizados`,
    `${formatInteger(sync.sendcloudLabels)} etiquetas/tracking`,
    `${formatInteger(sync.deliveriesValidated)} validados`,
    `${formatInteger(sync.incidents)} incidencias`,
    `Odoo ${sync.odooCalls}`,
    `Sendcloud ${sync.sendcloudCalls}`,
  ].join(" · ");
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 2,
  }).format(value);
}

function shortDateLabel(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(5);
  return value.replace(/\s202\d$/, "");
}

function formatFulfillment(value?: Order["fulfillmentBy"]) {
  if (value === "FBA") return "FBA · Amazon Fulfillment Network";
  if (value === "FBM") return "FBM · Merchant Fulfillment Network";
  return "";
}

function buildOrderGroupsByProduct(orders: Order[]) {
  const groups = new Map<string, ProductPrintGroupData>();

  orders.forEach((order) => {
    const product =
      order.items.find((item) => !isServiceLine(item) && item.components?.length) ??
      order.items.find((item) => !isServiceLine(item));
    const sku = product?.sku || "SIN-PRODUCTO";
    const group = groups.get(sku) ?? {
      sku,
      name: product?.name || "Sin producto",
      imageUrl: product?.imageUrl,
      quantity: 0,
      orders: [],
    };
    group.quantity += product?.quantity ?? 0;
    group.orders.push({ order, quantity: product?.quantity ?? 0 });
    groups.set(sku, group);
  });

  return Array.from(groups.values()).sort((left, right) =>
    left.sku.localeCompare(right.sku),
  );
}

function buildPreparationRows(orders: Order[]) {
  const rows = new Map<
    string,
    {
      sku: string;
      name: string;
      imageUrl?: string;
      quantity: number;
      uom: string;
      orders: Array<{ id: string; quantity: number }>;
    }
  >();

  orders.forEach((order) => {
    order.items.filter((item) => !isServiceLine(item)).forEach((item) => {
      const products =
        item.components && item.components.length > 0
          ? item.components
          : [
              {
                sku: item.sku,
                name: item.name,
                quantity: item.quantity,
                uom: "uds",
                imageUrl: item.imageUrl,
              },
            ];

      products.forEach((product) => {
        const row = rows.get(product.sku) ?? {
          sku: product.sku,
          name: product.name,
          imageUrl: product.imageUrl,
          quantity: 0,
          uom: product.uom,
          orders: [],
        };
        row.quantity += product.quantity;
        row.orders.push({ id: order.id, quantity: product.quantity });
        if (!row.imageUrl && product.imageUrl) row.imageUrl = product.imageUrl;
        rows.set(product.sku, row);
      });
    });
  });

  return Array.from(rows.values()).sort((left, right) =>
    left.sku.localeCompare(right.sku),
  );
}

function isServiceLine(
  item: Order["items"][number] | NonNullable<Order["items"][number]["components"]>[number],
) {
  const value = `${item.sku} ${item.name}`.toLowerCase();
  return (
    value.includes("ajuste web") ||
    value.includes("ajusteweb") ||
    value.includes("error_id_producto") ||
    value.includes("todos los transportistas") ||
    value.includes("416 mrw") ||
    value.includes("411 cainiao") ||
    value.includes("gls es-24h") ||
    value.includes("portugal ctt") ||
    value.includes("gls - internacional") ||
    value.includes("ship amazon") ||
    value.includes("amazon shipping costs") ||
    value.includes("shipping costs")
  );
}

function qrImageUrl(value: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=8&data=${encodeURIComponent(value)}`;
}

function matchesChannelOption(order: Order, option: string) {
  if (option === "Amazon FBA") return order.fulfillmentBy === "FBA";
  if (option === "Amazon FBM") return order.fulfillmentBy === "FBM";
  if (option === "Amazon DBA") return matchesControlChannel(order, "Amazon DBA");
  return order.channel === option;
}

function permissionsForRole(role: DashboardUserRole): DashboardPermission[] {
  if (role === "admin") return [...editablePermissions];
  if (role === "printer") return ["dashboard", "tasks", "orders", "odooWrite"];
  return ["dashboard", "tasks", "orders"];
}

function isTaskOverdue(task: DashboardTask) {
  return Boolean(task.dueDate && task.status !== "Hecha" && task.dueDate < todayIso());
}

function isTaskDueToday(task: DashboardTask) {
  return task.dueDate === todayIso() && task.status !== "Hecha";
}

function isTaskReminderDue(task: DashboardTask) {
  if (!task.reminderAt || task.status === "Hecha") return false;
  return new Date(task.reminderAt).getTime() <= Date.now();
}

function formatReminder(value: string) {
  if (!value) return "Sin aviso";
  return value.replace("T", " ");
}

function getNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function formatNotificationPermission(value: string) {
  const labels: Record<string, string> = {
    granted: "activados",
    denied: "bloqueados",
    default: "pendientes de permiso",
    unsupported: "no soportados",
  };
  return labels[value] ?? value;
}

function getMonthRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(year, monthIndex - 1, 1);
  const last = new Date(year, monthIndex, 0);
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

function getCalendarDays(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(year, monthIndex - 1, 1);
  const start = new Date(first);
  const mondayIndex = (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - mondayIndex);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      iso: date.toISOString().slice(0, 10),
      label: date.getDate().toString(),
      inMonth: date.getMonth() === monthIndex - 1,
    };
  });
}

function formatCalendarTime(value: string) {
  if (!value) return "Sin hora";
  return value.slice(11, 16) || "Todo el dia";
}

function formatCalendarSource(source: CalendarAccountId) {
  if (source === "gmail1") return "Gmail 1";
  if (source === "gmail2") return "Gmail 2";
  return "Dashboard";
}

function getDateRange(
  preset: RangePreset,
  customFrom: string,
  customTo: string,
) {
  if (preset === "custom") {
    return normalizeRange(customFrom, customTo);
  }

  const today = new Date();
  const from = new Date(today);
  if (preset === "yesterday") {
    from.setDate(today.getDate() - 1);
    return normalizeRange(toIsoDate(from), toIsoDate(from));
  }
  if (preset === "7d") from.setDate(today.getDate() - 6);
  if (preset === "30d") from.setDate(today.getDate() - 29);
  if (preset === "1m") from.setMonth(today.getMonth() - 1);
  if (preset === "thisMonth") {
    from.setDate(1);
  }
  if (preset === "previousMonth") {
    from.setMonth(today.getMonth() - 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth(), 0);
    return normalizeRange(toIsoDate(from), toIsoDate(to));
  }
  if (preset === "1y") from.setFullYear(today.getFullYear() - 1);

  return normalizeRange(toIsoDate(from), toIsoDate(today));
}

function normalizeRange(from: string, to: string) {
  return from <= to ? { from, to } : { from: to, to: from };
}

function todayIso() {
  return toIsoDate(new Date());
}

function lastDaysRange(days: number) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - Math.max(0, days - 1));
  return normalizeRange(toIsoDate(from), toIsoDate(today));
}

function getViewFromHash(): ActiveView {
  const route = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return routeViews[route] ?? "dashboard";
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default App;
