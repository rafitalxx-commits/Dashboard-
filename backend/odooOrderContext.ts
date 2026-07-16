import type { Order } from "../src/services/odooTypes.ts";

type OdooRelation = false | [number, string];

export type OdooOrderContextRecord = {
  id: number;
  name?: string;
  date_order?: string;
  create_date?: string;
  partner_id?: OdooRelation;
  team_id?: OdooRelation;
  amount_total?: number;
  amount_tax?: number;
  origin?: string | false;
  client_order_ref?: string | false;
  amz_fulfillment_by?: string | false;
  state?: string;
  invoice_status?: string;
};

export type SendcloudStatus = {
  reference: string;
  status: string;
  rawStatus?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
};

type SendcloudApiOrder = {
  order_number?: string;
  order_details?: {
    status?: {
      code?: string;
      message?: string;
    };
  };
};

type SendcloudApiShipment = {
  order_number?: string;
  carrier?: {
    code?: string;
    name?: string;
  };
  carrier_code?: string;
  carrier_name?: string;
  parcels?: Array<{
    status?: {
      code?: string;
      message?: string;
    };
    tracking_number?: string;
    tracking_url?: string;
  }>;
};

export type ResolvedOdooOrderContext = {
  order: Order;
  tracking?: {
    carrier: string;
    status: string;
    trackingNumber?: string;
    trackingUrl?: string;
    lastEvent: string;
    updatedAt: string;
  };
};

export type ResolveOdooOrderContextInput = {
  amazonOrderId?: string;
  odooOrderId?: string;
};

const sendcloudStatusCache = new Map<
  string,
  { expiresAt: number; status: SendcloudStatus }
>();
const sendcloudCacheTtlMs = 5 * 60 * 1000;

export async function resolveOdooOrderContextByAmazonOrderId(
  env: Record<string, string>,
  amazonOrderId: string,
): Promise<ResolvedOdooOrderContext | undefined> {
  return resolveOdooOrderContext(env, { amazonOrderId });
}

export async function resolveOdooOrderContext(
  env: Record<string, string>,
  input: ResolveOdooOrderContextInput,
): Promise<ResolvedOdooOrderContext | undefined> {
  const cleanAmazonOrderId = cleanText(input.amazonOrderId);
  const cleanOdooOrderId = cleanText(input.odooOrderId);
  if (!cleanAmazonOrderId && !cleanOdooOrderId) return undefined;

  const config = getOdooConfig(env);
  if (!config.url || !config.database || !config.username || !config.apiKey) {
    debugAmazonSendcloud(env, "missing_odoo_config", {
      amazonOrderId: cleanAmazonOrderId,
      odooOrderId: cleanOdooOrderId,
    });
    return undefined;
  }

  const uid = await authenticate(config);
  const order =
    (cleanOdooOrderId
      ? await findOdooOrderByStoredOrderId(config, uid, cleanOdooOrderId)
      : undefined) ??
    (cleanAmazonOrderId
      ? await findOdooOrderByAmazonOrderId(config, uid, cleanAmazonOrderId)
      : undefined);

  if (!order) {
    debugAmazonSendcloud(env, "odoo_order_not_found", {
      amazonOrderId: cleanAmazonOrderId,
      odooOrderId: cleanOdooOrderId,
    });
    return undefined;
  }

  const externalRef = getExternalOrderRef(order);
  const sendcloudReferences = Array.from(
    new Set(
      [
        externalRef,
        cleanText(order.client_order_ref),
        cleanText(order.origin),
        cleanAmazonOrderId,
      ].filter(Boolean),
    ),
  );
  debugAmazonSendcloud(env, "sendcloud_lookup", {
    amazonOrderId: cleanAmazonOrderId,
    odooOrderId: cleanOdooOrderId,
    resolvedOdooName: order.name,
    resolvedOdooId: order.id,
    externalRef,
    sendcloudReferences,
  });
  const sendcloudByReference = await getSendcloudStatuses(env, sendcloudReferences);
  const sendcloud = sendcloudReferences
    .map((reference) => sendcloudByReference.get(reference))
    .find(Boolean);
  debugAmazonSendcloud(env, "sendcloud_result", {
    amazonOrderId: cleanAmazonOrderId,
    odooOrderId: cleanOdooOrderId,
    externalRef,
    found: Boolean(sendcloud),
    matchedReference: sendcloud?.reference,
    trackingNumber: sendcloud?.trackingNumber,
    trackingUrl: sendcloud?.trackingUrl,
    status: sendcloud?.status,
  });
  const mappedOrder = mapOdooContextOrder(order, externalRef, sendcloud);

  return {
    order: mappedOrder,
    tracking: sendcloud
      ? {
          carrier: sendcloud.carrier ?? "Sendcloud",
          status: sendcloud.status,
          trackingNumber: sendcloud.trackingNumber,
          trackingUrl: sendcloud.trackingUrl,
          lastEvent: sendcloud.rawStatus ?? sendcloud.status,
          updatedAt: new Date().toISOString(),
        }
      : undefined,
  };
}

async function findOdooOrderByAmazonOrderId(
  config: ReturnType<typeof getOdooConfig>,
  uid: number,
  amazonOrderId: string,
) {
  const orders = (await executeKw(
    config,
    uid,
    "sale.order",
    "search_read",
    [
      [
        "|",
        ["client_order_ref", "=", amazonOrderId],
        ["origin", "=", amazonOrderId],
      ],
    ],
    {
      fields: [
        "id",
        "name",
        "date_order",
        "partner_id",
        "team_id",
        "amount_total",
        "amount_tax",
        "origin",
        "client_order_ref",
        "amz_fulfillment_by",
        "state",
        "invoice_status",
      ],
      limit: 5,
      order: "date_order desc",
    },
  )) as OdooOrderContextRecord[];
  return (
    orders.find((item) => cleanText(item.client_order_ref) === amazonOrderId) ??
    orders.find((item) => cleanText(item.origin) === amazonOrderId)
  );
}

async function findOdooOrderByStoredOrderId(
  config: ReturnType<typeof getOdooConfig>,
  uid: number,
  odooOrderId: string,
) {
  const numericId = Number(odooOrderId.replace(/^#/, ""));
  const domain =
    Number.isInteger(numericId) && numericId > 0
      ? ["|", ["id", "=", numericId], ["name", "=", odooOrderId]]
      : [["name", "=", odooOrderId]];
  const orders = (await executeKw(config, uid, "sale.order", "search_read", [domain], {
    fields: [
      "id",
      "name",
      "date_order",
      "partner_id",
      "team_id",
      "amount_total",
      "amount_tax",
      "origin",
      "client_order_ref",
      "amz_fulfillment_by",
      "state",
      "invoice_status",
    ],
    limit: 1,
  })) as OdooOrderContextRecord[];
  return orders[0];
}

export async function getSendcloudStatuses(
  env: Record<string, string>,
  references: string[],
) {
  const config = getSendcloudConfig(env);
  const statuses = new Map<string, SendcloudStatus>();
  if (!config.publicKey || !config.secretKey || references.length === 0) {
    debugAmazonSendcloud(env, "sendcloud_skipped", {
      hasCredentials: Boolean(config.publicKey && config.secretKey),
      references,
    });
    return statuses;
  }

  const uniqueReferences = Array.from(new Set(references.map(cleanText))).filter(
    Boolean,
  );
  const now = Date.now();
  uniqueReferences.forEach((reference) => {
    const cached = sendcloudStatusCache.get(reference);
    if (cached && cached.expiresAt > now) {
      statuses.set(reference, cached.status);
    }
  });
  const missingReferences = uniqueReferences.filter(
    (reference) => !statuses.has(reference),
  );
  debugAmazonSendcloud(env, "sendcloud_query_refs", {
    references: uniqueReferences,
    cached: uniqueReferences.filter((reference) => statuses.has(reference)),
    missing: missingReferences,
  });
  if (missingReferences.length === 0) return statuses;

  try {
    const [ordersPayload, shipmentsPayload] = await Promise.all([
      sendcloudGet<{ data?: SendcloudApiOrder[] }>(
        config,
        "/api/v3/orders?page_size=200",
      ),
      sendcloudGet<{ data?: SendcloudApiShipment[] }>(
        config,
        "/api/v3/shipments?page_size=200",
      ),
    ]);
    const ordersByReference = new Map(
      (ordersPayload.data ?? [])
        .filter((order) => cleanText(order.order_number))
        .map((order) => [cleanText(order.order_number), order]),
    );
    const shipmentsByReference = new Map(
      (shipmentsPayload.data ?? [])
        .filter((shipment) => cleanText(shipment.order_number))
        .map((shipment) => [cleanText(shipment.order_number), shipment]),
    );

    missingReferences.forEach((reference) => {
      const summary = summarizeSendcloud(
        reference,
        ordersByReference.get(reference),
        shipmentsByReference.get(reference),
      );
      if (summary) {
        statuses.set(reference, summary);
        sendcloudStatusCache.set(reference, {
          expiresAt: now + sendcloudCacheTtlMs,
          status: summary,
        });
      }
    });

    const exactReferences = missingReferences.filter(
      (reference) => !statuses.has(reference),
    );

    for (const reference of exactReferences) {
      try {
        const [orders, shipments] = await Promise.all([
          sendcloudGet<{ data?: SendcloudApiOrder[] }>(
            config,
            `/api/v3/orders?order_number=${encodeURIComponent(reference)}&page_size=1`,
          ),
          sendcloudGet<{ data?: SendcloudApiShipment[] }>(
            config,
            `/api/v3/shipments?order_number=${encodeURIComponent(reference)}&page_size=1`,
          ),
        ]);
        debugAmazonSendcloud(env, "sendcloud_exact_query", {
          reference,
          ordersPath: `/api/v3/orders?order_number=${reference}&page_size=1`,
          shipmentsPath: `/api/v3/shipments?order_number=${reference}&page_size=1`,
        });
        const status = summarizeSendcloud(
          reference,
          orders.data?.[0],
          shipments.data?.[0],
        );
        if (status) {
          statuses.set(reference, status);
          sendcloudStatusCache.set(reference, {
            expiresAt: now + sendcloudCacheTtlMs,
            status,
          });
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("429")) break;
        throw error;
      }
    }
  } catch (error) {
    console.warn(
      "Sendcloud no respondio correctamente",
      error instanceof Error ? error.message : error,
    );
  }

  return statuses;
}

export function getExternalOrderRef(order: {
  team_id?: OdooRelation;
  origin?: string | false;
  client_order_ref?: string | false;
}) {
  const channel = getRelationName(order.team_id).toLowerCase();
  const origin = typeof order.origin === "string" ? order.origin : "";
  const clientRef =
    typeof order.client_order_ref === "string" ? order.client_order_ref : "";

  if (channel.includes("amazon")) return clientRef;
  if (channel === "sale" || channel === "sales") return "";
  return origin;
}

export function getFulfillmentBy(order: {
  team_id?: OdooRelation;
  client_order_ref?: string | false;
  amz_fulfillment_by?: string | false;
}) {
  if (order.amz_fulfillment_by === "FBA" || order.amz_fulfillment_by === "FBM") {
    return order.amz_fulfillment_by;
  }

  const channel = getRelationName(order.team_id).toLowerCase();
  const clientRef = cleanText(order.client_order_ref).toUpperCase();
  if (channel.includes("amazon") && clientRef.startsWith("FBA")) return "FBA";

  return "";
}

function mapOdooContextOrder(
  order: OdooOrderContextRecord,
  externalRef: string,
  sendcloud?: SendcloudStatus,
): Order {
  return {
    id: order.name ?? `SO-${order.id}`,
    odooRef: `#${order.id}`,
    date: formatDate(order.date_order ?? order.create_date),
    client: getRelationName(order.partner_id),
    channel: getRelationName(order.team_id) || "Odoo",
    externalRef,
    fulfillmentBy: getFulfillmentBy(order),
    sendcloud,
    deliveryPrinted: false,
    total: order.amount_total ?? 0,
    taxTotal: order.amount_tax ?? 0,
    status: translateSaleState(order.state),
    invoiceStatus: translateInvoiceStatus(order.invoice_status),
    deliveryStatus: sendcloud?.status ?? "Sin dato Sendcloud",
    city: "",
    items: [],
  };
}

async function sendcloudGet<T>(
  config: ReturnType<typeof getSendcloudConfig>,
  path: string,
) {
  const auth = Buffer.from(
    `${config.publicKey}:${config.secretKey}`,
  ).toString("base64");
  const response = await fetch(`https://panel.sendcloud.sc${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    },
  });
  const payload = (await response.json()) as T;

  if (!response.ok) {
    throw new Error(`Sendcloud HTTP ${response.status}`);
  }

  return payload;
}

function summarizeSendcloud(
  reference: string,
  order?: SendcloudApiOrder,
  shipment?: SendcloudApiShipment,
): SendcloudStatus | undefined {
  const parcel = shipment?.parcels?.[0];
  const parcelStatus = parcel?.status?.code || parcel?.status?.message;
  const orderStatus =
    order?.order_details?.status?.message || order?.order_details?.status?.code;
  const rawStatus = parcelStatus || orderStatus;

  if (!rawStatus && !order && !shipment) return undefined;

  return {
    reference,
    status: translateSendcloudStatus(rawStatus, Boolean(parcel)),
    rawStatus,
    trackingNumber: cleanText(parcel?.tracking_number),
    trackingUrl: cleanText(parcel?.tracking_url),
    carrier:
      cleanText(shipment?.carrier?.name) ||
      cleanText(shipment?.carrier_name) ||
      cleanText(shipment?.carrier?.code) ||
      cleanText(shipment?.carrier_code) ||
      "Sendcloud",
  };
}

function translateSendcloudStatus(value?: string, hasParcel = false) {
  const status = cleanText(value).toUpperCase();
  if (!status) return hasParcel ? "Etiqueta creada" : "Sin etiqueta";
  if (status.includes("DELIVER")) return "Entregado";
  if (status.includes("ANNOUNC") || status.includes("LABEL")) return "Etiqueta creada";
  if (status.includes("TRANSIT") || status.includes("SORTING")) return "En transito";
  if (status.includes("EXCEPTION") || status.includes("ERROR")) return "Incidencia";
  if (status.includes("READY") || status.includes("PICK")) return "Listo para recoger";
  return value || "Estado Sendcloud";
}

function getOdooConfig(env: Record<string, string>) {
  return {
    url: trimTrailingSlash(env.ODOO_URL ?? ""),
    database: env.ODOO_DATABASE ?? "",
    username: env.ODOO_USERNAME ?? "",
    apiKey: env.ODOO_API_KEY ?? "",
  };
}

function debugAmazonSendcloud(
  env: Record<string, string | undefined>,
  event: string,
  detail: Record<string, unknown>,
) {
  if (
    env.AMAZON_MESSAGES_DEBUG_SENDCLOUD !== "true" &&
    env.NODE_ENV === "production"
  ) {
    return;
  }
  console.info(`[amazon-messages:sendcloud] ${event}`, detail);
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
  if (!["sale.order"].includes(model) || !["search_read"].includes(method)) {
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

function cleanText(value?: string | false) {
  return typeof value === "string" ? value.trim() : "";
}

function getRelationName(value?: OdooRelation) {
  return Array.isArray(value) ? value[1] : "";
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function translateSaleState(value?: string) {
  const labels: Record<string, string> = {
    draft: "Presupuesto",
    sent: "Presupuesto enviado",
    sale: "Pedido confirmado",
    done: "Bloqueado",
    cancel: "Cancelado",
  };
  return labels[value ?? ""] ?? value ?? "Sin estado";
}

function translateInvoiceStatus(value?: string) {
  const labels: Record<string, string> = {
    upselling: "Venta adicional",
    invoiced: "Facturado",
    to_invoice: "A facturar",
    no: "Sin factura",
  };
  return labels[value ?? ""] ?? value ?? "Sin factura";
}
