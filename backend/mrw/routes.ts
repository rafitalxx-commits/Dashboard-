import { createMrwClient, type MrwShipmentRequest } from "./client.ts";
import { shrinkPdfLabelBase64 } from "../pdfLabelTools.ts";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };

export function registerMrwRoutes(server: Server, auth: Auth, env: Record<string, string>) {
  const mrw = createMrwClient(env);
  server.middlewares.use("/api/mrw", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) return sendJson(response, 401, { message: "Login requerido" });
    if (!user.permissions.includes("expeditions")) return sendJson(response, 403, { message: "Sin permiso de expediciones" });
    const url = new URL(request.url ?? "/", "http://local");
    const path = url.pathname.replace(/^\/+|\/+$/g, "");

    try {
      if (request.method === "GET" && path === "status") return sendJson(response, 200, mrw.status());
      if (request.method === "POST" && path === "shipments/preview") {
        return sendJson(response, 200, { xml: mrw.buildShipmentXml(await readJsonBody<MrwShipmentRequest>(request)) });
      }
      if (request.method === "POST" && path === "shipments/test") {
        return sendJson(response, 201, { shipment: await mrw.createShipment(await readJsonBody<MrwShipmentRequest>(request)) });
      }
      if (request.method === "POST" && path === "shipments/real") {
        return sendJson(response, 201, { shipment: await mrw.createShipment(await readJsonBody<MrwShipmentRequest>(request)) });
      }
      const labelMatch = path.match(/^shipments\/([^/]+)\/label\.pdf$/);
      if (request.method === "GET" && labelMatch) return sendPdf(response, labelMatch[1], await mrw.getLabelPdf(labelMatch[1]));
      const cancelMatch = path.match(/^shipments\/([^/]+)$/);
      if (request.method === "DELETE" && cancelMatch) return sendJson(response, 200, { result: await mrw.cancelShipment(cancelMatch[1]) });
      return sendJson(response, 404, { message: "Ruta MRW no encontrada" });
    } catch (error) {
      return sendJson(response, 502, { message: error instanceof Error ? error.message : "No se pudo contactar con MRW" });
    }
  });
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
  response.setHeader("Content-Disposition", `inline; filename="mrw-${shipmentNumber.replace(/[^a-zA-Z0-9._-]/g, "-")}.pdf"`);
  response.end(Buffer.from(shrinkPdfLabelBase64(pdfBase64, 0.92), "base64"));
}
