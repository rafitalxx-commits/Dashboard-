export type StatusTone = "ok" | "warning" | "danger" | "neutral" | "info";

export type CatalogProduct = {
  id: number;
  templateId?: number;
  name: string;
  reference: string;
  barcode: string;
  uom: string;
  type: string;
  onHand: number;
  reserved: number;
  incoming: number;
  forecast: number;
  mto: boolean;
  isKit: boolean;
  componentCount: number;
  physicalLocations: string[];
  supplierNames: string[];
  locationSummary?: {
    preferredCode?: string;
    preferredQuantity?: number;
    replenishmentMin?: number;
    needsReplenishment: boolean;
  };
  updatedAt?: string;
};

export type CatalogStore = {
  updatedAt?: string;
  products: CatalogProduct[];
  sync: {
    status: "never" | "running" | "ok" | "error";
    lastFinishedAt?: string;
    message?: string;
    full: boolean;
    scanned: number;
    changed: number;
  };
};
export type CatalogProductDetail = {
  id: number;
  name: string;
  reference: string;
  barcode: string;
  image: string;
  suppliers: Array<{
    name: string;
    productName: string;
    productCode: string;
    minQty: number;
    delay: number;
  }>;
  components: Array<{
    id: number;
    name: string;
    reference: string;
    quantity: number;
    uom: string;
    locations: ProductLocation[];
  }>;
};
export type ProductLocation = {
  productId: number;
  code: string;
  row: string;
  shelf: string;
  height: string;
  quantity: number;
  preferred: boolean;
  replenishmentMin?: number;
  createdAt: string;
  updatedAt: string;
};
export type InventoryScope = {
  type: "general" | "products" | "supplier" | "locations";
  productSelection: {
    mode: "all" | "filtered" | "ids";
    ids?: number[];
    query?: string;
    supplier?: string;
    filter?: string;
  };
  allowedLocationCodes: string[];
  plannedProductIdsByLocation?: Record<string, number[]>;
};
export type ProductInventory = {
  id: string;
  name: string;
  status: "draft" | "in_progress" | "review" | "validated" | "finalized";
  scope: InventoryScope;
  plannedProductIds: number[];
  createdAt: string;
  updatedAt: string;
  operator?: InventoryOperator;
  startedAt?: string;
  finishedAt?: string;
  validatedAt?: string;
  counts: InventoryCount[];
  recountProductIds?: number[];
  recountRevision?: number;
  finalizedAt?: string;
  sentAt?: string;
  odooResults?: Array<{ productId: number; before: number; counted: number; changed: boolean; error?: string }>;
};
export type InventoryOperator = { id: string; code: string; name: string };
export type InventoryCount = { id: string; productId: number; locationCode: string; quantity: number; operator: InventoryOperator; countedAt: string; revision: number };

export type Order = {
  id: string;
  odooRef: string;
  date: string;
  odooReceivedAt?: string;
  client: string;
  /** Contacto de entrega de Odoo; distinto del contacto de facturación. */
  shippingRecipient?: string;
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
    status: "validated" | "ready" | "pending" | "incident" | "service_shipment";
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
  shippingEmail?: string;
  shippingPostalCode?: string;
  shippingCountryCode?: string;
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

export type PurchaseReceptionLine = {
  id: string;
  productId?: string;
  name: string;
  sku: string;
  barcode: string;
  imageUrl?: string;
  orderedQty: number;
  receivedQty: number;
  pendingQty: number;
  uom: string;
  expectedDate: string;
};

export type PurchaseReception = {
  id: string;
  ref: string;
  supplier: string;
  orderDate: string;
  expectedDate: string;
  state: string;
  status: "Pendiente" | "Parcial" | "Retrasado";
  amountTotal: number;
  currency: string;
  lines: PurchaseReceptionLine[];
  orderedQty: number;
  receivedQty: number;
  pendingQty: number;
};

export type PurchaseReceptionsPayload = {
  mode: "live" | "demo";
  receptions: PurchaseReception[];
  total: number;
  pendingLines: number;
  pendingUnits: number;
  message?: string;
};

export type InventoryReceptionLine = {
  id: string;
  productId?: string;
  name: string;
  sku: string;
  barcode: string;
  imageUrl?: string;
  expectedQty: number;
  processedQty: number;
  pendingQty: number;
  uom: string;
  classification: "under_order" | "replenishment";
  saleOrderRefs: string[];
  preferredLocation?: string;
};

export type ReceptionLocationAllocation = {
  id: string;
  location: string;
  quantity: number;
};

export type ReceptionLocationPlan = {
  receivedQty: number;
  allocations: ReceptionLocationAllocation[];
  ready: boolean;
};

export type ReceptionOperator = {
  id: string;
  code: string;
  name: string;
};

export type ReceptionSession = {
  receptionId: string;
  receptionRef: string;
  purchaseRef: string;
  operator: ReceptionOperator;
  status: "in_progress" | "completed";
  startedAt: string;
  updatedAt: string;
};

export type InventoryReception = {
  id: string;
  ref: string;
  purchaseRef: string;
  supplier: string;
  scheduledDate: string;
  state: string;
  status: "Preparada" | "Esperando" | "Borrador" | "Otra";
  destination: string;
  lines: InventoryReceptionLine[];
  expectedQty: number;
  processedQty: number;
  pendingQty: number;
};

export type InventoryReceptionsPayload = {
  mode: "live" | "demo";
  receptions: InventoryReception[];
  total: number;
  ready: number;
  waiting: number;
  pendingLines: number;
  message?: string;
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
