import { createAmazonSpApiClient } from "./client.ts";
import { createAmazonShipmentRepository } from "./repository.ts";
import type { AmazonShipmentConfirmationDraft } from "./schema.ts";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };
type ResolveShipmentDraft = (input: Record<string, unknown>) => Promise<AmazonShipmentConfirmationDraft>;

export function registerAmazonSpApiRoutes(
  server: Server,
  auth: Auth,
  env: Record<string, string>,
  options: { dataDir?: string; resolveShipmentDraft: ResolveShipmentDraft },
) {
  const repository = createAmazonShipmentRepository({ dataDir: options.dataDir });
  const client = createAmazonSpApiClient(env);

  server.middlewares.use("/api/amazon-sp-api", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) return sendJson(response, 401, { message: "Login requerido" });
    if (!user.permissions.includes("expeditions")) return sendJson(response, 403, { message: "Sin permiso de expediciones" });
    const url = new URL(request.url ?? "/", "http://local");
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    try {
      if (request.method === "GET" && path === "shipments") {
        return sendJson(response, 200, {
          dryRun: client.config.dryRun,
          shipments: repository.list().slice(0, 100),
        });
      }
      if (request.method === "POST" && path === "shipments/prepare") {
        const input = await readJsonBody<Record<string, unknown>>(request);
        const draft = await options.resolveShipmentDraft(input);
        const result = await client.confirmShipment(draft, { dryRun: true });
        const record = repository.upsertDraft(draft, {
          dryRun: true,
          request: result.request,
        });
        return sendJson(response, 201, {
          dryRun: true,
          shipment: record,
          request: result.request,
          documentation: {
            operation: "confirmShipment",
            method: "POST",
            path: "/orders/v0/orders/{orderId}/shipmentConfirmation",
          },
        });
      }
      const sendMatch = path.match(/^shipments\/([^/]+)\/send$/);
      if (request.method === "POST" && sendMatch) {
        if (!user.permissions.includes("odooWrite")) return sendJson(response, 403, { message: "Sin permiso para enviar tracking Amazon" });
        const record = repository.get(sendMatch[1]);
        if (!record) return sendJson(response, 404, { message: "Expedicion Amazon no encontrada" });
        if (record.status === "sent") return sendJson(response, 200, { shipment: record, duplicate: true });
        const result = await client.confirmShipment(record);
        const updated = repository.updateResult(record.id, {
          status: result.dryRun ? "pending" : "sent",
          amazonResponse: result.response,
          lastRequest: result.request,
          dryRun: result.dryRun,
        });
        return sendJson(response, 200, { dryRun: result.dryRun, shipment: updated, response: result.response });
      }
      const retryMatch = path.match(/^shipments\/([^/]+)\/retry$/);
      if (request.method === "POST" && retryMatch) {
        if (!user.permissions.includes("odooWrite")) return sendJson(response, 403, { message: "Sin permiso para reintentar tracking Amazon" });
        const record = repository.get(retryMatch[1]);
        if (!record) return sendJson(response, 404, { message: "Expedicion Amazon no encontrada" });
        repository.updateResult(record.id, { status: "retrying", incrementRetries: true });
        try {
          const result = await client.confirmShipment(record);
          const updated = repository.updateResult(record.id, {
            status: result.dryRun ? "pending" : "sent",
            amazonResponse: result.response,
            lastRequest: result.request,
            dryRun: result.dryRun,
          });
          return sendJson(response, 200, { dryRun: result.dryRun, shipment: updated, response: result.response });
        } catch (error) {
          const updated = repository.updateResult(record.id, {
            status: "error",
            amazonResponse: (error as { result?: unknown }).result,
            lastError: error instanceof Error ? error.message : "Amazon SP-API ha fallado",
          });
          return sendJson(response, 502, { shipment: updated, message: updated.lastError });
        }
      }
      return sendJson(response, 404, { message: "Ruta Amazon SP-API no encontrada" });
    } catch (error) {
      return sendJson(response, 400, { message: error instanceof Error ? error.message : "No se pudo preparar Amazon SP-API" });
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
