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
  /** product.product real cuando se importó desde un pedido confirmado. */
  productId?: number | null;
  description: string;
  reference: string | null;
  quantity: number | null;
  priceUnit: number | null;
  discount: number | null;
  /** Descuentos adicionales sucesivos; no se suman al porcentaje comercial. */
  discountExtra?: number | null;
  promptPaymentDiscount?: number | null;
  /** Pedido que aportó esta línea cuando se asoció manualmente. */
  sourcePurchaseOrderName?: string | null;
  sourcePurchaseOrderId?: number | null;
  /** ID exacto de purchase.order.line; permite verificar líneas repetidas del mismo producto. */
  sourcePurchaseLineId?: number | null;
  /** Excepción explícita: servicio/consumible existente elegido y confirmado por el operario. */
  genericProductConfirmed?: boolean;
  /** Cantidades de compra de sólo lectura: permiten cotejar recepción y factura. */
  qtyOrdered?: number | null;
  qtyReceived?: number | null;
  qtyInvoiced?: number | null;
  qtyPending?: number | null;
  /** Confirmación auditada de discrepancia de factura; nunca confirma recepción física. */
  quantityMismatchConfirmation?: {
    purchaseOrderId: number;
    productId: number;
    invoiceQuantity: number;
    qtyOrdered: number;
    qtyReceived: number;
    qtyInvoiced: number;
    confirmedBy: string;
    confirmedAt: string;
    scope: "quantity-discrepancy-not-receipt";
  } | null;
  /** Precio/descuento del pedido en Odoo al importar la línea; no se pisa al editar la factura. */
  odooPurchasePriceUnit?: number | null;
  odooPurchaseDiscount?: number | null;
  /** Precio del PDF cotejado de forma inequívoca o confirmado por un operario. */
  pdfPriceVerified?: boolean;
  /** Candidatos explicables; nunca equivalen a una identidad confirmada. */
  matchCandidates?: Array<{
    purchaseOrderId: number;
    purchaseOrderName: string;
    purchaseLineId: number | null;
    productId: number;
    productName: string;
    score: number;
    identityLevel: "exact" | "probable" | "ambiguous";
    evidence: string[];
    discrepancies: string[];
  }>;
  /** Propuestas de Raskibot: nunca equivalen a una selección humana. */
  aiProductCandidateId?: number | null;
  aiPurchaseOrderCandidateId?: number | null;
  aiCandidateReason?: string | null;
  taxNames: string[];
  /** Impuesto elegido localmente desde account.tax de Odoo (solo lectura). */
  taxId?: number | null;
  taxRate?: number | null;
  /** Cuenta contable local elegida desde account.account de Odoo. */
  accountId?: number | null;
  accountName?: string | null;
  /** Cuota de impuesto editable. Si se indica, prevalece sobre taxRate. */
  taxAmount?: number | null;
  /** Total final editable de la línea (base neta + cuota). */
  totalWithTax?: number | null;
  total: number | null;
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

export interface InvoiceReviewChatMessage {
  at: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export interface InboxDocument {
  driveFileId: string;
  /** Elección humana persistente; nunca inferida por la extracción. */
  confirmedOdooPartnerId?: number | null;
  /** Campos que el operador ha editado o aceptado y que un reescaneo no debe sobrescribir. */
  operatorEditedFields?: string[];
  /** Líneas que el operador ha editado o aceptado localmente. */
  operatorLinesEdited?: boolean;
  invoiceBranch?: "goods" | "services" | null;
  /** Aceptación humana de las líneas leídas del PDF cuando no existe pedido. */
  pdfLinesAccepted?: boolean;
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
  /** Reconciliación con la carpeta origen de Drive. Los ausentes se conservan para auditoría pero no se muestran. */
  sourcePresent?: boolean;
  sourceRemovedAt?: string | null;
  /** Fase 3: borrador de factura creado en Odoo (id + nombre + estado). */
  odooDraftMoveId: number | null;
  odooDraftName: string | null;
  odooDraftState: string | null;
  /** Multi-pedido (Fase 2): pedidos de compra que componen esta factura. */
  assignedPurchaseOrderIds: number[] | null;
  /** Conversación local y auditable de revisión; nunca es un canal de escritura Odoo. */
  reviewChat?: InvoiceReviewChatMessage[];
  /** Última propuesta del agente, separada de los datos confirmados del borrador. */
  reviewProposal?: {
    at: string;
    fields: Partial<Pick<PdfExtractedData, "supplier" | "supplierVat" | "country" | "billingAddress" | "currency" | "invoiceNumber" | "invoiceDate" | "dueDate" | "base" | "taxes" | "total">>;
    lines: PdfExtractedLine[];
    unresolved: string[];
  } | null;
  /** Último resultado estructurado del escaneo, separado de las confirmaciones humanas. */
  lastAiScan?: {
    at: string;
    status: "complete" | "partial";
    fieldsUpdated: string[];
    fieldsPreserved?: string[];
    lineCountUpdated: number;
    linesPreserved: boolean;
    unresolved: string[];
  } | null;
  /** Líneas originalmente leídas del PDF, antes de importar líneas de pedidos. */
  pdfSourceLines?: PdfExtractedLine[];
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
  /** Estado actual de facturación informado por purchase.order.invoice_status. */
  invoiceStatus?: string | null;
  partnerId: number;
  partnerName: string;
  partnerCountry: string | null;
  partnerVat: string | null;
  currency: string | null;
  dateOrder: string | null;
  buyer: string | null;
  origin: string | null;
  /** Número de pedido del proveedor en purchase.order.partner_ref (no es origin). */
  supplierRef?: string | null;
  amountTotal: number;
  amountUntaxed?: number;
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
    id?: number;
    productId: number | null;
    productName: string | null;
    qtyOrdered: number;
    qtyReceived: number;
    qtyInvoiced: number;
    qtyPending: number;
    priceUnit: number;
    discount: number;
    subtotal: number;
    taxIds?: number[];
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
