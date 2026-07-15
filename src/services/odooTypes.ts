export type StatusTone = "ok" | "warning" | "danger" | "neutral" | "info";

export type Order = {
  id: string;
  odooRef: string;
  date: string;
  client: string;
  channel: string;
  externalRef?: string;
  fulfillmentBy?: "FBA" | "FBM" | "";
  sendcloud?: {
    reference: string;
    status: string;
    rawStatus?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    carrier?: string;
    hasTracking?: boolean;
  };
  odooActions?: {
    printMark: {
      status: "ready" | "blocked" | "review";
      label: string;
      reason: string;
    };
    deliveryValidation: {
      status: "ready" | "blocked" | "review";
      label: string;
      reason: string;
    };
  };
  odooDeliveryValidation?: {
    status: "validated" | "ready" | "pending" | "incident";
    tone: StatusTone;
    label: string;
    reason: string;
    dateDone?: string;
    pickingId?: string;
    canValidate: boolean;
    validationMethod?: "manual" | "auto";
  };
  deliveryPrinted: boolean;
  deliveryPrintCount?: number;
  deliveryLastPrintDate?: string;
  total: number;
  taxTotal?: number;
  status: string;
  invoiceStatus: string;
  deliveryStatus: string;
  city: string;
  shippingAddress?: string;
  shippingPhone?: string;
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    price: number;
    subtotal?: number;
    stock: number;
    imageUrl?: string;
    components?: Array<{
      sku: string;
      name: string;
      quantity: number;
      uom: string;
      imageUrl?: string;
    }>;
  }>;
  cacheMeta?: {
    lightweight?: boolean;
    updatedAt?: string;
    writeDate?: string;
    sendcloud?: {
      status: "not_checked" | "not_found" | "found";
      tracking: "not_checked" | "not_found" | "present";
      reference?: string;
      carrier?: string;
      checkedAt?: string;
    };
  };
};

export type DashboardRow = {
  label: string;
  orders: number;
  amount: number;
};

export type DashboardProductRow = {
  label: string;
  quantity: number;
  amount: number;
};

export type DashboardSummary = {
  mode: "live" | "demo";
  source?: "dashboard-cache";
  totalOrders: number;
  totalRevenue: number;
  todayOrders: number;
  soldUnitsToday: number;
  soldAmountToday: number;
  activeCountries: number;
  daily: DashboardRow[];
  channels: DashboardRow[];
  countries: DashboardRow[];
  topProducts: DashboardProductRow[];
  cache?: {
    updatedAt?: string;
    incidentCount?: number;
    lastIncidentAt?: string;
    sync?: OrdersSyncStats;
  };
  message?: string;
};

export type OrdersSyncStats = {
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

export type OrdersPerformanceLastMetric = {
  createdAt: string;
  durationMs: number;
  odooCalls: number;
  sendcloudCalls: number;
  orders: number;
};

export type OrdersPerformanceScope = {
  count: number;
  averageDurationMs: number;
  last: OrdersPerformanceLastMetric | null;
};

export type OrdersV2Performance = {
  mode: "lab";
  cache: {
    updatedAt?: string;
    orders: number;
    sync: OrdersSyncStats;
  };
  scopes: Record<"home" | "orders" | "sync" | "print" | "grouping", OrdersPerformanceScope>;
  comparison: {
    v1: {
      source: "pending-measurement";
      note: string;
    };
    v2: {
      source: "dashboard-cache";
      home: OrdersPerformanceLastMetric | null;
      orders: OrdersPerformanceLastMetric | null;
      sync: OrdersPerformanceLastMetric | null;
    };
  };
};

export type Invoice = {
  id: string;
  ref: string;
  date: string;
  partner: string;
  base: number;
  tax: number;
  total: number;
  residual?: number;
  status: string;
  dueDate: string;
  channel?: string;
  country?: string;
  origin?: string;
  paymentState?: string;
};

export type InvoiceTrendPoint = {
  date: string;
  total: number;
  residual: number;
  count: number;
};

export type InvoiceTrendSeries = {
  label: string;
  points: InvoiceTrendPoint[];
};

export type InvoiceMetricRow = {
  label: string;
  count: number;
  total: number;
  residual: number;
};

export type InvoiceAnalytics = {
  mode: "live" | "demo";
  total: number;
  amountTotal: number;
  amountResidual: number;
  invoices: Invoice[];
  daily: InvoiceMetricRow[];
  channels: InvoiceMetricRow[];
  countries: InvoiceMetricRow[];
  statuses: InvoiceMetricRow[];
  trends: {
    channels: InvoiceTrendSeries[];
    countries: InvoiceTrendSeries[];
    statuses: InvoiceTrendSeries[];
  };
  limit?: number;
  offset?: number;
  message?: string;
};

export type Purchase = {
  id: string;
  ref: string;
  supplier: string;
  expectedDate: string;
  products: string;
  amount: number;
  status: string;
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  stock: number;
  reserved: number;
  incoming: number;
  cost: number;
  lastPurchasePrice: number | null;
  status: string;
};
