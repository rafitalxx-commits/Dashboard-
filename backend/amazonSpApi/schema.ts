export type AmazonShipmentStatus = "pending" | "sent" | "error" | "retrying";

export type AmazonShipmentOrderItem = {
  orderItemId: string;
  quantity: number;
};

export type AmazonShipmentConfirmationDraft = {
  pickingId: number;
  saleOrderId: number;
  saleOrderName: string;
  amazonOrderId: string;
  tracking: string;
  carrier: string;
  carrierCode?: string;
  shippingMethod?: string;
  shipmentDate: string;
  marketplaceId: string;
  packageReferenceId: string;
  orderItems: AmazonShipmentOrderItem[];
  geneiShipmentCode?: string;
  trackingUrl?: string;
  sourceReference?: string;
};

export type AmazonShipmentRecord = AmazonShipmentConfirmationDraft & {
  id: string;
  status: AmazonShipmentStatus;
  amazonResponse?: unknown;
  lastRequest?: unknown;
  lastError?: string;
  retries: number;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
};

export type AmazonShipmentStore = {
  shipments: AmazonShipmentRecord[];
};
