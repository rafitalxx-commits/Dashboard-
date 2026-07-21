import { createGeneiClient } from "./client.ts";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };

export function registerGeneiRoutes(server: Server, auth: Auth, env: Record<string, string>) {
  const genei = createGeneiClient(env);
  server.middlewares.use("/api/genei", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user || !user.permissions.includes("dashboard")) return sendJson(response, 401, { message: "Login requerido" });
    const url = new URL(request.url ?? "/", "http://local");
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    try {
      if (request.method === "GET" && path === "agencies") return sendJson(response, 200, { agencies: await genei.listAgencies() });
      if (request.method === "GET" && path === "quotes") {
        const query = Object.fromEntries(url.searchParams.entries());
        return sendJson(response, 200, { quotes: await genei.quote(query) });
      }
      if (request.method === "POST" && path === "quotes") {
        return sendJson(response, 200, { quotes: await genei.quote(await readJsonBody(request)) });
      }
      if (!user.permissions.includes("settings")) return sendJson(response, 403, { message: "Solo administradores pueden crear, pagar o descargar etiquetas" });
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

async function readJsonBody(request: { on: Function }) {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => { request.on("data", (chunk: Buffer) => chunks.push(chunk)); request.on("end", resolve); request.on("error", reject); });
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
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
