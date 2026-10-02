/** Shared, read-only definitions used by Home counts and their destination lists. */
export type HomeOrder = {
  id: string;
  odooRef?: string;
  externalRef?: string;
  date: string;
  channel: string;
  fulfillmentBy?: string;
  deliveryPrinted?: boolean;
  deliveryStatus?: string;
  sendcloud?: { status?: string };
};

export type ShippingLabel = {
  createdAt: string;
  tracking?: string;
  shipper?: string;
  odooOrderRef?: string;
  externalOrderRef?: string;
  orderRefs?: string[];
};

const normalize = (value?: string) => (value || "").trim().toUpperCase();

export function labelReferences(labels: ShippingLabel[]) {
  const refs = new Set<string>();
  for (const label of labels) {
    // The Expeditions ledger records both real and simulated labels. A real
    // generated label has a tracking number and a supported Dashboard carrier.
    if (!label.tracking || !isDashboardCarrier(label.shipper)) continue;
    for (const ref of [label.odooOrderRef, label.externalOrderRef, ...(label.orderRefs || [])]) {
      if (normalize(ref)) refs.add(normalize(ref));
    }
  }
  return refs;
}

export function isDashboardCarrier(value?: string) {
  const carrier = (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return ["mrw", "dhl", "genei", "correos express"].includes(carrier);
}

export function isHomeOrderChannel(order: HomeOrder) {
  const channel = order.channel.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  const fulfillment = (order.fulfillmentBy || "").trim().toUpperCase();
  return fulfillment === "FBM" || (channel.includes("amazon") && channel.includes("fbm")) || channel === "website" || channel === "web";
}

export function hasExpeditionLabel(order: HomeOrder, refs: Set<string>) {
  return [order.id, order.odooRef, order.externalRef].some((ref) => refs.has(normalize(ref)));
}

export function isHomeOrderUnprinted(order: HomeOrder) {
  // Match Dashboard's existing getEffectiveDeliveryStatus/isDelivered pair.
  const delivered = (order.sendcloud?.status || order.deliveryStatus || "").toLowerCase().includes("entregado");
  return isHomeOrderChannel(order) && !order.deliveryPrinted && !delivered;
}

export function isHomeOrderUnsent(order: HomeOrder, refs: Set<string>) {
  return isHomeOrderChannel(order) && !hasExpeditionLabel(order, refs);
}

export type HomePeriod = "48h" | "day" | "week" | "month";

export function periodBounds(period: HomePeriod, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  if (period === "48h") start.setTime(end.getTime() - 48 * 60 * 60 * 1000);
  if (period === "day") start.setHours(0, 0, 0, 0);
  if (period === "week") {
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  }
  if (period === "month") { start.setDate(1); start.setHours(0, 0, 0, 0); }
  return { start, end };
}

export function groupShipmentLabels(labels: ShippingLabel[], period: HomePeriod, now = new Date()) {
  const { start, end } = periodBounds(period, now);
  const hourly = period === "48h" || period === "day";
  const points = new Map<string, number>();
  const cursor = new Date(start);
  cursor.setMinutes(0, 0, 0);
  while (cursor <= end) {
    points.set(hourly ? cursor.toISOString().slice(0, 13) : cursor.toISOString().slice(0, 10), 0);
    if (hourly) cursor.setUTCHours(cursor.getUTCHours() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const label of labels) {
    if (!label.tracking || !isDashboardCarrier(label.shipper)) continue;
    const date = new Date(label.createdAt);
    if (!Number.isFinite(date.getTime()) || date < start || date > end) continue;
    const key = hourly ? date.toISOString().slice(0, 13) : date.toISOString().slice(0, 10);
    points.set(key, (points.get(key) || 0) + 1);
  }
  return { total: [...points.values()].reduce((a, b) => a + b, 0), points: [...points].map(([at, value]) => ({ at, value })) };
}
