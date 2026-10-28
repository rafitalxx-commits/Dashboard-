/**
 * Stable contracts for the Incidents module.
 * Google Sheets is the operational/history store; these types deliberately keep
 * Drive files as IDs/links only and never include file bytes.
 */

export type IncidentOrigin = "warehouse" | "carrier" | "customer";

export type IncidentType =
  | "wrong_product"
  | "missing_product"
  | "wrong_quantity"
  | "order_crossing"
  | "wrong_packaging"
  | "delivery_delay"
  | "late_delivery_rejected"
  | "damage"
  | "lost"
  | "delivered_not_received"
  | "return_to_origin"
  | "withdrawal"
  | "wrong_purchase"
  | "incompatible_product"
  | "warranty";

export type IncidentStatus = "Nueva" | "En gestión" | "Esperando" | "Reenvío enviado" | "Resuelta" | "Cerrada";
export type ClientStatus = "Pendiente" | "En gestión" | "Esperando cliente" | "Solucionado";
export type IncidentSubstatus =
  | "esperando_cliente"
  | "esperando_devolucion"
  | "esperando_recepcion"
  | "esperando_agencia"
  | "esperando_reembolso"
  | "esperando_reenvio"
  | "esperando_diagnostico"
  | "esperando_revision"
  | "pendiente_coste"
  | null;

export type ProcessKind =
  | "reception"
  | "reshipment"
  | "refund"
  | "repair"
  | "diagnosis"
  | "claim"
  | "stock_adjustment"
  | "follow_up";
export type ProcessState = "pending" | "in_progress" | "blocked" | "resolved" | "assumed";

export type IncidentKitComponent = {productId:number;sku:string;name:string;productType?:string;quantityPerKit:number;uomId?:number;imageUrl?:string};
export type IncidentKitSelection = {productId:number;sku:string;name:string;quantity:number;uomId?:number;imageUrl?:string};
export type IncidentProduct = {
  saleLineId?: number;
  kitComponents?: IncidentKitComponent[];
  kitSource?: 'original_delivery'|'bom';
  /** Incident-scoped, confirmed component quantities shared by DEV, REX and Odoo. */
  selectedKitComponents?: IncidentKitSelection[];
  productType?: string;
  productId?: number;
  sku: string;
  name: string;
  imageUrl?: string;
  orderedQuantity: number;
  affectedQuantity: number;
  receivedQuantity?: number;
  /** Snapshot values: do not recalculate these from today's product prices/costs. */
  unitSalePrice?: number;
  unitCostSnapshot?: number;
};

export type IncidentNote = {
  id: string;
  createdAt: string;
  createdBy: string;
  text: string;
};

export type IncidentEventType =
  | "created"
  | "note_added"
  | "reception_created"
  | "return_document_generated"
  | "pickup_requested"
  | "goods_received"
  | "evidence_added"
  | "reshipment_created"
  | "reshipment_sent"
  | "reshipment_delivered"
  | "refund_executed"
  | "claim_opened"
  | "claim_resolved"
  | "cost_added"
  | "cost_updated"
  | "stock_regularized"
  | "client_status_changed"
  | "incident_reopened"
  | "client_solved"
  | "incident_resolved"
  | "incident_closed";

export type IncidentEvent = {
  id: string;
  type: IncidentEventType;
  occurredAt: string;
  actor: string;
  summary: string;
  details?: Record<string, string | number | boolean | null>;
};

export type IncidentProcess = {
  id: string;
  kind: ProcessKind;
  state: ProcessState;
  title: string;
  requiredToClose: boolean;
  /** External Odoo/Drive IDs are references, never sheet row numbers. */
  dependsOn?: string[];
  resultReference?: string;
  externalId?: string;
  updatedAt: string;
};

export type IncidentCostCategory =
  | "lost_product"
  | "reshipment"
  | "pickup"
  | "return_shipping"
  | "refund"
  | "other"
  | "indemnity"
  | "recovery";
export type IncidentCost = {
  /** Explicit entry, including zero; automatic empty provisions omit this. */
  recordedAt?: string;
  recordedBy?: string;
  id: string;
  description: string;
  category: IncidentCostCategory;
  amount: number;
  direction: "cost" | "recovery";
  state: "estimated" | "pending" | "confirmed" | "assumed";
  occurredAt: string;
  source: "manual" | "carrier" | "odoo" | "return";
};

export type CarrierClaimStatus =
  | "pending"
  | "filed"
  | "accepted"
  | "rejected"
  | "compensated"
  | "closed";
export type CarrierClaim = {
  id: string;
  carrier: string;
  type: string;
  tracking: string;
  createdAt: string;
  status: CarrierClaimStatus;
  claimedAmount?: number;
  recoveredAmount?: number;
  caseNumber?: string;
  observations?: string;
  assumed?: boolean;
  driveFileIds: string[];
};

export type IncidentDriveFolder = {
  id: string;
  url: string;
};

export type Incident = {
  id: string;
  revision: number;
  requestId: string;
  /** Durable outbox intent saved atomically with the incident; only new opted-in records resume. */
  documentPreparation?: {requestedAt:string;actor:string;target:string};
  /** Response-only projection of the durable worker queue; never a stock confirmation. */
  documentPreparationStatus?: {state:'queued'|'running'|'done'|'blocked'|'failed';message:string;updatedAt:string};
  returns: CustomerReturn[];
  evidence: Array<{ id: string; name: string; url: string; mimeType: string; returnId?: string }>;
  wrongReceivedProduct?: { sku: string; quantity: number; productId?:number; name?:string; barcode?:string };
  odooOperations?: Array<{ receiptOrigin?:string; receiptSourceKey?:string; receiptConsumedBy?:string; discardedRemainder?:import("./odooStock").StockLine[]; backorderOf?:number; backorder?:{key:string;pickingId:number;externalReference:string;lines:import("./odooStock").StockLine[];parentPickingId:number}; simulated?: boolean; shipmentCode?: string; tracking?: string; carrier?: string; shippedAt?: string; trackingUrl?: string; shippedBy?: string; target?: string; key: string; digest: string; pickingId: number; scrapId?: number; confirmedAt: string; status?: 'done'|'awaiting_arrival'|'ready_for_expedition'; externalReference?: string; dispatchReference?: string; kind?: 'correction'|'return'|'reshipment'|'scrap'; returnId?: string; lines?: Array<{productId:number;sku:string;quantity:number;uomId:number;sourceId:number;destinationId:number;saleLineId?:number;toRefund?:boolean}> }>;
  replacementProduct?: { product: CatalogMatch; quantity: number };
  diagnosis?: string;
  freightPayer?: "company" | "customer" | "supplier";
  stockPlan: Array<{ sku: string; action: string; quantity: number; reason: string }>;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  relatedIncidentIds: string[];
  order: {
    odooId?: number;
    shippingDestination?: {name:string;address:string;postalCode:string;city:string;country:string;phone:string;email:string};
    odooReference: string;
    channelReference?: string;
    channel: string;
    customerName: string;
    customerEmail?: string;
    orderDate?: string;
    shippedAt?: string;
    saleWithoutTax?: number;
    tracking?: string;
    carrier?: string;
    preparedBy?: string;
  };
  origin: IncidentOrigin;
  type: IncidentType;
  subtype?: string;
  products: IncidentProduct[];
  status: IncidentStatus;
  substatus: IncidentSubstatus;
  clientStatus: ClientStatus;
  solution?: string;
  pendingSummary?: string;
  observationsSummary?: string;
  notes: IncidentNote[];
  processes: IncidentProcess[];
  costs: IncidentCost[];
  claims: CarrierClaim[];
  claimIds: string[];
  driveFolder?: IncidentDriveFolder;
  drivePhotosFolder?: IncidentDriveFolder;
  photoCount: number;
  stockRegularized: boolean;
  /** Snapshot used for cost statistics; nullable if Odoo did not provide one. */
  productCostSnapshot?: number;
  timeline: IncidentEvent[];
};

export type ReturnCondition =
  | "perfect"
  | "used"
  | "damaged"
  | "incomplete"
  | "wrong_product"
  | "needs_review";
export type ReturnDestination =
  | "stock"
  | "discard"
  | "not_ours";
export type ReturnItemOverride = {
  expectedSku: string;
  mode: "catalog" | "not_ours";
  quantity: number;
  product?: CatalogMatch;
  description?: string;
};
export type CustomerReturn = {
  id: string;
  incidentId: string;
  createdAt: string;
  updatedAt: string;
  orderReference: string;
  customerName: string;
  products: Array<{ productId?: number; sku: string; name: string; imageUrl?: string; kitParentSku?:string; expectedQuantity: number; receivedQuantity?: number }>;
  origin: IncidentOrigin;
  state: "awaiting" | "arrived" | "processed" | "cancelled";
  /** Odoo-only correction for an outbound line recorded as shipped but physically not sent. */
  stockCorrection?: boolean;
  lossAssumed?: boolean;
  condition?: ReturnCondition;
  destination?: ReturnDestination;
  /** Per-expected-line adjudication when the returned physical item differs. */
  itemOverrides?: ReturnItemOverride[];
  observations?: string;
  driveFolder?: IncidentDriveFolder;
  driveFileIds: string[];
  odooReceiptId?: number;
  receivedBy?: {id:string;code:string;name:string};
  receivedAt?: string;
  /** Warehouse confirmation is independent from state=processed (Odoo confirmation). */
  warehouseConfirmedAt?: string;
  odooSyncError?: string;
};

export type IncidentListFilters = {
  group?: "all" | "warehouse" | "carrier" | "customer" | "claims";
  status?: IncidentStatus;
  pending?: string;
  carrier?: string;
  claimStatus?: CarrierClaimStatus;
  channel?: string;
  operator?: string;
  type?: IncidentType;
  createdFrom?: string;
  createdTo?: string;
  query?: string;
};

export type IncidentClosureChecklist = {
  clientSolved: boolean;
  goodsRegularized: boolean;
  stockRegularized: boolean;
  logisticsResolved: boolean;
  warrantyResolved: boolean;
  claimsResolvedOrAssumed: boolean;
  costsClosed: boolean;
  missing: string[];
  canClose: boolean;
};

export type OrderContext = { order: Incident["order"]; products: IncidentProduct[]; source: "odoo" | "demo"; excludedServiceCount?: number };
export type CatalogMatch = { productType?: string; productId: number; sku: string; name: string; barcode: string; imageUrl?: string };
export type WizardDraft = {
  requestId: string;
  context: OrderContext;
  relatedContext?: OrderContext;
  origin: IncidentOrigin;
  type: IncidentType;
  products: IncidentProduct[];
  solution: string;
  scope?: "pack_ok" | "one" | "many" | "all" | "package_only" | "damaged";
  reason?: string;
  /** Explicit wizard choice. Undefined remains readable for legacy drafts. */
  wrongReceivedUnknown?: boolean;
  wrongReceived?: string;
  wrongReceivedProduct?: CatalogMatch;
  wrongReceivedQuantity?: number;
  observations?: string;
  warrantyAge?: "under1" | "over1";
  freightPayer?: "company" | "customer" | "supplier";
  evidence?: Incident["evidence"];
  driveDraftFolderId?: string;
  driveDraftPhotosFolderId?: string;
  preparedByCorrection?: {name:string;reason:string};
};
