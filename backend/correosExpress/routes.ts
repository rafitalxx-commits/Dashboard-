import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCorreosExpressClient, normalizeCorreosExpressPdfBase64, type CorreosExpressShipmentRequest } from "./client.ts";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };

export function registerCorreosExpressRoutes(server: Server, auth: Auth, env: Record<string, string>) {
  const cex = createCorreosExpressClient(env);
  const repository = createCorreosExpressRepository(env);
  server.middlewares.use("/api/correos-express", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) return sendJson(response, 401, { message: "Login requerido" });
    if (!user.permissions.includes("expeditions")) return sendJson(response, 403, { message: "Sin permiso de expediciones" });
    const url = new URL(request.url ?? "/", "http://local");
    const path = url.pathname.replace(/^\/+|\/+$/g, "");

    try {
      if (request.method === "GET" && path === "status") return sendJson(response, 200, cex.status());
      if (request.method === "GET" && path === "shipments") return sendJson(response, 200, { shipments: repository.list().slice(0, 200) });
      const recordedMatch = path.match(/^shipments\/external\/([^/]+)$/);
      if (request.method === "GET" && recordedMatch) {
        return sendJson(response, 200, { shipment: repository.findByReference(decodeURIComponent(recordedMatch[1])) });
      }
      if (request.method === "POST" && path === "shipments/preview") {
        return sendJson(response, 200, { payload: cex.buildShipmentPayload(await readJsonBody<CorreosExpressShipmentRequest>(request)) });
      }
      if (request.method === "POST" && path === "shipments/test") {
        return await createShipment(response, cex, repository, await readJsonBody<CorreosExpressShipmentRequest & { force?: boolean }>(request), "test");
      }
      if (request.method === "POST" && path === "shipments/real") {
        return await createShipment(response, cex, repository, await readJsonBody<CorreosExpressShipmentRequest & { force?: boolean }>(request), "real");
      }
      const labelMatch = path.match(/^shipments\/([^/]+)\/label\.pdf$/);
      if (request.method === "GET" && labelMatch) return await sendShipmentLabel(response, cex, repository, decodeURIComponent(labelMatch[1]));
      const trackingMatch = path.match(/^shipments\/([^/]+)\/tracking$/);
      if (request.method === "GET" && trackingMatch) return sendJson(response, 200, { tracking: await cex.getTracking(trackingMatch[1]) });
      return sendJson(response, 404, { message: "Ruta Correos Express no encontrada" });
    } catch (error) {
      return sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudo contactar con Correos Express" });
    }
  });
}

async function createShipment(
  response: any,
  cex: ReturnType<typeof createCorreosExpressClient>,
  repository: ReturnType<typeof createCorreosExpressRepository>,
  input: CorreosExpressShipmentRequest & { force?: boolean },
  mode: "test" | "real",
) {
  const reference = normalizeReference(input.reference);
  const existing = repository.findByReference(reference);
  if (existing && !input.force) {
    return sendJson(response, 409, {
      message: `Ya existe una expedicion Correos Express valida para ${reference}. Usa reimpresion o reintento controlado, no se creara duplicado.`,
      shipment: existing,
    });
  }
  const shipment = await cex.createShipment(input);
  const record = repository.upsert({
    reference,
    shipmentNumber: shipment.shipmentNumber,
    parcelCodes: shipment.parcelCodes,
    service: input.service,
    status: mode === "test" ? "created-test" : "created",
    labelBase64: shipment.labelBase64,
    raw: redactRaw(shipment.raw),
  });
  return sendJson(response, 201, { shipment: { ...shipment, record } });
}

async function sendShipmentLabel(
  response: any,
  cex: ReturnType<typeof createCorreosExpressClient>,
  repository: ReturnType<typeof createCorreosExpressRepository>,
  shipmentNumber: string,
) {
  try {
    return sendPdf(response, shipmentNumber, await cex.getLabelPdf(shipmentNumber));
  } catch (error) {
    const stored = repository.findByShipmentNumber(shipmentNumber);
    const labelBase64 = stored?.labelBase64 || extractStoredLabelBase64(stored?.raw);
    if (labelBase64) return sendPdf(response, shipmentNumber, normalizeCorreosExpressPdfBase64(labelBase64));
    throw error;
  }
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

function sendPdf(response: any, shipmentNumber: string, pdfBase64: string) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="correos-express-${shipmentNumber.replace(/[^a-zA-Z0-9._-]/g, "-")}.pdf"`);
  response.end(Buffer.from(pdfBase64, "base64"));
}

type CorreosExpressRecord = {
  reference: string;
  shipmentNumber: string;
  parcelCodes: string[];
  service: string;
  status: string;
  labelBase64?: string;
  raw?: unknown;
  createdAt: string;
  updatedAt: string;
};

type CorreosExpressStore = { shipments: CorreosExpressRecord[] };

function createCorreosExpressRepository(env: Record<string, string>) {
  const storePath = join(env.DASHBOARD_DATA_DIR ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data", "correos-express-shipments.json");

  function ensureStore() {
    if (existsSync(storePath)) return;
    mkdirSync(dirname(storePath), { recursive: true });
    writeStore({ shipments: [] });
  }

  function readStore(): CorreosExpressStore {
    ensureStore();
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Partial<CorreosExpressStore>;
    return { shipments: Array.isArray(parsed.shipments) ? parsed.shipments : [] };
  }

  function writeStore(store: CorreosExpressStore) {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  }

  return {
    list() {
      return readStore().shipments.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },
    findByReference(reference: string) {
      const normalized = normalizeReference(reference);
      return readStore().shipments.find((shipment) => normalizeReference(shipment.reference) === normalized) ?? null;
    },
    findByShipmentNumber(shipmentNumber: string) {
      return readStore().shipments.find((shipment) => shipment.shipmentNumber === shipmentNumber) ?? null;
    },
    upsert(input: Omit<CorreosExpressRecord, "createdAt" | "updatedAt">) {
      const store = readStore();
      const now = new Date().toISOString();
      const normalized = normalizeReference(input.reference);
      const index = store.shipments.findIndex((shipment) => normalizeReference(shipment.reference) === normalized || shipment.shipmentNumber === input.shipmentNumber);
      const previous = index >= 0 ? store.shipments[index] : null;
      const next = { ...input, reference: normalized, createdAt: previous?.createdAt || now, updatedAt: now };
      if (index >= 0) store.shipments[index] = next;
      else store.shipments.push(next);
      writeStore(store);
      return next;
    },
  };
}

function normalizeReference(value: string) {
  return String(value || "").trim().replace(/[‘’'`´]/g, "-").replace(/\s+/g, "").toUpperCase();
}

function redactRaw(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete copy.password;
  delete copy.solicitante;
  return copy;
}

function extractStoredLabelBase64(raw: unknown) {
  if (!raw || typeof raw !== "object") return "";
  const labels = Array.isArray((raw as Record<string, unknown>).etiqueta)
    ? (raw as Record<string, unknown>).etiqueta as Array<Record<string, unknown>>
    : [];
  for (const label of labels) {
    const value = String(label?.etiqueta1 || label?.etiqueta2 || label?.DevuelveEtiquetaPdf || "");
    if (value) return value;
  }
  return "";
}
