export type PrestashopOrderCarrier = {
  id: string;
  id_order: string;
  id_carrier: string;
  id_order_invoice?: string;
  weight?: string;
  shipping_cost_tax_excl?: string;
  shipping_cost_tax_incl?: string;
  tracking_number?: string;
  date_add?: string;
};

type PrestashopConfig = {
  apiUrl: string;
  apiKey: string;
  enabled: boolean;
  shippedStateId: string;
  timeoutMs: number;
};

export function createPrestashopClient(env: Record<string, string>) {
  const config: PrestashopConfig = {
    apiUrl: (env.PRESTASHOP_API_URL || "").replace(/\/$/, ""),
    apiKey: env.PRESTASHOP_API_KEY || "",
    enabled: env.PRESTASHOP_ENABLED === "true",
    shippedStateId: env.PRESTASHOP_SHIPPED_STATE_ID || "4",
    timeoutMs: Number(env.PRESTASHOP_TIMEOUT_MS || 15_000),
  };

  const assertConfigured = () => {
    if (!config.enabled) throw new Error("PrestaShop desactivado");
    if (!config.apiUrl || !config.apiKey) throw new Error("Falta configurar PrestaShop");
  };

  const request = async (method: string, path: string, body?: string) => {
    assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${config.apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.apiKey}:`).toString("base64")}`,
          Accept: "application/xml",
          ...(body ? { "Content-Type": "application/xml" } : {}),
        },
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(extractError(text) || `PrestaShop HTTP ${response.status}`);
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    status() {
      return {
        configured: Boolean(config.apiUrl && config.apiKey),
        enabled: config.enabled,
        apiUrl: config.apiUrl,
        shippedStateId: config.shippedStateId,
        timeoutMs: config.timeoutMs,
      };
    },
    async findOrderIdByReference(reference: string) {
      const xml = await request("GET", `/orders?filter[reference]=[${encodeURIComponent(reference)}]&display=[id]`);
      return extractTag(xml, "id");
    },
    async getOrder(orderId: string) {
      const xml = await request("GET", `/orders/${encodeURIComponent(orderId)}`);
      return {
        id: extractTag(xml, "id"),
        reference: extractTag(xml, "reference"),
        currentState: extractTag(xml, "current_state"),
      };
    },
    async getOrderCarrier(orderId: string) {
      const xml = await request("GET", `/order_carriers?filter[id_order]=[${encodeURIComponent(orderId)}]&display=full`);
      const records = extractOrderCarriers(xml);
      return records.sort((left, right) => Number(right.id || 0) - Number(left.id || 0))[0] ?? null;
    },
    async updateOrderCarrierTracking(record: PrestashopOrderCarrier, trackingNumber: string) {
      if (!record.id || !record.id_order || !record.id_carrier) {
        throw new Error("PrestaShop no ha devuelto order_carrier completo");
      }
      await request("PUT", `/order_carriers/${encodeURIComponent(record.id)}`, buildOrderCarrierXml({
        ...record,
        tracking_number: trackingNumber,
      }));
    },
    async createOrderHistory(orderId: string) {
      await request("POST", "/order_histories", buildOrderHistoryXml(orderId, config.shippedStateId));
    },
  };
}

function extractOrderCarriers(xml: string): PrestashopOrderCarrier[] {
  return Array.from(xml.matchAll(/<order_carrier\b[^>]*>([\s\S]*?)<\/order_carrier>/g))
    .map((match) => {
      const recordXml = match[1];
      return {
        id: extractTag(recordXml, "id"),
        id_order: extractTag(recordXml, "id_order"),
        id_carrier: extractTag(recordXml, "id_carrier"),
        id_order_invoice: extractTag(recordXml, "id_order_invoice"),
        weight: extractTag(recordXml, "weight"),
        shipping_cost_tax_excl: extractTag(recordXml, "shipping_cost_tax_excl"),
        shipping_cost_tax_incl: extractTag(recordXml, "shipping_cost_tax_incl"),
        tracking_number: extractTag(recordXml, "tracking_number"),
        date_add: extractTag(recordXml, "date_add"),
      };
    })
    .filter((record) => record.id);
}

function buildOrderCarrierXml(record: PrestashopOrderCarrier) {
  return `<prestashop>
  <order_carrier>
    <id><![CDATA[${escapeCdata(record.id)}]]></id>
    <id_order><![CDATA[${escapeCdata(record.id_order)}]]></id_order>
    <id_carrier><![CDATA[${escapeCdata(record.id_carrier)}]]></id_carrier>
    <id_order_invoice><![CDATA[${escapeCdata(record.id_order_invoice || "0")}]]></id_order_invoice>
    <weight><![CDATA[${escapeCdata(record.weight || "0.000000")}]]></weight>
    <shipping_cost_tax_excl><![CDATA[${escapeCdata(record.shipping_cost_tax_excl || "0.000000")}]]></shipping_cost_tax_excl>
    <shipping_cost_tax_incl><![CDATA[${escapeCdata(record.shipping_cost_tax_incl || "0.000000")}]]></shipping_cost_tax_incl>
    <tracking_number><![CDATA[${escapeCdata(record.tracking_number || "")}]]></tracking_number>
    <date_add><![CDATA[${escapeCdata(record.date_add || "")}]]></date_add>
  </order_carrier>
</prestashop>`;
}

function buildOrderHistoryXml(orderId: string, shippedStateId: string) {
  return `<prestashop>
  <order_history>
    <id_order><![CDATA[${escapeCdata(orderId)}]]></id_order>
    <id_order_state><![CDATA[${escapeCdata(shippedStateId)}]]></id_order_state>
  </order_history>
</prestashop>`;
}

function extractTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] || "").trim();
}

function extractError(xml: string) {
  return extractTag(xml, "message") || extractTag(xml, "error");
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeCdata(value: string) {
  return String(value).replace(/\]\]>/g, "]]]]><![CDATA[>");
}
