import type { GlsShipmentInput } from "./types.ts";
import { buildGlsCancellationXml, buildGlsShipmentXml, extractGlsCancellationResult, extractGlsLabel, extractGlsTracking, soapEnvelope, soapResult } from "./xml.ts";

export class GlsCreationRejected extends Error {}

export function createGlsClient(env: Record<string, string>) {
  const mock = env.GLS_LAB_MOCK !== "false";
  const realWritesEnabled = !mock && env.GLS_REAL_ENABLED === "true";
  const endpoint = env.GLS_API_URL || "https://ws-customer.gls-spain.es/b2b.asmx";
  const request = async (operation: string, fields: Record<string, string>) => {
    if (mock) {
      if (operation === "GrabaServicios") return `<GrabaServiciosResponse><GrabaServiciosResult>&lt;Envio codbarras=&quot;GLS-LAB-${fields.docIn.match(/<Referencia tipo="C"><!\[CDATA\[([\s\S]*?)\]\]><\/Referencia>/)?.[1] || "TEST"}&quot;&gt;&lt;Resultado return=&quot;0&quot;&gt;Grabado&lt;/Resultado&gt;&lt;/Envio&gt;</GrabaServiciosResult></GrabaServiciosResponse>`;
      if (operation === "EtiquetaEnvioV2") return `<EtiquetaEnvioV2Response><EtiquetaEnvioV2Result>${Buffer.from("%PDF-1.4\n%GLS LAB MOCK LABEL\n").toString("base64")}</EtiquetaEnvioV2Result></EtiquetaEnvioV2Response>`;
      if (operation === "Anula") {
        const tracking = fields.docIn.match(/<Envio\s+codbarras="([^"]+)"/)?.[1] || "";
        const code = env.GLS_LAB_CANCEL_RETURN || "0";
        const message = code === "0" ? "Expedicion anulada" : code === "-2" ? "Tiene tracking operativo" : "No existe envio";
        return `<AnulaResponse><AnulaResult>&lt;Servicios&gt;&lt;Envio codbarras=&quot;${tracking}&quot;&gt;&lt;Resultado return=&quot;${code}&quot;&gt;${message}&lt;/Resultado&gt;&lt;/Envio&gt;&lt;/Servicios&gt;</AnulaResult></AnulaResponse>`;
      }
    }
    if (["GrabaServicios", "Anula"].includes(operation) && !realWritesEnabled) throw new Error(`La operación real ${operation} de GLS está desactivada en esta instancia`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://www.asmred.com/${operation}"` },
      body: soapEnvelope(operation, fields),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`GLS HTTP ${response.status}: ${text.slice(0, 500)}`);
    return text;
  };
  const getLabel = async (tracking: string, format = "PDF") => {
    const labelResponse = await request("EtiquetaEnvioV2", {
      uidCliente: env.GLS_UID_CLIENTE || "GLS-LAB-MOCK", codigo: tracking,
      tipoEtiqueta: format, plataforma: env.GLS_PLATFORM || "",
    });
    const labelResult = soapResult(labelResponse, "EtiquetaEnvioV2");
    const labelBase64 = extractGlsLabel(labelResult) || extractGlsLabel(labelResponse) || (/^[A-Za-z0-9+/=\s]+$/.test(labelResult) ? labelResult.replace(/\s/g, "") : "");
    if (!labelBase64) throw new Error(`GLS creó el envío ${tracking}, pero no devolvió la etiqueta; revisa antes de volver a crearlo.`);
    if (!mock && format === "PDF") {
      const pdf = Buffer.from(labelBase64, "base64");
      if (pdf.subarray(0, 5).toString() !== "%PDF-" || !pdf.includes(Buffer.from("%%EOF"))) throw new Error(`GLS creó el envío ${tracking}, pero la etiqueta no es un PDF completo. Recupera su etiqueta sin recrearlo.`);
    }
    return { tracking, labelBase64 };
  };
  return {
    getLabel,
    status: () => ({ configured: Boolean(env.GLS_UID_CLIENTE && env.GLS_REMIT_NAME), labMock: mock, mockShipmentCreationEnabled: env.GLS_LAB_MOCK_CREATE_ENABLED === "true", realWritesEnabled, endpointConfigured: Boolean(env.GLS_API_URL) }),
    async createShipment(input: GlsShipmentInput, onCreated?: (tracking: string) => void) {
      const xml = buildGlsShipmentXml(input, env);
      const createResponse = await request("GrabaServicios", { docIn: xml });
      const createResult = soapResult(createResponse, "GrabaServicios");
      const code = createResult.match(/<(?:\w+:)?Resultado\b[^>]*\breturn=["'](-?\d+)["']/i)?.[1];
      if (code !== undefined && code !== "0") throw new GlsCreationRejected(`GLS rechazó el envío (${code}): ${createResult.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)}`);
      if (code !== "0") throw new Error("GLS no confirmó el resultado de creación; comprueba el envío antes de reintentar.");
      const tracking = extractGlsTracking(createResult);
      if (!tracking) throw new Error("GLS no devolvió código de barras; resultado no confirmable. No reintentes sin comprobar el envío en GLS.");
      onCreated?.(tracking);
      const { labelBase64 } = await getLabel(tracking, input.format || "PDF");
      return { tracking, labelBase64, providerStatus: "created" };
    },
    async cancelShipment(tracking: string) {
      const response = await request("Anula", { docIn: buildGlsCancellationXml(tracking, env) });
      const result = extractGlsCancellationResult(soapResult(response, "Anula"), tracking);
      if (result.code !== 0) throw new Error(`GLS no anuló el envío (${result.code}): ${result.message || "Error de GLS"}`);
      return { tracking, providerStatus: "cancelled", message: result.message };
    },
  };
}
