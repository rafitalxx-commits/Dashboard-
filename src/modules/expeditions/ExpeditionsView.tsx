import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  CheckCircle2,
  CircleAlert,
  PackageCheck,
  Printer,
  ScanLine,
  Settings2,
  Truck,
} from "lucide-react";
import "./expeditions.css";
import "./settingsDemo.css";
import { odooClient } from "../../services/odooClient";
import type { Order } from "../../services/odooTypes";
import { ShippingRulesManager } from "./ShippingRulesManager";
import { downloadWorkerQr as downloadWorkerQrFile } from "./workerQr";

type Mode = "automatic" | "manual";
type Parcel = { id: number; weight: string; length: string; width: string; height: string };
type Shipment = { code: string; tracking: string; carrier: string; service: string; printedAt: string };
type GeneiQuote = { id_agencia: string | number; nombre_agencia: string; importe: number; importe_sin_iva?: number; iva?: number; servicio_horas?: string };
type DestinationDraft = { name: string; address: string; postalCode: string; town: string; country: string; phone: string; email: string };
type LabelDelivery = "download" | "inline-print" | "popup";
type LabelCarrier = "genei" | "mrw" | "correos-express" | "dhl";
type LabelPrinterTarget = { id: string; label: string; printerName?: string };
type OperationProgress = { title: string; detail: string };
type QzTrayApi = {
  configs: { create: (printerName: string, options?: Record<string, unknown>) => unknown };
  print: (config: unknown, data: unknown[]) => Promise<void>;
  printers?: { find: () => Promise<string[]> };
  security?: {
    setCertificatePromise: (promiseFactory: (resolve: (certificate: string) => void, reject: (error: Error) => void) => void) => void;
    setSignatureAlgorithm?: (algorithm: string) => void;
    setSignaturePromise: (promiseFactory: (toSign: string) => (resolve: (signature: string) => void, reject: (error: Error) => void) => void) => void;
  };
  websocket: { connect: (options?: Record<string, unknown>) => Promise<void>; isActive: () => boolean };
};
type GeneratedShippingLabelRecord = {
  shipmentCode: string;
  createdAt: string;
  updatedAt?: string;
  orderRefs: string[];
  source?: string;
  externalOrderRef?: string;
  odooOrderRef?: string;
  tracking?: string;
  trackingUrl?: string;
  shipper?: string;
  carrierStatus?: string;
  client?: string;
  user?: string;
  operator?: string;
  reissuedFrom?: string;
  reissuedAt?: string;
  reissuedBy?: string;
  reissueReason?: string;
  trackingCountry?: string;
  trackingPostalCode?: string;
  trackingAddress?: string;
};
type HistoryFilters = {
  query: string;
  client: string;
  odooRef: string;
  reference: string;
  shipper: string;
  from: string;
  to: string;
  operator: string;
  limit: string;
};
type PrestashopTrackingRecord = {
  status: "PENDING" | "SYNCED" | "ERROR";
  trackingNumber: string;
  provider: string;
  syncedAt?: string;
  lastRunAt?: string;
  lastError?: string;
  attempts: number;
};
type ShippingConnector = "genei" | "sendcloud";
type ShippingRule = {
  id: string;
  name: string;
  active: boolean;
  connector: ShippingConnector;
  countries: string[];
  serviceFilter: string;
  selection: "cheapest";
  priority: number;
};
type ExpeditionsSettings = {
  connectors: Array<{ id: ShippingConnector; label: string; active: boolean; ready: boolean }>;
  rules: ShippingRule[];
  updatedAt: string;
};
type AmazonShipmentRecord = {
  id: string;
  saleOrderName: string;
  marketplaceId: string;
  geneiShipmentCode?: string;
  amazonOrderId: string;
  tracking: string;
  trackingUrl?: string;
  carrier: string;
  status: "pending" | "sent" | "error" | "retrying";
  dryRun: boolean;
  retries: number;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  lastError?: string;
};
type TransportRuleResolution = {
  appliedRule: { id: string; name: string; isDefault?: boolean } | null;
  carrier: string;
  service: string;
  usedDefault: boolean;
  evaluations?: Array<{ ruleId: string; matched: boolean }>;
};
type ManualRuleOption = { id: string; name: string; active: boolean; carrier: string; service: string; isDefault?: boolean };
type WarehouseWorker = { id: string; code: string; name: string; active: boolean; createdAt: string; updatedAt: string };
type DestinationOverride = { orderRef: string; destination: DestinationDraft; createdAt: string; updatedAt: string };

const automaticParcel: Parcel = { id: 1, weight: "1", length: "30", width: "20", height: "15" };
const emptyDestination: DestinationDraft = { name: "", address: "", postalCode: "", town: "", country: "", phone: "", email: "" };
const labelPrinterStorageKey = "expeditions.labelPrinter";
const labelPrinterTargets: LabelPrinterTarget[] = [
  { id: "portatilhp-zdesigner", label: "ZDesigner GC420d", printerName: "\\\\portatilhp\\ZDesigner GC420d (EPL)" },
  { id: "hpamd-honeywell", label: "Honeywell PC42d", printerName: "\\\\HPAMD\\Honeywell PC42d (203 dpi)" },
  { id: "browser", label: "Dialogo navegador" },
];
const defaultLabelPrinterId = labelPrinterTargets[0].id;
const defaultHistoryFilters: HistoryFilters = {
  query: "",
  client: "",
  odooRef: "",
  reference: "",
  shipper: "",
  from: "",
  to: "",
  operator: "",
  limit: "100",
};
const defaultExpeditionsSettings: ExpeditionsSettings = {
  connectors: [
    { id: "genei", label: "Genei", active: true, ready: true },
    { id: "sendcloud", label: "Sendcloud", active: false, ready: false },
  ],
  rules: [
    { id: "rule-fedex-eu", name: "Union Europea", active: true, connector: "genei", countries: ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "RO", "SK", "SI", "SE"], serviceFilter: "FEDEX|GLOBAL EXPRESS", selection: "cheapest", priority: 1 },
    { id: "rule-default", name: "Resto de destinos", active: true, connector: "genei", countries: [], serviceFilter: "", selection: "cheapest", priority: 99 },
  ],
  updatedAt: "",
};
const testOrder: Order = {
  id: "406-1883201-3960349", odooRef: "406-1883201-3960349", date: "", client: "Alouani aicha", channel: "Amazon · Prueba Genei", deliveryPrinted: false, total: 0, taxTotal: 0, status: "Prueba", invoiceStatus: "Sin factura", deliveryStatus: "Etiqueta real pendiente de abono", city: "Messina, Italia", shippingAddress: "Via vecchia comunale scala ritiro 5", shippingPhone: "+39 339 771 0152", shippingEmail: "wh0qf2x18wpvmgt@marketplace.amazon.it", shippingPostalCode: "98152", shippingCountryCode: "IT", items: [{ sku: "TEST-BOX", name: "Bulto de prueba", quantity: 1, price: 0, stock: 1 }],
};

const demoOrder = {
  reference: "AMZ-2026-1001",
  customer: "Sophie Martin",
  country: "Francia",
  countryCode: "FR",
  address: "18 Rue de la Paix, 75002 Paris",
  channel: "Amazon FBM",
  items: "2 productos · 1,35 kg estimados",
};

function normalizeReference(value?: string) {
  return normalizeScanReference(value).toUpperCase();
}

function normalizeScanReference(value?: string) {
  const compact = (value || "").trim().replace(/[‘’'`´]/g, "-").replace(/\s+/g, "");
  return /^\d{17}$/.test(compact)
    ? `${compact.slice(0, 3)}-${compact.slice(3, 10)}-${compact.slice(10)}`
    : compact;
}

function isSameOrderReference(reference: string, order: Order) {
  const normalized = normalizeReference(reference);
  return [order.odooRef, order.id, order.externalRef]
    .map(normalizeReference)
    .filter(Boolean)
    .includes(normalized);
}

function isPreparedOrderReference(reference: string, order: Order, preparedReference: string) {
  return (
    isSameOrderReference(reference, order) ||
    normalizeReference(reference) === normalizeReference(preparedReference)
  );
}

function getMissingDestinationFields(destination: DestinationDraft) {
  const labels: Array<[keyof DestinationDraft, string]> = [
    ["name", "nombre"],
    ["address", "direccion/calle"],
    ["postalCode", "CP"],
    ["town", "ciudad"],
    ["country", "pais"],
    ["phone", "telefono"],
    ["email", "email"],
  ];
  return labels.filter(([field]) => !destination[field].trim()).map(([, label]) => label);
}

function getDhlDestinationLimitIssues(destination: DestinationDraft) {
  const limits: Array<[keyof DestinationDraft, string, number]> = [["name", "Nombre", 40], ["address", "Dirección", 80], ["town", "Población", 20], ["postalCode", "Código postal", 9], ["email", "Email", 50]];
  return limits.filter(([field, , limit]) => destination[field].trim().length > limit).map(([field, label, limit]) => `${label}: ${destination[field].trim().length}/${limit}`);
}

function resolveOrderCountryCode(order: Order) {
  const explicit = String(order.shippingCountryCode || "").trim().toUpperCase();
  if (explicit) return explicit;
  return inferCountryCodeFromDestination([order.city, order.shippingAddress].filter(Boolean).join(", "));
}

function inferCountryCodeFromDestination(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const countryNames: Record<string, string> = {
    AUSTRIA: "AT",
    ALEMANIA: "DE",
    BELGICA: "BE",
    BELGIUM: "BE",
    BULGARIA: "BG",
    CHIPRE: "CY",
    CROACIA: "HR",
    CROATIA: "HR",
    CYPRUS: "CY",
    CZECHIA: "CZ",
    "CZECH REPUBLIC": "CZ",
    DANMARK: "DK",
    DENMARK: "DK",
    DINAMARCA: "DK",
    ESLOVAQUIA: "SK",
    ESLOVENIA: "SI",
    ESPANA: "ES",
    ESTONIA: "EE",
    FINLAND: "FI",
    FINLANDIA: "FI",
    FRANCE: "FR",
    FRANCIA: "FR",
    GERMANY: "DE",
    GRECIA: "GR",
    GREECE: "GR",
    HUNGARY: "HU",
    HUNGRIA: "HU",
    IRELAND: "IE",
    IRLANDA: "IE",
    ITALIA: "IT",
    ITALY: "IT",
    LATVIA: "LV",
    LETONIA: "LV",
    LITHUANIA: "LT",
    LITUANIA: "LT",
    LUXEMBOURG: "LU",
    LUXEMBURGO: "LU",
    MALTA: "MT",
    NETHERLANDS: "NL",
    "PAISES BAJOS": "NL",
    POLAND: "PL",
    POLONIA: "PL",
    PORTUGAL: "PT",
    "REPUBLICA CHECA": "CZ",
    ROMANIA: "RO",
    RUMANIA: "RO",
    SLOVAKIA: "SK",
    SLOVENIA: "SI",
    SPAIN: "ES",
    SWEDEN: "SE",
    SWITZERLAND: "CH",
    SUECIA: "SE",
    SUIZA: "CH",
  };
  for (const [name, code] of Object.entries(countryNames)) {
    if (new RegExp(`(^|[,\\s])${name}($|[,\\s])`).test(normalized)) return code;
  }
  return "";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

async function downloadPdfFromBackend(path: string, fallbackFilename: string) {
  const response = await fetch(apiPath(path));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || "No se pudo descargar la etiqueta");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filenameFromDisposition(response.headers.get("Content-Disposition")) || fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(disposition: string | null) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || "";
}

function pdfBase64ToObjectUrl(base64: string) {
  const cleanBase64 = base64.replace(/^data:application\/pdf;base64,/, "");
  const bytes = Uint8Array.from(atob(cleanBase64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function printPdfInCurrentTab(base64: string, shipmentCode: string) {
  return new Promise<void>((resolve, reject) => {
    const url = pdfBase64ToObjectUrl(base64);
    const frame = document.createElement("iframe");
    frame.title = `Etiqueta Genei ${shipmentCode}`;
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";
    frame.style.opacity = "0";
    frame.onload = () => {
      window.setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          window.setTimeout(() => {
            frame.remove();
            URL.revokeObjectURL(url);
          }, 60_000);
        }
      }, 350);
    };
    frame.onerror = () => {
      frame.remove();
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo preparar la etiqueta para imprimir"));
    };
    frame.src = url;
    document.body.appendChild(frame);
  });
}

let qzTrayScriptPromise: Promise<void> | null = null;
let qzSecurityConfigured = false;

function loadQzTrayScript() {
  if (window.qz) return Promise.resolve();
  if (!qzTrayScriptPromise) {
    qzTrayScriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.getElementById("qz-tray-script") as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("No se pudo cargar QZ Tray en el navegador")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.id = "qz-tray-script";
      script.src = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar QZ Tray en el navegador"));
      document.head.appendChild(script);
    });
  }
  return qzTrayScriptPromise;
}

async function readJsonResponse<T extends { message?: string }>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return { message: `Respuesta vacia del servidor (${response.status})` } as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { message: `Respuesta no JSON del servidor (${response.status})` } as T;
  }
}

async function connectQzTray() {
  await loadQzTrayScript();
  const qz = window.qz;
  if (!qz) throw new Error("QZ Tray no esta disponible en este navegador");
  configureQzSecurity(qz);
  if (qz.websocket.isActive()) return qz;

  const hosts = ["localhost", "127.0.0.1", "localhost.qz.io"];
  const attempts = [
    { label: "seguro", usingSecure: true },
    { label: "local no seguro", usingSecure: false },
  ];
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      await withTimeout(
        qz.websocket.connect({
          delay: 1,
          host: hosts,
          retries: 1,
          usingSecure: attempt.usingSecure,
        }),
        12_000,
        `QZ no responde en modo ${attempt.label}`,
      );
      return qz;
    } catch (error) {
      errors.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

async function listQzPrinters(qz: QzTrayApi) {
  if (!qz.printers?.find) return [];
  const printers = await withTimeout(qz.printers.find(), 10_000, "QZ no ha devuelto la lista de impresoras");
  return Array.from(new Set(printers.map((printer) => printer.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function configureQzSecurity(qz: QzTrayApi) {
  if (qzSecurityConfigured || !qz.security) return;
  qz.security.setCertificatePromise((resolve, reject) => {
    fetch(apiPath("/api/qz/certificate"), { cache: "no-store" })
      .then((response) => response.ok ? response.text() : Promise.reject(new Error(`QZ certificate ${response.status}`)))
      .then(resolve)
      .catch((error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
  qz.security.setSignatureAlgorithm?.("SHA512");
  qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
    fetch(apiPath("/api/qz/sign"), {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: toSign,
      cache: "no-store",
    })
      .then((response) => response.ok ? response.text() : Promise.reject(new Error(`QZ signature ${response.status}`)))
      .then(resolve)
      .catch((error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
  qzSecurityConfigured = true;
}

async function printPdfWithQzTray(base64: string, shipmentCode: string, printerName: string) {
  const qz = await connectQzTray();
  const config = qz.configs.create(printerName, {
    colorType: "grayscale",
    interpolation: "nearest-neighbor",
    jobName: `Etiqueta ${shipmentCode}`,
    margins: 0,
    orientation: "portrait",
    scaleContent: true,
    size: { width: 100, height: 150 },
    units: "mm",
  });
  await withTimeout(
    qz.print(config, [{
      type: "pixel",
      format: "pdf",
      flavor: "base64",
      data: base64.replace(/^data:application\/pdf;base64,/, ""),
      options: { ignoreTransparency: true },
    }]),
    25_000,
    `QZ no ha confirmado la impresion en ${printerName}`,
  );
}

/** Shared direct-print path. The selected printer is stored per browser/device. */
export function getSavedQzLabelPrinter() {
  const id = localStorage.getItem(labelPrinterStorageKey) || defaultLabelPrinterId;
  if (id.startsWith("qz:")) return id.slice(3);
  return labelPrinterTargets.find((target) => target.id === id)?.printerName || "";
}

/** Shared QZ controls for label modules. The choice is deliberately local to each workstation. */
export async function probeQzLabelPrinters() {
  return listQzPrinters(await connectQzTray());
}

export function saveQzLabelPrinter(printerName: string) {
  if (printerName.trim()) localStorage.setItem(labelPrinterStorageKey, `qz:${printerName.trim()}`);
  else localStorage.removeItem(labelPrinterStorageKey);
}

export async function printHtmlLabelWithQzTray(html: string, jobName: string, printerName: string) {
  if (!printerName) throw new Error("No hay impresora QZ asignada en este dispositivo");
  const qz = await connectQzTray();
  const config = qz.configs.create(printerName, {
    jobName,
    bounds: { x: 0, y: 0, width: 57, height: 33 },
    margins: 0,
    orientation: "portrait",
    // Product and location HTML already define an exact 57 × 33 mm canvas.
    // Letting QZ resize it again was producing clipping on thermal label printers.
    scaleContent: false,
    size: { width: 57, height: 33, custom: true },
    units: "mm",
  });
  await withTimeout(qz.print(config, [{ type: "html", format: "plain", data: html }]), 25_000, `QZ no ha confirmado la impresión en ${printerName}`);
}

/** Fixed-ratio image labels avoid the HTML page-margin differences between QZ JavaFX and browsers. */
export async function printImageLabelWithQzTray(dataUrl: string, jobName: string, printerName: string) {
  if (!printerName) throw new Error("No hay impresora QZ asignada en este dispositivo");
  const qz = await connectQzTray();
  const config = qz.configs.create(printerName, {
    jobName,
    bounds: { x: 0, y: 0, width: 57, height: 33 },
    margins: 0,
    orientation: "portrait",
    scaleContent: true,
    size: { width: 57, height: 33, custom: true },
    units: "mm",
  });
  await withTimeout(qz.print(config, [{
    type: "pixel",
    format: "image",
    flavor: "base64",
    data: dataUrl.replace(/^data:image\/(?:png|jpeg);base64,/, ""),
  }]), 25_000, `QZ no ha confirmado la impresión en ${printerName}`);
}

declare global {
  interface Window {
    qz?: QzTrayApi;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getGeneiShipmentCode(shipment?: Record<string, unknown> | null) {
  if (!shipment) return "";
  return String(
    shipment.reference ||
      shipment.shipmentCode ||
      shipment.codigo_envio ||
      shipment.codigoEnvio ||
      shipment.code ||
      "",
  );
}

function getCarrierFromLabelRecord(label?: GeneratedShippingLabelRecord | null): LabelCarrier {
  const carrierText = [
    label?.source,
    label?.shipper,
    label?.carrierStatus,
    label?.tracking,
    label?.shipmentCode,
  ].join(" ").toLowerCase();
  if (carrierText.includes("dhl")) return "dhl";
  if (carrierText.includes("correos-express") || carrierText.includes("correos express") || carrierText.includes("cex-")) return "correos-express";
  if (carrierText.includes("mrw") || /\b0{2,}\d{8,}\b/.test(carrierText)) return "mrw";
  return "genei";
}

function getGeneiShipmentCreatedAt(shipment?: Record<string, unknown> | null) {
  return formatExistingLabelDate(getGeneiShipmentCreatedAtRaw(shipment));
}

function getGeneiShipmentCreatedAtRaw(shipment?: Record<string, unknown> | null) {
  if (!shipment) return "";
  return String(
    shipment.createdAt ||
      shipment.created_at ||
      shipment.dateCreated ||
      shipment.fecha_creacion ||
      shipment.fechaCreacion ||
      shipment.fecha_alta ||
      shipment.created ||
      shipment.date ||
      "",
  );
}

function getGeneiTrackingNumber(shipment?: Record<string, unknown> | null) {
  if (!shipment) return "";
  return String(
    shipment.codigo_seguimiento ||
      shipment.trackingNumber ||
      shipment.tracking_number ||
      shipment.tracking ||
      shipment.codigo_bulto ||
      "",
  ).trim();
}

function getGeneiTrackingUrl(shipment?: Record<string, unknown> | null) {
  if (!shipment) return "";
  return String(shipment.trackingUrl || shipment.web_seguimiento || shipment.tracking_url || "").trim();
}

function buildPublicTrackingUrl(input: { tracking: string; shipper?: string; status?: string; trackingUrl?: string; trackingCountry?: string; trackingPostalCode?: string; trackingAddress?: string }) {
  const query = new URLSearchParams({ tracking_number: input.tracking });
  if (input.shipper && input.shipper !== "-") query.set("carrier", input.shipper);
  if (input.status && input.status !== "-") query.set("status", input.status);
  if (input.trackingUrl) query.set("official_url", input.trackingUrl);
  if (input.trackingCountry) query.set("country", input.trackingCountry);
  if (input.trackingPostalCode) query.set("postal_code", input.trackingPostalCode);
  if (input.trackingAddress) query.set("delivery_address", input.trackingAddress);
  return `/seguimiento/?${query}`;
}

function getGeneiCarrierName(shipment?: Record<string, unknown> | null) {
  if (!shipment) return "";
  return String(shipment.nombre_agencia || shipment.carrier || shipment.carrierName || "Genei").trim();
}

function getGeneiCarrierStatus(shipment?: Record<string, unknown> | null) {
  if (!shipment) return "";
  return String(
    shipment.estado ||
      shipment.status ||
      shipment.estado_envio ||
      shipment.shipmentStatus ||
      shipment.trackingStatus ||
      "",
  ).trim();
}

function getCarrierFromText(value?: string | null): LabelCarrier | "" {
  const carrierText = String(value || "").toLowerCase();
  if (carrierText.includes("dhl")) return "dhl";
  if (carrierText.includes("correos-express") || carrierText.includes("correos express") || carrierText.includes("cex")) return "correos-express";
  if (carrierText.includes("mrw")) return "mrw";
  if (carrierText.includes("genei") || carrierText.includes("global express")) return "genei";
  return "";
}

function getOrderExternalRef(order: Order) {
  return order.externalRef || (/^\d{3}-\d{7}-\d{7}$/.test(order.id) ? order.id : "");
}

function getDhlLabelReference(order: Order) {
  const external = (order.externalRef || "").trim();
  if (/^\d{3}-\d{7}-\d{7}$/.test(external)) return external;
  if (isPrestashopOrder(order) && external) return external;
  return order.id || order.odooRef;
}

function isPrestashopOrder(order?: Order | null) {
  return /website|webside|prestashop|presta/i.test(order?.channel || "");
}

function getPrestashopOrderId(order?: Order | null) {
  const externalRef = (order?.externalRef || "").trim();
  return /^\d+$/.test(externalRef) ? externalRef : "";
}

function formatExistingLabelDate(value: string) {
  if (!value.trim()) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function showExistingLabelWarning(shipmentCode: string, createdAt?: string) {
  const createdText = createdAt
    ? `\nGenerada: ${createdAt}`
    : "\nFecha de generacion: no devuelta por Genei";
  window.alert(`Etiqueta Genei ya generada: ${shipmentCode}${createdText}\n\nNo se reimprime automaticamente por seguridad. Si necesitas otra copia, pulsa "Imprimir etiqueta" manualmente.`);
}

async function findExistingGeneiShipment(order: Order) {
  const references = getOrderLabelReferences(order);
  const results = await Promise.all(
    references.map((reference) =>
      apiFetch(`/api/genei/shipments/external/${encodeURIComponent(reference)}`)
      .then(async (response) => (response.ok ? response.json() : null))
      .catch(() => null) as Promise<{ shipment?: Record<string, unknown> } | null>,
    ),
  );
  return results.find((known) => getGeneiShipmentCode(known?.shipment)) ?? null;
}

async function fetchGeneiShipmentDetailsWithTracking(shipmentCode: string, attempts = 4) {
  let lastPayload: { shipment?: Record<string, unknown>; message?: string } | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const detailsResponse = await apiFetch(`/api/genei/shipments/${encodeURIComponent(shipmentCode)}`);
    const details = await detailsResponse.json() as { shipment?: Record<string, unknown>; message?: string };
    if (!detailsResponse.ok || !details.shipment) throw new Error(details.message || "No se pudo leer el envio Genei");
    lastPayload = details;
    if (getGeneiTrackingNumber(details.shipment) || attempt === attempts) return details.shipment;
    await wait(1_500);
  }
  return lastPayload?.shipment ?? null;
}

function getOrderLabelReferences(order: Order, labelReference?: string) {
  return Array.from(
    new Set([labelReference, order.externalRef, order.id, order.odooRef].map(normalizeScanReference).filter(Boolean)),
  );
}

async function findRecordedShippingLabel(order: Order) {
  const references = getOrderLabelReferences(order);
  const results = await Promise.all(
    references.map((reference) =>
      apiFetch(`/api/genei/labels/external/${encodeURIComponent(reference)}`)
      .then(async (response) => (response.ok ? response.json() : null))
      .catch(() => null) as Promise<{ label?: GeneratedShippingLabelRecord } | null>,
    ),
  );
  return results.find((known) => known?.label?.shipmentCode)?.label ?? null;
}

async function recordGeneratedShippingLabel(
  order: Order,
  shipmentCode: string,
  labelReference?: string,
  createdAt = new Date().toISOString(),
  details?: Partial<GeneratedShippingLabelRecord>,
) {
  const response = await apiFetch("/api/genei/labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderRefs: getOrderLabelReferences(order, labelReference),
      shipmentCode,
      createdAt,
      source: "expeditions-print",
      externalOrderRef: getOrderExternalRef(order),
      odooOrderRef: order.odooRef || order.id,
      client: order.client,
      ...details,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || "No se pudo registrar la etiqueta generada");
  }
}

async function removeGeneratedShippingLabel(shipmentCode: string, order?: Order) {
  const endpoint = order
    ? `/api/genei/labels/${encodeURIComponent(shipmentCode)}/references`
    : `/api/genei/labels/${encodeURIComponent(shipmentCode)}`;
  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: order ? { "Content-Type": "application/json" } : undefined,
    body: order ? JSON.stringify({ orderRefs: getOrderLabelReferences(order) }) : undefined,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || "No se pudo liberar la etiqueta local");
  }
}

async function resolveTransportRuleForOrder(order: Order, destination: DestinationDraft, weightKg: number, forceRuleId?: string) {
  const response = await apiFetch("/api/shipping/rules/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(forceRuleId ? { forceRuleId } : {}),
      order: {
        id: order.id,
        odooRef: order.odooRef,
        externalRef: order.externalRef,
        channel: getOrderSalesChannel(order),
        countryCode: destination.country || resolveOrderCountryCode(order),
        postalCode: destination.postalCode || order.shippingPostalCode || "",
        weightKg,
        shippingMethod: getOrderShippingMethod(order),
        items: order.items.map((item) => ({ sku: item.sku, name: item.name, quantity: item.quantity })),
      },
    }),
  });
  const payload = await readJsonResponse<TransportRuleResolution & { message?: string }>(response);
  if (!response.ok) throw new Error(payload.message || "No se pudo resolver la regla de transporte");
  return payload;
}

function getOrderSalesChannel(order: Order) {
  const channel = String(order.channel || "").trim();
  const normalized = channel.toLowerCase();
  if (normalized.startsWith("amazon")) return "Amazon";
  if (normalized.startsWith("prestashop") || normalized.startsWith("web")) return "Webside";
  if (normalized.startsWith("odoo") || normalized.startsWith("sales")) return "Sales";
  if (normalized.startsWith("leroy")) return "Leroy Merlin";
  return channel.split("·")[0]?.trim() || channel;
}

function getOrderShippingMethod(order: Order) {
  const raw = order as Order & { shippingMethod?: string; shipmentMethod?: string; deliveryMethod?: string; carrierService?: string };
  return raw.shippingMethod || raw.shipmentMethod || raw.deliveryMethod || raw.carrierService || "";
}

function shippingServiceLabel(serviceId?: string) {
  const labels: Record<string, string> = {
    "mrw-urgent-1900-expedition": "MRW Urgent 19:00 Expedition 0-80kg",
    "mrw-urgent-1400-expedition": "MRW Urgent 14:00 Expedition",
    "mrw-ecommerce": "MRW Ecommerce",
    "genei-default": "Mas barato permitido por Genei",
    "genei-global-express": "Genei: Global Express / FedEx",
    "genei-dhl": "Genei: DHL",
    "genei-correos-express": "Genei: Correos Express",
    "genei-mrw": "Genei: MRW",
    "cex-paq-10": "Correos Express PAQ 10",
    "cex-paq-14": "Correos Express PAQ 14",
    "cex-paq-24": "Correos Express PAQ 24",
    "cex-entrega-plus": "Correos Express Entrega Plus",
    "cex-paq-empresa-14": "Correos Express PAQ Empresa 14",
    "cex-epaq-24": "Correos Express ePAQ 24",
    "cex-paq-punto": "Correos Express Paq Punto",
    "cex-paq-ecommerce": "Correos Express Paq E-commerce",
    "cex-baleares-express": "Correos Express Baleares Express",
    "cex-canarias-express": "Correos Express Canarias Express",
    "cex-canarias-aereo": "Correos Express Canarias Aereo",
    "cex-canarias-maritimo": "Correos Express Canarias Maritimo",
    "cex-islas-express": "Correos Express Islas Express",
    "cex-islas-documentacion": "Correos Express Islas Documentacion",
    "cex-islas-maritimo": "Correos Express Islas Maritimo",
    "cex-internacional-standard": "Correos Express Internacional Estandar",
    "cex-internacional-express": "Correos Express Internacional Express",
    "dhl-connect-b2c": "DHL Connect B2C",
  };
  return labels[serviceId || ""] || serviceId || "Servicio sin seleccionar";
}

function resolveShippingRule(settings: ExpeditionsSettings, country: string) {
  const normalizedCountry = country.trim().toUpperCase();
  const rules = [...settings.rules].filter((rule) => rule.active).sort((left, right) => left.priority - right.priority);
  return rules.find((rule) => rule.countries.includes(normalizedCountry)) ?? rules.find((rule) => rule.countries.length === 0) ?? null;
}

function ruleCountriesText(rule: ShippingRule) {
  return rule.countries.length ? rule.countries.join(", ") : "*";
}

function normalizeCountriesInput(value: string) {
  return value.split(/[,\s]+/).map((country) => country.trim().toUpperCase()).filter(Boolean);
}

function apiPath(path: string) {
  const match = window.location.pathname.match(/^\/(expeditions-(?:lab|redesign-lab))/);
  return match ? `/${match[1]}${path}` : path;
}

function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiPath(path), init);
}

function isLabExpeditionsEnvironment() {
  return /^\/expeditions-(?:lab|redesign-lab)/.test(window.location.pathname);
}

type ExpeditionsViewProps = {
  onRefreshOrders?: () => void;
};

export function ExpeditionsView({ onRefreshOrders }: ExpeditionsViewProps) {
  const [section, setSection] = useState<"operativa" | "history" | "rules" | "station" | "integrations" | "workers">("operativa");
  const [mode, setMode] = useState<Mode>("automatic");
  const [scan, setScan] = useState("");
  const [orderFound, setOrderFound] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [quotes, setQuotes] = useState<GeneiQuote[]>([]);
  const [testShipmentCode, setTestShipmentCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [parcels, setParcels] = useState<Parcel[]>([
    automaticParcel,
  ]);
  const [selectedQuote, setSelectedQuote] = useState(0);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [existingShipmentCode, setExistingShipmentCode] = useState<string | null>(null);
  const [existingShipmentCarrier, setExistingShipmentCarrier] = useState<LabelCarrier>("genei");
  const [existingShipmentCreatedAt, setExistingShipmentCreatedAt] = useState("");
  const [reissueReason, setReissueReason] = useState("");
  const [reissueContext, setReissueContext] = useState<{ shipmentCode: string; reason: string } | null>(null);
  const [mrwReissueAvailable, setMrwReissueAvailable] = useState(false);
  const [eligibleManualRuleIds, setEligibleManualRuleIds] = useState<string[] | null>(null);
  const [amazonShipment, setAmazonShipment] = useState<AmazonShipmentRecord | null>(null);
  const [amazonShipments, setAmazonShipments] = useState<AmazonShipmentRecord[]>([]);
  const [generatedLabels, setGeneratedLabels] = useState<GeneratedShippingLabelRecord[]>([]);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(defaultHistoryFilters);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyReturned, setHistoryReturned] = useState(0);
  const [amazonLoading, setAmazonLoading] = useState(false);
  const [prestashopTracking, setPrestashopTracking] = useState<PrestashopTrackingRecord | null>(null);
  const [prestashopLoading, setPrestashopLoading] = useState(false);
  const [preparedReference, setPreparedReference] = useState("");
  const [labelReference, setLabelReference] = useState("");
  const [labelPrinterId, setLabelPrinterId] = useState(() => localStorage.getItem(labelPrinterStorageKey) || defaultLabelPrinterId);
  const [simulateLabel, setSimulateLabel] = useState(() => isLabExpeditionsEnvironment());
  const [qzPrinters, setQzPrinters] = useState<string[]>([]);
  const [validateInOdooAfterLabel, setValidateInOdooAfterLabel] = useState(true);
  const [destinationDraft, setDestinationDraft] = useState<DestinationDraft>(emptyDestination);
  const [destinationOverride, setDestinationOverride] = useState<DestinationOverride | null>(null);
  const [transportRule, setTransportRule] = useState<TransportRuleResolution | null>(null);
  const [manualRules, setManualRules] = useState<ManualRuleOption[]>([]);
  const [manualRuleId, setManualRuleId] = useState("");
  const [parcelEditorOpen, setParcelEditorOpen] = useState(false);
  const [expeditionsSettings, setExpeditionsSettings] = useState<ExpeditionsSettings>(defaultExpeditionsSettings);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [qzStatus, setQzStatus] = useState("");
  const [notice, setNotice] = useState("Listo para escanear un pedido.");
  const [operationProgress, setOperationProgress] = useState<OperationProgress | null>(null);
  const [warehouseWorkers, setWarehouseWorkers] = useState<WarehouseWorker[]>([]);
  const [activeWarehouseWorker, setActiveWarehouseWorker] = useState<WarehouseWorker | null>(null);
  const [newWorkerName, setNewWorkerName] = useState("");
  const workerExpiryRef = useRef<number | null>(null);
  const scannerBufferRef = useRef("");
  const scannerResetRef = useRef<number | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const totalWeight = useMemo(
    () => parcels.reduce((total, parcel) => total + Number(parcel.weight.replace(",", ".") || 0), 0),
    [parcels],
  );
  const missingDestinationFields = getMissingDestinationFields(destinationDraft);
  const destinationReady = missingDestinationFields.length === 0;
  const labelPrinterOptions = useMemo(() => {
    const detectedTargets = qzPrinters
      .filter((printerName) => !labelPrinterTargets.some((target) => target.printerName === printerName))
      .map((printerName) => ({ id: `qz:${printerName}`, label: printerName, printerName }));
    const savedQzPrinter = labelPrinterId.startsWith("qz:")
      ? labelPrinterId.slice(3)
      : "";
    const savedTarget = savedQzPrinter && !labelPrinterTargets.some((target) => target.printerName === savedQzPrinter) && !detectedTargets.some((target) => target.printerName === savedQzPrinter)
      ? [{ id: labelPrinterId, label: savedQzPrinter, printerName: savedQzPrinter }]
      : [];
    return [...labelPrinterTargets, ...savedTarget, ...detectedTargets];
  }, [labelPrinterId, qzPrinters]);
  const selectedPrinterTarget = labelPrinterOptions.find((printer) => printer.id === labelPrinterId) ?? labelPrinterTargets[0];
  const orderLabelHistory = useMemo(() => {
    if (!order) return [];
    const references = getOrderLabelReferences(order);
    return generatedLabels.filter((label) => label.orderRefs.some((reference) => references.includes(normalizeScanReference(reference)))).sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }, [generatedLabels, order]);
  const labelHistoryBlock = orderLabelHistory.length ? (
    <div className="label-history">
      <strong>Histórico de etiquetas</strong>
      {orderLabelHistory.map((label) => (
        <div className="label-history-row" key={label.shipmentCode}>
          <span>{label.shipper || "Transportista"} · {label.shipmentCode} · {formatExistingLabelDate(label.createdAt)}</span>
          {label.reissuedFrom ? <small>Nueva etiqueta · Reimpresa por {label.operator || "Sin dato"} · Motivo: {label.reissueReason || "Sin motivo"}</small> : label.reissuedAt ? <small>Etiqueta anterior sustituida · Reimpresa por {label.reissuedBy || "Sin dato"} · Motivo: {label.reissueReason || "Sin motivo"}</small> : <small>Etiqueta original</small>}
        </div>
      ))}
    </div>
  ) : null;

  const focusScanInput = () => {
    window.setTimeout(() => {
      scanInputRef.current?.focus();
      scanInputRef.current?.select();
    }, 50);
  };

  const clearWarehouseWorker = () => {
    if (workerExpiryRef.current) window.clearTimeout(workerExpiryRef.current);
    workerExpiryRef.current = null;
    setActiveWarehouseWorker(null);
  };

  const loadWarehouseWorkers = async () => {
    const response = await apiFetch("/api/warehouse-workers");
    if (!response.ok) return;
    const payload = await response.json() as { workers?: WarehouseWorker[] };
    setWarehouseWorkers(payload.workers || []);
  };

  const identifyWarehouseWorker = async (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;
    try {
      const response = await apiFetch(`/api/warehouse-workers/resolve/${encodeURIComponent(code)}`);
      const payload = await response.json() as { worker?: WarehouseWorker; message?: string };
      if (!response.ok || !payload.worker) throw new Error(payload.message || "QR de operario no valido");
      if (workerExpiryRef.current) window.clearTimeout(workerExpiryRef.current);
      setActiveWarehouseWorker(payload.worker);
      workerExpiryRef.current = window.setTimeout(() => {
        setActiveWarehouseWorker(null);
        setNotice("Han pasado 30 segundos. Escanea de nuevo tu QR de operario.");
        focusScanInput();
      }, 30_000);
      setScan("");
      setNotice(`${payload.worker.name} identificado. Escanea ahora el pedido (maximo 30 s).`);
      focusScanInput();
    } catch (error) { setScan(""); setNotice(error instanceof Error ? `${error.message}. Escanea un QR activo.` : "Escanea un QR de operario activo."); focusScanInput(); }
  };

  const recordWarehouseActivity = async (targetOrder: Order, carrier: string, tracking: string, result: "label-created" | "simulated-label" = "label-created") => {
    if (!activeWarehouseWorker) return;
    await apiFetch("/api/warehouse-workers/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workerId: activeWarehouseWorker.id, workerCode: activeWarehouseWorker.code, workerName: activeWarehouseWorker.name, orderRef: targetOrder.odooRef || targetOrder.id, carrier, tracking, result }) });
  };
  const recordScanAudit = async (rawReference: string, targetOrder: Order, result: "scan-accepted" | "scan-blocked-unprinted") => {
    if (!activeWarehouseWorker) return;
    await apiFetch("/api/warehouse-workers/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workerId: activeWarehouseWorker.id, workerCode: activeWarehouseWorker.code, workerName: activeWarehouseWorker.name, orderRef: targetOrder.odooRef || targetOrder.id, rawReference, resolvedOrderRef: targetOrder.id, result }) });
  };
  const simulateLabShipment = async (targetOrder: Order, carrier: string) => {
    if (!simulateLabel || !isLabExpeditionsEnvironment() || !activeWarehouseWorker) return false;
    try {
      const orderRef = targetOrder.odooRef || targetOrder.id;
      const existingResponse = await apiFetch(`/api/warehouse-workers/activity/order/${encodeURIComponent(orderRef)}`);
      const existingPayload = await existingResponse.json().catch(() => ({})) as { activity?: { workerName?: string; workerCode?: string; tracking?: string } | null };
      if (existingResponse.ok && existingPayload.activity) {
        const previous = existingPayload.activity;
        const detail = `${previous.workerName || "Operario"}${previous.workerCode ? ` (${previous.workerCode})` : ""}${previous.tracking ? ` · ${previous.tracking}` : ""}`;
        window.alert(`Este pedido ya tiene una etiqueta de prueba.\n\nGenerada por: ${detail}\n\nNo se creará una etiqueta nueva.`);
        setNotice(`Pedido ya registrado en prueba por ${detail}. No se ha creado una etiqueta duplicada.`);
        setScan("");
        focusScanInput();
        return true;
      }
      setLoading(true);
      setOperationProgress({ title: "Generando etiqueta de prueba", detail: "Sin comunicación con transportista" });
      const shipmentCode = `SIM-${activeWarehouseWorker.code}-${Date.now().toString(36).toUpperCase()}`;
      await recordWarehouseActivity(targetOrder, carrier, shipmentCode, "simulated-label");
      resetShipmentFlow(`PRUEBA: etiqueta ficticia ${shipmentCode} registrada para ${activeWarehouseWorker.name}. Escanea el QR del siguiente operario.`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? `No se pudo registrar la prueba: ${error.message}` : "No se pudo registrar la etiqueta de prueba");
      return true;
    } finally {
      setLoading(false);
      setOperationProgress(null);
    }
  };
  const requireWarehouseWorker = () => {
    if (activeWarehouseWorker) return true;
    setNotice("Antes de crear una etiqueta nueva, escanea el QR del operario.");
    focusScanInput();
    return false;
  };

  const createWarehouseWorker = async () => {
    const name = newWorkerName.trim(); if (!name) return;
    const response = await apiFetch("/api/warehouse-workers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const payload = await response.json() as { workers?: WarehouseWorker[]; message?: string };
    if (!response.ok) { setNotice(payload.message || "No se pudo crear el operario"); return; }
    setWarehouseWorkers(payload.workers || []); setNewWorkerName("");
  };

  const downloadWorkerQr = async (worker: WarehouseWorker) => {
    await downloadWorkerQrFile(worker);
  };

  const loadExpeditionsSettings = async () => {
    try {
      const response = await apiFetch("/api/expeditions/settings");
      if (!response.ok) return;
      setExpeditionsSettings(await response.json() as ExpeditionsSettings);
    } catch {
      setExpeditionsSettings(defaultExpeditionsSettings);
    }
  };

  const loadManualRules = async () => {
    try {
      const response = await apiFetch("/api/shipping/rules");
      if (!response.ok) return;
      const payload = await response.json() as { rules?: ManualRuleOption[] };
      setManualRules((payload.rules || []).filter((rule) => rule.active));
    } catch { setManualRules([]); }
  };

  const loadAmazonShipments = async () => {
    try {
      const response = await apiFetch("/api/amazon-sp-api/shipments");
      if (!response.ok) return;
      const payload = await response.json() as { shipments?: AmazonShipmentRecord[] };
      setAmazonShipments(Array.isArray(payload.shipments) ? payload.shipments : []);
    } catch {
      setAmazonShipments([]);
    }
  };

  const loadGeneratedShippingLabels = async (filters = historyFilters) => {
    try {
      const query = new URLSearchParams();
      if (filters.query.trim()) query.set("q", filters.query.trim());
      if (filters.client.trim()) query.set("client", filters.client.trim());
      if (filters.odooRef.trim()) query.set("odooRef", filters.odooRef.trim());
      if (filters.reference.trim()) query.set("reference", filters.reference.trim());
      if (filters.shipper.trim()) query.set("shipper", filters.shipper.trim());
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
      if (filters.operator.trim()) query.set("operator", filters.operator.trim());
      query.set("limit", filters.limit || defaultHistoryFilters.limit);
      const response = await apiFetch(`/api/genei/labels?${query.toString()}`);
      if (!response.ok) return;
      const payload = await response.json() as { labels?: GeneratedShippingLabelRecord[]; total?: number; returned?: number };
      setGeneratedLabels(Array.isArray(payload.labels) ? payload.labels : []);
      setHistoryTotal(typeof payload.total === "number" ? payload.total : Array.isArray(payload.labels) ? payload.labels.length : 0);
      setHistoryReturned(typeof payload.returned === "number" ? payload.returned : Array.isArray(payload.labels) ? payload.labels.length : 0);
    } catch {
      setGeneratedLabels([]);
      setHistoryTotal(0);
      setHistoryReturned(0);
    }
  };

  const loadPrestashopTracking = async (targetOrder = order) => {
    if (!isPrestashopOrder(targetOrder)) {
      setPrestashopTracking(null);
      return null;
    }
    try {
      const response = await apiFetch(`/api/prestashop/tracking/${encodeURIComponent(targetOrder.odooRef || targetOrder.id)}`);
      if (!response.ok) return null;
      const payload = await response.json() as { tracking?: PrestashopTrackingRecord | null };
      setPrestashopTracking(payload.tracking ?? null);
      return payload.tracking ?? null;
    } catch {
      return null;
    }
  };

  const loadExpeditionsHistory = () => {
    void loadGeneratedShippingLabels();
    void loadAmazonShipments();
  };

  useEffect(() => {
    void loadExpeditionsSettings();
    void loadManualRules();
    void loadWarehouseWorkers();
    loadExpeditionsHistory();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGeneratedShippingLabels(historyFilters);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [historyFilters]);

  useEffect(() => {
    void loadPrestashopTracking(order);
  }, [order?.odooRef, order?.id, order?.channel]);

  useEffect(() => {
    localStorage.setItem(labelPrinterStorageKey, labelPrinterId);
  }, [labelPrinterId]);

  const printLabelPdf = async (base64: string, shipmentCode: string) => {
    const target = selectedPrinterTarget;
    if (!target.printerName) {
      await printPdfInCurrentTab(base64, shipmentCode);
      return target.label;
    }
    try {
      await printPdfWithQzTray(base64, shipmentCode, target.printerName);
      return target.label;
    } catch (error) {
      await printPdfInCurrentTab(base64, shipmentCode);
      const detail = error instanceof Error ? error.message : "QZ no conectado";
      return `Dialogo navegador (QZ: ${detail})`;
    }
  };

  const testQzTrayConnection = async () => {
    setQzStatus("Conectando con QZ Tray...");
    try {
      const qz = await connectQzTray();
      const printers = await listQzPrinters(qz);
      setQzPrinters(printers);
      const target = selectedPrinterTarget;
      const selectedText = target.printerName ? `Seleccionada: ${target.printerName}.` : "Selecciona una impresora detectada para imprimir directo.";
      setQzStatus(printers.length
        ? `QZ conectado. ${printers.length} impresora(s) detectada(s). ${selectedText}`
        : `QZ conectado, pero no ha devuelto impresoras. ${selectedText}`);
    } catch (error) {
      setQzStatus(error instanceof Error ? `QZ no conecta: ${error.message}` : "QZ no conecta");
    }
  };

  const findOrder = async (value = scan) => {
    const reference = normalizeScanReference(value);
    if (!reference) return;
    const isWorkerQr = /^OP\d+$/i.test(reference);
    if (isWorkerQr && !orderFound) {
      await identifyWarehouseWorker(reference);
      return;
    }
    if (isWorkerQr && orderFound) {
      setScan("");
      setNotice(`Pedido ya preparado para ${activeWarehouseWorker?.name || "el operario inicial"}. Para mantener la trazabilidad, debe terminarlo ese mismo operario.`);
      focusScanInput();
      return;
    }
    if (!activeWarehouseWorker) {
      await identifyWarehouseWorker(reference);
      return;
    }
    if (workerExpiryRef.current) { window.clearTimeout(workerExpiryRef.current); workerExpiryRef.current = null; }
    if (orderFound && order && quotes.length > 0 && isPreparedOrderReference(reference, order, preparedReference)) {
      if (existingShipmentCode) {
        setScan("");
        showExistingLabelWarning(existingShipmentCode, existingShipmentCreatedAt);
        setNotice(`Etiqueta Genei ${existingShipmentCode} ya generada${existingShipmentCreatedAt ? ` el ${existingShipmentCreatedAt}` : ""}. Reimpresion bloqueada en automatico; usa el boton Imprimir etiqueta si hace falta.`);
        focusScanInput();
        return;
      }
      if (!destinationReady) {
        setNotice(`Faltan datos de destino: ${missingDestinationFields.join(", ")}. Completa los campos antes de volver a escanear para generar la etiqueta.`);
        return;
      }
      setScan("");
      setNotice("Segundo escaneo confirmado. Generando etiqueta Genei e imprimiendo sin salir de Expediciones.");
      await createAndPayManualShipment({ skipConfirm: true, delivery: "inline-print", print: true });
      focusScanInput();
      return;
    }
    let foundForManualFallback: Order | null = null;
    let draftForManualFallback: DestinationDraft | null = null;
    setOperationProgress({ title: "Buscando pedido", detail: reference });
    setLoading(true); setOrderFound(false); setOrder(null); setQuotes([]); setShipment(null); setTestShipmentCode(null); setExistingShipmentCode(null); setExistingShipmentCarrier("genei"); setExistingShipmentCreatedAt(""); setMrwReissueAvailable(false); setEligibleManualRuleIds(null); setAmazonShipment(null); setPrestashopTracking(null); setPreparedReference(""); setLabelReference(""); setDestinationDraft(emptyDestination); setDestinationOverride(null); setTransportRule(null); setManualRuleId("");
    try {
      const result = reference.toUpperCase() === testOrder.odooRef ? null : await odooClient.getOrderDetail(reference);
      const found = result?.order ?? (reference.toUpperCase() === testOrder.odooRef ? testOrder : null);
      if (!found) throw new Error("No se ha encontrado ese pedido en Odoo");
      foundForManualFallback = found;
      if (!found.deliveryPrinted) {
        void recordScanAudit(reference, found, "scan-blocked-unprinted");
        setScan("");
        setNotice(`Pedido ${found.id}: albarán pendiente de imprimir. No se ha creado ni impreso ninguna etiqueta de envío.`);
        focusScanInput();
        return;
      }
      void recordScanAudit(reference, found, "scan-accepted");
      setOperationProgress({ title: "Pedido localizado", detail: "Comprobando destino y etiquetas previas" });
      const country = resolveOrderCountryCode(found);
      const postalCode = found.shippingPostalCode || "";
      const town = found.city.split(",")[0]?.trim() || "";
      const draft = {
        name: found.shippingRecipient || found.client || "",
        address: found.shippingAddress || "",
        postalCode,
        town,
        country,
        phone: found.shippingPhone || "",
        email: found.shippingEmail || "",
      };
      const overrideResponse = await apiFetch(`/api/expedition-destination-overrides/${encodeURIComponent(found.odooRef || found.id)}`);
      const overridePayload = await readJsonResponse<{ override?: DestinationOverride | null }>(overrideResponse);
      const effectiveDraft = overridePayload.override?.destination ?? draft;
      draftForManualFallback = effectiveDraft;
      setDestinationDraft(effectiveDraft);
      setDestinationOverride(overridePayload.override ?? null);
      const missingFields = getMissingDestinationFields(effectiveDraft);
      if (missingFields.length > 0) {
        setOrder(found); setQuotes([]); setSelectedQuote(0); setOrderFound(true); setPreparedReference(reference); setLabelReference(found.externalRef || found.id || found.odooRef); setScan(""); setMode("manual");
        setNotice(`Modo manual: faltan datos de destino (${missingFields.join(", ")}). Corrige los campos y pulsa Actualizar datos corregidos.`);
        return;
      }
      const recordedLabel = await findRecordedShippingLabel(found);
      if (recordedLabel?.shipmentCode) {
        const recordedCreatedAt = formatExistingLabelDate(recordedLabel.createdAt);
        setOrder(found); setQuotes([]); setSelectedQuote(0); setOrderFound(true); setPreparedReference(reference); setLabelReference(found.externalRef || found.id || found.odooRef); setScan(""); setExistingShipmentCode(recordedLabel.shipmentCode); setExistingShipmentCarrier(getCarrierFromLabelRecord(recordedLabel)); setExistingShipmentCreatedAt(recordedCreatedAt);
        void loadGeneratedShippingLabels({ ...defaultHistoryFilters, odooRef: found.odooRef || found.id, limit: "100" });
        showExistingLabelWarning(recordedLabel.shipmentCode, recordedCreatedAt);
        setNotice(`Etiqueta de envio ${recordedLabel.shipmentCode} ya registrada${recordedCreatedAt ? ` el ${recordedCreatedAt}` : ""}. Reimpresion bloqueada en automatico; usa Imprimir etiqueta si hace falta.`);
        focusScanInput();
        return;
      }
      const resolvedRule = await resolveTransportRuleForOrder(found, effectiveDraft, totalWeight);
      setOperationProgress({ title: "Aplicando regla de transporte", detail: resolvedRule.appliedRule?.name || "Regla por defecto" });
      setTransportRule(resolvedRule);
      setManualRuleId(resolvedRule.appliedRule?.id || "");
      if (!resolvedRule.carrier) {
        setOrder(found); setQuotes([]); setSelectedQuote(0); setOrderFound(true); setPreparedReference(reference); setLabelReference(found.externalRef || found.id || found.odooRef); setScan(""); setMode("manual");
        setNotice("Modo manual: el pedido no tiene transportista por regla. Revisa destino/datos y ajusta la regla de envio antes de generar etiqueta.");
        return;
      }
      if (["mrw", "correos-express", "dhl"].includes(resolvedRule.carrier)) {
        const directCarrierLabel = resolvedRule.carrier === "mrw" ? "MRW" : resolvedRule.carrier === "correos-express" ? "Correos Express" : "DHL";
        setOrder(found); setQuotes([]); setSelectedQuote(0); setOrderFound(true); setPreparedReference(reference); setLabelReference(found.externalRef || found.id || found.odooRef); setScan("");
        if (mode === "automatic") {
          setNotice(`Regla "${resolvedRule.appliedRule?.name || "por defecto"}". Generando etiqueta ${directCarrierLabel} con servicio ${resolvedRule.service || "sin servicio"} sin segundo escaneo.`);
          setOperationProgress({ title: `Generando etiqueta ${directCarrierLabel}`, detail: "Enviando datos al transportista" });
          await (resolvedRule.carrier === "mrw" ? createMrwShipment : resolvedRule.carrier === "correos-express" ? createCorreosExpressShipment : createDhlShipment)({
            delivery: "inline-print",
            print: true,
            skipConfirm: true,
            orderOverride: found,
            destinationOverride: effectiveDraft,
            labelReferenceOverride: found.externalRef || found.id || found.odooRef,
            resetAfterSuccess: true,
            serviceOverride: resolvedRule.service,
          });
          return;
        }
        setNotice(`Pedido encontrado. Regla aplicada: ${resolvedRule.appliedRule?.name || "por defecto"} · ${directCarrierLabel} · ${resolvedRule.service || "sin servicio"}. Revisa la direccion y genera la etiqueta.`);
        return;
      }
      if (resolvedRule.carrier && resolvedRule.carrier !== "genei") throw new Error(`La regla selecciona ${resolvedRule.carrier}, pero ese conector aun no genera etiquetas desde Expediciones`);
      const knownShipmentPromise = findExistingGeneiShipment(found);
      setOperationProgress({ title: "Cotizando Genei", detail: "Buscando el servicio permitido por la regla" });
      const quotePayloadPromise = apiFetch("/api/genei/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isWarehouse: false, isoCountryOrigin: "ES", isoCountryDestination: country, postalCodeOrigin: "03690", postalCodeDestination: postalCode, townOrigin: "San Vicente del Raspeig", townDestination: town, packages: parcels.map((parcel) => ({ weight: Number(parcel.weight.replace(",", ".")), height: Number(parcel.height), width: Number(parcel.width), length: Number(parcel.length), isBox: false })) }) })
        .then(async (response) => ({
          ok: response.ok,
          payload: await readJsonResponse<{ quotes?: Array<GeneiQuote & { id?: string | number; agency?: string; base?: number; total?: number }>; message?: string }>(response),
        }));
      const known = await knownShipmentPromise;
      const shipmentData = known?.shipment;
      const shipmentReference = getGeneiShipmentCode(shipmentData) || (found.odooRef === testOrder.odooRef ? "0DROIMAV" : "");
      const shipmentCreatedAt = getGeneiShipmentCreatedAt(shipmentData);
      if (shipmentReference) {
        void quotePayloadPromise.catch(() => null);
        void recordGeneratedShippingLabel(
          found,
          shipmentReference,
          found.externalRef || found.id || found.odooRef,
          getGeneiShipmentCreatedAtRaw(shipmentData) || new Date().toISOString(),
          {
            tracking: getGeneiTrackingNumber(shipmentData),
            trackingUrl: getGeneiTrackingUrl(shipmentData),
            shipper: getGeneiCarrierName(shipmentData),
            carrierStatus: getGeneiCarrierStatus(shipmentData),
          },
        ).catch(() => null);
        setOrder(found); setQuotes([]); setSelectedQuote(0); setOrderFound(true); setPreparedReference(reference); setLabelReference(found.externalRef || found.id || found.odooRef); setScan(""); setExistingShipmentCode(shipmentReference); setExistingShipmentCarrier("genei"); setExistingShipmentCreatedAt(shipmentCreatedAt);
        showExistingLabelWarning(shipmentReference, shipmentCreatedAt);
        setNotice(`Pedido encontrado con etiqueta Genei ${shipmentReference} ya generada${shipmentCreatedAt ? ` el ${shipmentCreatedAt}` : ""}. Revisa y reimprime manualmente solo si hace falta.`);
        focusScanInput();
        return;
      }
      const quoteResponse = await quotePayloadPromise;
      const quotePayload = quoteResponse.payload;
      if (!quoteResponse.ok) throw new Error(quotePayload.message || "No se pudo cotizar con Genei");
      const available = (quotePayload.quotes || []).map((quote) => ({
        ...quote,
        id_agencia: quote.id_agencia ?? quote.id ?? "",
        nombre_agencia: quote.nombre_agencia ?? quote.agency ?? "Servicio Genei",
        importe: quote.importe ?? quote.total ?? 0,
        importe_sin_iva: quote.importe_sin_iva ?? quote.base,
      }));
      if (!available.length) throw new Error("Genei no ofrece servicios para este pedido con los bultos indicados");
      const matchedRule = resolvedRule.appliedRule;
      if (!matchedRule) throw new Error("No hay regla de envio activa para este destino");
      const servicePattern = resolvedRule.service && resolvedRule.service !== "genei-default"
        ? new RegExp(resolvedRule.service.replace(/^genei-/, "").replace(/-/g, ".*"), "i")
        : null;
      const permitted = servicePattern ? available.filter((quote) => servicePattern.test(quote.nombre_agencia)) : available;
      if (!permitted.length) throw new Error(`La regla "${matchedRule.name}" no encuentra servicios Genei permitidos para este pedido. Requiere revision manual.`);
      const ordered = [...permitted].sort((left, right) => Number(left.importe) - Number(right.importe));
      setOrder(found); setQuotes(ordered); setSelectedQuote(0); setOrderFound(true); setPreparedReference(reference); setLabelReference(found.externalRef || found.id || found.odooRef); setScan("");
      if (mode === "automatic") {
        setNotice(`Regla "${matchedRule.name}". Generando etiqueta con ${ordered[0].nombre_agencia} sin segundo escaneo.`);
        setOperationProgress({ title: "Generando etiqueta Genei", detail: ordered[0].nombre_agencia });
        await createAndPayManualShipment({
          delivery: "inline-print",
          print: true,
          skipConfirm: true,
          orderOverride: found,
          quoteOverride: ordered[0],
          destinationOverride: effectiveDraft,
          labelReferenceOverride: found.externalRef || found.id || found.odooRef,
          resetAfterSuccess: true,
        });
        return;
      }
      setNotice(shipmentReference ? `Pedido encontrado. Etiqueta Genei registrada: ${shipmentReference}. Escanea otra vez el mismo pedido para imprimirla.` : draft.address ? `Pedido encontrado. Regla aplicada: ${matchedRule.name}. Escanea otra vez el mismo pedido para confirmar la etiqueta.` : "Pedido encontrado y cotizado, pero falta la direccion/calle. Completala antes del segundo escaneo.");
    } catch (error) {
      if (reference.toUpperCase() === testOrder.odooRef) {
        setOrder(testOrder); setOrderFound(true); setPreparedReference(reference); setLabelReference(testOrder.externalRef || testOrder.id || testOrder.odooRef); setQuotes([]); setNotice(error instanceof Error ? `Pedido de pruebas encontrado, pero la cotización ha fallado: ${error.message}` : "Pedido de pruebas encontrado, pero no se pudo obtener la cotización.");
      } else if (foundForManualFallback) {
        if (draftForManualFallback) setDestinationDraft(draftForManualFallback);
        setOrder(foundForManualFallback);
        setQuotes([]);
        setSelectedQuote(0);
        setOrderFound(true);
        setPreparedReference(reference);
        setLabelReference(foundForManualFallback.externalRef || foundForManualFallback.id || foundForManualFallback.odooRef);
        setScan("");
        setMode("manual");
        setNotice(error instanceof Error ? `Modo manual: pedido encontrado, pero no se pudo preparar etiqueta. ${error.message}` : "Modo manual: pedido encontrado, pero no se pudo preparar etiqueta.");
      } else setNotice(error instanceof Error ? error.message : "No se pudo preparar el pedido");
    }
    finally { setLoading(false); setOperationProgress(null); focusScanInput(); }
  };

  useEffect(() => {
    const handleScannerInput = (event: KeyboardEvent) => {
      if (section !== "operativa" || loading || isEditableTarget(event.target)) return;
      if (event.key === "Enter") {
        const buffered = scannerBufferRef.current;
        scannerBufferRef.current = "";
        if (scannerResetRef.current) window.clearTimeout(scannerResetRef.current);
        scannerResetRef.current = null;
        if (buffered.length >= 4) {
          event.preventDefault();
          void findOrder(buffered);
        }
        return;
      }
      if (event.key.length !== 1) return;
      scannerBufferRef.current += event.key;
      if (scannerResetRef.current) window.clearTimeout(scannerResetRef.current);
      scannerResetRef.current = window.setTimeout(() => {
        scannerBufferRef.current = "";
        scannerResetRef.current = null;
      }, 250);
    };

    document.addEventListener("keydown", handleScannerInput);
    return () => {
      document.removeEventListener("keydown", handleScannerInput);
      if (scannerResetRef.current) window.clearTimeout(scannerResetRef.current);
    };
  });

  const refreshManualPreparation = async (ruleId = manualRuleId) => {
    if (!order) return;
    const missingFields = getMissingDestinationFields(destinationDraft);
    if (missingFields.length > 0) {
      setMode("manual");
      setNotice(`Siguen faltando datos de destino: ${missingFields.join(", ")}.`);
      return;
    }
    setLoading(true);
    setOperationProgress({ title: "Revisando datos corregidos", detail: order.odooRef || order.id });
    try {
      const overrideResponse = await apiFetch(`/api/expedition-destination-overrides/${encodeURIComponent(order.odooRef || order.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destination: destinationDraft }) });
      const overridePayload = await readJsonResponse<{ override?: DestinationOverride; message?: string }>(overrideResponse);
      if (!overrideResponse.ok || !overridePayload.override) throw new Error(overridePayload.message || "No se pudo guardar la dirección temporal de Expediciones");
      setDestinationOverride(overridePayload.override);
      const resolvedRule = await resolveTransportRuleForOrder(order, destinationDraft, totalWeight, ruleId || undefined);
      setTransportRule(resolvedRule);
      setManualRuleId(resolvedRule.appliedRule?.id || "");
      if (!resolvedRule.carrier) throw new Error("La regla aplicada no tiene transportista configurado");
      if (["mrw", "correos-express", "dhl"].includes(resolvedRule.carrier)) {
        setQuotes([]);
        setSelectedQuote(0);
        const directCarrierLabel = resolvedRule.carrier === "mrw"
          ? "MRW"
          : resolvedRule.carrier === "correos-express"
            ? "Correos Express"
            : "DHL";
        const dhlIssues = resolvedRule.carrier === "dhl" ? getDhlDestinationLimitIssues(destinationDraft) : [];
        setNotice(dhlIssues.length ? `Dirección temporal guardada en Expediciones. DHL bloqueado: ${dhlIssues.join(", ")}.` : `Dirección temporal guardada en Expediciones. ${directCarrierLabel} listo con servicio ${shippingServiceLabel(resolvedRule.service)}. Ya puedes generar la etiqueta.`);
        return;
      }
      if (resolvedRule.carrier && resolvedRule.carrier !== "genei") {
        throw new Error(`La regla selecciona ${resolvedRule.carrier}, pero ese conector aun no genera etiquetas desde Expediciones`);
      }
      const quoteResponse = await apiFetch("/api/genei/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isWarehouse: false,
          isoCountryOrigin: "ES",
          isoCountryDestination: destinationDraft.country,
          postalCodeOrigin: "03690",
          postalCodeDestination: destinationDraft.postalCode,
          townOrigin: "San Vicente del Raspeig",
          townDestination: destinationDraft.town,
          packages: parcels.map((parcel) => ({
            weight: Number(parcel.weight.replace(",", ".")),
            height: Number(parcel.height),
            width: Number(parcel.width),
            length: Number(parcel.length),
            isBox: false,
          })),
        }),
      });
      const quotePayload = await readJsonResponse<{ quotes?: Array<GeneiQuote & { id?: string | number; agency?: string; base?: number; total?: number }>; message?: string }>(quoteResponse);
      if (!quoteResponse.ok) throw new Error(quotePayload.message || "No se pudo cotizar con Genei");
      const available = (quotePayload.quotes || []).map((quote) => ({
        ...quote,
        id_agencia: quote.id_agencia ?? quote.id ?? "",
        nombre_agencia: quote.nombre_agencia ?? quote.agency ?? "Servicio Genei",
        importe: quote.importe ?? quote.total ?? 0,
        importe_sin_iva: quote.importe_sin_iva ?? quote.base,
      }));
      if (!available.length) throw new Error("Genei no ofrece servicios para este pedido con los bultos indicados");
      const matchedRule = resolvedRule.appliedRule;
      if (!matchedRule) throw new Error("No hay regla de envio activa para este destino");
      const servicePattern = resolvedRule.service && resolvedRule.service !== "genei-default"
        ? new RegExp(resolvedRule.service.replace(/^genei-/, "").replace(/-/g, ".*"), "i")
        : null;
      const permitted = servicePattern ? available.filter((quote) => servicePattern.test(quote.nombre_agencia)) : available;
      if (!permitted.length) throw new Error(`La regla "${matchedRule.name}" no encuentra servicios Genei permitidos para este pedido.`);
      const ordered = [...permitted].sort((left, right) => Number(left.importe) - Number(right.importe));
      setQuotes(ordered);
      setSelectedQuote(0);
      setNotice(`Datos corregidos. Regla aplicada: ${matchedRule.name}. Ya puedes generar la etiqueta.`);
    } catch (error) {
      setMode("manual");
      setNotice(error instanceof Error ? `Modo manual: ${error.message}` : "Modo manual: no se pudo preparar el pedido con los datos corregidos");
    } finally {
      setLoading(false);
      setOperationProgress(null);
    }
  };

  const createShipment = () => {
    if (!orderFound) return;
    const selected = quotes[selectedQuote];
    if (!selected) return;
    setShipment({
      code: "PENDIENTE",
      tracking: "Prueba sin pago",
      carrier: selected.nombre_agencia,
      service: "Pendiente de crear",
      printedAt: new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date()),
    });
    setNotice("La creacion real de prueba se habilitara tras confirmar los datos de Odoo.");
  };

  const createTestShipment = async () => {
    if (!order || !quotes[selectedQuote]) return;
    if (!destinationReady) {
      setNotice(`Faltan datos de destino: ${missingDestinationFields.join(", ")}. Completa los campos antes de crear la prueba.`);
      return;
    }
    setLoading(true);
    try {
      const response = await apiFetch("/api/genei/shipments/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencyId: Number(quotes[selectedQuote].id_agencia), externalShippingCode: getShipmentExternalReference(), orderReference: order.odooRef, packagesArray: parcels.map((parcel) => ({ weight: Number(parcel.weight.replace(",", ".")), height: Number(parcel.height), width: Number(parcel.width), length: Number(parcel.length) })), destination: { postalCode: destinationDraft.postalCode, town: destinationDraft.town, name: destinationDraft.name, address: destinationDraft.address, isoCountry: destinationDraft.country, phone: destinationDraft.phone, email: destinationDraft.email } }) });
      const payload = await readJsonResponse<{ shipment?: { reference?: string }; message?: string }>(response);
      if (!response.ok || !payload.shipment?.reference) throw new Error(payload.message || "Genei no ha creado la prueba");
      setTestShipmentCode(payload.shipment.reference); setNotice(`Prueba creada en Genei (${payload.shipment.reference}) sin pagar. Puedes cancelarla.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo crear la prueba"); }
    finally { setLoading(false); }
  };

  const openMrwLabel = async (
    shipmentNumber: string,
    options: { print?: boolean; delivery?: LabelDelivery } = {},
  ) => {
    if (options.delivery === "download") {
      await downloadPdfFromBackend(`/api/mrw/shipments/${encodeURIComponent(shipmentNumber)}/label.pdf`, `mrw-${shipmentNumber}.pdf`);
      return;
    }
    const response = await apiFetch(`/api/mrw/shipments/${encodeURIComponent(shipmentNumber)}/label.pdf`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(payload.message || "MRW no ha devuelto la etiqueta");
    }
    const buffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    if (options.print) {
      const printerLabel = await printLabelPdf(base64, shipmentNumber);
      setNotice(`Etiqueta MRW ${shipmentNumber} enviada a ${printerLabel}.`);
      return;
    }
    window.open(pdfBase64ToObjectUrl(base64), "_blank", "noopener");
  };

  const openCorreosExpressLabel = async (
    shipmentNumber: string,
    options: { print?: boolean; delivery?: LabelDelivery } = {},
  ) => {
    if (options.delivery === "download") {
      await downloadPdfFromBackend(`/api/correos-express/shipments/${encodeURIComponent(shipmentNumber)}/label.pdf`, `correos-express-${shipmentNumber}.pdf`);
      return;
    }
    const response = await apiFetch(`/api/correos-express/shipments/${encodeURIComponent(shipmentNumber)}/label.pdf`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(payload.message || "Correos Express no ha devuelto la etiqueta");
    }
    const buffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    if (options.print) {
      const printerLabel = await printLabelPdf(base64, shipmentNumber);
      setNotice(`Etiqueta Correos Express ${shipmentNumber} enviada a ${printerLabel}.`);
      return;
    }
    window.open(pdfBase64ToObjectUrl(base64), "_blank", "noopener");
  };

  const openDhlLabel = async (
    shipmentNumber: string,
    options: { print?: boolean; delivery?: LabelDelivery } = {},
  ) => {
    const url = `/api/dhl/shipments/${encodeURIComponent(shipmentNumber)}/label`;
    if (options.delivery === "download") {
      await downloadPdfFromBackend(url, `dhl-${shipmentNumber}.pdf`);
      return;
    }
    const response = await apiFetch(url);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(payload.message || "DHL no ha devuelto la etiqueta");
    }
    const base64 = arrayBufferToBase64(await response.arrayBuffer());
    if (options.print) {
      const printerLabel = await printLabelPdf(base64, shipmentNumber);
      setNotice(`Etiqueta DHL ${shipmentNumber} enviada a ${printerLabel}.`);
      return;
    }
    window.open(pdfBase64ToObjectUrl(base64), "_blank", "noopener");
  };

  const createMrwShipment = async (options: {
    destinationOverride?: DestinationDraft;
    labelReferenceOverride?: string;
    orderOverride?: Order;
    print?: boolean;
    resetAfterSuccess?: boolean;
    serviceOverride?: string;
    skipConfirm?: boolean;
    delivery?: LabelDelivery;
  } = {}) => {
    const targetOrder = options.orderOverride ?? order;
    const targetDestination = options.destinationOverride ?? destinationDraft;
    const missingFields = getMissingDestinationFields(targetDestination);
    const service = options.serviceOverride || transportRule?.service || "mrw-urgent-1900-expedition";
    if (!targetOrder || !requireWarehouseWorker()) return;
    if (missingFields.length > 0) {
      setNotice(`Faltan datos de destino: ${missingFields.join(", ")}. Completa los campos antes de generar la etiqueta MRW.`);
      return;
    }
    if (await simulateLabShipment(targetOrder, "MRW")) return;
    if (!options.skipConfirm && !window.confirm(`Vas a generar una etiqueta MRW con servicio ${service}. ¿Confirmas?`)) return;
    setOperationProgress({ title: "Generando etiqueta MRW", detail: "Creando envio real en MRW" });
    setLoading(true);
    try {
      const response = await apiFetch("/api/mrw/shipments/real", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: getShipmentExternalReference(options.labelReferenceOverride, targetOrder),
          service,
          destination: {
            name: targetDestination.name,
            address: targetDestination.address,
            postalCode: targetDestination.postalCode,
            town: targetDestination.town,
            countryCode: targetDestination.country,
            phone: targetDestination.phone,
            email: targetDestination.email,
          },
          packages: parcels.map((parcel) => ({
            weight: Number(parcel.weight.replace(",", ".")),
            length: Number(parcel.length),
            width: Number(parcel.width),
            height: Number(parcel.height),
          })),
        }),
      });
      const payload = await readJsonResponse<{ shipment?: { shipmentNumber?: string; url?: string }; message?: string }>(response);
      const shipmentNumber = payload.shipment?.shipmentNumber || "";
      if (!response.ok || !shipmentNumber) throw new Error(payload.message || "MRW no ha creado la etiqueta");
      setExistingShipmentCode(shipmentNumber);
      setExistingShipmentCarrier("mrw");
      setExistingShipmentCreatedAt(new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date()));
      setOperationProgress({ title: "Etiqueta MRW creada", detail: "Preparando PDF e impresion" });
      setNotice(`Etiqueta MRW ${shipmentNumber} creada. Preparando ${options.delivery === "download" ? "descarga" : "impresion"}.`);
      await recordGeneratedShippingLabel(
        targetOrder,
        shipmentNumber,
        getShipmentExternalReference(options.labelReferenceOverride, targetOrder),
        new Date().toISOString(),
        { source: "mrw-label-created", tracking: shipmentNumber, shipper: "MRW", carrierStatus: service, operator: activeWarehouseWorker?.name, reissuedFrom: reissueContext?.shipmentCode, reissueReason: reissueContext?.reason },
      );
      setReissueContext(null);
      setReissueReason("");
      await recordWarehouseActivity(targetOrder, "MRW", shipmentNumber);
      void preparePrestashopTracking(targetOrder, shipmentNumber, "MRW", service);
      await queueAmazonTracking(shipmentNumber, targetOrder, {
        carrier: "MRW", carrierStatus: service, shipmentDate: new Date().toISOString(), tracking: shipmentNumber,
      });
      await openMrwLabel(shipmentNumber, { delivery: options.delivery ?? "download", print: options.print });
      void runPostLabelWorkflow(shipmentNumber, targetOrder, {
        carrier: "MRW",
        carrierStatus: service,
        shipmentDate: new Date().toISOString(),
        tracking: shipmentNumber,
      });
      resetShipmentFlow(`Etiqueta MRW ${shipmentNumber} creada. Escanea el QR del siguiente operario.`);
    } catch (error) {
      setMode("manual");
      setNotice(error instanceof Error ? `Modo manual: MRW no ha generado la etiqueta. ${error.message}` : "Modo manual: no se pudo generar la etiqueta MRW");
    } finally {
      setLoading(false);
      setOperationProgress(null);
    }
  };

  const createCorreosExpressShipment = async (options: {
    destinationOverride?: DestinationDraft;
    labelReferenceOverride?: string;
    orderOverride?: Order;
    print?: boolean;
    resetAfterSuccess?: boolean;
    serviceOverride?: string;
    skipConfirm?: boolean;
    delivery?: LabelDelivery;
  } = {}) => {
    const targetOrder = options.orderOverride ?? order;
    const targetDestination = options.destinationOverride ?? destinationDraft;
    const missingFields = getMissingDestinationFields(targetDestination);
    const service = options.serviceOverride || transportRule?.service || "cex-paq-24";
    if (!targetOrder || !requireWarehouseWorker()) return;
    if (missingFields.length > 0) {
      setNotice(`Faltan datos de destino: ${missingFields.join(", ")}. Completa los campos antes de generar la etiqueta Correos Express.`);
      return;
    }
    if (await simulateLabShipment(targetOrder, "Correos Express")) return;
    if (!options.skipConfirm && !window.confirm(`Vas a generar una etiqueta Correos Express con servicio ${shippingServiceLabel(service)}. ¿Confirmas?`)) return;
    setOperationProgress({ title: "Generando etiqueta Correos Express", detail: "Creando envio en el transportista" });
    setLoading(true);
    try {
      const response = await apiFetch("/api/correos-express/shipments/real", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: getShipmentExternalReference(options.labelReferenceOverride, targetOrder),
          service,
          destination: {
            name: targetDestination.name,
            address: targetDestination.address,
            postalCode: targetDestination.postalCode,
            town: targetDestination.town,
            countryCode: targetDestination.country,
            phone: targetDestination.phone,
            email: targetDestination.email,
          },
          packages: parcels.map((parcel) => ({
            weight: Number(parcel.weight.replace(",", ".")),
            length: Number(parcel.length),
            width: Number(parcel.width),
            height: Number(parcel.height),
          })),
        }),
      });
      const payload = await readJsonResponse<{ shipment?: { shipmentNumber?: string; labelBase64?: string }; message?: string }>(response);
      const shipmentNumber = payload.shipment?.shipmentNumber || "";
      if (!response.ok || !shipmentNumber) throw new Error(payload.message || "Correos Express no ha creado la etiqueta");
      setExistingShipmentCode(shipmentNumber);
      setExistingShipmentCarrier("correos-express");
      setExistingShipmentCreatedAt(new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date()));
      setOperationProgress({ title: "Etiqueta Correos Express creada", detail: "Preparando PDF e impresion" });
      setNotice(`Etiqueta Correos Express ${shipmentNumber} creada. Preparando ${options.delivery === "download" ? "descarga" : "impresion"}.`);
      await recordGeneratedShippingLabel(
        targetOrder,
        shipmentNumber,
        getShipmentExternalReference(options.labelReferenceOverride, targetOrder),
        new Date().toISOString(),
        { source: "correos-express-label-created", tracking: shipmentNumber, shipper: "Correos Express", carrierStatus: service, operator: activeWarehouseWorker?.name, reissuedFrom: reissueContext?.shipmentCode, reissueReason: reissueContext?.reason },
      );
      setReissueContext(null);
      setReissueReason("");
      await recordWarehouseActivity(targetOrder, "Correos Express", shipmentNumber);
      void preparePrestashopTracking(targetOrder, shipmentNumber, "Correos Express", service);
      await queueAmazonTracking(shipmentNumber, targetOrder, {
        carrier: "Correos Express", carrierStatus: service, shipmentDate: new Date().toISOString(), tracking: shipmentNumber,
      });
      if (payload.shipment?.labelBase64 && options.delivery !== "download") {
        if (options.print) {
          const printerLabel = await printLabelPdf(payload.shipment.labelBase64, shipmentNumber);
          setNotice(`Etiqueta Correos Express ${shipmentNumber} enviada a ${printerLabel}.`);
        }
        else window.open(pdfBase64ToObjectUrl(payload.shipment.labelBase64), "_blank", "noopener");
      } else {
        await openCorreosExpressLabel(shipmentNumber, { delivery: options.delivery ?? "download", print: options.print });
      }
      void runPostLabelWorkflow(shipmentNumber, targetOrder, {
        carrier: "Correos Express",
        carrierStatus: service,
        shipmentDate: new Date().toISOString(),
        tracking: shipmentNumber,
      });
      resetShipmentFlow(`Etiqueta Correos Express ${shipmentNumber} creada. Escanea el QR del siguiente operario.`);
    } catch (error) {
      setMode("manual");
      setNotice(error instanceof Error ? `Modo manual: Correos Express no ha generado la etiqueta. ${error.message}` : "Modo manual: no se pudo generar la etiqueta Correos Express");
    } finally {
      setLoading(false);
      setOperationProgress(null);
    }
  };

  const createDhlShipment = async (options: {
    destinationOverride?: DestinationDraft;
    orderOverride?: Order;
    print?: boolean;
    resetAfterSuccess?: boolean;
    skipConfirm?: boolean;
    delivery?: LabelDelivery;
  } = {}) => {
    const targetOrder = options.orderOverride ?? order;
    const targetDestination = options.destinationOverride ?? destinationDraft;
    if (!targetOrder || !requireWarehouseWorker()) return;
    const missingFields = getMissingDestinationFields(targetDestination);
    if (missingFields.length > 0) {
      setNotice(`Faltan datos de destino: ${missingFields.join(", ")}. Completa los campos antes de generar la etiqueta DHL.`);
      return;
    }
    const dhlIssues = getDhlDestinationLimitIssues(targetDestination);
    if (dhlIssues.length) {
      setMode("manual");
      setNotice(`DHL no permite crear la etiqueta: ${dhlIssues.join(", ")}. Corrige y pulsa «Actualizar datos corregidos».`);
      return;
    }
    if (await simulateLabShipment(targetOrder, "DHL")) return;
    const reference = getDhlLabelReference(targetOrder);
    if (!options.skipConfirm && !window.confirm(`Vas a generar una etiqueta DHL Connect B2C para ${reference}. ¿Confirmas?`)) return;
    setOperationProgress({ title: "Generando etiqueta DHL", detail: "Creando envío B2C en DHL" });
    setLoading(true);
    try {
      const response = await apiFetch("/api/dhl/shipments/real", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference,
          destination: { name: targetDestination.name, address: targetDestination.address, postalCode: targetDestination.postalCode, town: targetDestination.town, countryCode: targetDestination.country, phone: targetDestination.phone, email: targetDestination.email },
          packages: parcels.map((parcel) => ({ weight: Number(parcel.weight.replace(",", ".")), length: Number(parcel.length), width: Number(parcel.width), height: Number(parcel.height) })),
          format: "PDF",
        }),
      });
      const payload = await readJsonResponse<{ shipment?: { tracking?: string; reference?: string; createdAt?: string }; message?: string }>(response);
      const shipmentNumber = payload.shipment?.tracking || "";
      if (!response.ok || !shipmentNumber) throw new Error(payload.message || "DHL no ha creado la etiqueta");
      setExistingShipmentCode(shipmentNumber);
      setExistingShipmentCarrier("dhl");
      setExistingShipmentCreatedAt(formatExistingLabelDate(payload.shipment?.createdAt || new Date().toISOString()));
      await recordGeneratedShippingLabel(targetOrder, shipmentNumber, reference, new Date().toISOString(), { source: "dhl-label-created", tracking: shipmentNumber, shipper: "DHL", carrierStatus: "DHL Connect B2C", operator: activeWarehouseWorker?.name, reissuedFrom: reissueContext?.shipmentCode, reissueReason: reissueContext?.reason });
      setReissueContext(null);
      setReissueReason("");
      await recordWarehouseActivity(targetOrder, "DHL", shipmentNumber);
      void preparePrestashopTracking(targetOrder, shipmentNumber, "DHL", "dhl-connect-b2c");
      await queueAmazonTracking(shipmentNumber, targetOrder, { carrier: "DHL", carrierStatus: "DHL Connect B2C", shipmentDate: new Date().toISOString(), tracking: shipmentNumber });
      await openDhlLabel(shipmentNumber, { delivery: options.delivery ?? "download", print: options.print });
      void runPostLabelWorkflow(shipmentNumber, targetOrder, { carrier: "DHL", carrierStatus: "DHL Connect B2C", shipmentDate: new Date().toISOString(), tracking: shipmentNumber });
      resetShipmentFlow(`Etiqueta DHL ${shipmentNumber} creada. Escanea el QR del siguiente operario.`);
    } catch (error) {
      setMode("manual");
      setNotice(error instanceof Error ? `DHL no ha generado la etiqueta. ${error.message}` : "DHL no ha generado la etiqueta");
    } finally { setLoading(false); setOperationProgress(null); }
  };

  const createAndPayManualShipment = async (options: {
    destinationOverride?: DestinationDraft;
    labelReferenceOverride?: string;
    labelWindow?: Window | null;
    orderOverride?: Order;
    print?: boolean;
    quoteOverride?: GeneiQuote;
    resetAfterSuccess?: boolean;
    skipConfirm?: boolean;
    delivery?: LabelDelivery;
  } = {}) => {
    const targetOrder = options.orderOverride ?? order;
    const targetQuote = options.quoteOverride ?? quotes[selectedQuote];
    const targetDestination = options.destinationOverride ?? destinationDraft;
    const missingFields = getMissingDestinationFields(targetDestination);
    if (!targetOrder || !targetQuote || !requireWarehouseWorker()) return;
    if (missingFields.length > 0) {
      setNotice(`Faltan datos de destino: ${missingFields.join(", ")}. Completa los campos antes de generar la etiqueta.`);
      return;
    }
    if (await simulateLabShipment(targetOrder, targetQuote.nombre_agencia || "Genei")) return;
    const total = Number(targetQuote.importe).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
    if (!options.skipConfirm && !window.confirm(`Vas a generar y pagar una etiqueta real con ${targetQuote.nombre_agencia} por ${total}. ¿Confirmas?`)) return;
    let labelWindow = options.labelWindow;
    setOperationProgress({ title: "Generando etiqueta Genei", detail: targetQuote.nombre_agencia });
    setLoading(true);
    try {
      const shipmentResponse = await apiFetch("/api/genei/shipments/real", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencyId: Number(targetQuote.id_agencia), externalShippingCode: getShipmentExternalReference(options.labelReferenceOverride, targetOrder), orderReference: targetOrder.odooRef, packagesArray: parcels.map((parcel) => ({ weight: Number(parcel.weight.replace(",", ".")), height: Number(parcel.height), width: Number(parcel.width), length: Number(parcel.length) })), destination: { postalCode: targetDestination.postalCode, town: targetDestination.town, name: targetDestination.name, address: targetDestination.address, isoCountry: targetDestination.country, phone: targetDestination.phone, email: targetDestination.email } }) });
      const shipmentText = await shipmentResponse.text();
      const shipmentPayload = (shipmentText ? JSON.parse(shipmentText) : {}) as { shipment?: Record<string, unknown> & { transactionId?: number }; message?: string };
      const createdCode = getGeneiShipmentCode(shipmentPayload.shipment);
      if (!shipmentResponse.ok || !createdCode || !shipmentPayload.shipment?.transactionId) {
        if (shipmentPayload.message?.toLowerCase().includes("externo ya corresponde")) {
          const known = await findExistingGeneiShipment(targetOrder);
          const existingCode = getGeneiShipmentCode(known?.shipment);
          if (existingCode) {
            setExistingShipmentCode(existingCode);
            setExistingShipmentCarrier("genei");
            const existingCreatedAt = getGeneiShipmentCreatedAt(known?.shipment);
            setExistingShipmentCreatedAt(existingCreatedAt);
            void recordGeneratedShippingLabel(
              targetOrder,
              existingCode,
              getShipmentExternalReference(options.labelReferenceOverride, targetOrder),
              getGeneiShipmentCreatedAtRaw(known?.shipment) || new Date().toISOString(),
              {
                tracking: getGeneiTrackingNumber(known?.shipment),
                trackingUrl: getGeneiTrackingUrl(known?.shipment),
                shipper: getGeneiCarrierName(known?.shipment),
                carrierStatus: getGeneiCarrierStatus(known?.shipment),
              },
            ).catch(() => null);
            showExistingLabelWarning(existingCode, existingCreatedAt);
            setNotice(`Genei ya tenia la etiqueta ${existingCode}${existingCreatedAt ? ` generada el ${existingCreatedAt}` : ""}. Reimpresion bloqueada en automatico; usa Imprimir etiqueta si hace falta.`);
            focusScanInput();
            return;
          }
        }
        throw new Error(shipmentPayload.message || "Genei no ha creado la etiqueta");
      }
      const paymentResponse = await apiFetch(`/api/genei/payments/${shipmentPayload.shipment.transactionId}`, { method: "POST" });
      const paymentText = await paymentResponse.text();
      const paymentPayload = (paymentText ? JSON.parse(paymentText) : {}) as { message?: string };
      if (!paymentResponse.ok) throw new Error(paymentPayload.message || "Genei no ha podido cobrar la etiqueta");
      setOperationProgress({ title: "Etiqueta Genei pagada", detail: "Esperando PDF e impresion" });
      const generatedAt = new Date();
      const generatedAtIso = generatedAt.toISOString();
      const generatedAtLabel = new Intl.DateTimeFormat("es-ES", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(generatedAt);
      setExistingShipmentCode(createdCode);
      setExistingShipmentCarrier("genei");
      setExistingShipmentCreatedAt(generatedAtLabel);
      setNotice(`Etiqueta ${createdCode} generada y pagada. Preparando ${options.delivery === "download" ? "descarga" : "impresion"}.`);
      await openLabel(createdCode, {
        labelWindow,
        print: options.print,
        delivery: options.delivery ?? "download",
      });
      await recordGeneratedShippingLabel(targetOrder, createdCode, getShipmentExternalReference(options.labelReferenceOverride, targetOrder), generatedAtIso, {
        source: "genei-label-created",
        tracking: getGeneiTrackingNumber(shipmentPayload.shipment),
        trackingUrl: getGeneiTrackingUrl(shipmentPayload.shipment),
        shipper: getGeneiCarrierName(shipmentPayload.shipment),
        carrierStatus: getGeneiCarrierStatus(shipmentPayload.shipment),
      });
      await recordWarehouseActivity(targetOrder, getGeneiCarrierName(shipmentPayload.shipment) || "Genei", createdCode);
      void preparePrestashopTracking(targetOrder, createdCode, "Genei", String(targetQuote.nombre_agencia || targetQuote.id_agencia || ""));
      void loadGeneratedShippingLabels();
      await queueAmazonTracking(createdCode, targetOrder, {
        carrier: getGeneiCarrierName(shipmentPayload.shipment) || "Genei",
        carrierStatus: getGeneiCarrierStatus(shipmentPayload.shipment),
        shipmentDate: getGeneiShipmentCreatedAtRaw(shipmentPayload.shipment) || generatedAtIso,
        tracking: getGeneiTrackingNumber(shipmentPayload.shipment),
        trackingUrl: getGeneiTrackingUrl(shipmentPayload.shipment),
      });
      void runPostLabelWorkflow(createdCode, targetOrder, {
        carrier: getGeneiCarrierName(shipmentPayload.shipment) || "Genei",
        carrierStatus: getGeneiCarrierStatus(shipmentPayload.shipment),
        shipmentDate: getGeneiShipmentCreatedAtRaw(shipmentPayload.shipment) || generatedAtIso,
        tracking: getGeneiTrackingNumber(shipmentPayload.shipment),
        trackingUrl: getGeneiTrackingUrl(shipmentPayload.shipment),
      });
      resetShipmentFlow("Etiqueta creada. Escanea el QR del siguiente operario.");
    } catch (error) {
      labelWindow?.close();
      setMode("manual");
      setNotice(error instanceof Error ? `Modo manual: Genei no ha generado la etiqueta. ${error.message}` : "Modo manual: no se pudo generar la etiqueta");
    }
    finally { setLoading(false); setOperationProgress(null); focusScanInput(); }
  };

  const cancelTestShipment = async () => {
    if (!testShipmentCode) return;
    setLoading(true);
    try { const response = await apiFetch(`/api/genei/shipments/${encodeURIComponent(testShipmentCode)}`, { method: "DELETE" }); const payload = await readJsonResponse<{ message?: string }>(response); if (!response.ok) throw new Error(payload.message || "No se pudo cancelar la prueba"); setNotice(`Prueba ${testShipmentCode} cancelada. No se ha realizado ningun pago.`); setTestShipmentCode(null); } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo cancelar la prueba"); } finally { setLoading(false); }
  };

  const resetShipmentFlow = (nextNotice = "Listo para escanear un nuevo pedido.") => {
    clearWarehouseWorker();
    setOrderFound(false); setOrder(null); setQuotes([]); setShipment(null); setTestShipmentCode(null); setExistingShipmentCode(null); setExistingShipmentCarrier("genei"); setExistingShipmentCreatedAt(""); setMrwReissueAvailable(false); setEligibleManualRuleIds(null); setAmazonShipment(null); setPrestashopTracking(null); setPreparedReference(""); setLabelReference(""); setDestinationDraft(emptyDestination); setDestinationOverride(null); setTransportRule(null); setManualRuleId(""); setScan(""); setParcels([automaticParcel]); setSelectedQuote(0); setMode("automatic"); setNotice(nextNotice); focusScanInput();
  };

  const editInManual = () => {
    setMode("manual");
    setNotice("Modo manual activo. Revisa bultos, datos del destinatario y servicio; despues recotizaremos antes de crear el envio.");
  };

  const openLabel = async (
    shipmentCode: string,
    options: { labelWindow?: Window | null; print?: boolean; delivery?: LabelDelivery } = {},
  ) => {
    const fetchLabelBase64 = async (attempts = 10) => {
      let lastMessage = "Genei todavia no ha preparado el PDF de la etiqueta";
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        setNotice(`Esperando etiqueta Genei ${shipmentCode}. Intento ${attempt}/${attempts}.`);
        const response = await apiFetch(`/api/genei/shipments/${encodeURIComponent(shipmentCode)}/label`);
        const payload = await readJsonResponse<{ label?: unknown; message?: string }>(response);
        if (response.ok) {
          const label = payload.label;
          const base64 = typeof label === "string" ? label : label && typeof label === "object" ? String((label as Record<string, unknown>).base64 || (label as Record<string, unknown>).file || (label as Record<string, unknown>).label || "") : "";
          if (base64) return base64;
          lastMessage = "Genei no ha devuelto PDF todavia";
        } else {
          lastMessage = payload.message || lastMessage;
        }
        if (attempt < attempts) await wait(attempt < 4 ? 1500 : 3000);
      }
      throw new Error(`${lastMessage}. Si Genei lo deja atascado como pendiente, cancela ese envio en Genei desde la pantalla y vuelve a escanear para recrearlo.`);
    };

    const delivery = options.delivery ?? "download";
    const labelWindow = delivery === "popup" ? options.labelWindow ?? window.open("", "_blank") : null;
    if (delivery === "popup" && !labelWindow) {
      setNotice("El navegador ha bloqueado la apertura del PDF. Descarga la etiqueta desde el boton de descarga.");
      return;
    }
    if (labelWindow) labelWindow.document.title = "Cargando etiqueta Genei";
    try {
      const base64 = await fetchLabelBase64();
      if (delivery === "download") {
        await downloadPdfFromBackend(`/api/genei/shipments/${encodeURIComponent(shipmentCode)}/label.pdf`, `genei-${shipmentCode}.pdf`);
        setNotice("Etiqueta lista en Genei. Descarga iniciada desde el backend.");
        return;
      }
      if (delivery === "inline-print") {
        const printerLabel = await printLabelPdf(base64, shipmentCode);
        setNotice(`Etiqueta Genei ${shipmentCode} enviada a ${printerLabel}.`);
        return;
      }
      const url = pdfBase64ToObjectUrl(base64);
      if (!labelWindow) throw new Error("No se pudo abrir la ventana de etiqueta");
      labelWindow.document.open();
      labelWindow.document.write(`
        <!doctype html>
        <html lang="es">
          <head>
            <meta charset="utf-8" />
            <title>Etiqueta Genei ${escapeHtml(shipmentCode)}</title>
            <style>
              html, body { height: 100%; margin: 0; font-family: Arial, sans-serif; color: #111827; }
              body { display: grid; grid-template-rows: auto 1fr; background: #f8fafc; }
              header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #cbd5e1; background: #fff; }
              strong { font-size: 14px; }
              .actions { display: flex; gap: 8px; }
              button, a { border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; font-size: 13px; font-weight: 700; padding: 8px 10px; text-decoration: none; }
              a { background: #fff; color: #2563eb; }
              iframe { width: 100%; height: 100%; border: 0; background: #fff; }
              @media print {
                header { display: none; }
                body { display: block; background: #fff; }
                iframe { height: 100vh; }
              }
            </style>
          </head>
          <body>
            <header>
              <strong>Etiqueta Genei ${escapeHtml(shipmentCode)}</strong>
              <div class="actions">
                <button type="button" onclick="window.print()">Imprimir</button>
                <a href="${url}" target="_blank" rel="noreferrer">Abrir PDF</a>
              </div>
            </header>
            <iframe src="${url}" title="Etiqueta Genei"></iframe>
          </body>
        </html>
      `);
      labelWindow.document.close();
      labelWindow.focus();
      if (options.print) window.setTimeout(() => { labelWindow.focus(); labelWindow.print(); }, 1200);
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
      setNotice(options.print ? "Ventana de etiqueta abierta con visor PDF y boton de imprimir." : "Ventana de etiqueta abierta desde Genei. No se ha guardado ninguna copia en el equipo.");
    } catch (error) {
      if (labelWindow) labelWindow.document.body.innerHTML = `<p>${escapeHtml(error instanceof Error ? error.message : "No se pudo abrir el PDF")}</p>`;
      setNotice(error instanceof Error ? error.message : "No se pudo abrir el PDF");
    }
  };

  const openExistingLabel = async (
    delivery: LabelDelivery = "download",
    print = delivery === "inline-print" || delivery === "popup",
  ) => {
    if (!existingShipmentCode) return;
    setLoading(true);
    try {
      await openLabel(existingShipmentCode, { delivery, print });
      if (print && validateInOdooAfterLabel) {
        await validateLabelDeliveryInOdoo(existingShipmentCode);
      }
    }
    finally { setLoading(false); }
  };

  const cancelGeneiShipment = async () => {
    if (!existingShipmentCode || !window.confirm(`¿Cancelar en Genei la etiqueta ${existingShipmentCode}? Esta acción puede dejarla pendiente de abono.`)) return;
    setLoading(true);
    try {
      const response = await apiFetch(`/api/genei/shipments/${encodeURIComponent(existingShipmentCode)}`, { method: "DELETE" });
      const payload = await readJsonResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message || "Genei no ha podido cancelar el envío");
      await removeGeneratedShippingLabel(existingShipmentCode);
      setExistingShipmentCode(null);
      setExistingShipmentCarrier("genei");
      setExistingShipmentCreatedAt("");
      void loadGeneratedShippingLabels();
      setNotice(payload.message || `Envío ${existingShipmentCode} cancelado en Genei. Registro local liberado; ya puedes crear una nueva etiqueta.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo cancelar el envío"); }
    finally { setLoading(false); }
  };

  const cancelMrwShipment = async () => {
    if (!existingShipmentCode || !window.confirm(`¿Cancelar en MRW el envío ${existingShipmentCode}? Se liberará el pedido para generar una nueva etiqueta.`)) return;
    setLoading(true);
    try {
      const response = await apiFetch(`/api/mrw/shipments/${encodeURIComponent(existingShipmentCode)}`, { method: "DELETE" });
      const payload = await readJsonResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message || "MRW no ha podido cancelar el envío");
      await removeGeneratedShippingLabel(existingShipmentCode);
      setExistingShipmentCode(null);
      setExistingShipmentCarrier("genei");
      setExistingShipmentCreatedAt("");
      setMrwReissueAvailable(false);
      void loadGeneratedShippingLabels();
      setNotice(payload.message || `Envío ${existingShipmentCode} cancelado en MRW. Registro local liberado; ya puedes crear una nueva etiqueta.`);
    } catch (error) {
      setMrwReissueAvailable(true);
      const message = error instanceof Error ? error.message : "MRW no permite cancelar este envío";
      setNotice(`${message}. MRW mantiene la etiqueta activa: escribe el motivo para reemitir y selecciona una regla de envío apta.`);
    }
    finally { setLoading(false); }
  };

  const beginControlledMrwReissue = async () => {
    if (!existingShipmentCode || !requireWarehouseWorker()) return;
    const reason = reissueReason.trim();
    if (!reason) { setNotice("Para reemitir una etiqueta MRW escribe el motivo."); return; }
    if (!window.confirm(`La etiqueta ${existingShipmentCode} sigue activa en MRW. Confirma que no será entregada al transportista y que deseas crear una sustituta.`)) return;
    if (!order) return;
    setLoading(true);
    try {
      const resolvedRule = await resolveTransportRuleForOrder(order, destinationDraft, totalWeight);
      const eligibleRuleIds = (resolvedRule.evaluations || []).filter((evaluation) => evaluation.matched).map((evaluation) => evaluation.ruleId);
      if (resolvedRule.appliedRule?.id && !eligibleRuleIds.includes(resolvedRule.appliedRule.id)) eligibleRuleIds.push(resolvedRule.appliedRule.id);
      setEligibleManualRuleIds(eligibleRuleIds);
      setTransportRule(resolvedRule);
      setManualRuleId(resolvedRule.appliedRule?.id || "");
      setMode("manual");
      setReissueContext({ shipmentCode: existingShipmentCode, reason });
      setExistingShipmentCode(null);
      setExistingShipmentCreatedAt("");
      setMrwReissueAvailable(false);
      setNotice(`Reemisión autorizada por ${activeWarehouseWorker?.name}. Elige la regla apta, ajusta los bultos y genera la nueva etiqueta.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron cargar las reglas aptas para la reemisión");
    } finally { setLoading(false); }
  };

  const cancelDhlShipment = async () => {
    if (!existingShipmentCode || !window.confirm(`¿Cancelar en DHL el envío ${existingShipmentCode}? Se liberará el pedido para generar una nueva etiqueta.`)) return;
    setLoading(true);
    try {
      const response = await apiFetch(`/api/dhl/shipments/${encodeURIComponent(existingShipmentCode)}`, { method: "DELETE" });
      const payload = await readJsonResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message || "DHL no ha podido cancelar el envío");
      await removeGeneratedShippingLabel(existingShipmentCode);
      setExistingShipmentCode(null); setExistingShipmentCarrier("genei"); setExistingShipmentCreatedAt("");
      void loadGeneratedShippingLabels();
      setNotice(`Envío ${existingShipmentCode} cancelado en DHL. Registro local liberado.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo cancelar el envío DHL"); }
    finally { setLoading(false); }
  };

  const unlinkGeneiShipment = async () => {
    if (!existingShipmentCode || !order || !window.confirm(`¿Desvincular la etiqueta ${existingShipmentCode} del pedido ${order.odooRef}? No cancela el envío en Genei.`)) return;
    setLoading(true);
    try {
      const detailsResponse = await apiFetch(`/api/genei/shipments/${encodeURIComponent(existingShipmentCode)}`);
      const details = await detailsResponse.json() as { shipment?: Record<string, unknown>; message?: string };
      const shipmentId = details.shipment && (details.shipment.id_envio || details.shipment.id || details.shipment.shipmentId);
      if (!detailsResponse.ok || !shipmentId) throw new Error(details.message || "No se ha podido identificar el envío en Genei para desvincularlo");
      const response = await apiFetch(`/api/genei/shipments/${encodeURIComponent(String(shipmentId))}/external/${encodeURIComponent(order.odooRef)}`, { method: "DELETE" });
      const payload = await readJsonResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message || "Genei no ha podido desvincular el pedido");
      await removeGeneratedShippingLabel(existingShipmentCode, order);
      setExistingShipmentCode(null);
      setExistingShipmentCarrier("genei");
      setExistingShipmentCreatedAt("");
      void loadGeneratedShippingLabels();
      setNotice(payload.message || "Envío desvinculado del pedido y registro local liberado. Ya puedes crear una nueva etiqueta.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo desvincular el envío"); }
    finally { setLoading(false); }
  };

  const markAsShipped = async () => {
    if (!order || !existingShipmentCode || !window.confirm(`¿Dar por enviado el pedido ${order.odooRef}? Odoo validará la entrega y enviará el tracking mediante el conector del canal.`)) return;
    await validateLabelDeliveryInOdoo(existingShipmentCode);
  };

  const prepareAmazonTrackingDryRun = async (
    shipmentCode = existingShipmentCode || "",
    orderOverride?: Order | null,
    options: {
      carrier?: string;
      carrierStatus?: string;
      quiet?: boolean;
      shipmentDate?: string;
      tracking?: string;
      trackingUrl?: string;
      updateLabelRecord?: boolean;
    } = {},
  ) => {
    const targetOrder = orderOverride ?? order;
    if (!shipmentCode || !targetOrder) return null;
    if (!/amazon/i.test(targetOrder.channel) && !/^\d{3}-\d{7}-\d{7}$/.test(targetOrder.externalRef || "")) return null;
    if (!options.quiet) setAmazonLoading(true);
    try {
      const localLabel = generatedLabels.find((label) => normalizeReference(label.shipmentCode) === normalizeReference(shipmentCode));
      let tracking = options.tracking || localLabel?.tracking || "";
      let trackingUrl = options.trackingUrl || localLabel?.trackingUrl || "";
      let carrier = options.carrier || localLabel?.shipper || "";
      let carrierStatus = options.carrierStatus || localLabel?.carrierStatus || "";
      let shipmentDate = options.shipmentDate || localLabel?.createdAt || "";
      if (!tracking || !carrier) {
        const optionCarrier = getCarrierFromText(options.carrier);
        const knownCarrier = optionCarrier || getCarrierFromLabelRecord(localLabel) || existingShipmentCarrier;
        if (knownCarrier !== "genei") {
          tracking = tracking || shipmentCode;
          carrier = carrier || (existingShipmentCarrier === "mrw" ? "MRW" : existingShipmentCarrier === "correos-express" ? "Correos Express" : existingShipmentCarrier === "dhl" ? "DHL" : "");
          shipmentDate = shipmentDate || new Date().toISOString();
        } else {
          const details = await fetchGeneiShipmentDetailsWithTracking(shipmentCode);
          tracking = getGeneiTrackingNumber(details);
          trackingUrl = getGeneiTrackingUrl(details);
          carrier = getGeneiCarrierName(details);
          carrierStatus = getGeneiCarrierStatus(details);
          shipmentDate = getGeneiShipmentCreatedAtRaw(details) || new Date().toISOString();
        }
      }
      if (!tracking) throw new Error("El transportista aun no ha devuelto tracking real para Amazon");
      if (options.updateLabelRecord) {
        void recordGeneratedShippingLabel(targetOrder, shipmentCode, getShipmentExternalReference(undefined, targetOrder), shipmentDate || new Date().toISOString(), {
          tracking,
          trackingUrl,
          shipper: carrier,
          carrierStatus,
        }).then(loadGeneratedShippingLabels).catch(() => null);
      }
      const response = await apiFetch("/api/amazon-sp-api/shipments/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderRef: targetOrder.externalRef || targetOrder.odooRef || targetOrder.id,
          saleOrderId: Number(String(targetOrder.id).replace(/^#/, "")) || undefined,
          pickingId: targetOrder.odooDeliveryValidation?.pickingId,
          amazonOrderId: targetOrder.externalRef,
          shippingCountryCode: targetOrder.shippingCountryCode,
          geneiShipmentCode: shipmentCode,
          tracking,
          trackingUrl,
          carrier,
          carrierCode: carrier,
          shippingMethod: carrier,
          shipmentDate: shipmentDate || new Date().toISOString(),
        }),
      });
      const payload = await response.json() as { shipment?: AmazonShipmentRecord; message?: string };
      if (!response.ok || !payload.shipment) throw new Error(payload.message || "No se pudo preparar Amazon dry-run");
      setAmazonShipment(payload.shipment);
      void loadAmazonShipments();
      if (!options.quiet) setNotice(`Amazon preparado: ${payload.shipment.amazonOrderId} · ${payload.shipment.carrier} · ${payload.shipment.tracking}.`);
      return payload.shipment;
    } catch (error) {
      if (!options.quiet) setNotice(error instanceof Error ? `Amazon pendiente: ${error.message}` : "Amazon pendiente: no se pudo preparar el tracking");
      return null;
    } finally {
      if (!options.quiet) setAmazonLoading(false);
    }
  };

  const sendAmazonTracking = async () => {
    const prepared = amazonShipment ?? await prepareAmazonTrackingDryRun();
    if (!prepared) return;
    setAmazonLoading(true);
    try {
      const response = await apiFetch(`/api/amazon-sp-api/shipments/${encodeURIComponent(prepared.id)}/send`, { method: "POST" });
      const payload = await response.json() as { shipment?: AmazonShipmentRecord; dryRun?: boolean; message?: string };
      if (!response.ok || !payload.shipment) throw new Error(payload.message || "No se pudo enviar tracking Amazon");
      setAmazonShipment(payload.shipment);
      void loadAmazonShipments();
      setNotice(payload.dryRun
        ? "Amazon dry-run ejecutado. No se ha enviado nada real; la peticion queda registrada para revisar."
        : `Tracking enviado a Amazon para ${payload.shipment.amazonOrderId}. Queda registrado en Historial.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo enviar tracking Amazon");
    } finally {
      setAmazonLoading(false);
    }
  };

  const retryAmazonTracking = async () => {
    if (!amazonShipment) return;
    setAmazonLoading(true);
    try {
      const response = await apiFetch(`/api/amazon-sp-api/shipments/${encodeURIComponent(amazonShipment.id)}/retry`, { method: "POST" });
      const payload = await response.json() as { shipment?: AmazonShipmentRecord; dryRun?: boolean; message?: string };
      if (!response.ok || !payload.shipment) throw new Error(payload.message || "No se pudo reintentar Amazon");
      setAmazonShipment(payload.shipment);
      void loadAmazonShipments();
      setNotice(payload.dryRun ? "Reintento Amazon simulado. No se ha enviado nada real." : "Reintento Amazon enviado.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo reintentar Amazon");
    } finally {
      setAmazonLoading(false);
    }
  };

  const sendAmazonTrackingFromHistory = async (label: GeneratedShippingLabelRecord) => {
    const amazonOrderId = label.externalOrderRef || label.orderRefs.find((reference) => /^\d{3}-\d{7}-\d{7}$/.test(reference)) || "";
    const tracking = label.tracking || label.shipmentCode;
    const carrier = label.shipper || (getCarrierFromLabelRecord(label) === "mrw" ? "MRW" : getCarrierFromLabelRecord(label) === "correos-express" ? "Correos Express" : "Genei");
    if (!amazonOrderId) {
      setNotice("Historial: esta etiqueta no tiene numero de pedido Amazon.");
      return;
    }
    if (!tracking) {
      setNotice(`Historial: ${amazonOrderId} no tiene tracking para enviar a Amazon.`);
      return;
    }
    setAmazonLoading(true);
    try {
      const prepareResponse = await apiFetch("/api/amazon-sp-api/shipments/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderRef: amazonOrderId,
          amazonOrderId,
          geneiShipmentCode: label.shipmentCode,
          tracking,
          trackingUrl: label.trackingUrl,
          carrier,
          carrierCode: carrier,
          shippingMethod: carrier,
          shipmentDate: label.createdAt || new Date().toISOString(),
        }),
      });
      const preparedPayload = await prepareResponse.json() as { shipment?: AmazonShipmentRecord; message?: string };
      if (!prepareResponse.ok || !preparedPayload.shipment) throw new Error(preparedPayload.message || "No se pudo preparar Amazon desde historial");
      const sendResponse = await apiFetch(`/api/amazon-sp-api/shipments/${encodeURIComponent(preparedPayload.shipment.id)}/send`, { method: "POST" });
      const sentPayload = await sendResponse.json() as { shipment?: AmazonShipmentRecord; dryRun?: boolean; message?: string };
      if (!sendResponse.ok || !sentPayload.shipment) throw new Error(sentPayload.message || "No se pudo enviar Amazon desde historial");
      setAmazonShipment(sentPayload.shipment);
      await loadAmazonShipments();
      setNotice(sentPayload.dryRun
        ? `Amazon dry-run registrado para ${amazonOrderId}; no se envio real.`
        : `Tracking ${tracking} enviado a Amazon para ${amazonOrderId}.`);
    } catch (error) {
      setNotice(error instanceof Error ? `Amazon historial: ${error.message}` : "Amazon historial: error al enviar tracking");
    } finally {
      setAmazonLoading(false);
    }
  };

  const hasSentAmazonTracking = (targetOrder: Order) => {
    const amazonOrderId = getOrderExternalRef(targetOrder);
    if (!amazonOrderId) return false;
    return amazonShipments.some((item) => item.amazonOrderId === amazonOrderId && item.status === "sent" && !item.dryRun);
  };

  const queueAmazonTracking = async (
    shipmentCode: string,
    targetOrder: Order,
    options: {
      carrier?: string;
      carrierStatus?: string;
      shipmentDate?: string;
      tracking?: string;
      trackingUrl?: string;
    } = {},
  ) => {
    if (hasSentAmazonTracking(targetOrder)) return true;
    return Boolean(await prepareAmazonTrackingDryRun(shipmentCode, targetOrder, { quiet: true, updateLabelRecord: true, ...options }));
  };

  const buildPrestashopPayload = (targetOrder: Order, trackingNumber: string, provider: string, serviceCode?: string) => ({
    channel: targetOrder.channel,
    odooOrderId: targetOrder.odooRef || targetOrder.id,
    prestashopOrderId: getPrestashopOrderId(targetOrder),
    trackingNumber,
    provider,
    serviceCode: serviceCode || "",
  });

  const preparePrestashopTracking = async (targetOrder: Order, trackingNumber: string, provider: string, serviceCode?: string) => {
    if (!isPrestashopOrder(targetOrder) || !trackingNumber) return null;
    const payload = buildPrestashopPayload(targetOrder, trackingNumber, provider, serviceCode);
    if (!payload.prestashopOrderId) {
      setNotice("Etiqueta creada. PrestaShop pendiente: Odoo no trae id_order numerico en externalRef/origin.");
      return null;
    }
    try {
      const response = await apiFetch("/api/prestashop/tracking/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { tracking?: PrestashopTrackingRecord; message?: string };
      if (!response.ok || !result.tracking) throw new Error(result.message || "No se pudo preparar PrestaShop");
      setPrestashopTracking(result.tracking);
      return result.tracking;
    } catch (error) {
      setNotice(error instanceof Error ? `Etiqueta creada. PrestaShop pendiente: ${error.message}` : "Etiqueta creada. PrestaShop pendiente.");
      return null;
    }
  };

  const retryPrestashopTracking = async () => {
    if (!order || !existingShipmentCode) return;
    setPrestashopLoading(true);
    try {
      const response = await apiFetch("/api/prestashop/tracking/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPrestashopPayload(
          order,
          existingShipmentCode,
          existingShipmentCarrier === "mrw" ? "MRW" : existingShipmentCarrier === "correos-express" ? "Correos Express" : "Genei",
          transportRule?.service,
        )),
      });
      const payload = await response.json() as { tracking?: PrestashopTrackingRecord; message?: string };
      if (!response.ok || !payload.tracking) throw new Error(payload.message || "No se pudo sincronizar PrestaShop");
      setPrestashopTracking(payload.tracking);
      setNotice(payload.tracking.status === "SYNCED" ? "Seguimiento enviado a PrestaShop." : `PrestaShop: ${payload.tracking.status}`);
    } catch (error) {
      setNotice(error instanceof Error ? `PrestaShop error: ${error.message}` : "PrestaShop error");
    } finally {
      setPrestashopLoading(false);
    }
  };

  const runPostLabelWorkflow = async (
    shipmentCode: string,
    targetOrder: Order,
    options: {
      carrier?: string;
      carrierStatus?: string;
      shipmentDate?: string;
      tracking?: string;
      trackingUrl?: string;
    } = {},
  ) => {
    let amazonDone = false;
    try {
      if (hasSentAmazonTracking(targetOrder)) {
        amazonDone = true;
      } else {
        const prepared = await prepareAmazonTrackingDryRun(shipmentCode, targetOrder, { quiet: true, updateLabelRecord: true, ...options });
        if (prepared) {
          const response = await apiFetch(`/api/amazon-sp-api/shipments/${encodeURIComponent(prepared.id)}/send`, { method: "POST" });
          const payload = await response.json() as { shipment?: AmazonShipmentRecord; dryRun?: boolean; message?: string };
          if (!response.ok || !payload.shipment) throw new Error(payload.message || "No se pudo enviar tracking Amazon");
          setAmazonShipment(payload.shipment);
          amazonDone = payload.shipment.status === "sent" && !payload.dryRun;
          void loadAmazonShipments();
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? `Etiqueta impresa. Amazon queda pendiente: ${error.message}` : "Etiqueta impresa. Amazon queda pendiente.");
    }

    try {
      await validateLabelDeliveryInOdoo(shipmentCode, targetOrder, { background: true, amazonDone });
    } catch {
      // validateLabelDeliveryInOdoo already surfaces the operational error in the notice.
    }
  };

  const saveShippingRule = async (rule: ShippingRule) => {
    setSettingsLoading(true);
    try {
      const response = await apiFetch(`/api/expeditions/settings/rules/${encodeURIComponent(rule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      const payload = await response.json() as { settings?: ExpeditionsSettings; message?: string };
      if (!response.ok || !payload.settings) throw new Error(payload.message || "No se pudo guardar la regla");
      setExpeditionsSettings(payload.settings);
      setNotice(`Regla "${rule.name}" guardada.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo guardar la regla");
    } finally {
      setSettingsLoading(false);
    }
  };

  const createShippingRule = async () => {
    setSettingsLoading(true);
    try {
      const response = await apiFetch("/api/expeditions/settings/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nueva regla", connector: "genei", countries: [], serviceFilter: "" }),
      });
      const payload = await response.json() as { settings?: ExpeditionsSettings; message?: string };
      if (!response.ok || !payload.settings) throw new Error(payload.message || "No se pudo crear la regla");
      setExpeditionsSettings(payload.settings);
      setNotice("Nueva regla de envio creada.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo crear la regla");
    } finally {
      setSettingsLoading(false);
    }
  };

  const deleteShippingRule = async (rule: ShippingRule) => {
    if (!window.confirm(`¿Eliminar la regla "${rule.name}"?`)) return;
    setSettingsLoading(true);
    try {
      const response = await apiFetch(`/api/expeditions/settings/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      const payload = await response.json() as { settings?: ExpeditionsSettings; message?: string };
      if (!response.ok || !payload.settings) throw new Error(payload.message || "No se pudo eliminar la regla");
      setExpeditionsSettings(payload.settings);
      setNotice(`Regla "${rule.name}" eliminada.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo eliminar la regla");
    } finally {
      setSettingsLoading(false);
    }
  };

  const updateLocalRule = (ruleId: string, patch: Partial<ShippingRule>) => {
    setExpeditionsSettings((current) => ({
      ...current,
      rules: current.rules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule),
    }));
  };

  const getShipmentExternalReference = (referenceOverride?: string, orderOverride?: Order) => {
    const targetOrder = orderOverride ?? order;
    const explicitReference = normalizeScanReference(referenceOverride);
    if (explicitReference) return explicitReference;
    if (orderOverride) return targetOrder?.externalRef || targetOrder?.id || targetOrder?.odooRef || "";
    return normalizeScanReference(labelReference) || targetOrder?.externalRef || targetOrder?.id || targetOrder?.odooRef || "";
  };

  const validateLabelDeliveryInOdoo = async (
    shipmentCode: string,
    orderOverride?: Order,
    options: { background?: boolean; amazonDone?: boolean } = {},
  ) => {
    const targetOrder = orderOverride ?? order;
    if (!targetOrder) return;
    if (!options.background) setLoading(true);
    try {
      const result = await odooClient.validateOdooDeliveries([targetOrder.odooRef], {
        source: "dashboard-label",
        tracking: shipmentCode,
      });
      const incidentText = result.incidents?.length
        ? ` Incidencia: ${result.incidents[0].reason}`
        : "";
      setNotice(options.background
        ? `Etiqueta ${shipmentCode} impresa. Amazon${options.amazonDone ? " enviado" : " no aplica/pendiente"}. Odoo: ${result.validated ?? 0} entrega(s) validada(s).${incidentText}`
        : `Etiqueta ${shipmentCode} impresa. Odoo: ${result.validated ?? 0} entrega(s) validada(s).${incidentText}`);
      onRefreshOrders?.();
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo validar la entrega en Odoo"); }
    finally { if (!options.background) setLoading(false); }
  };

  const updateParcel = (id: number, field: keyof Omit<Parcel, "id">, value: string) =>
    setParcels((current) => current.map((parcel) => (parcel.id === id ? { ...parcel, [field]: value } : parcel)));
  const updateDestination = (field: keyof DestinationDraft, value: string) =>
    setDestinationDraft((current) => ({ ...current, [field]: value }));
  const restoreOdooDestination = async () => {
    if (!order) return;
    setLoading(true);
    try {
      const response = await apiFetch(`/api/expedition-destination-overrides/${encodeURIComponent(order.odooRef || order.id)}`, { method: "DELETE" });
      const payload = await readJsonResponse<{ message?: string }>(response);
      if (!response.ok) throw new Error(payload.message || "No se pudo restaurar la dirección de Odoo");
      const original: DestinationDraft = { name: order.shippingRecipient || order.client || "", address: order.shippingAddress || "", postalCode: order.shippingPostalCode || "", town: order.city.split(",")[0]?.trim() || "", country: resolveOrderCountryCode(order), phone: order.shippingPhone || "", email: order.shippingEmail || "" };
      setDestinationDraft(original); setDestinationOverride(null); setNotice("Dirección temporal eliminada. Se vuelve a usar la dirección de Odoo.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo restaurar la dirección de Odoo"); }
    finally { setLoading(false); }
  };
  const openCurrentLabel = (delivery: LabelDelivery, print = false) => {
    if (!existingShipmentCode) return;
    if (existingShipmentCarrier === "mrw") return openMrwLabel(existingShipmentCode, { delivery, print });
    if (existingShipmentCarrier === "correos-express") return openCorreosExpressLabel(existingShipmentCode, { delivery, print });
    if (existingShipmentCarrier === "dhl") return openDhlLabel(existingShipmentCode, { delivery, print });
    return openExistingLabel(delivery, print);
  };
  const cancelCurrentShipment = () => {
    if (existingShipmentCarrier === "mrw") return cancelMrwShipment();
    if (existingShipmentCarrier === "dhl") return cancelDhlShipment();
    return cancelGeneiShipment();
  };

  return (
    <div className="expeditions-view">
      {operationProgress ? (
        <div className="expeditions-progress-backdrop" role="status" aria-live="assertive">
          <div className="expeditions-progress-panel">
            <div className="expeditions-progress-spinner" aria-hidden="true" />
            <div>
              <h3>{operationProgress.title}</h3>
              <p>{operationProgress.detail}</p>
            </div>
            <div className="expeditions-progress-bar" aria-hidden="true"><span /></div>
          </div>
        </div>
      ) : null}
      <nav className="expeditions-subnav" aria-label="Secciones de Expediciones">
        <button className={section === "operativa" ? "active" : ""} onClick={() => setSection("operativa")} type="button"><ScanLine size={16} /> Operativa</button>
        <button className={section === "history" ? "active" : ""} onClick={() => setSection("history")} type="button"><PackageCheck size={16} /> Historial</button>
        <button className={section === "rules" ? "active" : ""} onClick={() => setSection("rules")} type="button"><Settings2 size={16} /> Reglas de envio</button>
        <button className={section === "station" ? "active" : ""} onClick={() => setSection("station")} type="button"><Printer size={16} /> Puesto e impresion</button>
        <button className={section === "integrations" ? "active" : ""} onClick={() => setSection("integrations")} type="button"><Truck size={16} /> Integraciones</button>
      </nav>

      {section === "operativa" ? <>
      <section className="expeditions-toolbar">
        <div className="mode-toggle" aria-label="Modo de expedicion">
          <button className={mode === "automatic" ? "active" : ""} onClick={() => { setMode("automatic"); setParcels([automaticParcel]); setSelectedQuote(0); }} type="button">Automatico</button>
          <button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")} type="button">Manual</button>
        </div>
        {isLabExpeditionsEnvironment() ? <label className="label-printer-select simulation-toggle"><input checked={simulateLabel} onChange={(event) => setSimulateLabel(event.target.checked)} type="checkbox" /><span>Simular etiqueta</span></label> : null}
        <label className="label-printer-select">
          <Printer size={16} />
          <select
            disabled={loading}
            onChange={(event) => setLabelPrinterId(event.target.value)}
            value={labelPrinterId}
          >
            {labelPrinterOptions.map((target) => (
              <option key={target.id} value={target.id}>{target.label}</option>
            ))}
          </select>
        </label>
        <button className="secondary-action" disabled={loading} onClick={() => void testQzTrayConnection()} type="button">Probar QZ</button>
        <span><Settings2 size={16} /> {mode === "automatic" ? "Un escaneo busca, genera o recupera la etiqueta e imprime." : "Puedes editar los bultos antes de generar la etiqueta."}</span>
      </section>
      {qzStatus ? <p className="expeditions-notice">{qzStatus}</p> : null}

      <section className="scan-panel">
        <div className="scan-icon"><ScanLine size={30} /></div>
        <div className="scan-copy"><strong>{activeWarehouseWorker ? `Pedido para ${activeWarehouseWorker.name}` : "Escanear QR de operario"}</strong><span>{activeWarehouseWorker ? "Escanea el pedido antes de 30 segundos" : "Después escanea el pedido para crear una etiqueta nueva"}</span></div>
        <input autoFocus disabled={loading} onChange={(event) => setScan(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void findOrder(); }} placeholder={activeWarehouseWorker ? "Referencia Odoo o Amazon" : "QR de operario (OP001)"} ref={scanInputRef} value={scan} />
        <button className="primary-action" disabled={loading} onClick={() => void findOrder()} type="button">{loading ? "Preparando..." : activeWarehouseWorker ? "Buscar pedido" : "Identificar"}</button>
      </section>
      <p className={`expeditions-notice ${orderFound ? "success" : ""}`}>{orderFound ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}{notice}</p>

      {!orderFound ? (
        <section className="expeditions-empty"><PackageCheck size={38} /><h3>{activeWarehouseWorker ? "Esperando el pedido" : "Esperando el QR de operario"}</h3><p>{activeWarehouseWorker ? "Escanea la referencia Odoo o Amazon." : "Escanea tu QR antes de preparar una etiqueta nueva."}</p></section>
      ) : (
        <div className="expeditions-grid">
          <section className="expeditions-card order-card">
            <div className="card-heading"><div><span>Número de pedido Odoo</span><h3>{order?.id || order?.odooRef}</h3></div><span className="status-chip">{order?.channel}</span></div>
            <dl className="order-summary"><div><dt>Destinatario de envío</dt><dd title={destinationDraft.name || order?.shippingRecipient || order?.client}>{destinationDraft.name || order?.shippingRecipient || order?.client}</dd></div><div><dt>Dirección de envío</dt><dd title={destinationDraft.address || order?.shippingAddress || "Falta direccion/calle"}>{destinationDraft.address || order?.shippingAddress || "Falta direccion/calle"}</dd></div></dl>
            {destinationOverride ? <p className="expeditions-notice"><CircleAlert size={16} /> Dirección temporal de Expediciones activa. Odoo no se modifica. <button className="secondary-action" disabled={loading} onClick={() => void restoreOdooDestination()} type="button">Restaurar Odoo</button></p> : null}
            <details className="destination-editor" open={mode === "manual" || getMissingDestinationFields(destinationDraft).length > 0}>
              <summary>Editar dirección y contacto</summary>
              <div className="destination-fields">
                <label className="destination-field-full">Nombre<input onChange={(event) => updateDestination("name", event.target.value)} value={destinationDraft.name} /></label>
                <label className="destination-field-full">Dirección<input className={!destinationDraft.address.trim() ? "missing" : ""} onChange={(event) => updateDestination("address", event.target.value)} placeholder="Calle y número" value={destinationDraft.address} /></label>
                <div className="destination-inline-fields"><label>CP<input onChange={(event) => updateDestination("postalCode", event.target.value)} value={destinationDraft.postalCode} /></label><label>Ciudad<input onChange={(event) => updateDestination("town", event.target.value)} value={destinationDraft.town} /></label><label>País<input onChange={(event) => updateDestination("country", event.target.value.toUpperCase())} value={destinationDraft.country} /></label></div>
                <div className="destination-inline-fields"><label>Teléfono<input onChange={(event) => updateDestination("phone", event.target.value)} value={destinationDraft.phone} /></label><label>Email<input onChange={(event) => updateDestination("email", event.target.value)} value={destinationDraft.email} /></label></div>
              </div>
            </details>
            <div className="parcel-summary-actions">
              <details className="parcel-editor" onToggle={(event) => setParcelEditorOpen((event.currentTarget as HTMLDetailsElement).open)} open={parcelEditorOpen}>
                <summary><span>Bultos</span><strong>{parcels.length} {parcels.length === 1 ? "bulto" : "bultos"} · {totalWeight.toLocaleString("es-ES")} kg</strong></summary>
              <div className="parcel-editor-body">
                {parcels.map((parcel, index) => <div className="parcel-row" key={parcel.id}><strong>Bulto {index + 1}</strong>{(["weight", "length", "width", "height"] as const).map((field) => <label key={field}>{field === "weight" ? "kg" : field === "length" ? "largo" : field === "width" ? "ancho" : "alto"}<input disabled={mode === "automatic"} inputMode="decimal" onChange={(event) => updateParcel(parcel.id, field, event.target.value)} value={parcel[field]} /></label>)}{mode === "manual" && parcels.length > 1 && <button aria-label="Quitar bulto" className="remove-parcel" onClick={() => setParcels((current) => current.filter((item) => item.id !== parcel.id))} type="button">×</button>}</div>)}
              </div>
              </details>
              <div className="parcel-summary-buttons"><button className="secondary-action" onClick={() => { setMode("manual"); setParcelEditorOpen(true); }} type="button">Editar bultos</button><button className="add-parcel-button" onClick={() => { setMode("manual"); setParcelEditorOpen(true); setParcels((current) => [...current, { id: Date.now(), weight: "1", length: "30", width: "20", height: "15" }]); }} type="button">+ Añadir bulto</button></div>
            </div>
            {mode === "manual" ? <button className="refresh-corrected-action" disabled={loading} onClick={() => void refreshManualPreparation()} type="button">Guardar y actualizar datos corregidos</button> : null}
          </section>

          {["mrw", "correos-express", "dhl"].includes(transportRule?.carrier || "") ? (
          <section className="expeditions-card quote-card">
            <div className="shipment-rule-card"><span className="shipment-rule-icon"><Truck size={21} /></span><div><span>Regla de envío</span><h3>{transportRule.appliedRule?.name || "Regla pendiente"}</h3><p>{transportRule.carrier === "mrw" ? "MRW" : transportRule.carrier === "correos-express" ? "Correos Express" : "DHL"} · {shippingServiceLabel(transportRule.service)}</p></div></div>
            {labelHistoryBlock}
            {mode === "manual" ? <label className="manual-rule-select">{reissueContext ? "Elegir transportista para la reemisión" : "Cambiar regla manualmente"}<select disabled={loading} onChange={(event) => { const nextRuleId = event.target.value; setManualRuleId(nextRuleId); void refreshManualPreparation(nextRuleId); }} value={manualRuleId}>{manualRules.filter((rule) => !eligibleManualRuleIds || eligibleManualRuleIds.includes(rule.id)).map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · {rule.carrier}</option>)}</select><small>{reissueContext ? "Solo se muestran reglas aptas para este envío. La elección se aplicará únicamente a la nueva etiqueta." : "La regla elegida se aplicará solo a esta etiqueta."}</small></label> : null}
          </section>
          ) : (
          <section className="expeditions-card quote-card">
            <div className="card-heading"><div><span>Transportista</span><h3>{quotes[selectedQuote]?.nombre_agencia || "Sin transportista"}</h3></div><span className="status-chip">{quotes.length ? "Genei" : "Pendiente"}</span></div>
            <p className="carrier-help">{quotes.length ? "Servicio y precio obtenidos mediante Genei." : "No hay transportista disponible para los datos actuales."}</p>
            {labelHistoryBlock}
            <div className="quote-list">
              {quotes.map((quote, index) => { const total = Number(quote.importe); const base = Number(quote.importe_sin_iva ?? total / (1 + Number(quote.iva ?? 21) / 100)); return <label className={selectedQuote === index ? "quote selected" : "quote"} key={`${quote.id_agencia}-${index}`}><input checked={selectedQuote === index} disabled={mode === "automatic"} name="quote" onChange={() => setSelectedQuote(index)} type="radio" /><div><strong>{quote.nombre_agencia}</strong><span>{quote.servicio_horas ? `${quote.servicio_horas} h` : "Servicio disponible"}{mode === "automatic" && index === 0 ? " · Seleccionado por regla" : ""}</span><span>{base.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} + IVA</span></div><b>{total.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</b></label>; })}
            </div>
          </section>
          )}

          <section className="expeditions-card action-card">
            <span>Ultimo paso</span><h3>{shipment ? "Envio creado" : "Crear e imprimir"}</h3>
            <label className="label-reference-field">
              Referencia etiqueta
              <input
                disabled={loading}
                onChange={(event) => setLabelReference(event.target.value)}
                placeholder="Amazon / Prestashop / referencia canal"
                value={labelReference}
              />
              <small>Se envia a Genei como referencia externa para localizar la etiqueta por pedido.</small>
            </label>
            <label className="odoo-auto-validate">
              <input
                checked={validateInOdooAfterLabel}
                disabled={loading}
                onChange={(event) => setValidateInOdooAfterLabel(event.target.checked)}
                type="checkbox"
              />
              Validar entrega en Odoo al reimprimir etiqueta
            </label>
            {existingShipmentCode ? (
              <>
                <div className="shipment-success">
                  <CheckCircle2 size={25} />
                  <div>
                    <strong>Etiqueta {existingShipmentCarrier === "mrw" ? "MRW" : existingShipmentCarrier === "correos-express" ? "Correos Express" : existingShipmentCarrier === "dhl" ? "DHL" : "Genei"} · {existingShipmentCode}</strong>
                    <span>{existingShipmentCreatedAt ? `Generada el ${existingShipmentCreatedAt}. ` : ""}Recuperacion directa desde el transportista: no se guarda ningun PDF en el equipo.</span>
                    <div className="settings-demo-actions">
                      <button className="action-primary" disabled={loading} onClick={() => void openCurrentLabel("inline-print", true)} type="button">Imprimir etiqueta</button>
                      <button className="secondary-action" disabled={loading} onClick={() => void openCurrentLabel("download")} type="button">Descargar etiqueta</button>
                      <button className="secondary-action" disabled={loading} onClick={() => void openCurrentLabel("popup", false)} type="button">Abrir PDF</button>
                      {isPrestashopOrder(order) ? <button className="secondary-action" disabled={loading || prestashopLoading} onClick={() => void retryPrestashopTracking()} type="button">Reintentar seguimiento PrestaShop</button> : null}
                      {existingShipmentCarrier !== "correos-express" ? <button className="danger-action" disabled={loading} onClick={() => void cancelCurrentShipment()} type="button">Cancelar etiqueta</button> : <span className="cancel-unavailable">La cancelación de Correos Express sigue pendiente de su conector.</span>}
                      {existingShipmentCarrier === "mrw" && mrwReissueAvailable ? <div className="controlled-reissue"><label>Motivo de reemisión<input disabled={loading} onChange={(event) => setReissueReason(event.target.value)} placeholder="Ej.: cambiar a 2 bultos" value={reissueReason} /></label><button className="secondary-action" disabled={loading || !reissueReason.trim()} onClick={() => void beginControlledMrwReissue()} type="button">Reemitir etiqueta</button></div> : null}
                      {existingShipmentCarrier === "genei" ? <button className="secondary-action" disabled={loading} onClick={() => void unlinkGeneiShipment()} type="button">Desvincular pedido</button> : null}
                    </div>
                  </div>
                </div>
                {amazonShipment ? (
                  <div className="amazon-shipment-state">
                    <strong>Amazon: {amazonShipment.status === "pending" ? "Pendiente" : amazonShipment.status === "sent" ? "Enviado" : amazonShipment.status === "retrying" ? "Reintentando" : "Error"}</strong>
                    <span>{amazonShipment.dryRun ? "Modo simulacion. " : ""}{amazonShipment.carrier} · {amazonShipment.tracking}{amazonShipment.lastError ? ` · ${amazonShipment.lastError}` : ""}</span>
                  </div>
                ) : null}
                {isPrestashopOrder(order) ? (
                  <div className="amazon-shipment-state">
                    <strong>PrestaShop: {prestashopTracking?.status === "SYNCED" ? "Enviado" : prestashopTracking?.status === "ERROR" ? "Error" : "Pendiente"}</strong>
                    <span>
                      Tracking: {prestashopTracking?.trackingNumber || existingShipmentCode}
                      {prestashopTracking?.syncedAt ? ` · Sincronizado: ${formatExistingLabelDate(prestashopTracking.syncedAt)}` : " · Sin sincronizar"}
                      {prestashopTracking?.lastError ? ` · ${prestashopTracking.lastError}` : ""}
                    </span>
                  </div>
                ) : null}
              </>
            ) : testShipmentCode ? (
              <div className="shipment-success">
                <CheckCircle2 size={25} />
                <div>
                  <strong>Prueba Genei · {testShipmentCode}</strong>
                  <span>Envio pendiente de pago. No se ha generado ningun cargo.</span>
                  <div className="settings-demo-actions">
                    <button className="secondary-action" disabled={loading} onClick={() => void cancelTestShipment()} type="button">Cancelar prueba</button>
                    <button className="secondary-action" disabled={loading} onClick={resetShipmentFlow} type="button">Cancelar y nuevo escaneo</button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p>{["mrw", "correos-express", "dhl"].includes(transportRule?.carrier || "") ? `La regla ha seleccionado ${transportRule.carrier === "mrw" ? "MRW" : transportRule.carrier === "correos-express" ? "Correos Express" : "DHL"}. Al generar etiqueta se usara el servicio indicado por la regla.` : "Falta el segundo escaneo del mismo pedido. Ese segundo escaneo generara y pagara la etiqueta, abrira la impresion y dejara Amazon/Odoo trabajando en segundo plano."}</p>
                <button className="action-primary full" disabled={loading} onClick={() => void (transportRule?.carrier === "mrw" ? createMrwShipment({ delivery: "inline-print", print: true }) : transportRule?.carrier === "correos-express" ? createCorreosExpressShipment({ delivery: "inline-print", print: true }) : transportRule?.carrier === "dhl" ? createDhlShipment({ delivery: "inline-print", print: true }) : createAndPayManualShipment({ delivery: "inline-print", print: true }))} type="button">Generar e imprimir etiqueta</button>
                <button className="secondary-action full" disabled={loading} onClick={() => void (transportRule?.carrier === "mrw" ? createMrwShipment({ delivery: "download" }) : transportRule?.carrier === "correos-express" ? createCorreosExpressShipment({ delivery: "download" }) : transportRule?.carrier === "dhl" ? createDhlShipment({ delivery: "download" }) : createAndPayManualShipment({ delivery: "download" }))} type="button">Generar y descargar etiqueta</button>
                <button className="secondary-action full" disabled={loading} onClick={resetShipmentFlow} type="button">Cancelar y nuevo escaneo</button>
              </>
            )}
          </section>
        </div>
      )}</> : section === "workers" ? (
        <section className="expeditions-card" style={{ maxWidth: 880, margin: "28px auto" }}>
          <div className="card-heading"><div><span>Configuración</span><h3>Operarios de almacén</h3></div><span className="status-chip">QR obligatorio</span></div>
          <p className="carrier-help">Crea los operarios que necesites. Cada etiqueta nueva exige escanear un QR activo; una reimpresión no lo solicita.</p>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, alignItems: "end", marginBottom: 18 }}><label>Nombre del operario<input onChange={(event) => setNewWorkerName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createWarehouseWorker(); }} placeholder="Ej. Juan García" value={newWorkerName} /></label><button className="action-primary" onClick={() => void createWarehouseWorker()} style={{ minHeight: 42 }} type="button">Crear OP correlativo</button></div>
          <div className="quote-list">
            {warehouseWorkers.length ? warehouseWorkers.map((worker) => <div className="quote selected" key={worker.id}><div><strong>{worker.name}</strong><span>{worker.code} · {worker.active ? "Activo" : "Inactivo"}</span></div><div className="settings-demo-actions"><button className="secondary-action" onClick={() => void downloadWorkerQr(worker)} type="button">Descargar QR</button><button className="secondary-action" onClick={async () => { const name = window.prompt("Nombre del operario", worker.name); if (name === null) return; const response = await apiFetch(`/api/warehouse-workers/${worker.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); const payload = await response.json() as { workers?: WarehouseWorker[] }; if (response.ok) setWarehouseWorkers(payload.workers || []); }} type="button">Editar</button><button className="secondary-action" onClick={async () => { const response = await apiFetch(`/api/warehouse-workers/${worker.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !worker.active }) }); const payload = await response.json() as { workers?: WarehouseWorker[] }; if (response.ok) setWarehouseWorkers(payload.workers || []); }} type="button">{worker.active ? "Desactivar" : "Activar"}</button></div></div>) : <p className="carrier-help">Aún no hay operarios. Crea el primero para descargar e imprimir su QR.</p>}
          </div>
        </section>
      ) : <ExpeditionsSettingsDemo
        connectors={expeditionsSettings.connectors}
        onCreateRule={createShippingRule}
        onDeleteRule={deleteShippingRule}
        onSaveRule={saveShippingRule}
        onUpdateRule={updateLocalRule}
        amazonShipments={amazonShipments}
        generatedLabels={generatedLabels}
        historyFilters={historyFilters}
        historyReturned={historyReturned}
        historyTotal={historyTotal}
        onSendAmazonFromHistory={sendAmazonTrackingFromHistory}
        onRefreshHistory={loadExpeditionsHistory}
        onUpdateHistoryFilters={setHistoryFilters}
        rules={expeditionsSettings.rules}
        saving={settingsLoading}
        section={section}
      />}
    </div>
  );
}

function ExpeditionsSettingsDemo({
  amazonShipments,
  connectors,
  generatedLabels,
  historyFilters,
  historyReturned,
  historyTotal,
  onRefreshHistory,
  onSendAmazonFromHistory,
  onUpdateHistoryFilters,
  onCreateRule,
  onDeleteRule,
  onSaveRule,
  onUpdateRule,
  rules,
  saving,
  section,
}: {
  amazonShipments: AmazonShipmentRecord[];
  connectors: ExpeditionsSettings["connectors"];
  generatedLabels: GeneratedShippingLabelRecord[];
  historyFilters: HistoryFilters;
  historyReturned: number;
  historyTotal: number;
  onRefreshHistory: () => void;
  onSendAmazonFromHistory: (label: GeneratedShippingLabelRecord) => void;
  onUpdateHistoryFilters: (filters: HistoryFilters) => void;
  onCreateRule: () => void;
  onDeleteRule: (rule: ShippingRule) => void;
  onSaveRule: (rule: ShippingRule) => void;
  onUpdateRule: (ruleId: string, patch: Partial<ShippingRule>) => void;
  rules: ShippingRule[];
  saving: boolean;
  section: "history" | "rules" | "station" | "integrations";
}) {
  if (section === "history") return <ExpeditionsHistory labels={generatedLabels} amazonShipments={amazonShipments} filters={historyFilters} returned={historyReturned} total={historyTotal} onRefresh={onRefreshHistory} onUpdateFilters={onUpdateHistoryFilters} />;
  if (section === "rules") return <ShippingRulesManager />;
  if (section === "station") return <section className="settings-demo"><div className="settings-demo-head"><div><span>PUESTO DE TRABAJO</span><h3>Preparacion 1</h3><p>Esta configuracion se guardara en cada ordenador, no por usuario.</p></div><span className="station-ok">Conectada</span></div><div className="station-settings"><label>Modo de trabajo<select defaultValue="automatic"><option value="automatic">Automatico</option><option value="manual">Manual</option></select></label><label>Impresora de etiquetas<select defaultValue="Zebra ZD421"><option>Zebra ZD421</option><option>Honeywell PC42t</option></select></label><label>Impresora de albaranes<select defaultValue="Microsoft Print to PDF"><option>Microsoft Print to PDF</option><option>HP Office</option></select></label><label>Perfil de caja por defecto<select defaultValue="Caja estandar S"><option>Caja estandar S · 30 × 20 × 15</option><option>Caja estandar M · 40 × 30 × 20</option></select></label></div><div className="settings-demo-actions"><button className="secondary-action" type="button">Imprimir prueba</button><button className="primary-action" type="button">Guardar configuracion</button></div></section>;
  return <section className="settings-demo"><div className="settings-demo-head"><div><span>INTEGRACIONES</span><h3>Conectores de envio</h3><p>Las reglas deciden que conector se usa para cada destino.</p></div></div><div className="integration-grid">{connectors.map((connector) => <article key={connector.id}><h4>{connector.label}</h4><p>{connector.id === "genei" ? "Agregador activo: permite elegir servicios de agencias integradas en Genei." : "Conector heredado pendiente de retirar del flujo nuevo."}</p><span className="integration-state">{connector.ready ? "Disponible" : "Preparado"}</span></article>)}<article><h4>MRW directo</h4><p>Conector SOAP SAGEC preparado para MRW 19, MRW 14, EtiquetaEnvio y CancelarEnvio.</p><span className="integration-state">Lab</span></article><article><h4>Correos Express / DHL</h4><p>Disponibles en el catalogo de reglas como transportistas futuros; generacion directa pendiente de credenciales/API.</p><span className="integration-state">Preparado</span></article><article><h4>Amazon SP-API</h4><p>Confirmacion real de tracking controlada por dry-run y allowlist.</p><span className="integration-state">Controlado</span></article></div><div className="settings-demo-note"><CircleAlert size={17} /> La activacion real de nuevos conectores se hara en lab y con aprobacion explicita antes de produccion.</div></section>;
}

function ExpeditionsHistory({
  amazonShipments,
  filters,
  labels,
  onRefresh,
  onUpdateFilters,
  returned,
  total,
}: {
  amazonShipments: AmazonShipmentRecord[];
  filters: HistoryFilters;
  labels: GeneratedShippingLabelRecord[];
  onRefresh: () => void;
  onUpdateFilters: (filters: HistoryFilters) => void;
  returned: number;
  total: number;
}) {
  const historyColumns = [
    { id: "externalRef", label: "Num. Pedido Ext.", width: 170 },
    { id: "odooRef", label: "Num. Odoo", width: 120 },
    { id: "tracking", label: "Tracking", width: 180 },
    { id: "shipper", label: "Shipper", width: 170 },
    { id: "createdAt", label: "Fecha", width: 150 },
    { id: "operator", label: "Operario", width: 170 },
    { id: "client", label: "Cliente", width: 220 },
    { id: "status", label: "Estado", width: 220 },
    { id: "source", label: "Origen", width: 130 },
    { id: "refs", label: "Referencias", width: 260 },
  ] as const;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => Object.fromEntries(historyColumns.map((column) => [column.id, column.width])),
  );
  const gridTemplateColumns = historyColumns
    .map((column) => `${columnWidths[column.id] ?? column.width}px`)
    .join(" ");
  const startColumnResize = (event: ReactPointerEvent<HTMLButtonElement>, columnId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[columnId] ?? historyColumns.find((column) => column.id === columnId)?.width ?? 140;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(80, startWidth + moveEvent.clientX - startX);
      setColumnWidths((current) => ({ ...current, [columnId]: nextWidth }));
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };
  const amazonByExternalRef = new Map(amazonShipments.map((shipment) => [normalizeReference(shipment.amazonOrderId), shipment]));
  const amazonByShipmentCode = new Map(amazonShipments
    .filter((shipment) => shipment.geneiShipmentCode)
    .map((shipment) => [normalizeReference(shipment.geneiShipmentCode), shipment]));
  const seenAmazonOrders = new Set<string>();
  const hasActiveFilters = Object.entries(filters).some(([key, value]) => key !== "limit" && value.trim());
  const hasDateFilter = Boolean(filters.from || filters.to);
  const limitOptions = hasDateFilter ? ["100", "200", "500", "1000", "2000"] : ["100", "200", "500"];
  const updateFilter = (field: keyof HistoryFilters, value: string) => {
    const next = { ...filters, [field]: value };
    if ((field === "from" || field === "to") && !next.from && !next.to && Number(next.limit) > 500) next.limit = "500";
    if (field === "limit" && Number(value) > 500 && !hasDateFilter) next.limit = "500";
    onUpdateFilters(next);
  };
  const clearFilters = () => onUpdateFilters(defaultHistoryFilters);
  const labelRows = labels.map((label) => {
    const externalRef = label.externalOrderRef || label.orderRefs.find((reference) => /^\d{3}-\d{7}-\d{7}$/.test(reference)) || "";
    const amazon = amazonByShipmentCode.get(normalizeReference(label.shipmentCode)) ?? amazonByExternalRef.get(normalizeReference(externalRef));
    if (amazon) seenAmazonOrders.add(normalizeReference(amazon.amazonOrderId));
    const isAmazonOrder = /^\d{3}-\d{7}-\d{7}$/.test(externalRef);
    const hasTracking = Boolean(label.tracking || label.shipmentCode);
    const amazonStatus = amazonStatusLabel(amazon) || (isAmazonOrder && hasTracking ? "Amazon pendiente" : "");
    return {
      id: label.shipmentCode,
      label,
      canSendAmazon: isAmazonOrder && hasTracking && amazon?.status !== "sent",
      shipmentCode: label.shipmentCode,
      externalRef: externalRef || amazon?.amazonOrderId || label.orderRefs.find((reference) => /^S\d+$/i.test(reference)) || "-",
      odooRef: label.orderRefs.find((reference) => /^S\d+$/i.test(reference)) || label.odooOrderRef || amazon?.saleOrderName || "-",
      tracking: label.tracking || amazon?.tracking || "",
      trackingUrl: label.trackingUrl || amazon?.trackingUrl || "",
      trackingCountry: label.trackingCountry || "",
      trackingPostalCode: label.trackingPostalCode || "",
      trackingAddress: label.trackingAddress || "",
      shipper: label.shipper || amazon?.carrier || "-",
      createdAt: label.createdAt,
      operator: label.operator || "Sin registrar",
      client: label.client || "-",
      status: [label.carrierStatus, amazonStatus].filter(Boolean).join(" · ") || "-",
      source: label.source || "Dashboard",
      refs: label.orderRefs.join(", ") || "-",
    };
  });
  const amazonOnlyRows = hasActiveFilters ? [] : amazonShipments
    .filter((shipment) => !seenAmazonOrders.has(normalizeReference(shipment.amazonOrderId)))
    .slice(0, 50)
    .map((shipment) => ({
      id: shipment.id,
      label: null,
      canSendAmazon: false,
      shipmentCode: shipment.geneiShipmentCode || shipment.id,
      externalRef: shipment.amazonOrderId,
      odooRef: shipment.saleOrderName || "-",
      tracking: shipment.tracking || "",
      trackingUrl: shipment.trackingUrl || "",
      shipper: shipment.carrier || "-",
      createdAt: shipment.sentAt || shipment.updatedAt || shipment.createdAt,
      operator: "Sin registrar",
      client: "-",
      status: amazonStatusLabel(shipment) || "-",
      source: shipment.dryRun ? "Amazon dry-run" : "Amazon",
      refs: [shipment.amazonOrderId, shipment.saleOrderName, shipment.geneiShipmentCode].filter(Boolean).join(", ") || "-",
    }));
  const rows = [...labelRows, ...amazonOnlyRows];
  return (
    <div className="amazon-history">
      <div className="amazon-history-head">
        <div>
          <span>HISTORIAL</span>
          <h4>Etiquetas y seguimientos</h4>
        </div>
        <button className="secondary-action" onClick={onRefresh} type="button">Actualizar</button>
        <b>{returned}/{total}</b>
      </div>
      <div className="history-search-panel">
        <label>
          Buscar
          <input value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="Cliente, pedido, tracking..." />
        </label>
        <label>
          Cliente
          <input value={filters.client} onChange={(event) => updateFilter("client", event.target.value)} placeholder="Nombre cliente" />
        </label>
        <label>
          Pedido Odoo
          <input value={filters.odooRef} onChange={(event) => updateFilter("odooRef", event.target.value)} placeholder="S96197" />
        </label>
        <label>
          Ref. etiqueta
          <input value={filters.reference} onChange={(event) => updateFilter("reference", event.target.value)} placeholder="Amazon / PrestaShop" />
        </label>
        <label>
          Shipper
          <input value={filters.shipper} onChange={(event) => updateFilter("shipper", event.target.value)} placeholder="MRW, FedEx..." />
        </label>
        <label>
          Desde
          <input type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} />
        </label>
        <label>
          Operario
          <input value={filters.operator} onChange={(event) => updateFilter("operator", event.target.value)} placeholder="Operario" />
        </label>
        <label>
          Mostrar
          <select value={filters.limit} onChange={(event) => updateFilter("limit", event.target.value)}>
            {limitOptions.map((option) => <option value={option} key={option}>{option}</option>)}
          </select>
        </label>
        <button className="secondary-action compact-action" onClick={clearFilters} type="button">Limpiar</button>
      </div>
      {rows.length ? (
        <div className="amazon-history-table expeditions-history-table" role="table" aria-label="Historial de expediciones">
          <div className="amazon-history-row header" role="row" style={{ gridTemplateColumns }}>
            {historyColumns.map((column) => (
              <span className="amazon-history-cell amazon-history-header-cell" key={column.id}>
                {column.label}
                <button
                  aria-label={`Ajustar columna ${column.label}`}
                  className="amazon-history-resizer"
                  onPointerDown={(event) => startColumnResize(event, column.id)}
                  type="button"
                />
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <div className="amazon-history-row" role="row" key={row.id} style={{ gridTemplateColumns }}>
              <span className="amazon-history-cell">{row.externalRef || "-"}</span>
              <span className="amazon-history-cell">{row.odooRef || "-"}</span>
              <span className="amazon-history-cell">
                {row.tracking ? <><a className="tracking-link" href={buildPublicTrackingUrl(row)} target="_blank" rel="noopener noreferrer">{row.tracking}</a>{row.trackingUrl ? <a className="tracking-link" href={row.trackingUrl} target="_blank" rel="noopener noreferrer">Oficial ↗</a> : null}</> : <a className="tracking-link" href={buildPublicTrackingUrl({ tracking: "", shipper: row.shipper, status: row.status })} target="_blank" rel="noopener noreferrer">Sin seguimiento</a>}
              </span>
              <span className="amazon-history-cell">{row.shipper}</span>
              <span className="amazon-history-cell">{formatAmazonHistoryDate(row.createdAt)}</span>
              <span className="amazon-history-cell">{row.operator}</span>
              <span className="amazon-history-cell">{row.client}</span>
              <span className="amazon-history-cell">{row.status}</span>
              <span className="amazon-history-cell">{row.source}</span>
              <span className="amazon-history-cell">{row.refs}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="amazon-history-empty">Sin etiquetas registradas todavia.</div>
      )}
    </div>
  );
}

function amazonStatusLabel(shipment?: AmazonShipmentRecord) {
  if (!shipment) return "";
  if (shipment.status === "sent") return "Amazon enviado";
  if (shipment.status === "pending") return "Amazon pendiente";
  if (shipment.status === "retrying") return "Amazon reintentando";
  return shipment.lastError ? `Amazon error: ${shipment.lastError}` : "Amazon error";
}

function formatAmazonHistoryDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "medium" });
}
