import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGlsClient } from "../backend/gls/client.ts";
import { registerGlsRoutes } from "../backend/gls/routes.ts";
import { buildGlsCancellationXml, buildGlsShipmentXml, extractGlsCancellationResult, soapEnvelope, soapResult } from "../backend/gls/xml.ts";
import { validateGlsShipment } from "../backend/gls/validators.ts";
import { isRecordedDashboardLabel } from "../backend/odooDeliveryStatus.ts";

type Handler = (request: EventEmitter & { method: string; url: string; headers: Record<string, string> }, response: Response) => void | Promise<void>;
type Response = { statusCode: number; headers: Record<string, string>; body: Buffer; setHeader: (name: string, value: string) => void; end: (value?: string | Buffer) => void };

const tempDir = mkdtempSync(join(tmpdir(), "gls-lab-"));
const env: Record<string, string> = { GLS_LAB_MOCK: "true", GLS_UID: "uid-alias-mock", GLS_REMIT_NAME: "Remitente", DASHBOARD_DATA_DIR: tempDir };
let handler: Handler | undefined;
registerGlsRoutes(
  { middlewares: { use: (_path, registered: Handler) => { handler = registered; } } },
  { getSessionUser: () => ({ permissions: ["expeditions"] }) },
  env,
);
assert.ok(handler, "La ruta GLS debe registrarse");

async function request(method: string, path: string, payload?: unknown) {
  return await new Promise<Response>((resolve, reject) => {
    const input = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> };
    input.method = method;
    input.url = `/${path}`;
    input.headers = {};
    const response: Response = {
      statusCode: 200,
      headers: {},
      body: Buffer.alloc(0),
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(value = "") { this.body = Buffer.isBuffer(value) ? value : Buffer.from(value); resolve(this); },
    };
    Promise.resolve(handler!(input, response)).catch(reject);
    process.nextTick(() => {
      if (payload !== undefined) input.emit("data", Buffer.from(JSON.stringify(payload)));
      input.emit("end");
    });
  });
}

const shipment = {
  reference: "GLS-LAB-001",
  service: "96",
  destination: { name: "Cliente LAB", address: "Calle Prueba 1", town: "Madrid", postalCode: "28001", countryCode: "ES", phone: "600000000", email: "lab@example.test" },
  packages: [{ weight: 1.25 }],
  format: "PDF" as const,
};
assert.doesNotThrow(() => validateGlsShipment(shipment, {}), "El mock por defecto no debe exigir credenciales ni datos reales del remitente");

const status = await request("GET", "status");
assert.equal(status.statusCode, 200);
assert.equal(JSON.parse(status.body.toString()).labMock, true);
assert.equal(JSON.parse(status.body.toString()).configured, true, "El alias GLS_UID debe satisfacer GLS_UID_CLIENTE en LAB");
const mockBlocked = await request("POST", "shipments/real", shipment);
assert.equal(mockBlocked.statusCode, 503, "El mock no debe registrar una etiqueta ficticia como real por defecto");
env.GLS_LAB_MOCK_CREATE_ENABLED = "true";
const created = await request("POST", "shipments/real", shipment);
assert.equal(created.statusCode, 201);
const createdRecord = JSON.parse(created.body.toString()).shipment;
assert.equal(createdRecord.status, "created");
assert.equal(createdRecord.tracking, "GLS-LAB-GLS-LAB-001");
assert.equal("labelBase64" in createdRecord, false, "La etiqueta no se devuelve en el JSON público");
const duplicate = await request("POST", "shipments/real", shipment);
assert.equal(duplicate.statusCode, 409, "No debe crearse dos veces una referencia confirmada");
const label = await request("GET", `shipments/${createdRecord.tracking}/label`);
assert.equal(label.statusCode, 200);
assert.match(label.body.toString(), /^%PDF-1.4/);
const cancelXml = buildGlsCancellationXml(createdRecord.tracking, { GLS_UID_CLIENTE: "uid-mock" });
assert.match(cancelXml, /<Envio codbarras="GLS-LAB-GLS-LAB-001" \/>/);
assert.deepEqual(extractGlsCancellationResult(`<Servicios><Envio codbarras="${createdRecord.tracking}"><Resultado return="0">Expedicion anulada</Resultado></Envio></Servicios>`, createdRecord.tracking), { code: 0, message: "Expedicion anulada" });
assert.throws(() => extractGlsCancellationResult(`<Servicios><Envio codbarras="OTRO"><Resultado return="0">Expedicion anulada</Resultado></Envio></Servicios>`, createdRecord.tracking), /código distinto/);
const cancelled = await request("POST", `shipments/${encodeURIComponent(createdRecord.tracking)}/cancel`);
assert.equal(cancelled.statusCode, 200);
assert.equal(JSON.parse(cancelled.body.toString()).shipment.status, "cancelled", "Solo el return=0 simulado confirma la anulación");
assert.equal("labelBase64" in JSON.parse(cancelled.body.toString()).shipment, false);
const storedCancellation = await request("GET", `shipments/${encodeURIComponent(createdRecord.tracking)}`);
assert.equal(JSON.parse(storedCancellation.body.toString()).shipment.status, "cancelled", "El estado de anulación debe persistir en el ledger");
const cancelledLabel = await request("GET", `shipments/${encodeURIComponent(createdRecord.tracking)}/label`);
assert.equal(cancelledLabel.statusCode, 410, "Una etiqueta anulada no debe poder recuperarse para imprimirla");
const repeatedCancellation = await request("POST", `shipments/${encodeURIComponent(createdRecord.tracking)}/cancel`);
assert.equal(JSON.parse(repeatedCancellation.body.toString()).idempotent, true);

env.GLS_LAB_CANCEL_RETURN = "-2";
const rejectedCreation = await request("POST", "shipments/real", { ...shipment, reference: "GLS-LAB-002" });
const rejectedTracking = JSON.parse(rejectedCreation.body.toString()).shipment.tracking;
const rejectedCancellation = await request("POST", `shipments/${encodeURIComponent(rejectedTracking)}/cancel`);
assert.equal(rejectedCancellation.statusCode, 409);
assert.equal(JSON.parse(rejectedCancellation.body.toString()).shipment.status, "created", "Una respuesta negativa de GLS no debe marcar la etiqueta como anulada");
assert.match(JSON.parse(rejectedCancellation.body.toString()).message, /tracking operativo/);
delete env.GLS_LAB_CANCEL_RETURN;

const xml = buildGlsShipmentXml({ ...shipment, destination: { ...shipment.destination, name: "Rafa & <test>" } }, { GLS_UID_CLIENTE: "uid-lab", GLS_REMIT_NAME: "Remitente", GLS_REMIT_ADDRESS: "Calle 1", GLS_REMIT_TOWN: "Alicante", GLS_REMIT_POSTAL_CODE: "03000" });
assert.match(xml, /uidcliente="uid-lab"/);
assert.match(xml, /Rafa & <test>/, "Los datos CDATA preservan caracteres especiales");
assert.equal(soapResult(`<Envelope><GrabaServiciosResponse><GrabaServiciosResult>&lt;Envio codbarras=&quot;ABC123&quot;/&gt;</GrabaServiciosResult></GrabaServiciosResponse></Envelope>`, "GrabaServicios"), `<Envio codbarras="ABC123"/>`);
assert.match(soapEnvelope("EtiquetaEnvioV2", { codigo: "ABC123", tipoEtiqueta: "PDF" }), /EtiquetaEnvioV2/);
assert.equal(isRecordedDashboardLabel({ source: "gls-label-created", shipmentCode: "GLS123" }), true, "La etiqueta GLS debe usar la elegibilidad de ledger independiente del transportista");
assert.equal(isRecordedDashboardLabel({ source: "gls-label-created", shipmentCode: "" }), false);
assert.equal(isRecordedDashboardLabel({ source: "external-gls-tracking", shipmentCode: "GLS123", tracking: "GLS123" }), false);
assert.equal(isRecordedDashboardLabel({ source: "gls-label-created", shipmentCode: "GLS123", reissuedAt: "2026-10-15T12:00:00Z" }), false);

const blocked = createGlsClient({ GLS_LAB_MOCK: "false", GLS_REAL_ENABLED: "false", GLS_UID_CLIENTE: "not-used" });
await assert.rejects(() => blocked.createShipment(shipment), /desactivada/);
await assert.rejects(() => blocked.cancelShipment("GLS-REAL-NOT-USED"), /desactivada/);

console.log("GLS LAB integration test passed (SOAP mock; no GLS shipment created)");
