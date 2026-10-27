import type { GlsShipmentInput } from "./types.ts";
import { getGlsService } from "./services.ts";

const XMLNS = "http://www.asmred.com/";

export function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildGlsShipmentXml(input: GlsShipmentInput, env: Record<string, string>) {
  const origin = {
    name: env.GLS_REMIT_NAME || "",
    address: env.GLS_REMIT_ADDRESS || "",
    town: env.GLS_REMIT_TOWN || "",
    province: env.GLS_REMIT_PROVINCE || "",
    postalCode: env.GLS_REMIT_POSTAL_CODE || "",
    phone: env.GLS_REMIT_PHONE || "",
    mobile: env.GLS_REMIT_MOBILE || "",
    email: env.GLS_REMIT_EMAIL || "",
  };
  const date = input.date || new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid" }).format(new Date());
  const cashOnDelivery = Number(input.cashOnDelivery || 0).toFixed(2).replace(".", ",");
  const peso = input.packages.reduce((sum, item) => sum + item.weight, 0);
  const recipient = input.destination;
  const service = getGlsService(input.service);
  if (!service) throw new Error("GLS no puede generar la etiqueta: servicio no disponible en el catálogo.");
  return `<?xml version="1.0" encoding="utf-8"?><Servicios uidcliente="${escapeXml(env.GLS_UID_CLIENTE)}" xmlns="${XMLNS}"><Envio codbarras=""><Fecha>${escapeXml(date)}</Fecha><Portes>${escapeXml(env.GLS_PORTES || "P")}</Portes><Servicio>${escapeXml(input.service)}</Servicio><Horario>${escapeXml(service.horario)}</Horario><Bultos>${input.packages.length}</Bultos><Peso>${peso.toFixed(3)}</Peso><Retorno>0</Retorno><Pod>N</Pod><Remite><Plaza>${escapeXml(env.GLS_REMIT_PLAZA)}</Plaza><Nombre><![CDATA[${origin.name.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Nombre><Direccion><![CDATA[${origin.address.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Direccion><Poblacion><![CDATA[${origin.town.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Poblacion><Provincia><![CDATA[${origin.province.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Provincia><Pais>${escapeXml(env.GLS_REMIT_COUNTRY || "34")}</Pais><CP>${escapeXml(origin.postalCode)}</CP><Telefono><![CDATA[${origin.phone.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Telefono><Movil><![CDATA[${origin.mobile.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Movil><Email><![CDATA[${origin.email.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Email><Observaciones><![CDATA[]]></Observaciones></Remite><Destinatario><Codigo></Codigo><Plaza></Plaza><Nombre><![CDATA[${recipient.name.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Nombre><Direccion><![CDATA[${recipient.address.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Direccion><Poblacion><![CDATA[${recipient.town.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Poblacion><Provincia><![CDATA[${(recipient.province || "").replace(/]]>/g, "]]]]><![CDATA[>")}]]></Provincia><Pais>${countryDialCode(recipient.countryCode)}</Pais><CP>${escapeXml(recipient.postalCode)}</CP><Telefono><![CDATA[${recipient.phone.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Telefono><Movil><![CDATA[${(recipient.mobile || (input.service === "74" ? recipient.phone : "")).replace(/]]>/g, "]]]]><![CDATA[>")}]]></Movil><Email><![CDATA[${recipient.email.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Email><Observaciones><![CDATA[${(recipient.observations || "").replace(/]]>/g, "]]]]><![CDATA[>")}]]></Observaciones><ATT><![CDATA[${(recipient.contact || recipient.name).replace(/]]>/g, "]]]]><![CDATA[>")}]]></ATT></Destinatario><Referencias><Referencia tipo="C"><![CDATA[${input.reference.replace(/]]>/g, "]]]]><![CDATA[>")}]]></Referencia></Referencias><Importes><Reembolso>${cashOnDelivery}</Reembolso></Importes></Envio></Servicios>`;
}

export function buildGlsCancellationXml(tracking: string, env: Record<string, string>) {
  return `<?xml version="1.0" encoding="utf-8"?><Servicios uidcliente="${escapeXml(env.GLS_UID_CLIENTE)}"><Envio codbarras="${escapeXml(tracking)}" /></Servicios>`;
}

export function extractGlsCancellationResult(value: string, tracking: string) {
  const shipment = value.match(/<(?:\w+:)?Envio\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Envio\s*>/i);
  if (!shipment) throw new Error("GLS no devolvió el resultado de anulación del envío");
  const barcode = shipment[1].match(/(?:codbarras|codigo|referencia)\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
  if (barcode !== tracking) throw new Error("GLS devolvió un resultado de anulación para un código distinto");
  const result = shipment[2].match(/<(?:\w+:)?Resultado\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Resultado\s*>/i);
  if (!result) throw new Error("GLS no indicó si la anulación fue aceptada");
  const code = result[1].match(/\breturn\s*=\s*["'](-?\d+)["']/i)?.[1];
  if (code === undefined) throw new Error("GLS devolvió un resultado de anulación sin código");
  const message = decodeXml(result[2].replace(/<[^>]*>/g, "").trim());
  return { code: Number(code), message };
}

export function soapEnvelope(operation: string, fields: Record<string, string>) {
  // GLS declares docIn as an XML node (xs:any), not an escaped string.
  // Strip the standalone declaration before nesting the generated document.
  const body = Object.entries(fields).map(([key, value]) => {
    const content = key === "docIn" && ["GrabaServicios", "Anula"].includes(operation)
      ? value.replace(/^\s*<\?xml[^?]*\?>\s*/i, "")
      : escapeXml(value);
    return `<${key}>${content}</${key}>`;
  }).join("");
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${operation} xmlns="${XMLNS}">${body}</${operation}></soap:Body></soap:Envelope>`;
}

export function soapResult(xml: string, operation: string) {
  const fault = xml.match(/<(?:\w+:)?Fault\b[\s\S]*?<(?:\w+:)?(?:faultstring|Reason)[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:faultstring|Reason)>/i);
  if (fault) throw new Error(`GLS SOAP: ${decodeXml(fault[1].replace(/<[^>]*>/g, "").trim())}`);
  const expression = new RegExp(`<(?:(?:\\w+):)?${operation}Result\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${operation}Result>`, "i");
  const match = xml.match(expression);
  if (!match) throw new Error(`Respuesta GLS sin ${operation}Result`);
  return decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
}

export function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function extractGlsTracking(value: string) {
  const attrs = value.match(/(?:codbarras|codigoBarras|tracking|codigo)\s*=\s*["']([^"']+)["']/i);
  if (attrs?.[1]) return attrs[1].trim();
  const elements = value.match(/<(?:\w+:)?(?:codbarras|codigoBarras|tracking|codigo)\b[^>]*>([^<]+)<\//i);
  return elements?.[1]?.trim() || "";
}

export function extractGlsLabel(value: string) {
  const match = value.match(/<(?:\w+:)?(?:base64Binary|Etiqueta|Label)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:base64Binary|Etiqueta|Label)>/i);
  if (match?.[1]) return decodeXml(match[1].replace(/\s/g, ""));
  const direct = value.match(/(?:^|\s)([A-Za-z0-9+/]{100,}={0,2})(?:\s|$)/);
  return direct?.[1] || "";
}

export function countryDialCode(countryCode: string) {
  const codes: Record<string, string> = { AD: "376", AT: "43", BE: "32", BG: "359", CY: "357", HR: "385", CZ: "420", DK: "45", EE: "372", FI: "358", FR: "33", DE: "49", GR: "30", HU: "36", IE: "353", IT: "39", LV: "371", LT: "370", LU: "352", MT: "356", NL: "31", NO: "47", PL: "48", PT: "351", RO: "40", SK: "421", SI: "386", ES: "34", SE: "46", CH: "41", GB: "44" };
  return codes[countryCode.toUpperCase()] || countryCode;
}
