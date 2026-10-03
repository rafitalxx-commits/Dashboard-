// Tipos de Fase 2: bandeja documental (Drive + OCR/IA + cotejo) y control pedido/recepcion/factura.
// Todo en SOLO LECTURA de Odoo/Drive; solo se persiste el registro documental local del LAB.

export type DocumentStatus =
  | "SIN_REVISAR"
  | "EN_REVISION"
  | "PENDIENTE_COTEJO"
  | "PENDIENTE_VALIDAR"
  | "VALIDADA"
  | "INCIDENCIA";

export type DocumentSource = "email" | "manual" | "web" | "desconocido";

export interface PdfExtractedLine {
  description: string;
  reference: string | null;
  quantity: number | null;
  priceUnit: number | null;
  discount: number | null;
  taxNames: string[];
  /** Impuesto elegido localmente desde account.tax (Odoo, solo lectura). */
  taxId?: number | null;
  taxAmount?: number | null;
  /** Cuenta contable local elegida desde account.account. */
  accountId?: number | null;
  accountName?: string | null;
  total: number | null;
  /** Pedido de compra que aportó esta línea (asociación local de la factura). */
  sourcePurchaseOrder?: string | null;
  /** Instantánea operativa de recepción de Odoo. Nunca sustituye los importes corregidos por el operario. */
  sourceQtyOrdered?: number | null;
  sourceQtyReceived?: number | null;
  sourceQtyInvoiced?: number | null;
  sourceReceptionStatus?: "sin_recepcion" | "parcial" | "completa" | null;
  confidence: number; // 0-100 heuristico
}

export type DocumentType = "factura" | "albaran" | "aduana" | "transporte" | "otro";

export interface PdfExtractedData {
  supplier: string | null;
  supplierVat: string | null;
  country: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // ISO yyyy-mm-dd
  dueDate: string | null;
  currency: string | null;
  base: number | null;
  taxes: number | null;
  total: number | null;
  lines: PdfExtractedLine[];
  textPreview: string;
  needsOcr: boolean;
  warnings: string[];
  pdfPages: number;
  /** Direccion de facturacion (cotejo sin pedido: servicios, comisiones, consumibles). */
  billingAddress: string | null;
  /** Tipo de documento detectado (factura vs no-factura). null = sin clasificar (legado). */
  docType: DocumentType | null;
}

export interface DocumentMatchCriterion {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface DocumentMatch {
  purchaseOrderId: number | null;
  purchaseOrderName: string | null;
  score: number; // 0-100
  band: "alta" | "media" | "baja" | "sin";
  criteria: DocumentMatchCriterion[];
  totalDiff: number | null; // factura - pedido
  invoiceIdOdoo: number | null; // factura Odoo ya existente (duplicado posible)
  invoiceNameOdoo: string | null;
  /** true cuando el documento NO es una factura (albaran, aduana, transporte...) y se excluye del cotejo. */
  excluded?: boolean;
  excludedReason?: string | null;
}

export interface InboxDocument {
  driveFileId: string;
  driveFolderId: string | null;
  name: string;
  size: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
  source: DocumentSource;
  sourceEmail: string | null;
  detectedAt: string | null; // ISO
  detectedBy: string | null;
  // Datos extraidos (OCR/IA)
  extracted: PdfExtractedData | null;
  ocrStatus: "pendiente" | "ok" | "needs_ocr" | "error";
  aiStatus: "no_aplicado" | "ok" | "error";
  confidence: number | null; // confianza IA/extraccion
  // Cotejo
  match: DocumentMatch | null;
  // Estado documental
  status: DocumentStatus;
  // Validacion humana
  validationUser: string | null;
  validationAt: string | null;
  notes: string | null;
  // Drive definitivo (preparado para fase 3)
  targetFolderPath: string | null; // ej. /2026/NOX2/T3
  movedTo: string | null; // folder id destino si se moviera
  /** Fase 3: borrador de factura creado en Odoo (id + nombre + estado). */
  odooDraftMoveId: number | null;
  odooDraftName: string | null;
  odooDraftState: string | null;
  /** Multi-pedido (Fase 2): pedidos de compra que componen esta factura. */
  assignedPurchaseOrderIds: number[] | null;
  // Interno
  pdfCached: boolean;
  processedAt: string | null;
}

export interface InboxStore {
  meta: {
    version: 2;
    lastScanAt: string | null;
    lastScanResult: string | null;
    totalDocuments: number;
    driveFolderId: string | null;
  };
  documents: InboxDocument[];
}

// ---------- Pedidos sin facturar ----------

export interface PurchaseOrderRecord {
  id: number;
  name: string;
  state: string;
  partnerId: number;
  partnerName: string;
  partnerCountry: string | null;
  partnerVat: string | null;
  currency: string | null;
  dateOrder: string | null;
  buyer: string | null;
  origin: string | null;
  amountTotal: number;
  // Recepciones
  pickings: { id: number; name: string; state: string; dateDone: string | null }[];
  receivedQty: number | null; // total qty_received lineas
  orderedQty: number | null;
  allReceived: boolean;
  lastReceptionAt: string | null;
  daysSinceReception: number | null;
  // Facturacion (desde cache fase 1 + lineas)
  linkedInvoiceIds: number[];
  linkedInvoiceNames: string[];
  billedAmount: number;
  pendingAmount: number;
  billedPct: number | null;
  billingSplit: boolean; // una factura cubre varios pedidos (no repartible)
  lines: {
    productId: number | null;
    productName: string | null;
    qtyOrdered: number;
    qtyReceived: number;
    qtyInvoiced: number;
    qtyPending: number;
    priceUnit: number;
    subtotal: number;
    discount: number;
  }[];
  status: "SIN_FACTURA" | "FACTURACION_PARCIAL" | "FACTURADO" | "INCIDENCIA" | "SIN_RECEPCION";
}

export interface UnbilledStore {
  meta: {
    version: 1;
    lastPoSyncAt: string | null;
    totalOrders: number;
    message: string | null;
  };
  orders: PurchaseOrderRecord[];
}

export interface UnbilledKpis {
  ordersWithoutInvoice: { count: number; total: number };
  partialBilling: { count: number; total: number; pending: number };
  receivedOver15Days: { count: number };
  importaciones: { count: number; total: number };
  totalPendingAmount: number;
  totalOrders: number;
}

export interface InboxKpis {
  sinRevisar: number;
  pendientesCotejo: number;
  pedidosSinFacturar: number;
  importePedidosSinFacturar: number;
  importePendienteCotejo: number;
  sinCoincidenciaOdoo: number;
  facturacionParcial: number;
  validadasMes: number;
  incidencias: number;
  borradoresListosOdoo: number;
}
