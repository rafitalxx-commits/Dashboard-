import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createGeneiClient } from "./client.ts";
import { shrinkPdfLabelBase64 } from "../pdfLabelTools.ts";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { id?: string; name?: string; username?: string; email?: string; permissions: string[] } | undefined };
type GeneratedLabelRecord = {
  shipmentCode: string;
  createdAt: string;
  updatedAt: string;
  orderRefs: string[];
  source: string;
  externalOrderRef?: string;
  odooOrderRef?: string;
  tracking?: string;
  trackingUrl?: string;
  shipper?: string;
  carrierStatus?: string;
  client?: string;
  user?: string;
  operator?: string;
  reissuedFrom?: string;
  reissuedAt?: string;
  reissuedBy?: string;
  reissueReason?: string;
};
type GeneratedLabelStore = { labels: GeneratedLabelRecord[] };

export function registerGeneiRoutes(server: Server, auth: Auth, env: Record<string, string>) {
  const genei = createGeneiClient(env);
  const labelsRepository = createGeneratedLabelsRepository();
  const dataDir = process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data";
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
      if (request.method === "GET" && path === "labels") {
        const result = searchGeneratedLabels(enrichGeneratedLabels(labelsRepository.list(), dataDir), url.searchParams);
        return sendJson(response, 200, result);
      }
      const recordedLabelMatch = path.match(/^labels\/external\/([^/]+)$/);
      if (request.method === "GET" && recordedLabelMatch) {
        const label = labelsRepository.findByReference(decodeURIComponent(recordedLabelMatch[1]));
        return sendJson(response, 200, { label: label ? enrichGeneratedLabels([label], dataDir)[0] : null });
      }
      const labelReferencesMatch = path.match(/^labels\/([^/]+)\/references$/);
      if (request.method === "DELETE" && labelReferencesMatch) {
        const input = await readJsonBody<{ orderRefs?: string[] }>(request);
        return sendJson(response, 200, {
          label: labelsRepository.removeReferences(decodeURIComponent(labelReferencesMatch[1]), input.orderRefs),
        });
      }
      const labelRecordMatch = path.match(/^labels\/([^/]+)$/);
      if (request.method === "DELETE" && labelRecordMatch) {
        return sendJson(response, 200, {
          removed: labelsRepository.removeByShipmentCode(decodeURIComponent(labelRecordMatch[1])),
        });
      }
      if (request.method === "POST" && path === "labels") {
        const input = await readJsonBody<GeneratedLabelInput>(request);
        return sendJson(response, 201, { label: labelsRepository.upsert({ ...input, user: input.user || getDisplayUser(user) }) });
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

  function list() {
    return readStore().labels;
  }

  function removeByShipmentCode(shipmentCode: string) {
    const normalizedShipmentCode = shipmentCode.trim();
    if (!normalizedShipmentCode) return false;
    const store = readStore();
    const nextLabels = store.labels.filter((label) => label.shipmentCode !== normalizedShipmentCode);
    if (nextLabels.length === store.labels.length) return false;
    writeStore({ labels: nextLabels });
    return true;
  }

  function removeReferences(shipmentCode: string, references?: string[]) {
    const normalizedShipmentCode = shipmentCode.trim();
    const normalizedReferences = normalizeRefs(references);
    if (!normalizedShipmentCode || !normalizedReferences.length) return null;
    const store = readStore();
    const existingIndex = store.labels.findIndex((label) => label.shipmentCode === normalizedShipmentCode);
    if (existingIndex < 0) return null;
    const current = store.labels[existingIndex];
    const nextRefs = current.orderRefs.filter((reference) => !normalizedReferences.includes(normalizeLabelReference(reference)));
    if (!nextRefs.length) {
      store.labels.splice(existingIndex, 1);
      writeStore(store);
      return null;
    }
    const next: GeneratedLabelRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      orderRefs: nextRefs,
      externalOrderRef: normalizedReferences.includes(normalizeLabelReference(current.externalOrderRef)) ? undefined : current.externalOrderRef,
      odooOrderRef: normalizedReferences.includes(normalizeLabelReference(current.odooOrderRef)) ? undefined : current.odooOrderRef,
    };
    store.labels[existingIndex] = next;
    writeStore(store);
    return next;
  }

  function upsert(input: GeneratedLabelInput) {
    const shipmentCode = String(input.shipmentCode || "").trim();
    const orderRefs = normalizeRefs(input.orderRefs);
    if (!shipmentCode) throw new Error("Falta codigo de etiqueta Genei");
    if (!orderRefs.length) throw new Error("Falta referencia de pedido para registrar la etiqueta");
    const now = new Date().toISOString();
    const createdAt = input.createdAt && !Number.isNaN(new Date(input.createdAt).getTime())
      ? new Date(input.createdAt).toISOString()
      : now;
    const store = readStore();
    const existingIndex = store.labels.findIndex((label) => label.shipmentCode === shipmentCode);
    const referenceConflict = existingIndex < 0
      ? store.labels.find((label) => label.orderRefs.some((reference) => orderRefs.includes(normalizeLabelReference(reference))))
      : null;
    const reissuedFrom = cleanOptional(input.reissuedFrom);
    const reissueReason = cleanOptional(input.reissueReason);
    const reissueOperator = cleanOptional(input.operator) || cleanOptional(input.user);
    if (referenceConflict) {
      if (!reissuedFrom || referenceConflict.shipmentCode !== reissuedFrom || !reissueReason) {
        throw new Error(`La referencia ya esta registrada en la etiqueta Genei ${referenceConflict.shipmentCode}`);
      }
      const conflictIndex = store.labels.indexOf(referenceConflict);
      store.labels[conflictIndex] = { ...referenceConflict, updatedAt: now, reissuedAt: now, reissuedBy: reissueOperator || "Sin dato", reissueReason };
    }
    const previous = existingIndex >= 0 ? store.labels[existingIndex] : null;
    const next: GeneratedLabelRecord = {
      shipmentCode,
      createdAt: previous?.createdAt || createdAt,
      updatedAt: now,
      orderRefs: normalizeRefs([...(previous?.orderRefs || []), ...orderRefs]),
      source: input.source || previous?.source || "expeditions",
      externalOrderRef: cleanOptional(input.externalOrderRef) || previous?.externalOrderRef,
      odooOrderRef: cleanOptional(input.odooOrderRef) || previous?.odooOrderRef,
      tracking: cleanOptional(input.tracking) || previous?.tracking,
      trackingUrl: cleanOptional(input.trackingUrl) || previous?.trackingUrl,
      shipper: cleanOptional(input.shipper) || previous?.shipper,
      carrierStatus: cleanOptional(input.carrierStatus) || previous?.carrierStatus,
      client: cleanOptional(input.client) || previous?.client,
      user: cleanOptional(input.user) || previous?.user,
      operator: cleanOptional(input.operator) || previous?.operator,
      reissuedFrom: reissuedFrom || previous?.reissuedFrom,
      reissueReason: reissueReason || previous?.reissueReason,
    };
    if (existingIndex >= 0) store.labels[existingIndex] = next;
    else store.labels.unshift(next);
    writeStore(store);
    return next;
  }

  return { findByReference, list, removeByShipmentCode, removeReferences, upsert };
}

type GeneratedLabelInput = {
  orderRefs?: string[];
  shipmentCode?: string;
  createdAt?: string;
  source?: string;
  externalOrderRef?: string;
  odooOrderRef?: string;
  tracking?: string;
  trackingUrl?: string;
  shipper?: string;
  carrierStatus?: string;
  client?: string;
  user?: string;
  operator?: string;
  reissuedFrom?: string;
  reissueReason?: string;
};

function cleanOptional(value?: string) {
  return typeof value === "string" ? value.trim() : "";
}

function searchGeneratedLabels(labels: GeneratedLabelRecord[], params: URLSearchParams) {
  const query = normalizeSearchValue(params.get("q"));
  const client = normalizeSearchValue(params.get("client"));
  const odooRef = normalizeSearchValue(params.get("odooRef"));
  const reference = normalizeSearchValue(params.get("reference"));
  const shipper = normalizeSearchValue(params.get("shipper"));
  const operator = normalizeSearchValue(params.get("operator"));
  const fromTime = parseDateBoundary(params.get("from"), "from");
  const toTime = parseDateBoundary(params.get("to"), "to");
  const maxLimit = fromTime !== null || toTime !== null ? 2000 : 500;
  const limit = clampInteger(params.get("limit"), 100, 1, maxLimit);
  const offset = clampInteger(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  const filtered = labels.filter((label) => {
    const createdTime = new Date(label.createdAt).getTime();
    if (fromTime !== null && (!Number.isFinite(createdTime) || createdTime < fromTime)) return false;
    if (toTime !== null && (!Number.isFinite(createdTime) || createdTime > toTime)) return false;
    if (query && !labelSearchValues(label).some((value) => value.includes(query))) return false;
    if (client && !normalizeSearchValue(label.client).includes(client)) return false;
    if (odooRef && ![label.odooOrderRef, ...(label.orderRefs || [])]
      .some((value) => normalizeSearchValue(value).includes(odooRef))) return false;
    if (reference && ![
      label.externalOrderRef,
      label.shipmentCode,
      label.tracking,
      ...(label.orderRefs || []),
    ].some((value) => normalizeSearchValue(value).includes(reference))) return false;
    if (shipper && !normalizeSearchValue(label.shipper).includes(shipper)) return false;
    if (operator && !normalizeSearchValue(label.operator).includes(operator)) return false;
    return true;
  });
  return {
    labels: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
    returned: Math.min(limit, Math.max(0, filtered.length - offset)),
  };
}

function labelSearchValues(label: GeneratedLabelRecord) {
  return [
    label.shipmentCode,
    label.externalOrderRef,
    label.odooOrderRef,
    label.tracking,
    label.shipper,
    label.carrierStatus,
    label.client,
    label.operator,
    label.source,
    ...(label.orderRefs || []),
  ].map(normalizeSearchValue).filter(Boolean);
}

function normalizeSearchValue(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function parseDateBoundary(value: string | null, boundary: "from" | "to") {
  if (!value) return null;
  const suffix = boundary === "from" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}${suffix}` : value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function enrichGeneratedLabels(labels: GeneratedLabelRecord[], dataDir: string) {
  const amazonShipments = readStoreArray<Record<string, unknown>>(join(dataDir, "amazon-sp-api-shipments.json"), "shipments");
  const orders = readStoreArray<Record<string, unknown>>(join(dataDir, "orders-cache.json"), "orders");
  const activities = readJsonArray<WarehouseActivity>(join(dataDir, "warehouse-worker-activity.json"));
  const amazonByShipmentCode = new Map<string, Record<string, unknown>>();
  const amazonByOrderRef = new Map<string, Record<string, unknown>>();
  const ordersByReference = new Map<string, Record<string, unknown>>();
  const activityByTracking = new Map<string, WarehouseActivity>();
  const activityByOrderReference = new Map<string, WarehouseActivity>();

  for (const activity of activities) {
    if (activity.result !== "label-created" && activity.result !== "simulated-label") continue;
    if (activity.tracking) activityByTracking.set(normalizeLookupReference(activity.tracking), activity);
    if (activity.orderRef) activityByOrderReference.set(normalizeLookupReference(activity.orderRef), activity);
  }

  for (const shipment of amazonShipments) {
    const shipmentCode = cleanOptionalValue(shipment.geneiShipmentCode);
    const amazonOrderId = cleanOptionalValue(shipment.amazonOrderId);
    if (shipmentCode) amazonByShipmentCode.set(normalizeLookupReference(shipmentCode), shipment);
    if (amazonOrderId) amazonByOrderRef.set(normalizeLookupReference(amazonOrderId), shipment);
  }

  for (const order of orders) {
    [
      cleanOptionalValue(order.externalRef),
      cleanOptionalValue(order.id),
      cleanOptionalValue(order.odooRef),
    ].filter(Boolean).forEach((reference) => {
      ordersByReference.set(normalizeLookupReference(reference), order);
    });
  }

  return labels.map((label) => {
    const references = [
      label.shipmentCode,
      label.externalOrderRef,
      label.odooOrderRef,
      ...(label.orderRefs || []),
    ].map(normalizeLookupReference).filter(Boolean);
    const amazon = amazonByShipmentCode.get(normalizeLookupReference(label.shipmentCode)) ??
      references.map((reference) => amazonByOrderRef.get(reference)).find(Boolean);
    const order = references.map((reference) => ordersByReference.get(reference)).find(Boolean);
    const activity = activityByTracking.get(normalizeLookupReference(label.tracking || label.shipmentCode)) ??
      references.map((reference) => activityByOrderReference.get(reference)).find(Boolean);
    const sendcloud = order?.sendcloud && typeof order.sendcloud === "object"
      ? order.sendcloud as Record<string, unknown>
      : null;
    return {
      ...label,
      externalOrderRef: cleanOptional(label.externalOrderRef) || cleanOptionalValue(amazon?.amazonOrderId) || cleanOptionalValue(order?.externalRef),
      odooOrderRef: cleanOptional(label.odooOrderRef) || cleanOptionalValue(amazon?.saleOrderName) || cleanOptionalValue(order?.id) || cleanOptionalValue(order?.odooRef),
      tracking: cleanOptional(label.tracking) || cleanOptionalValue(amazon?.tracking) || cleanOptionalValue(sendcloud?.trackingNumber),
      trackingUrl: cleanOptional(label.trackingUrl) || cleanOptionalValue(amazon?.trackingUrl) || cleanOptionalValue(sendcloud?.trackingUrl),
      shipper: cleanOptional(label.shipper) || cleanOptionalValue(amazon?.carrier) || cleanOptionalValue(sendcloud?.carrier),
      carrierStatus: cleanOptional(label.carrierStatus) || amazonStatusLabel(amazon) || cleanOptionalValue(sendcloud?.status),
      client: cleanOptional(label.client) || cleanOptionalValue(order?.client),
      operator: cleanOptional(label.operator) || formatWarehouseOperator(activity),
      // The public customer page needs the delivery destination to open the
      // carrier portal. Resolve it here for every historic label as well as
      // newly-created ones, rather than relying on the link's origin.
      trackingCountry: cleanOptionalValue(order?.shippingCountryCode),
      trackingPostalCode: cleanOptionalValue(order?.shippingPostalCode),
      trackingAddress: [cleanOptionalValue(order?.shippingAddress), cleanOptionalValue(order?.shippingPostalCode), cleanOptionalValue(order?.city), cleanOptionalValue(order?.shippingCountryCode)].filter(Boolean).join(", "),
    };
  });
}

type WarehouseActivity = {
  workerName?: string;
  workerCode?: string;
  orderRef?: string;
  tracking?: string;
  result?: string;
};

function formatWarehouseOperator(activity?: WarehouseActivity) {
  if (!activity?.workerName) return "";
  return activity.workerCode ? `${activity.workerName} (${activity.workerCode})` : activity.workerName;
}

function readStoreArray<T>(storePath: string, key: string): T[] {
  try {
    if (!existsSync(storePath)) return [];
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>;
    const value = parsed[key];
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}

function readJsonArray<T>(storePath: string): T[] {
  try {
    if (!existsSync(storePath)) return [];
    const parsed = JSON.parse(readFileSync(storePath, "utf8"));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function cleanOptionalValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeLookupReference(value?: unknown) {
  const compact = cleanOptionalValue(value).replace(/[‘’'`´]/g, "-").replace(/\s+/g, "");
  const reference = /^\d{17}$/.test(compact)
    ? `${compact.slice(0, 3)}-${compact.slice(3, 10)}-${compact.slice(10)}`
    : compact;
  return reference.toUpperCase();
}

function amazonStatusLabel(shipment?: Record<string, unknown>) {
  if (!shipment) return "";
  const status = cleanOptionalValue(shipment.status);
  if (status === "sent") return "Amazon enviado";
  if (status === "pending") return "Amazon pendiente";
  if (status === "retrying") return "Amazon reintentando";
  return cleanOptionalValue(shipment.lastError) ? `Amazon error: ${cleanOptionalValue(shipment.lastError)}` : "";
}

function getDisplayUser(user: { id?: string; name?: string; username?: string; email?: string }) {
  return cleanOptional(user.name) || cleanOptional(user.username) || cleanOptional(user.email) || cleanOptional(user.id) || "Sin dato";
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
  response.end(Buffer.from(shrinkPdfLabelBase64(base64, 0.92), "base64"));
}
