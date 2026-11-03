// Tipos compartidos del modulo Facturas de proveedor (Fase 1, solo lectura).
// La entidad de factura ya reserva campos para OCR/IA/Drive futuros (seccion 12 del alcance).

export type SupplierInvoiceMoveType = "in_invoice" | "in_refund";

export interface SupplierInvoiceLine {
  productId: number | null;
  productRef: string | null; // referencia interna extraida de "[REF] descripcion"
  productName: string | null; // descripcion del producto
  name: string; // descripcion de linea
  quantity: number;
  priceUnit: number;
  discount: number;
  taxNames: string[];
  subtotal: number;
  total: number;
  displayType: "product" | "line_section" | "line_note" | "other";
}

export interface SupplierInvoiceAttachment {
  id: number;
  name: string;
  mime: string | null;
  type: string | null;
}

export interface SupplierInvoiceRecord {
  id: number; // id tecnico de account.move (no se muestra en la UI)
  name: string; // numero interno Odoo
  ref: string | null; // numero/referencia del proveedor
  moveType: SupplierInvoiceMoveType;
  state: string; // draft | posted | cancel | reversed
  paymentState: string; // not_paid | in_payment | paid | partial | reversed | ""
  invoiceDate: string | null;
  accountingDate: string | null;
  dueDate: string | null;
  currency: string | null;
  journal: string | null;
  partnerId: number;
  partnerName: string;
  partnerVat: string | null;
  partnerCountry: string | null;
  partnerCountryCode: string | null;
  fiscalPosition: string | null;
  amountUntaxed: number;
  amountTax: number;
  amountTotal: number;
  amountResidual: number;
  amountPaid: number; // amountTotal - amountResidual
  invoiceOrigin: string | null; // referencia de origen real de Odoo
  taxSummary: string[];
  linkedPurchaseOrderIds: number[];
  linkedPurchaseOrderNames: string[];
  linkedPickingIds: number[];
  linkedPickingNames: string[];
  products: string[]; // nombres de producto (para filtro/analitica)
  lineCount: number;
  lines: SupplierInvoiceLine[]; // lineas completas para detalle y futuro matching
  attachments: SupplierInvoiceAttachment[];
  hasPdf: boolean;
  writeDate: string | null;
  lastSyncAt: string | null;
  // --- Campos reservados para fases futuras (OCR/IA/Drive). No se muestran en Fase 1 ---
  source: null;
  pdf_url: null;
  drive_file_id: null;
  ocr_status: null;
  ai_status: null;
  confidence: null;
  detected_supplier: null;
  matched_supplier_id: null;
  matched_purchase_orders: unknown[];
  matching_score: null;
  validation_status: null;
  validation_user: null;
  processed_at: null;
}

export interface SupplierInvoiceStore {
  meta: {
    version: 1;
    lastSyncAt: string | null;
    lastSyncMode: "full" | "incremental" | "none";
    totalInvoices: number;
    writeDateMax: string | null;
    message: string | null;
  };
  invoices: SupplierInvoiceRecord[];
  // Tabla de equivalencias proveedor/descripcion -> producto Odoo (futura, seccion 13).
  // Fase 1: coleccion vacia y reservada; el esquema se define cuando se implemente el aprendizaje.
  supplierEquivalences: unknown[];
}

export type SupplierInvoiceSortKey =
  | "name"
  | "ref"
  | "partnerName"
  | "invoiceDate"
  | "dueDate"
  | "state"
  | "paymentState"
  | "currency"
  | "amountUntaxed"
  | "amountTax"
  | "amountTotal"
  | "amountResidual"
  | "purchaseOrderNames";

export interface SupplierInvoiceFilters {
  from?: string | null; // ISO yyyy-mm-dd (fecha de factura)
  to?: string | null;
  year?: number | null;
  month?: number | null;
  partnerId?: number | null;
  country?: string | null;
  state?: string | null;
  paymentState?: string | null;
  product?: string | null;
  purchaseOrder?: string | null;
  currency?: string | null;
  fiscalPosition?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  text?: string | null;
}

export interface SupplierInvoiceKpis {
  periodTotal: number; // Facturado (periodo filtrado)
  periodCount: number; // Nº facturas del periodo
  yearTotal: number; // Facturado ano (filtros + ano seleccionado)
  pendingTotal: number; // Pendiente de pago (residual)
  paidTotal: number; // Pagado dentro del periodo
  averageTicket: number; // Ticket medio
  activeVendors: number; // Proveedores activos
  previousPeriodTotal: number; // Periodo equivalente anterior
  variationPct: number | null; // Variacion vs periodo anterior (%)
}

export interface SupplierInvoiceCharts {
  monthly: { month: number; total: number }[]; // ano seleccionado
  topVendors: { partnerId: number; name: string; total: number; count: number }[];
  payment: {
    paid: { count: number; total: number };
    partial: { count: number; total: number };
    pending: { count: number; total: number };
  };
}

export interface SupplierInvoiceOptions {
  vendors: { id: number; name: string }[];
  countries: string[];
  states: string[];
  paymentStates: string[];
  currencies: string[];
  fiscalPositions: string[];
  products: string[];
  purchaseOrders: string[];
}

export interface SupplierInvoiceDataResponse {
  mode: "live" | "empty";
  total: number;
  items: SupplierInvoiceRecord[];
  kpis: SupplierInvoiceKpis;
  charts: SupplierInvoiceCharts;
  options: SupplierInvoiceOptions;
  lastSyncAt: string | null;
  odooBaseUrl: string | null;
  filteredDateRange: { from: string | null; to: string | null };
}