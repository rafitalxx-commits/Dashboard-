import https from "node:https";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCorreosExpressClient } from "../correosExpress/client.ts";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type TrackingEvent = { occurredAt: string; status: string; location: string };

export function registerPublicTrackingRoutes(server: Server, env: Record<string, string>) {
  const cache = createTrackingCache(process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data");
  const cex = createCorreosExpressClient(env);
  server.middlewares.use("/tracking-api", async (request, response) => {
    const path = new URL(request.url || "/", "http://local").pathname.replace(/^\/+|\/+$/g, "");
    const contextMatch = path.match(/^context\/([A-Za-z0-9-]{6,40})$/);
    if (request.method === "GET" && contextMatch) return send(response, 200, findPublicDeliveryContext(process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data", contextMatch[1]));
    const match = path.match(/^(mrw|correos-express)\/([A-Za-z0-9-]{6,25})$/);
    if (request.method !== "GET" || !match) return send(response, 404, { message: "Seguimiento no disponible" });
    try {
      const carrier = match[1]; const tracking = match[2].toUpperCase();
      const cached = cache.get(carrier, tracking);
      if (cached) return send(response, 200, { ...cached, cached: true });
      if (carrier === "correos-express") {
        const raw = await cex.getTracking(tracking);
        const events = normalizeCorreosEvents(raw);
        const result = { carrier: "Correos Express", tracking, events, status: events[0]?.status || String(raw.descEstado || "Etiqueta creada") };
        cache.save(carrier, tracking, result, /ENTREGAD/i.test(result.status));
        return send(response, 200, result);
      }
      const events = await fetchMrwEvents(tracking);
      const result = { carrier: "MRW", tracking, events, status: events[0]?.status || "Sin eventos disponibles" };
      if (events.length) cache.save(carrier, tracking, result, /ENTREGAD/i.test(result.status));
      return send(response, 200, result);
    } catch (error) { return send(response, 502, { message: error instanceof Error ? error.message : "El transportista no ha podido devolver el seguimiento ahora." }); }
  });
}

function findPublicDeliveryContext(dataDir: string, tracking: string) {
  const labels = readJsonArray(join(dataDir, "genei-shipping-labels.json"), "labels");
  const label = labels.find((item) => [item.tracking, item.shipmentCode].some((value) => String(value || "").toUpperCase() === tracking.toUpperCase()));
  if (!label) return { deliveryAddress: "" };
  const orders = readJsonArray(join(dataDir, "orders-cache.json"), "orders");
  const references = new Set([label.externalOrderRef, label.odooOrderRef, ...(Array.isArray(label.orderRefs) ? label.orderRefs : [])].map((value) => String(value || "").toUpperCase()));
  const order = orders.find((item) => [item.externalRef, item.odooRef, item.id].some((value) => references.has(String(value || "").toUpperCase())));
  if (!order) return { deliveryAddress: "" };
  return { deliveryAddress: formatDeliveryAddress(order) };
}
function readJsonArray(file: string, key: string): Array<Record<string, any>> { try { const value = JSON.parse(readFileSync(file, "utf8"))[key]; return Array.isArray(value) ? value : []; } catch { return []; } }
function formatDeliveryAddress(order: Record<string, any>) { const address = String(order.shippingAddress || "").trim(); const extras = [order.shippingPostalCode, order.city, order.shippingCountryCode].map((value) => String(value || "").trim()).filter(Boolean); return [address, ...extras.filter((value) => !address.toLowerCase().includes(value.toLowerCase()))].filter(Boolean).join(", "); }

function normalizeCorreosEvents(raw: Record<string, any>): TrackingEvent[] { return (Array.isArray(raw.estadoEnvios) ? raw.estadoEnvios : []).map((event: Record<string, unknown>) => ({ occurredAt: formatCorreosDate(String(event.fechaEstado || ""), String(event.horaEstado || "")), status: String(event.descEstado || "Estado actualizado"), location: [event.nombreDelegacion, event.idDelegacion].filter(Boolean).join(" · ") || "Correos Express" })).reverse(); }
function formatCorreosDate(date: string, time: string) { return date.length === 8 ? `${date.slice(0, 2)}/${date.slice(2, 4)}/${date.slice(4)}${time ? ` · ${time.slice(0, 2)}:${time.slice(2, 4)}` : ""}` : date || "Fecha no disponible"; }
function createTrackingCache(dataDir: string) { const file = join(dataDir, "public-tracking-cache.json"); const read = () => { try { return JSON.parse(readFileSync(file, "utf8")) as { entries: Record<string, any> }; } catch { return { entries: {} }; } }; const key = (carrier: string, tracking: string) => `${carrier}:${tracking}`; return { get(carrier: string, tracking: string) { const item = read().entries[key(carrier, tracking)]; return item && (item.closed || Date.now() - Date.parse(item.updatedAt) < 12 * 60 * 60 * 1000) ? item.result : null; }, save(carrier: string, tracking: string, result: unknown, closed: boolean) { const store = read(); store.entries[key(carrier, tracking)] = { result, closed, updatedAt: new Date().toISOString() }; mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(store, null, 2)); } }; }
async function fetchMrwEvents(tracking: string): Promise<TrackingEvent[]> { const initial = await requestMrw("https://www.mrw.es/seguimiento/validar-envio.asp", "POST", `mrw-finder-follow-code=${encodeURIComponent(tracking)}&enviar_numenvio_bt=Enviar`); const cookie = initial.cookies.map((item) => item.split(";", 1)[0]).join("; "); const current = await requestMrw("https://www.mrw.es/seguimiento/envio-actual.asp", "GET", undefined, cookie); const rows = current.body.match(/<tr class="past">[\s\S]*?<\/tr>/gi) || []; return rows.map((row) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1].replace(/<[^>]+>/g, "").replace(/&iacute;/g, "í").replace(/&oacute;/g, "ó").trim())).filter((cells) => cells.length >= 4).map((cells) => ({ occurredAt: `${cells[0]} · ${cells[1]}`, status: cells[2], location: cells[3] })); }
function requestMrw(url: string, method: "GET" | "POST", body?: string, cookie?: string): Promise<{ body: string; cookies: string[] }> { return new Promise((resolve, reject) => { const request = https.request(url, { method, headers: { "User-Agent": "Todoelectrico tracking customer portal/1.0", ...(body ? { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (response) => { const chunks: Buffer[] = []; response.on("data", (chunk: Buffer) => chunks.push(chunk)); response.on("end", () => (response.statusCode || 500) >= 400 ? reject(new Error(`MRW HTTP ${response.statusCode}`)) : resolve({ body: Buffer.concat(chunks).toString("utf8"), cookies: response.headers["set-cookie"] || [] })); }); request.on("error", reject); if (body) request.write(body); request.end(); }); }
function send(response: any, status: number, body: unknown) { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.setHeader("Cache-Control", "no-store"); response.end(JSON.stringify(body)); }
