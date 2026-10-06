// Bandeja documental Fase 2: extraccion local de PDF (pdf-parse), cotejo contra cache Odoo
// y registro documental persistente. SOLO LECTURA de Drive/Odoo. La IA/OCR externa queda
// para una fase posterior; aqui se usan heuristicas locales deterministas.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const pdfParse = createRequire(import.meta.url)("pdf-parse") as typeof import("pdf-parse");
import { DriveClient } from "./driveClient.ts";
import type { SupplierInvoiceStore } from "./types.ts";
import type {
  InboxDocument,
  InboxStore,
  DocumentMatch,
  DocumentMatchCriterion,
  PdfExtractedData,
  PdfExtractedLine,
  InboxKpis,
  UnbilledKpis,
  DocumentSource,
  DocumentType,
} from "./phase2Types.ts";

// ---------- Helpers numericos / normalizacion ----------

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function normalizeRate(s: string): string {
  // "EUR", "EUR ", "  €", "Euro" -> "EUR"; ISO o simbolo comun.
  const t = (s ?? "").toUpperCase().replace(/\s+/g, "").replace(/,/g, ".");
  if (/EUR|EURO/.test(t)) return "EUR";
  if (t === "€") return "EUR";
  if (t === "USD" || t === "$") return "USD";
  if (t === "GBP" || t === "£") return "GBP";
  if (t === "CNY" || t === "¥") return "CNY";
  return t || "EUR";
}

export function parseMoney(s: string): number | null {
  if (!s) return null;
  const t = s.replace(/[€$£\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const unitPrice3 = (value: string): number | null => {
  const price = parseMoney(value);
  return price == null ? null : Math.round(price * 1000) / 1000;
};

export function parseDate(s: string): string | null {
  // dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd
  if (!s) return null;
  const m1 = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m1) {
    const [_, dd, mm, yyyy] = m1;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return s.slice(0, 10);
  return null;
}

export function normalizeSupplierName(s: string | null): string {
  if (!s) return "";
  return s.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
}

// ---------- Clasificacion de tipo de documento (factura vs no-factura) ----------

const DOC_TYPE_PATTERNS: { type: DocumentType; label: string; re: RegExp }[] = [
  {
    type: "factura",
    label: "Factura",
    // Prioridad 1: si el documento se autodenomina factura, es factura.
    // (los certificados/albaranes de aduana rara vez dicen "factura").
    re: /\bfactura\b|\binvoice\b|factura\s+electr[óo]nica|\brechnung\b|\bfacture\b/i,
  },
  {
    type: "aduana",
    label: "Certificado/documento de aduana",
    // Certificado de importacion H1 (Agencia Tributaria), MRN, levante...
    re: /certificado\s+de\s+importaci|documento\s+\w*aduana|despacho\s+de\s+aduana|(?:^|\s)mrn\s*[a-z]{2}\d{12}|levante\s+\d|d\.?a\.?u\.?|declaraci[oó]n\s+\w*aduana|agencia\s+tributaria[^\n]{0,40}importaci/i,
  },
  {
    type: "transporte",
    label: "Documento de transporte",
    // Carta de porte (CMR), conocimiento de embarque, waybill
    re: /carta\s+de\s+porte|\bc\.?m\.?r\b|conocimiento\s+de\s+embarque|\bwaybill\b|bill\s+of\s+lading|\btransportista\b/i,
  },
  {
    type: "albaran",
    label: "Albarán / entrega",
    // Albaran, delivery note, packing list, remito
    re: /albar[áa]n|documento\s+de\s+entrega|delivery\s+note|packing\s+list|\bremito\b/i,
  },
];

/** Clasifica el tipo de documento por patrones de texto. Prioridad: aduana > transporte > albaran > factura. */
export function detectDocType(text: string, name = ""): { docType: DocumentType; label: string } {
  const hay = `${name}\n${text}`;
  for (const p of DOC_TYPE_PATTERNS) {
    if (p.re.test(hay)) return { docType: p.type, label: p.label };
  }
  return { docType: "otro", label: "Otro documento" };
}

// Un identificador fiscal debe contener letras; si se permiten sólo dígitos,
// números de factura/empleado como 05015781 acaban atribuyendo «Montador» como emisor.
const VAT_RE = /\b(?=[A-Z0-9]{8,12}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{1,2}\d{7,8}[A-Z0-9]?\b/i;

// ---------- Extraccion de texto plano ----------

function extractSupplier(lines: string[]): { supplier: string | null; vat: string | null; country: string | null } {
  // Heuristicas locales sobre facturas reales de proveedor de Todoelectrico.
  // El EMISOR es el proveedor; el cliente (Todoelectrico, B54685144) se excluye.
  const CLIENT_VAT = "B54685144";
  let supplier: string | null = null;
  let vat: string | null = null;
  let country: string | null = null;
  const isClientVat = (v: string) => v.replace(/[^A-Z0-9]/gi, "").toUpperCase().endsWith(CLIENT_VAT);

  // 1) Buscar VAT de emisor: primer VAT que NO sea el del cliente, con razon social cerca.
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    const m = line.match(VAT_RE);
    if (!m) continue;
    const candidate = m[0];
    if (isClientVat(candidate)) continue;
    vat = candidate;
    const prefix = candidate[0].toUpperCase();
    if (prefix === "B" || prefix === "A" || prefix === "N") country = "España";
    else if (prefix === "F") country = "Francia";
    else if (prefix === "D") country = "Alemania";
    else if (prefix === "I") country = "Italia";
    // Razon social: linea anterior o la misma linea sin el VAT ni etiquetas
    const prev = lines[i - 1] ?? "";
    const same = line.replace(candidate, " ").replace(/\b(?:CIF|NIF|VAT|EMISOR|PROVEEDOR|ISSUER|SUPPLIER)\b\s*:?/gi, " ").replace(/:|\s+/g, " ").trim();
    const roleOrAddress = /\b(?:customer\s*id|customer|buyer|cliente|montador|instalador|conductor|direcci[oó]n|address|c[oó]digo\s+postal|postal\s+code|cp|calle|c\/?|pol[ií]gono)\b/i;
    const nameFromSame = same.length >= 3 && /[A-Za-z]{3,}/.test(same) && !/todoelectrico/i.test(same) && !roleOrAddress.test(same) ? same : null;
    const previousName = prev.replace(/^\s*(?:EMISOR|PROVEEDOR|ISSUER|SUPPLIER)\s*:\s*/i, "").trim();
    const nameFromPrev = previousName.length >= 3 && /[A-Za-z]{3,}/.test(previousName) && !/CIF|NIF|VAT/i.test(previousName) && !/todoelectrico/i.test(previousName) && !roleOrAddress.test(previousName) ? previousName : null;
    supplier = nameFromSame ?? nameFromPrev ?? null;
    break; // usar el primer VAT de emisor encontrado (cabecera de factura)
  }

  // 2) Fallback: primera linea con forma de razon social que no sea el cliente
  if (!supplier) {
    for (const line of lines.slice(0, 12)) {
      if (/todoelectrico/i.test(line)) continue;
      if (/\b(S\.?L\.?|S\.?A\.?U?\.?|SOCIEDAD|COMPANY|LTD|LIMITED)\b/i.test(line) && line.length > 3 && line.length < 120) {
        supplier = line.trim();
        break;
      }
    }
  }
  // 3) Ultimo recurso: primera linea no-cliente con dominio web del emisor
  if (!supplier) {
    const dom = lines.slice(0, 12).find((l) => /www\.[a-z0-9-]+\.[a-z]{2,}/i.test(l) && !/todoelectrico/i.test(l));
    if (dom) {
      const d = dom.match(/www\.([a-z0-9-]+)\./i);
      if (d) supplier = d[1].charAt(0).toUpperCase() + d[1].slice(1);
    }
  }
  return { supplier, vat, country };
}

function looksLikeInvoiceNumber(s: string): boolean {
  // Referencia de factura tipica: contiene letras y/o numeros con separadores, no es fecha ni VAT.
  if (!s || s.length < 3 || s.length > 40) return false;
  if (/^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4,})$/.test(s)) return false; // fecha o codigo largo puro
  if (/\b(FECHA|CLIENTE|NOMBRE|DIRECCION|VehICULO|Montador|TOTAL|SUBTOTAL|IVA|BASE|Descripci|ARTICULO|CANTIDAD|PREC)\b/i.test(s)) return false;
  return /[A-Z0-9]/i.test(s) && /[0-9]/.test(s);
}

function extractInvoiceNumber(lines: string[], text: string): string | null {
  // Evitar que el NIF/CIF sea detectado como numero de factura (ya esta en vat).
  const vatFound = text.match(VAT_RE)?.[0] ?? "";
  // 1) Mismo texto plano: "Factura : WEB-11913/C", "Factura No. FAC/2026/32484"
  const sameLine = [
    /(?:factura|invoice)\s*(?:n[ºo]?\.?|no\.?|num\.?|numero)?\s*[:#]?\s*([A-Z0-9][A-Z0-9/\-_.]{3,30})/i,
  ];
  for (const re of sameLine) {
    const m = text.match(re);
    if (m && looksLikeInvoiceNumber(m[1]) && m[1] !== vatFound) return m[1].trim();
  }
  // 2) Multilinea: etiqueta en una linea, valor en la siguiente (PDFs reales)
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (/^(factura\s*(n[ºo]?\.?|no\.?|num\.?)?|n[ºo]?\.?|n\u00fam|invoice\s*(no\.?|number|#)?)\s*:?\s*$/i.test(line) ||
        /^(factura|invoice)\s*(n[ºo]?\.?|no\.?)\s*:?\s*$/i.test(line)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const v = lines[j].trim();
        if (looksLikeInvoiceNumber(v) && v !== vatFound) return v;
      }
    }
    // Valor en la misma linea despues de dos puntos
    const m2 = line.match(/^(?:factura|n[ºo]?\.?|no\.?|invoice)\s*(?:n[ºo]?\.?|no\.?|num\.?)?\s*[:#]\s*(.+)$/i);
    if (m2) {
      const v = m2[1].trim();
      if (looksLikeInvoiceNumber(v) && v !== vatFound) return v;
    }
  }
  return null;
}

function extractDates(text: string): { invoiceDate: string | null; dueDate: string | null } {
  let invoiceDate: string | null = null;
  let dueDate: string | null = null;
  const mInvoice = text.match(/(?:fecha|date|emisi[oó]n|factura\s*:)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (mInvoice) invoiceDate = parseDate(mInvoice[1]);
  // Buscar el vencimiento junto a una etiqueta explícita. Algunos PDF extraen
  // primero el importe+fecha y después la etiqueta «VENCIMIENTOS».
  const rows = text.split(/\r?\n/);
  const dueLabel = /\b(?:vencimientos?|fecha\s*(?:de\s*)?vencimiento|due\s*date|vence)\b/i;
  for (let i = 0; i < rows.length && !dueDate; i++) {
    if (!dueLabel.test(rows[i])) continue;
    for (const offset of [0, 1, 2, -1, -2]) {
      const row = rows[i + offset];
      if (!row) continue;
      const candidates = row.match(/\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2}/g) ?? [];
      for (const candidate of candidates) {
        const date = parseDate(candidate);
        if (date && date !== invoiceDate) { dueDate = date; break; }
      }
      if (dueDate) break;
    }
  }
  return { invoiceDate, dueDate };
}

function extractBillingAddress(lines: string[]): string | null {
  // Direccion de facturacion del proveedor: linea con calle/avenida/poligono/parque
  // cerca de la cabecera, que no sea el cliente (Todoelectrico).
  const CLIENT_MARKERS = /todoelectrico|b54685144/i;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const line = lines[i].trim();
    if (CLIENT_MARKERS.test(line)) continue;
    if (/^(calle|c\/|c\.?\s|av|avenida|avda|plaza|pol[ií]gono|parque|carretera|ctra|paseo|ronda|camino|via|v[ií]a|urb\.?)\b/i.test(line) && line.length >= 6 && line.length <= 160) {
      return line;
    }
  }
  return null;
}

function moneyTokens(line: string): number[] {
  // Extrae importes tipo "351,57", "42350,00", "1.234,56" (formato ES) de una linea.
  const out: number[] = [];
  const re = /\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+,\d{1,2}/g;
  for (const m of line.matchAll(re)) {
    const v = parseMoney(m[0]);
    if (v != null && v > 0) out.push(v);
  }
  return out;
}

function extractAmounts(lines: string[]): { base: number | null; taxes: number | null; total: number | null } {
  // Los importes pueden venir varios en la misma linea ("Base: X IVA 21%: Y Total: Z"),
  // asi que se busca cada etiqueta con SU valor en el texto completo, no el final de linea.
  const text = lines.join(" \n ");
  let base: number | null = null, taxes: number | null = null, total: number | null = null;
  // Total: buscar "Total" seguido de un importe
  const mTotal = text.match(/\b(?:total(?:\s+(?:factura|a\s+pagar|importe))?|importe\s+total)\s*:?\s*(\d[\d.,]*)/i);
  if (mTotal) total = parseMoney(mTotal[1]);
  // Base imponible
  const mBase = text.match(/\b(?:base(?:\s+imponible)?|subtotal)\s*:?\s*(\d[\d.,]*)/i);
  if (mBase) base = parseMoney(mBase[1]);
  // IVA puede llevar delante el porcentaje ("IVA 21%: 7.350,00"): se salta el % para no pillarlo como valor.
  const mTax = text.match(/\b(?:iva|impuestos?|tax)\s*(?:\d{1,2}\s*%)?\s*:?\s*(\d[\d.,]*)/i);
  if (mTax) taxes = parseMoney(mTax[1]);
  // Fallback: si hay base+taxes pero no total, calcular total
  if (total == null && base != null && taxes != null) total = base + taxes;
  // Fallback adicional: si solo hay 2 importes en toda la linea de resumen y uno es el total
  if (total == null) {
    const all = moneyTokens(text);
    if (all.length === 2) { base = all[0]; total = all[1]; }
    else if (all.length === 3) { base = all[0]; taxes = all[1]; total = all[2]; }
  }
  return { base, taxes, total };
}

function extractLines(text: string): PdfExtractedLine[] {
  // Heuristica simple de lineas: filas con cantidad x precio en lineas cortas.
  const rows = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: PdfExtractedLine[] = [];
  // Patron mas flexible: descripcion + cantidad + precio_unitario + (total opcional)
  const re = /^(.{2,150}?)\s+(\d+(?:[.,]\d+)?)\s*[xX*]\s*([\d.,]+)\s*(?:€|EUR)?\s*(?:=\s*)?([\d.,]+)?$/i;
  for (const row of rows) {
    const m = row.match(re);
    if (m) {
      out.push({
        description: m[1].trim(),
        reference: null,
        quantity: parseMoney(m[2]),
        priceUnit: unitPrice3(m[3]),
        discount: null,
        taxNames: [],
        total: m[4] ? parseMoney(m[4]) : null,
        confidence: 70,
      });
    }
  }
  // Fallback: buscar lineas con patron "descripcion cantidad precio total"
  if (out.length === 0) {
    const re2 = /^(.{3,150}?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*(?:€|EUR)?$/i;
    for (const row of rows) {
      const m = row.match(re2);
      if (m) {
        out.push({
          description: m[1].trim(),
          reference: null,
          quantity: parseMoney(m[2]),
          priceUnit: unitPrice3(m[3]),
          discount: null,
          taxNames: [],
          total: parseMoney(m[4]),
          confidence: 60,
        });
      }
    }
  }
  return out.slice(0, 50);
}

export function extractPdfData(text: string, pages: number, name = ""): PdfExtractedData {
  const needsOcr = text.trim().length < 40 && pages > 0;
  const warnings: string[] = [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const { docType, label } = detectDocType(text, name);
  const { supplier, vat, country } = extractSupplier(lines);
  const invoiceNumber = extractInvoiceNumber(lines, text);
  const { invoiceDate, dueDate } = extractDates(text);
  const { base, taxes, total } = extractAmounts(lines);
  const currency = /EUR|€|EURO/i.test(text) ? "EUR" : null;
  const invoiceLines = extractLines(text);
  const billingAddress = extractBillingAddress(lines);
  if (needsOcr) warnings.push("PDF escaneado sin capa de texto: OCR pendiente (fase posterior).");
  if (docType !== "factura") warnings.push(`No es factura: ${label}.`);
  if (!total && !base) warnings.push("No se han detectado importes de forma fiable.");
  return {
    supplier,
    supplierVat: vat,
    country,
    invoiceNumber,
    invoiceDate,
    dueDate,
    currency,
    base,
    taxes,
    total,
    lines: invoiceLines,
    textPreview: text.slice(0, 1200),
    needsOcr,
    warnings,
    pdfPages: pages,
    billingAddress,
    docType,
  };
}

// ---------- Cotejo con Odoo (cache fase 1 + pedidos sincronizados) ----------

export interface PoIndex {
  id: number;
  name: string;
  supplierRef?: string | null;
  partnerName: string;
  partnerVat: string | null;
  partnerCountry: string | null;
  currency: string | null;
  dateOrder: string | null;
  amountTotal: number;
  lines: { productName: string | null; qtyOrdered: number; priceUnit: number }[];
}

export function buildPoIndex(orderStore: { orders: { id: number; name: string; supplierRef?: string | null; partnerName: string; partnerVat: string | null; partnerCountry: string | null; currency: string | null; dateOrder: string | null; amountTotal: number; lines: { productName: string | null; qtyOrdered: number; priceUnit: number }[] }[] }): PoIndex[] {
  return orderStore.orders.map((o) => ({
    id: o.id,
    name: o.name,
    supplierRef: o.supplierRef ?? null,
    partnerName: o.partnerName,
    partnerVat: o.partnerVat,
    partnerCountry: o.partnerCountry,
    currency: o.currency,
    dateOrder: o.dateOrder,
    amountTotal: o.amountTotal,
    lines: o.lines,
  }));
}

function tokensSimilar(a: string, b: string): boolean {
  const ta = normalizeSupplierName(a).split(" ").filter((x) => x.length > 2);
  const tb = normalizeSupplierName(b).split(" ").filter((x) => x.length > 2);
  if (!ta.length || !tb.length) return false;
  const hit = ta.filter((x) => tb.includes(x)).length;
  return hit / Math.min(ta.length, tb.length) >= 0.6;
}

export type PurchaseOrderReferenceEvidence = {
  raw: string;
  normalized: string;
  source: "customer_order_column" | "supplier_order_column" | "labeled_text";
  exactOdooHit: boolean;
  start: number;
  end: number;
};

/**
 * Bare numbers are references only beside a purchase/order label. P/PO tokens
 * outside the Odoo cache are retained only at a text boundary; concatenated
 * table cells are split only when the prefix is an exact name in that cache.
 */
export function extractPurchaseOrderReferenceEvidence(ex: PdfExtractedData, knownOrderNames: string[] = []): PurchaseOrderReferenceEvidence[] {
  const hay = ex.textPreview ?? "";
  const known = knownOrderNames.map((name) => ({ name, digits: name.match(/^P0*(\d{4,7})$/i)?.[1] ?? "" })).filter((x) => x.digits);
  const evidence: PurchaseOrderReferenceEvidence[] = [];
  const byName = new Map<string, PurchaseOrderReferenceEvidence>();
  const sourceAt = (start: number): PurchaseOrderReferenceEvidence["source"] => {
    const context = hay.slice(Math.max(0, start - 48), start).toLowerCase();
    const customerAt = Math.max(context.lastIndexOf("cliente"), context.lastIndexOf("customer"));
    const supplierAt = Math.max(context.lastIndexOf("proveedor"), context.lastIndexOf("supplier"));
    if (customerAt > supplierAt) return "customer_order_column";
    if (supplierAt >= 0) return "supplier_order_column";
    return "labeled_text";
  };
  const add = (raw: string, normalized: string, start: number, end: number, exactOdooHit: boolean, source = sourceAt(start)) => {
    if (byName.has(normalized)) return;
    const item = { raw, normalized, source, exactOdooHit, start, end };
    byName.set(normalized, item);
    evidence.push(item);
  };

  for (const found of hay.matchAll(/(PO|P)\s*(\d{4,8})(?:([,.])(\d{2}))?/gi)) {
    const start = found.index ?? 0;
    const end = start + found[0].length;
    const tokenDigits = found[2].replace(/^0+/, "") || "0";
    const exact = known.filter((item) => (item.digits.replace(/^0+/, "") || "0") === tokenDigits);
    if (exact.length === 1) {
      add(found[0], exact[0].name, start, end, true);
      continue;
    }
    if (found[3]) {
      const split = known.filter((item) => {
        const digits = item.digits.replace(/^0+/, "") || "0";
        return tokenDigits.startsWith(digits) && tokenDigits.slice(digits.length) === "0";
      });
      if (split.length === 1) {
        add(found[0], split[0].name, start, end, true);
        continue;
      }
    }
    const left = hay[start - 1] ?? "";
    const right = hay[end] ?? "";
    const labeled = /(?:pedido|referencia|order|\bpo)\s*[:#-]?\s*$/i.test(hay.slice(Math.max(0, start - 48), start));
    if ((!left || !/[A-Z0-9]/i.test(left)) && (!right || !/[A-Z0-9]/i.test(right))) {
      add(found[0], `P${found[2].replace(/^0+/, "").padStart(5, "0")}`, start, end, false);
    } else if (labeled && !found[3]) {
      add(found[0], `P${found[2].replace(/^0+/, "").padStart(5, "0")}`, start, end, false);
    }
  }
  const labelPattern = /\b(?:pedido(?:\s+(?:de\s+)?(?:compra|cliente))?|referencia\s+(?:de\s+)?(?:pedido|cliente)|ref\.?\s*(?:pedido|cliente)?)\s*[:#-]?\s*0*(\d{4,7})\b/gi;
  for (const found of hay.matchAll(labelPattern)) {
    const start = found.index ?? 0;
    const end = start + found[0].length;
    const digits = found[1].replace(/^0+/, "") || "0";
    const matches = known.filter((item) => (item.digits.replace(/^0+/, "") || "0") === digits);
    const normalized = matches.length === 1 ? matches[0].name : `P${digits.padStart(5, "0")}`;
    const label = found[0].slice(0, found[0].length - found[1].length);
    const source = /cliente/i.test(label) ? "customer_order_column" : /proveedor|compra/i.test(label) ? "supplier_order_column" : "labeled_text";
    add(found[0], normalized, start, end, matches.length === 1, source);
  }
  return evidence.sort((a, b) => a.start - b.start);
}

export function extractPurchaseOrderReferences(ex: PdfExtractedData, knownOrderNames: string[] = []): string[] {
  return extractPurchaseOrderReferenceEvidence(ex, knownOrderNames).map((item) => item.normalized);
}

export function matchDocument(
  doc: InboxDocument,
  invoices: SupplierInvoiceStore["invoices"],
  poIndex: PoIndex[],
): DocumentMatch | null {
  const ex = doc.extracted;
  if (!ex) return null;

  // No-facturas SEGURAS (albaran, aduana, transporte) NO entran en el cotejo:
  // se marcan como excluidas para que no confundan al agente ni al matching.
  // "otro" (ambiguo) sigue el flujo normal: la IA decide y el cotejo da score bajo si no es factura.
  if (ex.docType === "aduana" || ex.docType === "transporte" || ex.docType === "albaran") {
    return {
      purchaseOrderId: null,
      purchaseOrderName: null,
      score: 0,
      band: "sin",
      criteria: [{ key: "docType", label: "Tipo de documento", ok: false, detail: `No es factura (${ex.docType})` }],
      totalDiff: null,
      invoiceIdOdoo: null,
      invoiceNameOdoo: null,
      excluded: true,
      excludedReason: ex.docType,
    };
  }

  const criteria: DocumentMatchCriterion[] = [];
  let score = 0;

  // 0) Referencia explícita del pedido dentro del PDF. Tiene prioridad sobre
  // heurísticas de proveedor/importe: es la referencia que el proveedor ha
  // usado para identificar nuestra compra.
  const explicitRefs = extractPurchaseOrderReferences(ex, poIndex.map((order) => order.name));
  const hay = ex.textPreview ?? "";
  const explicitOrders = poIndex.filter((po) => explicitRefs.includes(po.name.toUpperCase()));
  const supplierRefOrders = poIndex.filter((po) => {
    const ref = (po.supplierRef ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return Boolean(ref && ref.length >= 5 && new RegExp(`(?<![A-Z0-9])${ref}(?![A-Z0-9])`, "i").test(hay));
  });
  const explicitPo = explicitOrders.length === 1 ? explicitOrders[0] : null;
  const supplierRefPo = supplierRefOrders.length === 1 ? supplierRefOrders[0] : null;
  const referenceConflict = Boolean(explicitPo && supplierRefPo && explicitPo.id !== supplierRefPo.id);

  // 1) Proveedor (40 pts): nombre normalizado o VAT
  const exName = normalizeSupplierName(ex.supplier);
  // Odoo puede guardar ESB28960987 y el PDF B28960987: son el mismo NIF.
  const normalVat = (value: string | null | undefined) => {
    const raw = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return raw.length > 9 && /^[A-Z]{2}/.test(raw) ? raw.slice(2) : raw;
  };
  const exVat = normalVat(ex.supplierVat);
  let bestPo: PoIndex | null = null;
  let bestPoScore = -1;
  for (const po of poIndex) {
    let s = 0;
    if (exVat && po.partnerVat && normalVat(po.partnerVat) === exVat) s += 40;
    else if (exName && tokensSimilar(po.partnerName, exName)) s += 35;
    if (s > bestPoScore) {
      bestPoScore = s;
      bestPo = po;
    }
  }
  const supplierPo = bestPoScore >= 20 ? bestPo : null;
  if (referenceConflict || explicitOrders.length > 1 || supplierRefOrders.length > 1) {
    bestPo = null;
    criteria.push({ key: "purchaseReference", label: "Referencias ambiguas", ok: false, detail: "Hay varios pedidos posibles; requiere revisión manual." });
  } else if (supplierRefPo || explicitPo) {
    bestPo = supplierRefPo ?? explicitPo;
    score += 60;
    criteria.push({ key: "purchaseReference", label: supplierRefPo ? "Referencia del proveedor en PDF" : "Pedido de compra en PDF", ok: true, detail: supplierRefPo ? `${supplierRefPo.supplierRef} → ${supplierRefPo.name}` : `${explicitRefs.join(", ")} → ${explicitPo?.name}` });
  } else if (!supplierPo) {
    bestPo = null;
  }
  // Con una referencia explícita, el pedido elegido puede no ser el primer
  // pedido de ese proveedor. Evalúa el proveedor contra ESE pedido, no contra
  // el primer candidato que tuvo el mismo NIF.
  const selectedSupplierScore = bestPo
    ? (exVat && bestPo.partnerVat && normalVat(bestPo.partnerVat) === exVat ? 40
      : exName && tokensSimilar(bestPo.partnerName, exName) ? 35 : 0)
    : 0;
  if (bestPo && selectedSupplierScore > 0) {
    score += selectedSupplierScore;
    criteria.push({
      key: "supplier",
      label: "Proveedor coincide",
      ok: true,
      detail: bestPo.partnerName,
    });
  } else {
    criteria.push({ key: "supplier", label: "Proveedor en Odoo", ok: false, detail: ex.supplier ?? "no detectado" });
  }

  // 2) Importe (25 pts): PDF total vs pedido
  if (bestPo && ex.total != null) {
    const diff = ex.total - bestPo.amountTotal;
    const pct = bestPo.amountTotal > 0 ? Math.abs(diff) / bestPo.amountTotal : 1;
    if (pct <= 0.02) { score += 25; criteria.push({ key: "total", label: "Total coincide", ok: true, detail: `Diferencia ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} €` }); }
    else if (pct <= 0.15) { score += 12; criteria.push({ key: "total", label: "Total aproximado", ok: true, detail: `Diferencia ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} €` }); }
    else criteria.push({ key: "total", label: "Total difiere", ok: false, detail: `Diferencia ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} €` });
  } else if (bestPo) {
    // Ausencia de total extraíble no es un error del proveedor ni invalida una
    // referencia de pedido/líneas inequívoca: se informa sin una X roja.
    criteria.push({ key: "total", label: "Total pendiente de extraer", ok: true, detail: "Importe PDF no detectado; no bloquea la asociación" });
  }

  // 3) Fecha (10 pts): emision PDF dentro de +-90 dias del pedido
  if (bestPo && ex.invoiceDate && bestPo.dateOrder) {
    const d1 = new Date(ex.invoiceDate).getTime();
    const d2 = new Date(bestPo.dateOrder).getTime();
    const days = Math.abs(d1 - d2) / 86400000;
    if (days <= 90) { score += 10; criteria.push({ key: "date", label: "Fecha razonable", ok: true, detail: `${Math.round(days)} días desde pedido` }); }
    else criteria.push({ key: "date", label: "Fecha alejada del pedido", ok: false, detail: `${Math.round(days)} días` });
  }

  // 4) Lineas (25 pts): coincidencia por descripcion/SKU
  if (bestPo && bestPo.lines.length && ex.lines.length) {
    let hits = 0;
    const exDesc = ex.lines.map((l) => normalizeSupplierName(l.description));
    for (const pl of bestPo.lines) {
      const plN = normalizeSupplierName(pl.productName ?? "");
      if (plN && exDesc.some((d) => d.includes(plN) || plN.includes(d))) hits += 1;
    }
    const pct = hits / Math.min(bestPo.lines.length, ex.lines.length);
    if (pct >= 0.8) { score += 25; criteria.push({ key: "lines", label: "Líneas coinciden", ok: true, detail: `${hits} de ${Math.min(bestPo.lines.length, ex.lines.length)}` }); }
    else if (pct >= 0.4) { score += 12; criteria.push({ key: "lines", label: "Algunas líneas coinciden", ok: true, detail: `${hits} de ${Math.min(bestPo.lines.length, ex.lines.length)}` }); }
    else criteria.push({ key: "lines", label: "Líneas sin correspondencia", ok: false, detail: `${hits} de ${Math.min(bestPo.lines.length, ex.lines.length)}` });
  }

  // Banda alta exige, ademas del score >=80, importe exacto ("Total coincide", dif <=2%).
  // Un total aproximado (dif hasta 15%) o que difiere no puede ser "alta".
  score = Math.min(100, score);
  const totalCriterio = criteria.find((c) => c.key === "total");
  const totalExacto = totalCriterio != null && totalCriterio.label === "Total coincide";
  const band = score >= 80 && totalExacto ? "alta" : score >= 50 ? "media" : score >= 30 ? "baja" : "sin";

  // Duplicado: misma factura ya registrada en Odoo (proveedor + numero + importe)
  let invoiceIdOdoo: number | null = null;
  let invoiceNameOdoo: string | null = null;
  if (ex.invoiceNumber && ex.supplier) {
    const dup = invoices.find((inv) =>
      inv.partnerId === (bestPo?.id ? inv.partnerId : inv.partnerId) &&
      inv.ref && normalizeSupplierName(inv.ref) === normalizeSupplierName(ex.invoiceNumber) &&
      ex.total != null && Math.abs(inv.amountTotal - ex.total) / Math.max(1, inv.amountTotal) < 0.05
    );
    if (dup && bestPo) {
      const samePartner = tokensSimilar(dup.partnerName, bestPo.partnerName);
      if (samePartner) {
        invoiceIdOdoo = dup.id;
        invoiceNameOdoo = dup.name;
        criteria.push({ key: "duplicate", label: "Posible duplicado", ok: false, detail: `Ya existe ${dup.name} (${dup.ref}) en Odoo` });
      }
    }
  }

  return {
    purchaseOrderId: bestPo?.id ?? null,
    purchaseOrderName: bestPo?.name ?? null,
    score,
    band,
    criteria,
    totalDiff: bestPo && ex.total != null ? ex.total - bestPo.amountTotal : null,
    invoiceIdOdoo,
    invoiceNameOdoo,
  };
}

// ---------- Store documental ----------

export class DocumentInboxService {
  private store: InboxStore;
  private storePath: string;
  private dataDir: string;
  private cacheDir: string;

  constructor(options: { dataDir?: string } = {}) {
    this.dataDir = options.dataDir ?? "";
    this.storePath = this.dataDir ? `${this.dataDir.replace(/\/$/, "")}/supplier-invoices/docInbox.json` : "";
    this.cacheDir = this.dataDir ? join(this.dataDir.replace(/\/$/, ""), "supplier-invoices", "inbox") : "";
    this.store = {
      meta: { version: 2, lastScanAt: null, lastScanResult: null, totalDocuments: 0, driveFolderId: null },
      documents: [],
    };
    this.load();
  }

  load(): void {
    if (!this.storePath) return;
    try {
      if (existsSync(this.storePath)) {
        const raw = JSON.parse(readFileSync(this.storePath, "utf8")) as InboxStore;
        if (raw && Array.isArray(raw.documents)) this.store = raw;
      }
    } catch {
      // store ausente o corrupto: se reconstruye
    }
  }

  save(): void {
    if (!this.storePath) return;
    try {
      // El store vive en <dataDir>/supplier-invoices/docInbox.json: crear el subdirectorio completo
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.store), "utf8");
    } catch {
      // cache secundaria
    }
  }

  getStore(): InboxStore {
    return this.store;
  }

  getDocument(driveFileId: string): InboxDocument | undefined {
    return this.store.documents.find((d) => d.driveFileId === driveFileId);
  }

  async scan(
    env: Record<string, string | undefined>,
    invoices: SupplierInvoiceStore["invoices"],
    poIndex: PoIndex[],
    detectedBy: string,
  ): Promise<{ scanned: number; added: number; matched: number; removed: number; errors: string[]; skippedKnown: number; addedIds: { driveFileId: string; name: string }[] }> {
    const client = new DriveClient(env);
    const err = client.configError();
    if (err) throw new Error(err);
    const files = await client.listFiles();
    const visibleIds = new Set(files.map((file) => file.id));
    const removedAt = new Date().toISOString();
    let removed = 0;
    for (const doc of this.store.documents) {
      if (!visibleIds.has(doc.driveFileId) && doc.sourcePresent !== false) {
        doc.sourcePresent = false;
        doc.sourceRemovedAt = removedAt;
        removed += 1;
      }
    }
    let added = 0, matched = 0, errors: string[] = [], skippedKnown = 0;
    const addedIds: { driveFileId: string; name: string }[] = [];
    for (const file of files) {
      const existing = this.getDocument(file.id);
      if (existing) {
        existing.sourcePresent = true;
        existing.sourceRemovedAt = null;
        existing.driveFolderId = file.parents?.[0] ?? existing.driveFolderId;
        existing.name = file.name;
        existing.size = file.size;
        existing.modifiedTime = file.modifiedTime;
        existing.webViewLink = file.webViewLink;
      }
      if (existing) {
        skippedKnown += 1;
        continue;
      }
      try {
        const base: InboxDocument = {
          driveFileId: file.id,
          driveFolderId: file.parents?.[0] ?? null,
          name: file.name,
          size: file.size,
          modifiedTime: file.modifiedTime,
          webViewLink: file.webViewLink,
          source: inferSource(file.name, env.SUPPLIER_INVOICES_DRIVE_SOURCE ?? "manual"),
          sourceEmail: env.SUPPLIER_INVOICES_DRIVE_SOURCE_EMAIL ?? null,
          detectedAt: new Date().toISOString(),
          detectedBy,
          extracted: null,
          ocrStatus: "pendiente",
          aiStatus: "no_aplicado",
          confidence: null,
          match: null,
          status: "SIN_REVISAR",
          validationUser: null,
          validationAt: null,
          notes: null,
          targetFolderPath: null,
          movedTo: null,
          sourcePresent: true,
          sourceRemovedAt: null,
          odooDraftMoveId: null,
          odooDraftName: null,
          odooDraftState: null,
          pdfCached: false,
          processedAt: null,
        };
        this.store.documents.push(base);
        added += 1;
        addedIds.push({ driveFileId: file.id, name: file.name });
      } catch (error) {
        errors.push(`${file.name}: ${error instanceof Error ? error.message : "error"}`);
      }
    }
    this.store.meta.lastScanAt = new Date().toISOString();
    this.store.meta.lastScanResult = `${added} añadidos, ${skippedKnown} ya conocidos, ${removed} ausentes en origen, ${errors.length} errores`;
    this.store.meta.totalDocuments = this.store.documents.filter((doc) => doc.sourcePresent !== false).length;
    this.store.meta.driveFolderId = client.getAccount() ? env.SUPPLIER_INVOICES_DRIVE_FOLDER_ID ?? null : null;
    this.save();
    return { scanned: files.length, added, matched, removed, errors, skippedKnown, addedIds };
  }

  /** Descarga y extrae sólo el PDF elegido para revisión; nunca procesa el resto de la bandeja. */
  async prepareForReview(
    driveFileId: string,
    env: Record<string, string | undefined>,
    invoices: SupplierInvoiceStore["invoices"],
    poIndex: PoIndex[],
  ): Promise<InboxDocument> {
    const doc = this.getDocument(driveFileId);
    if (!doc || doc.sourcePresent === false) throw new Error("Documento no disponible en la bandeja de Drive");
    const cachedPath = `${this.cacheDir}/${doc.driveFileId}.pdf`;
    if (doc.pdfCached && doc.extracted && existsSync(cachedPath)) {
      if (readFileSync(cachedPath).subarray(0, 5).toString() === "%PDF-") return doc;
    }
    const client = new DriveClient(env);
    const pdfPath = await client.download(doc.driveFileId, this.cacheDir);
    const buf = readFileSync(pdfPath);
    if (buf.subarray(0, 5).toString() !== "%PDF-") throw new Error("El archivo de Drive no es un PDF válido");
    const parsed = await pdfParse(buf);
    const extracted = extractPdfData(parsed.text ?? "", parsed.numpages ?? 0, doc.name);
    doc.extracted = extracted;
    doc.ocrStatus = extracted.needsOcr ? "needs_ocr" : "ok";
    doc.confidence = extracted.needsOcr ? null : heuristicConfidence(extracted);
    doc.match = matchDocument(doc, invoices, poIndex);
    // Un nuevo análisis no puede desvalidar una factura ya enviada a Odoo.
    if (doc.match && !doc.odooDraftMoveId && doc.status !== "VALIDADA" && doc.status !== "INCIDENCIA") {
      doc.status = doc.match.band === "alta" ? "PENDIENTE_VALIDAR" : "PENDIENTE_COTEJO";
    }
    doc.notes = extracted.warnings.length ? extracted.warnings.join("; ") : doc.notes;
    doc.pdfCached = true;
    doc.processedAt = new Date().toISOString();
    this.save();
    return doc;
  }

  /** Reclasifica documentos usando el PDF cacheado completo.
   * force=false: solo legados sin docType. force=true: re-evalua TODOS con la
   * heuristica actual (para cuando cambian los patrones). Los no-factura quedan
   * excluidos del cotejo; si un excluido deja de ser no-factura, se des-excluye
   * (match a null; el rematch o el lote de IA lo recotejan). */
  async reclassifyDocuments(force = false): Promise<number> {
    let n = 0;
    for (const doc of this.store.documents) {
      const ex = doc.extracted;
      if (!ex) continue;
      if (!force && ex.docType) continue;
      let text = ex.textPreview ?? "";
      try {
        const pdfPath = `${this.cacheDir}/${doc.driveFileId}.pdf`;
        if (existsSync(pdfPath)) {
          const parsed = await pdfParse(readFileSync(pdfPath));
          text = parsed.text ?? text;
        }
      } catch {
        // usa textPreview si no se puede releer el PDF
      }
      const { docType, label } = detectDocType(text, doc.name);
      const wasExcluded = doc.match?.excluded === true;
      ex.docType = docType;
      const isNonInvoice = docType === "aduana" || docType === "transporte" || docType === "albaran";
      if (isNonInvoice) {
        if (!ex.warnings.some((w) => w.startsWith("No es factura"))) {
          ex.warnings = [...ex.warnings, `No es factura: ${label}.`].slice(0, 8);
        }
        doc.match = {
          purchaseOrderId: null,
          purchaseOrderName: null,
          score: 0,
          band: "sin",
          criteria: [{ key: "docType", label: "Tipo de documento", ok: false, detail: `No es factura (${docType})` }],
          totalDiff: null,
          invoiceIdOdoo: null,
          invoiceNameOdoo: null,
          excluded: true,
          excludedReason: docType,
        };
      } else if (wasExcluded) {
        // Ya no es no-factura: quitar la exclusion; el match se recalcula despues.
        const m = doc.match;
        doc.match = m && "score" in m ? { ...m, excluded: undefined, excludedReason: undefined } : null;
      }
      n++;
    }
    if (n) this.save();
    return n;
  }

  setStatus(driveFileId: string, status: InboxDocument["status"], user: string, notes?: string): InboxDocument | null {
    const doc = this.getDocument(driveFileId);
    if (!doc) return null;
    // Un recotejo posterior no puede ocultar el archivo de Drive ni desvalidar
    // un documento que ya tiene borrador creado en Odoo.
    if (doc.odooDraftMoveId && status !== "VALIDADA") return doc;
    doc.status = status;
    doc.validationUser = user;
    doc.validationAt = new Date().toISOString();
    if (notes !== undefined) doc.notes = notes;
    this.save();
    return doc;
  }

  applyAiExtraction(driveFileId: string, extracted: PdfExtractedData, aiStatus: "ok" | "error", confidence: number | null, note: string | null): InboxDocument | null {
    const doc = this.getDocument(driveFileId);
    if (!doc) return null;
    doc.extracted = extracted;
    doc.aiStatus = aiStatus;
    doc.confidence = confidence;
    doc.ocrStatus = "ok";
    if (note) doc.notes = note;
    doc.processedAt = new Date().toISOString();
    this.save();
    return doc;
  }

  computeKpis(unbilled?: UnbilledKpis): InboxKpis {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    let sinRevisar = 0, pendientesCotejo = 0, importePendienteCotejo = 0, sinCoincidenciaOdoo = 0;
    let validadasMes = 0, incidencias = 0, borradoresListosOdoo = 0;
    for (const d of this.store.documents) {
      if (d.sourcePresent === false) continue;
      if (d.status === "SIN_REVISAR") sinRevisar += 1;
      if (d.status === "PENDIENTE_COTEJO" || d.status === "PENDIENTE_VALIDAR") {
        pendientesCotejo += 1;
        if (d.extracted?.total != null) importePendienteCotejo += d.extracted.total;
      }
      if (d.match && d.match.band === "sin") sinCoincidenciaOdoo += 1;
      if (d.status === "VALIDADA") {
        if (d.validationAt) {
          const v = new Date(d.validationAt);
          if (v.getMonth() === month && v.getFullYear() === year) validadasMes += 1;
        }
        if (d.match && d.match.purchaseOrderId != null) borradoresListosOdoo += 1;
      }
      if (d.status === "INCIDENCIA") incidencias += 1;
    }
    return {
      sinRevisar,
      pendientesCotejo,
      pedidosSinFacturar: unbilled?.ordersWithoutInvoice.count ?? 0,
      importePedidosSinFacturar: unbilled?.ordersWithoutInvoice.total ?? 0,
      importePendienteCotejo,
      sinCoincidenciaOdoo,
      facturacionParcial: unbilled?.partialBilling.count ?? 0,
      validadasMes,
      incidencias,
      borradoresListosOdoo,
    };
  }
}

function inferSource(name: string, fallback: string): DocumentSource {
  const n = name.toLowerCase();
  if (fallback === "email") return "email";
  if (/^factura[-_]/i.test(n) || /^(invoice|factura)\b/i.test(n)) return fallback === "web" ? "web" : "email";
  return (fallback as DocumentSource) || "desconocido";
}

function heuristicConfidence(ex: PdfExtractedData): number {
  let c = 0;
  if (ex.supplier) c += 25;
  if (ex.supplierVat) c += 15;
  if (ex.invoiceNumber) c += 20;
  if (ex.invoiceDate) c += 15;
  if (ex.total != null) c += 25;
  return Math.min(100, c);
}
