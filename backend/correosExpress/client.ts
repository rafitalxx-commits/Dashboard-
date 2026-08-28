import zlib from "node:zlib";

export type CorreosExpressServiceId =
  | "cex-paq-10"
  | "cex-paq-14"
  | "cex-paq-24"
  | "cex-entrega-plus"
  | "cex-internacional-standard"
  | "cex-internacional-express"
  | "cex-paq-empresa-14"
  | "cex-epaq-24"
  | "cex-paq-punto"
  | "cex-paq-ecommerce"
  | "cex-islas-express"
  | "cex-islas-documentacion"
  | "cex-islas-maritimo"
  | "cex-baleares-express"
  | "cex-canarias-express"
  | "cex-canarias-aereo"
  | "cex-canarias-maritimo";

export type CorreosExpressShipmentRequest = {
  reference: string;
  service: CorreosExpressServiceId | string;
  destination: {
    name: string;
    address: string;
    postalCode: string;
    town: string;
    countryCode?: string;
    phone: string;
    email?: string;
  };
  packages: Array<{ weight: number; length?: number; width?: number; height?: number }>;
  observations?: string;
  labelType?: "1" | "2" | "3" | "4" | "5";
  customs?: { required?: boolean; complete?: boolean; missing?: string[] };
};

export type CorreosExpressShipmentResult = {
  shipmentNumber: string;
  parcelCodes: string[];
  labelBase64?: string;
  raw: unknown;
};

type CorreosExpressSender = {
  code: string;
  name: string;
  nif?: string;
  address: string;
  town: string;
  postalCode: string;
  countryCode: string;
  contact?: string;
  phone: string;
  email?: string;
};

const DEFAULT_CREATE_URL = "https://www.test.cexpr.es/wspsc/apiRestGrabacionEnviok8s/json/grabacionEnvio";
const DEFAULT_LABEL_URL = "https://www.test.cexpr.es/wspsc/apiRestEtiquetaTransporte/json/etiquetaTransporte";
const DEFAULT_TRACKING_URL = "https://www.test.cexpr.es/wspsc/apiRestSeguimientoEnviosk8s/json/seguimientoEnvio";

const PRODUCT_CODES: Record<string, string> = {
  "correos-express-standard": "63",
  "correos-express-internacional-standard": "90",
  "cex-paq-10": "61",
  "cex-paq-14": "62",
  "cex-paq-24": "63",
  "cex-entrega-plus": "54",
  "cex-internacional-standard": "90",
  "cex-internacional-express": "91",
  "cex-paq-empresa-14": "92",
  "cex-epaq-24": "93",
  "cex-paq-punto": "18",
  "cex-paq-ecommerce": "24",
  "cex-islas-express": "26",
  "cex-islas-documentacion": "46",
  "cex-islas-maritimo": "79",
  "cex-baleares-express": "66",
  "cex-canarias-express": "67",
  "cex-canarias-aereo": "68",
  "cex-canarias-maritimo": "69",
};

export function createCorreosExpressClient(env: Record<string, string>) {
  const createShipmentUrl = (env.CEX_CREATE_SHIPMENT_URL || DEFAULT_CREATE_URL).trim();
  const labelUrl = (env.CEX_LABEL_URL || DEFAULT_LABEL_URL).trim();
  const trackingUrl = (env.CEX_TRACKING_URL || DEFAULT_TRACKING_URL).trim();
  const productionEnabled = env.CEX_PRODUCTION_ENABLED === "true";
  const allowTestSelfSignedCertificate =
    env.CORREOS_EXPRESS_ALLOW_TEST_SELF_SIGNED_CERT === "true" ||
    env.CEX_ALLOW_TEST_SELF_SIGNED_CERT === "true";
  const username = env.CORREOS_EXPRESS_USERNAME || env.CEX_USERNAME || "";
  const password = env.CORREOS_EXPRESS_PASSWORD || env.CEX_PASSWORD || "";
  const customerCode = env.CORREOS_EXPRESS_CLIENT_CODE || env.CEX_CUSTOMER_CODE || env.CEX_KEY_CLI || "";
  const requester = env.CORREOS_EXPRESS_REQUESTER_CODE || env.CEX_SOLICITANTE || customerCode;
  const requesterPassword = env.CORREOS_EXPRESS_REQUESTER_PASSWORD || env.CEX_SOLICITANTE_PASSWORD || env.CEX_PASSWORD_CLIENTE || "";
  const sender: CorreosExpressSender = {
    code: env.CORREOS_EXPRESS_SENDER_CODE || env.CEX_SENDER_CODE || customerCode,
    name: env.CORREOS_EXPRESS_SENDER_NAME || env.CEX_SENDER_NAME || env.GENEI_SENDER_NAME || "",
    nif: env.CORREOS_EXPRESS_SENDER_NIF || env.CEX_SENDER_NIF || "",
    address: env.CORREOS_EXPRESS_SENDER_ADDRESS || env.CEX_SENDER_ADDRESS || env.GENEI_SENDER_ADDRESS || "",
    town: env.CORREOS_EXPRESS_SENDER_TOWN || env.CEX_SENDER_TOWN || env.GENEI_SENDER_TOWN || "",
    postalCode: env.CORREOS_EXPRESS_SENDER_POSTAL_CODE || env.CEX_SENDER_POSTAL_CODE || env.GENEI_SENDER_POSTAL_CODE || "",
    countryCode: env.CORREOS_EXPRESS_SENDER_COUNTRY || env.CEX_SENDER_COUNTRY || env.GENEI_SENDER_COUNTRY || "ES",
    contact: env.CORREOS_EXPRESS_SENDER_CONTACT || env.CEX_SENDER_CONTACT || env.CORREOS_EXPRESS_SENDER_NAME || env.CEX_SENDER_NAME || env.GENEI_SENDER_NAME || "",
    phone: env.CORREOS_EXPRESS_SENDER_PHONE || env.CEX_SENDER_PHONE || env.GENEI_SENDER_PHONE || "",
    email: env.CORREOS_EXPRESS_SENDER_EMAIL || env.CEX_SENDER_EMAIL || env.GENEI_SENDER_EMAIL || "",
  };

  const assertConfigured = () => {
    const missing = [
      ["CORREOS_EXPRESS_USERNAME", username],
      ["CORREOS_EXPRESS_PASSWORD", password],
      ["CORREOS_EXPRESS_CLIENT_CODE", customerCode],
      ["CORREOS_EXPRESS_REQUESTER_CODE", requester],
      ["CORREOS_EXPRESS_SENDER_CODE", sender.code],
      ["CORREOS_EXPRESS_SENDER_NAME", sender.name],
      ["CORREOS_EXPRESS_SENDER_ADDRESS", sender.address],
      ["CORREOS_EXPRESS_SENDER_TOWN", sender.town],
      ["CORREOS_EXPRESS_SENDER_POSTAL_CODE", sender.postalCode],
      ["CORREOS_EXPRESS_SENDER_PHONE", sender.phone],
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) throw new Error(`Falta configurar Correos Express: ${missing.join(", ")}`);
  };

  const postJson = async <T>(url: string, payload: unknown) => {
    assertConfigured();
    assertProductionAllowed(url, productionEnabled);
    const { status, text } = await postJsonHttp(url, payload, {
      username,
      password,
      allowSelfSignedCertificate: allowTestSelfSignedCertificate && isTestEndpoint(url),
    });
    const body = text ? parseJson(text) : {};
    if (status < 200 || status >= 300) throw new Error(`Correos Express HTTP ${status}: ${extractErrorMessage(body) || text.slice(0, 500)}`);
    const returnCode = Number((body as Record<string, unknown>).codigoRetorno);
    if (Number.isFinite(returnCode) && returnCode !== 0) throw new Error(`Correos Express ${returnCode}: ${extractErrorMessage(body) || "solicitud rechazada"}`);
    return body as T;
  };
  const buildPayload = (input: CorreosExpressShipmentRequest) =>
    buildShipmentPayload(sender, requester, requesterPassword, input, resolveProductCode(input.service), input.labelType);

  return {
    status() {
      return {
        createShipmentUrl,
        labelUrl,
        trackingUrl,
        configured: Boolean(username && password && customerCode && requester && sender.code),
        productionEndpoint: isProductionEndpoint(createShipmentUrl) || isProductionEndpoint(labelUrl) || isProductionEndpoint(trackingUrl),
        productionEnabled,
        allowTestSelfSignedCertificate,
        services: correosExpressServices(),
      };
    },
    buildShipmentPayload(input: CorreosExpressShipmentRequest) {
      validateShipmentInput(input);
      return buildPayload(input);
    },
    async createShipment(input: CorreosExpressShipmentRequest): Promise<CorreosExpressShipmentResult> {
      validateShipmentInput(input);
      const body = await postJson<Record<string, unknown>>(createShipmentUrl, buildPayload(input));
      return {
        shipmentNumber: String(body.datosResultado || ""),
        parcelCodes: Array.isArray(body.listaBultos)
          ? body.listaBultos.map((parcel) => String((parcel as Record<string, unknown>).codUnico || "")).filter(Boolean)
          : [],
        labelBase64: extractEmbeddedLabel(body),
        raw: body,
      };
    },
    async getLabelPdf(shipmentNumber: string) {
      const body = await postJson<Record<string, unknown>>(labelUrl, {
        keyCli: customerCode,
        nenvio: shipmentNumber,
        tipo: "1",
      });
      return extractTransportLabel(body);
    },
    async getTracking(shipmentNumber: string) {
      return postJson<Record<string, unknown>>(trackingUrl, {
        codigoCliente: customerCode,
        dato: shipmentNumber,
        idioma: "ES",
      });
    },
  };
}

export function correosExpressServices() {
  return [
    { id: "cex-paq-10", label: "Correos Express Nacional PAQ 10", code: "61" },
    { id: "cex-paq-14", label: "Correos Express Nacional PAQ 14", code: "62" },
    { id: "cex-paq-24", label: "Correos Express PAQ 24", code: "63" },
    { id: "cex-entrega-plus", label: "Correos Express Nacional Entrega Plus", code: "54" },
    { id: "cex-paq-empresa-14", label: "Correos Express Nacional PAQ Empresa 14", code: "92" },
    { id: "cex-epaq-24", label: "Correos Express Nacional ePAQ 24", code: "93" },
    { id: "cex-paq-punto", label: "Correos Express Nacional Paq Punto", code: "18" },
    { id: "cex-paq-ecommerce", label: "Correos Express Nacional Paq E-commerce", code: "24" },
    { id: "cex-baleares-express", label: "Correos Express Islas Baleares Express", code: "66" },
    { id: "cex-canarias-express", label: "Correos Express Islas Canarias Express", code: "67" },
    { id: "cex-canarias-aereo", label: "Correos Express Islas Canarias Aereo", code: "68" },
    { id: "cex-canarias-maritimo", label: "Correos Express Islas Canarias Maritimo", code: "69" },
    { id: "cex-islas-express", label: "Correos Express Islas Express", code: "26" },
    { id: "cex-islas-documentacion", label: "Correos Express Islas Documentacion", code: "46" },
    { id: "cex-islas-maritimo", label: "Correos Express Islas Maritimo", code: "79" },
    { id: "cex-internacional-standard", label: "Correos Express Internacional Estandar", code: "90" },
    { id: "cex-internacional-express", label: "Correos Express Internacional Express", code: "91" },
  ];
}

function buildShipmentPayload(
  sender: CorreosExpressSender,
  requester: string,
  requesterPassword: string,
  input: CorreosExpressShipmentRequest,
  productCode: string,
  labelType = "1",
) {
  const packages = input.packages.length ? input.packages : [{ weight: 1 }];
  const totalWeight = packages.reduce((total, parcel) => total + Number(parcel.weight || 0), 0);
  return {
    solicitante: trimLen(requester, 100),
    canalEntrada: "",
    numEnvio: "",
    ref: trimLen(input.reference, 30),
    refCliente: trimLen(input.reference, 30),
    fecha: formatCexDate(new Date()),
    codRte: onlyDigits(sender.code).slice(0, 9),
    nomRte: trimLen(sender.name, 40),
    nifRte: trimLen(sender.nif || "", 20),
    dirRte: trimLen(sender.address, 300),
    pobRte: trimLen(sender.town, 40),
    codPosNacRte: sender.countryCode === "ES" ? onlyDigits(sender.postalCode).slice(0, 5) : "",
    paisISORte: sender.countryCode,
    codPosIntRte: sender.countryCode === "ES" ? "" : trimLen(sender.postalCode, 7),
    contacRte: trimLen(sender.contact || sender.name, 40),
    telefRte: trimLen(normalizePhone(sender.phone), 15),
    emailRte: trimLen(sender.email || "", 75),
    codDest: "",
    nomDest: trimLen(input.destination.name, 40),
    nifDest: "",
    dirDest: trimLen(input.destination.address, 300),
    pobDest: trimLen(input.destination.town, 40),
    codPosNacDest: (input.destination.countryCode || "ES") === "ES" ? onlyDigits(input.destination.postalCode).slice(0, 5) : "",
    paisISODest: input.destination.countryCode || "ES",
    codPosIntDest: (input.destination.countryCode || "ES") === "ES" ? "" : trimLen(input.destination.postalCode, 7),
    contacDest: trimLen(input.destination.name, 40),
    telefDest: trimLen(normalizePhone(input.destination.phone), 15),
    emailDest: trimLen(input.destination.email || "", 75),
    contacOtrs: "",
    telefOtrs: "",
    emailOtrs: "",
    observac: trimLen(input.observations || "", 80),
    numBultos: String(packages.length),
    kilos: formatDecimal(totalWeight || 1),
    volumen: "",
    alto: "",
    largo: "",
    ancho: "",
    producto: productCode,
    portes: "P",
    reembolso: "",
    entrSabado: "",
    seguro: "",
    numEnvioVuelta: "",
    listaBultos: packages.map((parcel, index) => ({
      alto: parcel.height ? formatDecimal(Number(parcel.height) / 100) : "",
      ancho: parcel.width ? formatDecimal(Number(parcel.width) / 100) : "",
      codBultoCli: "",
      codUnico: "",
      descripcion: "",
      kilos: parcel.weight ? formatDecimal(parcel.weight) : "",
      largo: parcel.length ? formatDecimal(Number(parcel.length) / 100) : "",
      observaciones: "",
      orden: String(index + 1),
      referencia: trimLen(input.reference, 20),
      volumen: "",
    })),
    password: requesterPassword,
    listaInformacionAdicional: [{ tipoEtiqueta: labelType, etiquetaPDF: "N" }],
  };
}

function validateShipmentInput(input: CorreosExpressShipmentRequest) {
  const missing = [
    ["referencia", input.reference],
    ["servicio", input.service],
    ["destinatario", input.destination?.name],
    ["direccion", input.destination?.address],
    ["poblacion", input.destination?.town],
    ["telefono", input.destination?.phone],
  ].filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
  const countryCode = input.destination?.countryCode || "ES";
  if (countryCode === "ES" && !/^\d{5}$/.test(onlyDigits(input.destination?.postalCode || ""))) missing.push("codigo postal nacional de 5 digitos");
  if (countryCode !== "ES" && !String(input.destination?.postalCode || "").trim()) missing.push("codigo postal internacional");
  if (!input.packages?.length) missing.push("bultos");
  if (input.packages?.some((parcel) => !Number.isFinite(Number(parcel.weight)) || Number(parcel.weight) <= 0)) missing.push("peso de bulto");
  if (resolveProductCode(input.service) === "90" && input.packages.length !== 1) missing.push("servicio internacional 90 inicialmente monobulto");
  if (input.customs?.required && !input.customs.complete) {
    const detail = input.customs.missing?.length ? `: ${input.customs.missing.join(", ")}` : "";
    throw new Error(`No se crea etiqueta Correos Express: documentacion aduanera incompleta${detail}`);
  }
  if (missing.length) throw new Error(`No se crea etiqueta Correos Express. Faltan datos obligatorios: ${missing.join(", ")}`);
}

function resolveProductCode(service: string) {
  const code = PRODUCT_CODES[service] || service;
  if (!/^\d{2}$/.test(code)) throw new Error(`Falta mapear el producto Correos Express para el servicio ${service}`);
  return code;
}

function extractTransportLabel(body: Record<string, unknown>) {
  const labels = Array.isArray(body.listaEtiquetas) ? body.listaEtiquetas : [];
  for (const label of labels) {
    const value = (label || {}) as Record<string, unknown>;
    const pdf = String(value.DevuelveEtiquetaPdf || value.devuelveEtiquetaPdf || value.etiquetaPdf || "");
    if (pdf) return normalizeCorreosExpressPdfBase64(pdf);
  }
  const direct = String(body.DevuelveEtiquetaPdf || body.devuelveEtiquetaPdf || body.etiquetaPdf || "");
  if (direct) return normalizeCorreosExpressPdfBase64(direct);
  throw new Error(extractErrorMessage(body) || "Correos Express no ha devuelto PDF de etiqueta");
}

function extractEmbeddedLabel(body: Record<string, unknown>) {
  const labels = Array.isArray(body.etiqueta) ? body.etiqueta : [];
  for (const label of labels) {
    const value = (label || {}) as Record<string, unknown>;
    const pdf = String(value.etiqueta1 || value.etiqueta2 || value.DevuelveEtiquetaPdf || "");
    if (pdf && /^[A-Za-z0-9+/=]+$/.test(pdf) && pdf.length > 1000) return normalizeCorreosExpressPdfBase64(pdf);
  }
  return undefined;
}

export function normalizeCorreosExpressPdfBase64(value: string) {
  const compact = value.replace(/\s+/g, "");
  const decoded = Buffer.from(compact, "base64");
  if (decoded.subarray(0, 5).toString("utf8") === "%PDF-") return fitPdfBase64ToPortrait(compact);
  const nested = decoded.toString("utf8").replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(nested)) {
    const nestedDecoded = Buffer.from(nested, "base64");
    if (nestedDecoded.subarray(0, 5).toString("utf8") === "%PDF-") return fitPdfBase64ToPortrait(nested);
  }
  return compact;
}

function fitPdfBase64ToPortrait(base64: string) {
  const buffer = Buffer.from(base64, "base64");
  const source = buffer.toString("latin1");
  const objectRanges = findPdfObjects(buffer);
  const pageObjectRange = objectRanges.find((object) =>
    /\/Type\s*\/Page\b/.test(buffer.subarray(object.start, object.end).toString("latin1")),
  );
  if (!pageObjectRange) return base64;
  const pageObjectSource = buffer.subarray(pageObjectRange.start, pageObjectRange.end).toString("latin1");
  const mediaBox = pageObjectSource.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!mediaBox || Number(mediaBox[1]) <= Number(mediaBox[2])) return base64;
  const pageMatch = pageObjectSource.match(/(\d+)\s+0\s+obj\s*(<<[\s\S]*?>>)\s*endobj/);
  const contentsMatch = pageMatch?.[2].match(/\/Contents\s+(\d+)\s+0\s+R/);
  const sizeMatch = source.match(/trailer\s*<<[\s\S]*?\/Size\s+(\d+)/);
  const rootMatch = source.match(/trailer\s*<<[\s\S]*?\/Root\s+(\d+\s+\d+\s+R)/);
  const infoMatch = source.match(/trailer\s*<<[\s\S]*?\/Info\s+(\d+\s+\d+\s+R)/);
  if (!pageMatch || !contentsMatch || !sizeMatch || !rootMatch) return base64;
  const originalContent = extractPdfStream(buffer, Number(contentsMatch[1]));
  if (!originalContent) return base64;
  const width = Number(mediaBox[1]);
  const height = Number(mediaBox[2]);
  const scale = 0.94;
  const xOffset = height - 8;
  const yOffset = Math.max(8, (width - (width * scale)) / 2);
  const transformedContent = zlib.deflateSync(Buffer.concat([
    Buffer.from(`q\n0 ${scale} -${scale} 0 ${xOffset} ${yOffset} cm\n`, "latin1"),
    originalContent,
    Buffer.from("\nQ\n", "latin1"),
  ]));
  if (!objectRanges.length) return base64;
  const newContentObjectNumber = Math.max(Number(sizeMatch[1]), ...objectRanges.map((object) => object.number + 1));
  const pageObject = pageMatch[2]
    .replace(/\/MediaBox\s*\[[^\]]+\]/, `/MediaBox[0 0 ${height} ${width}]`)
    .replace(/\/Rotate\s+\d+\s*/, "")
    .replace(/\/Contents\s+\d+\s+0\s+R/, `/Contents ${newContentObjectNumber} 0 R`);
  const newContentObject = Buffer.concat([
    Buffer.from(`${newContentObjectNumber} 0 obj\n<</Length ${transformedContent.length}/Filter/FlateDecode>>\nstream\n`, "latin1"),
    transformedContent,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
  ]);
  const replacementObjects = new Map<number, Buffer>([
    [Number(pageMatch[1]), Buffer.from(`${pageMatch[1]} 0 obj\n${pageObject}\nendobj\n`, "latin1")],
    [newContentObjectNumber, newContentObject],
  ]);
  const offsets = new Map<number, number>();
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  for (const object of objectRanges) {
    const replacement = replacementObjects.get(object.number);
    const objectBuffer = replacement || buffer.subarray(object.start, object.end);
    offsets.set(object.number, Buffer.concat(parts).length);
    parts.push(objectBuffer, Buffer.from("\n", "latin1"));
    replacementObjects.delete(object.number);
  }
  for (const [number, objectBuffer] of [...replacementObjects.entries()].sort((left, right) => left[0] - right[0])) {
    offsets.set(number, Buffer.concat(parts).length);
    parts.push(objectBuffer, Buffer.from("\n", "latin1"));
  }
  const xrefOffset = Buffer.concat(parts).length;
  const size = Math.max(newContentObjectNumber + 1, ...offsets.keys()) + 1;
  const trailerInfo = infoMatch ? `/Info ${infoMatch[1]}` : "";
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber < size; objectNumber += 1) {
    const offset = offsets.get(objectNumber);
    xref += offset === undefined ? "0000000000 65535 f \n" : `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<</Size ${size}/Root ${rootMatch[1]}${trailerInfo}>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts).toString("base64");
}

function extractPdfStream(buffer: Buffer, objectNumber: number) {
  const source = buffer.toString("latin1");
  const objectMatch = source.match(new RegExp(`${objectNumber} 0 obj[\\s\\S]*?stream\\r?\\n([\\s\\S]*?)\\r?\\nendstream[\\s\\S]*?endobj`));
  if (!objectMatch) return null;
  const streamStart = source.indexOf(objectMatch[1]);
  const stream = buffer.subarray(streamStart, streamStart + Buffer.byteLength(objectMatch[1], "latin1"));
  return /\/FlateDecode/.test(objectMatch[0]) ? zlib.inflateSync(stream) : stream;
}

function findPdfObjects(buffer: Buffer) {
  const source = buffer.toString("latin1");
  const objects: Array<{ number: number; start: number; end: number }> = [];
  for (const match of source.matchAll(/(\d+)\s+0\s+obj[\s\S]*?endobj/g)) {
    objects.push({
      number: Number(match[1]),
      start: match.index || 0,
      end: (match.index || 0) + Buffer.byteLength(match[0], "latin1"),
    });
  }
  return objects.sort((left, right) => left.number - right.number);
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Correos Express no ha devuelto JSON valido: ${value.slice(0, 500)}`);
  }
}

function extractErrorMessage(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const value = body as Record<string, unknown>;
  return String(value.mensajeRetorno || value.message || value.error || "").trim();
}

function assertProductionAllowed(url: string, productionEnabled: boolean) {
  if (isProductionEndpoint(url) && !productionEnabled) {
    throw new Error("Correos Express produccion bloqueado: configura CEX_PRODUCTION_ENABLED=true solo despues de validacion y OK explicito.");
  }
}

function postJsonHttp(
  targetUrl: string,
  payload: unknown,
  options: { username: string; password: string; allowSelfSignedCertificate: boolean },
) {
  const parsed = new URL(targetUrl);
  const body = JSON.stringify(payload);
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = https.request({
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      port: parsed.port ? Number(parsed.port) : 443,
      method: "POST",
      rejectUnauthorized: !options.allowSelfSignedCertificate,
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`,
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/json; charset=utf-8",
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => resolve({ status: response.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function isProductionEndpoint(url: string) {
  return /www\.cexpr\.es/i.test(url) && !/www\.test\.cexpr\.es/i.test(url);
}

function isTestEndpoint(url: string) {
  return /www\.test\.cexpr\.es/i.test(url);
}

function trimLen(value: string, max: number) {
  return String(value || "").trim().slice(0, max);
}

function onlyDigits(value: string) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizePhone(value: string) {
  return onlyDigits(value).slice(-15);
}

function formatDecimal(value: number) {
  return Number(value || 0).toFixed(3).replace(/\.?0+$/, "");
}

function formatCexDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}${date.getFullYear()}`;
}
import https from "node:https";
