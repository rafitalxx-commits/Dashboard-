import {assertIncidentLabelAllowed} from '../incidents/labelGuard.ts';
import { loadGlsEnvironment } from "./config.ts";
import { createGlsClient, GlsCreationRejected } from "./client.ts";
import { createGlsRepository } from "./repository.ts";
import type { GlsShipmentInput, GlsShipmentRecord } from "./types.ts";
import { validateGlsShipment } from "./validators.ts";

type Server = { middlewares: { use: (path: string, handler: (request: any, response: any) => void | Promise<void>) => void } };
type Auth = { getSessionUser: (cookie?: string) => { permissions: string[] } | undefined };

export function registerGlsRoutes(server: Server, auth: Auth, env: Record<string, string>) {
  const glsEnv = loadGlsEnvironment(env);
  const client = createGlsClient(glsEnv);
  const repository = createGlsRepository(glsEnv);
  server.middlewares.use("/api/gls", async (request, response) => {
    const user = auth.getSessionUser(request.headers.cookie);
    if (!user) return send(response, 401, { message: "Login requerido" });
    if (!user.permissions.includes("expeditions")) return send(response, 403, { message: "Sin permiso de expediciones" });
    const path = new URL(request.url || "/", "http://local").pathname.replace(/^\/+|\/+$/g, "");
    try {
      if (request.method === "GET" && path === "status") return send(response, 200, client.status());
      if (request.method === "GET" && path === "shipments") return send(response, 200, { shipments: repository.list().map(publicRecord) });
      const shipmentStatus = path.match(/^shipments\/([^/]+)$/);
      if (request.method === "GET" && shipmentStatus) {
        const record = repository.findByReferenceOrTracking(decodeURIComponent(shipmentStatus[1]));
        return record ? send(response, 200, { shipment: publicRecord(record) }) : send(response, 404, { message: "Envío GLS no encontrado en el registro local" });
      }
      if (request.method === "POST" && path === "shipments/real") {
        const input = await body<GlsShipmentInput>(request);
        await assertIncidentLabelAllowed(env,input);
        if (client.status().labMock && !client.status().mockShipmentCreationEnabled) return send(response, 503, { message: "GLS está en modo mock; no se registrará una etiqueta ficticia ni se validará una entrega. La creación simulada solo se habilita expresamente para pruebas." });
        if (!client.status().labMock && !client.status().realWritesEnabled) return send(response, 503, { message: "La creación real GLS está desactivada en esta instancia." });
        validateGlsShipment(input, glsEnv);
        const existing = repository.find(input.reference);
        if (existing && ["created", "pending", "unknown", "cancel_pending"].includes(existing.status)) return send(response, 409, { message: `Ya existe o está pendiente de confirmar un envío GLS para ${input.reference}; no se creará un duplicado.`, shipment: publicRecord(existing) });
        const now = new Date().toISOString();
        const pending: GlsShipmentRecord = { reference: input.reference, status: "pending", service: input.service, labelFormat: input.format || "PDF", createdAt: now, updatedAt: now };
        repository.save(pending);
        let confirmed = pending;
        try {
          const created = await client.createShipment(input, (tracking) => {
            confirmed = { ...pending, status: "created", tracking, updatedAt: new Date().toISOString() };
            repository.save(confirmed);
          });
          const record: GlsShipmentRecord = { ...pending, status: "created", tracking: created.tracking, labelBase64: created.labelBase64, updatedAt: new Date().toISOString() };
          repository.save(record);
          return send(response, 201, { shipment: publicRecord(record) });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const record: GlsShipmentRecord = { ...confirmed, status: confirmed.tracking ? "created" : error instanceof GlsCreationRejected ? "failed" : "unknown", providerErrorMessage: message, updatedAt: new Date().toISOString() };
          repository.save(record);
          return send(response, 502, { message, shipment: publicRecord(record) });
        }
      }
      const cancellation = path.match(/^shipments\/([^/]+)\/cancel$/);
      if (request.method === "POST" && cancellation) {
        if (client.status().labMock && !client.status().mockShipmentCreationEnabled) return send(response, 503, { message: "GLS está en modo mock; no se simulará la anulación de un envío real." });
        const tracking = decodeURIComponent(cancellation[1]).trim();
        if (!tracking || tracking.length > 80) return send(response, 400, { message: "Código de barras GLS no válido" });
        const existing = repository.findByReferenceOrTracking(tracking);
        if (!existing) return send(response, 404, { message: "Envío GLS no encontrado en el registro local" });
        if (existing.status === "cancelled") return send(response, 200, { shipment: publicRecord(existing), idempotent: true });
        if (existing.status === "cancel_pending" || existing.status === "unknown") return send(response, 409, { message: "El resultado de la anulación no es seguro para repetir; comprueba el estado del envío con GLS.", shipment: publicRecord(existing) });
        if (existing.status !== "created") return send(response, 409, { message: "Solo se pueden anular envíos GLS confirmados como creados" });
        if (!client.status().labMock && !client.status().realWritesEnabled) return send(response, 503, { message: "La anulación real GLS está desactivada en esta instancia." });
        const pending: GlsShipmentRecord = { ...existing, status: "cancel_pending", providerErrorMessage: undefined, updatedAt: new Date().toISOString() };
        repository.save(pending);
        try {
          const result = await client.cancelShipment(existing.tracking || tracking);
          const cancelled: GlsShipmentRecord = { ...pending, status: "cancelled", providerErrorMessage: undefined, updatedAt: new Date().toISOString() };
          repository.save(cancelled);
          return send(response, 200, { shipment: publicRecord(cancelled), message: result.message });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const rejected = /GLS no anuló el envío \(/i.test(message);
          const failed: GlsShipmentRecord = { ...pending, status: rejected ? "created" : "unknown", providerErrorMessage: message, updatedAt: new Date().toISOString() };
          repository.save(failed);
          return send(response, rejected ? 409 : 502, { message, shipment: publicRecord(failed) });
        }
      }
      const label = path.match(/^shipments\/([^/]+)\/label$/);
      if (request.method === "GET" && label) {
        let record = repository.findByReferenceOrTracking(decodeURIComponent(label[1]));
        if (record?.status === "cancelled") return send(response, 410, { message: "GLS confirmó la anulación; la etiqueta ya no está disponible" });
        if (record?.status === "unknown" || record?.status === "cancel_pending") return send(response, 409, { message: "Estado GLS pendiente de comprobar; impresión bloqueada hasta confirmar el envío." });
        if (record?.status === "created" && record.tracking && !record.labelBase64) {
          if (client.status().labMock && !client.status().mockShipmentCreationEnabled) return send(response, 503, { message: "GLS está en modo mock; no se sustituirá una etiqueta real por una simulada." });
          const recovered = await client.getLabel(record.tracking, record.labelFormat || "PDF");
          record = { ...record, labelBase64: recovered.labelBase64, providerErrorMessage: undefined, updatedAt: new Date().toISOString() };
          repository.save(record);
        }
        if (!record?.labelBase64) return send(response, 404, { message: "Etiqueta GLS no disponible" });
        response.statusCode = 200;
        response.setHeader("Content-Type", record.labelFormat === "ZPL" ? "text/plain; charset=utf-8" : "application/pdf");
        return response.end(Buffer.from(record.labelBase64, "base64"));
      }
      return send(response, 404, { message: "Ruta GLS no encontrada" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return send(response, message.startsWith("GLS no puede generar") ? 400 : 502, { message });
    }
  });
}

function publicRecord(record: GlsShipmentRecord) {
  const { labelBase64: _label, ...safe } = record;
  return safe;
}
async function body<T = Record<string, unknown>>(request: { on: Function }) {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", resolve);
    request.on("error", reject);
  });
  const text = Buffer.concat(chunks).toString("utf8");
  return (text ? JSON.parse(text) : {}) as T;
}
function send(response: any, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}
