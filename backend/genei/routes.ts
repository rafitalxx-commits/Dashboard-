import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createGeneiClient } from "./client.ts";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };
type GeneratedLabelRecord = {
  shipmentCode: string;
  createdAt: string;
  updatedAt: string;
  orderRefs: string[];
  source: string;
};
type GeneratedLabelStore = { labels: GeneratedLabelRecord[] };

export function registerGeneiRoutes(server: Server, auth: Auth, env: Record<string, string>) {
  const genei = createGeneiClient(env);
  const labelsRepository = createGeneratedLabelsRepository();
  server.middlewares.use("/api/genei", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) return sendJson(response, 401, { message: "Login requerido" });
    if (!user.permissions.includes("expeditions")) return sendJson(response, 403, { message: "Sin permiso de expediciones" });
    const url = new URL(request.url ?? "/", "http://local");
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    try {
      if (request.method === "GET" && path === "agencies") return sendJson(response, 200, { agencies: await genei.listAgencies() });
      if (request.method === "GET" && path === "quotes") {
        const query = Object.fromEntries(url.searchParams.entries());
        return sendJson(response, 200, { quotes: await genei.quote(query) });
      }
      const recordedLabelMatch = path.match(/^labels\/external\/([^/]+)$/);
      if (request.method === "GET" && recordedLabelMatch) {
        return sendJson(response, 200, { label: labelsRepository.findByReference(decodeURIComponent(recordedLabelMatch[1])) });
      }
      if (request.method === "POST" && path === "labels") {
        const input = await readJsonBody<{ orderRefs?: string[]; shipmentCode?: string; createdAt?: string; source?: string }>(request);
        return sendJson(response, 201, { label: labelsRepository.upsert(input) });
      }
      if (request.method === "POST" && path === "quotes") {
        return sendJson(response, 200, { quotes: await genei.quote(await readJsonBody(request)) });
      }
      if (!user.permissions.includes("expeditions")) return sendJson(response, 403, { message: "Sin permiso de expediciones" });
      if (request.method === "POST" && path === "shipments") {
        return sendJson(response, 201, { shipment: await genei.createShipment(await readJsonBody(request)) });
      }
      if (request.method === "POST" && path === "shipments/test") {
        const input = await readJsonBody<{ destination?: Record<string, unknown>; packagesArray?: unknown[]; agencyId?: number; externalShippingCode?: string }>(request);
        if (!input.destination || !input.packagesArray?.length || !Number.isInteger(input.agencyId)) {
          return sendJson(response, 400, { message: "Faltan destino, bultos o agencia para crear la prueba" });
        }
        const account = await genei.getUser();
        const origin = {
          postalCode: env.GENEI_SENDER_POSTAL_CODE || account?.postalCode || "",
          town: env.GENEI_SENDER_TOWN || account?.city || "",
          name: env.GENEI_SENDER_NAME || account?.name || "",
          address: env.GENEI_SENDER_ADDRESS || account?.address || "",
          isoCountry: env.GENEI_SENDER_COUNTRY || "ES",
          phone: normalizePhone(env.GENEI_SENDER_PHONE || account?.phone || ""),
          email: env.GENEI_SENDER_EMAIL || account?.mail || "",
          observations: "",
          dni: account?.dni || "",
          contact: env.GENEI_SENDER_NAME || account?.name || "",
        };
        const shipment = await genei.createShipment({
          packagesArray: input.packagesArray,
          origin,
          destination: { observations: "", contact: input.destination.name, ...input.destination },
          paymentMethodShipping: 4,
          agencyId: input.agencyId,
          shippingFromWarehouse: 0,
          shippingToWarehouse: 0,
          shippingPalletized: 0,
          cashOnDelivery: 0,
          cashOnDeliveryAmount: 0,
          priority: 0,
          pickupAtStore: 0,
          externalShippingCode: input.externalShippingCode || "",
        });
        return sendJson(response, 201, { shipment });
      }
      if (request.method === "POST" && path === "shipments/real") {
        const input = await readJsonBody<{ destination?: Record<string, unknown>; packagesArray?: unknown[]; agencyId?: number; externalShippingCode?: string }>(request);
        if (!input.destination || !input.packagesArray?.length || !Number.isInteger(input.agencyId)) {
          return sendJson(response, 400, { message: "Faltan destino, bultos o agencia para generar la etiqueta" });
        }
        const account = await genei.getUser();
        const origin = {
          postalCode: env.GENEI_SENDER_POSTAL_CODE || account?.postalCode || "",
          town: env.GENEI_SENDER_TOWN || account?.city || "",
          name: env.GENEI_SENDER_NAME || account?.name || "",
          address: env.GENEI_SENDER_ADDRESS || account?.address || "",
          isoCountry: env.GENEI_SENDER_COUNTRY || "ES",
          phone: normalizePhone(env.GENEI_SENDER_PHONE || account?.phone || ""),
          email: env.GENEI_SENDER_EMAIL || account?.mail || "",
          observations: "", dni: account?.dni || "", contact: env.GENEI_SENDER_NAME || account?.name || "",
        };
        const shipment = await genei.createShipment({
          packagesArray: input.packagesArray, origin,
          destination: { observations: "", contact: input.destination.name, ...input.destination },
          paymentMethodShipping: 4, agencyId: input.agencyId, shippingFromWarehouse: 0, shippingToWarehouse: 0,
          shippingPalletized: 0, cashOnDelivery: 0, cashOnDeliveryAmount: 0, priority: 0, pickupAtStore: 0,
          externalShippingCode: input.externalShippingCode || "",
        });
        return sendJson(response, 201, { shipment });
      }
      const cancelMatch = path.match(/^shipments\/([^/]+)$/);
      const unlinkMatch = path.match(/^shipments\/(\d+)\/external\/([^/]+)$/);
      if (request.method === "DELETE" && unlinkMatch) {
        return sendJson(response, 200, { result: await genei.unlinkShipment(unlinkMatch[1], decodeURIComponent(unlinkMatch[2])) });
      }
      if (request.method === "DELETE" && cancelMatch) {
        return sendJson(response, 200, { result: await genei.cancelShipment(cancelMatch[1]) });
      }
      const shipmentMatch = path.match(/^shipments\/([^/]+)$/);
      if (request.method === "GET" && shipmentMatch) {
        return sendJson(response, 200, { shipment: await genei.getShipment(shipmentMatch[1]) });
      }
      const paymentMatch = path.match(/^payments\/(\d+)$/);
      if (request.method === "POST" && paymentMatch) {
        const paymentToken = await genei.getPaymentToken();
        return sendJson(response, 200, { result: await genei.payTransaction(Number(paymentMatch[1]), paymentToken) });
      }
      const labelFileMatch = path.match(/^shipments\/([^/]+)\/label\.pdf$/);
      if (request.method === "GET" && labelFileMatch) {
        const label = await genei.getPdfLabel(labelFileMatch[1]);
        return sendPdf(response, labelFileMatch[1], extractPdfBase64(label));
      }
      const labelMatch = path.match(/^shipments\/([^/]+)\/label$/);
      if (request.method === "GET" && labelMatch) {
        return sendJson(response, 200, { label: await genei.getPdfLabel(labelMatch[1]) });
      }
      const externalShipmentMatch = path.match(/^shipments\/external\/([^/]+)$/);
      if (request.method === "GET" && externalShipmentMatch) {
        return sendJson(response, 200, { shipment: await genei.getShipmentByExternalCode(decodeURIComponent(externalShipmentMatch[1])) });
      }
      return sendJson(response, 404, { message: "Ruta Genei no encontrada" });
    } catch (error) {
      return sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudo contactar con Genei" });
    }
  });
}

function createGeneratedLabelsRepository() {
  const storePath = join(process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data", "genei-shipping-labels.json");

  function normalizeLabelReference(value?: string) {
    const compact = (value || "").trim().replace(/[‘’'`´]/g, "-").replace(/\s+/g, "");
    const reference = /^\d{17}$/.test(compact)
      ? `${compact.slice(0, 3)}-${compact.slice(3, 10)}-${compact.slice(10)}`
      : compact;
    return reference.toUpperCase();
  }

  function normalizeRefs(values?: string[]) {
    return Array.from(new Set((values || []).map(normalizeLabelReference).filter(Boolean)));
  }

  function ensureStore() {
    if (existsSync(storePath)) return;
    mkdirSync(dirname(storePath), { recursive: true });
    writeStore({ labels: [] });
  }

  function readStore(): GeneratedLabelStore {
    ensureStore();
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Partial<GeneratedLabelStore>;
    return { labels: Array.isArray(parsed.labels) ? parsed.labels : [] };
  }

  function writeStore(store: GeneratedLabelStore) {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
  }

  function findByReference(reference: string) {
    const normalized = normalizeLabelReference(reference);
    if (!normalized) return null;
    return readStore().labels.find((label) => label.orderRefs.map(normalizeLabelReference).includes(normalized)) ?? null;
  }

  function upsert(input: { orderRefs?: string[]; shipmentCode?: string; createdAt?: string; source?: string }) {
    const shipmentCode = String(input.shipmentCode || "").trim();
    const orderRefs = normalizeRefs(input.orderRefs);
    if (!shipmentCode) throw new Error("Falta codigo de etiqueta Genei");
    if (!orderRefs.length) throw new Error("Falta referencia de pedido para registrar la etiqueta");
    const now = new Date().toISOString();
    const createdAt = input.createdAt && !Number.isNaN(new Date(input.createdAt).getTime())
      ? new Date(input.createdAt).toISOString()
      : now;
    const store = readStore();
    const existingIndex = store.labels.findIndex((label) =>
      label.shipmentCode === shipmentCode ||
      label.orderRefs.some((reference) => orderRefs.includes(normalizeLabelReference(reference))),
    );
    const previous = existingIndex >= 0 ? store.labels[existingIndex] : null;
    const next: GeneratedLabelRecord = {
      shipmentCode,
      createdAt: previous?.createdAt || createdAt,
      updatedAt: now,
      orderRefs: normalizeRefs([...(previous?.orderRefs || []), ...orderRefs]),
      source: input.source || previous?.source || "expeditions",
    };
    if (existingIndex >= 0) store.labels[existingIndex] = next;
    else store.labels.unshift(next);
    writeStore(store);
    return next;
  }

  return { findByReference, upsert };
}

function normalizePhone(value: string) {
  const compact = value.replace(/\s+/g, "");
  return compact.startsWith("+") ? compact : `+34${compact}`;
}

function extractPdfBase64(label: unknown) {
  const base64 = typeof label === "string"
    ? label
    : label && typeof label === "object"
      ? String((label as Record<string, unknown>).base64 || (label as Record<string, unknown>).file || (label as Record<string, unknown>).label || "")
      : "";
  if (!base64) throw new Error("Genei no ha devuelto un PDF para esta etiqueta");
  return base64.replace(/^data:application\/pdf;base64,/, "");
}

async function readJsonBody<T = Record<string, unknown>>(request: { on: Function }): Promise<T> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => { request.on("data", (chunk: Buffer) => chunks.push(chunk)); request.on("end", resolve); request.on("error", reject); });
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
}

function sendJson(response: any, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendPdf(response: any, shipmentCode: string, base64: string) {
  const filename = `genei-${shipmentCode.replace(/[^a-zA-Z0-9._-]/g, "-")}.pdf`;
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.setHeader("Cache-Control", "no-store");
  response.end(Buffer.from(base64, "base64"));
}
