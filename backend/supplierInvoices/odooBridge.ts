// Fase 3: puente Dashboard -> Odoo (facturas de proveedor).
// Crea un BORRADOR de factura (account.move in_invoice) en Odoo desde un documento
// VALIDADA, y permite contabilizarlo despues. NUNCA escribe si la puerta
// SUPPLIER_INVOICES_ODOO_WRITE_ENABLED no esta en "true".
//
// Reglas de negocio (2026-09-13):
//  - Base, impuestos y total deben estar informados. Diferencias entre esos
//    importes, las líneas y los pedidos se advierten, pero no bloquean el borrador;
//    el operario revisa y corrige el borrador en Odoo antes de contabilizarlo.
//  - El impuesto se mapea EXACTO contra account.tax de Odoo por pais y tasa
//    (critico para OSS / declaraciones trimestrales de los paises donde se comercia).

import type { OdooConfig } from "./odooClient.ts";
import { authenticate, executeKw, searchRead, readRows, getOdooConfig } from "./odooClient.ts";
import { normalizeSupplierName } from "./documentInbox.ts";
import { WEB_ADJUSTMENT_PRODUCT_CODE, isWebAdjustmentProductId, discountedBase, effectiveDiscount } from "../../shared/supplierInvoiceDiscounts.ts";
import { supplierInvoiceAmountWarnings } from "../../shared/supplierInvoiceAmountWarnings.ts";

export interface DraftResult {
  ok: boolean;
  moveId?: number;
  name?: string;
  state?: string;
  message: string;
  warnings: string[];
  taxDetail?: { lineIndex: number; taxId: number; taxName: string; rate: number }[];
  actual?: { reference: string; dueDate: string | null; base: number; taxes: number; total: number; lines: { productId: number | null; purchaseLineId: number | null; quantity: number; priceUnit: number; base: number; total: number }[] };
}

/** Puerta de escritura: solo "true" permite crear/contabilizar en Odoo. */
export function odooWriteEnabled(env: Record<string, string | undefined>): boolean {
  return String(env.SUPPLIER_INVOICES_ODOO_WRITE_ENABLED ?? "false").toLowerCase() === "true";
}

export interface OrderShape {
  id: number;
  name: string;
  partnerId: number;
  partnerName: string;
  partnerVat: string | null;
  amountTotal: number | null;
  lines: { productId: number | null; productName: string | null; qtyOrdered: number; qtyReceived: number; qtyInvoiced: number; qtyPending: number; priceUnit: number; subtotal: number }[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Build the value accepted by Odoo's editable tax_totals inverse. */
export function planTaxTotalCorrection(totals: unknown, groupId: number, target: number): Record<string, unknown> {
  if (!totals || typeof totals !== "object" || !Array.isArray((totals as any).subtotals)) throw new Error("Odoo no devolvió el desglose editable de impuestos");
  const amended = structuredClone(totals) as { subtotals: { tax_groups: { id: number; tax_amount_currency: number }[] }[] };
  const groups = amended.subtotals.flatMap((subtotal) => subtotal.tax_groups ?? []);
  const targetGroup = groups.filter((group) => Number(group.id) === groupId);
  if (!groupId || targetGroup.length !== 1 || groups.length !== 1) throw new Error("el impuesto no corresponde a un único grupo fiscal editable");
  targetGroup[0].tax_amount_currency = target;
  return amended as unknown as Record<string, unknown>;
}

export function serviceLineIdentityError(line: { productId?: number | null; description?: string | null; sourcePurchaseOrderId?: number | null; genericProductConfirmed?: boolean }, index: number): string | null {
  if (line.sourcePurchaseOrderId || (line.productId && line.genericProductConfirmed !== true) || !line.description?.trim()) {
    return `Línea ${index + 1}: confirma la descripción contable; si enlazas un producto, confirma el servicio/consumible Odoo sin pedido.`;
  }
  return null;
}

export interface AmountsCheck {
  ok: boolean;
  message: string;
  base: number;
  taxes: number;
  total: number;
  sumLines: number;
  poTotal: number | null;
}

/** Required values remain a hard gate; arithmetic disagreement is handled separately as a warning. */
export function draftAmountCompletenessError(
  base: number | null,
  taxes: number | null,
  total: number | null,
  _lines: { total: number | null }[],
): string | null {
  if ([base, taxes, total].some((value) => value == null || !Number.isFinite(Number(value)))) {
    return "Faltan importes: completa Base, Impuestos y Total para incluir el desglose en el borrador.";
  }
  return null;
}

/** Select one active AJUSTEWEB product.product variant returned by the exact Odoo default_code query. */
export function resolveWebAdjustmentProductId(rows: { id?: unknown; active?: unknown; type?: unknown; default_code?: unknown }[]): number | null {
  if (rows.length !== 1) return null;
  const product = rows[0];
  const id = Number(product.id);
  if (!Number.isInteger(id) || id <= 0 || product.active === false || product.type !== "service" || product.default_code !== "AJUSTEWEB") return null;
  return id;
}

/** Validación pura: base+impuestos=total, líneas=base y cuotas=impuestos. */
export function validateAmounts(
  base: number | null,
  taxes: number | null,
  total: number | null,
  lines: { total: number | null; quantity?: number | null; priceUnit?: number | null; discount?: number | null; discountExtra?: number | null; promptPaymentDiscount?: number | null; taxAmount?: number | null }[],
  pos: { name: string; amountTotal: number | null }[],
  tol = 0.01,
): AmountsCheck {
  const msg = (m: string) => ({ ok: false, message: m, base: base ?? 0, taxes: taxes ?? 0, total: total ?? 0, sumLines: 0, poTotal: null });
  if (base == null || taxes == null || total == null) {
    return msg("Faltan importes: revisa Base, Impuestos y Total en el Dashboard (no se crea el borrador sin el desglose completo).");
  }
  const sumBT = round2(base + taxes);
  if (Math.abs(sumBT - total) > tol) {
    return msg(`Importes NO cuadran: Base ${round2(base)} + Impuestos ${round2(taxes)} = ${sumBT} ≠ Total ${round2(total)}. Corrige el desglose en el Dashboard antes de crear el borrador.`);
  }
  let sumLines = 0;
  if (lines.length) {
    sumLines = round2(lines.reduce((a, l) => a + (l.quantity != null && l.priceUnit != null
      ? discountedBase(l.quantity, l.priceUnit, l.discount, l.discountExtra, l.promptPaymentDiscount)
      : (l.total ?? 0)), 0));
    // Three-decimal Odoo unit prices cannot reproduce every four-decimal PDF line.
    // Accept only the maximum explainable half-unit rounding drift; never add a
    // balancing product or silently change a confirmed source line.
    const precisionDrift = lines.reduce((sum, line) => sum + Math.abs(line.quantity ?? 0) * 0.0005 * (1 - effectiveDiscount(line.discount, line.discountExtra, line.promptPaymentDiscount) / 100), 0);
    const hasSequentialDiscounts = lines.some((line) => (line.discountExtra ?? 0) !== 0 || (line.promptPaymentDiscount ?? 0) !== 0);
    if (Math.abs(sumLines - base) > (hasSequentialDiscounts ? tol : Math.max(tol, precisionDrift + 0.01))) {
      return { ok: false, message: `Las líneas suman ${sumLines} pero la Base es ${round2(base)}. Corrige las líneas del documento en el Dashboard.`, base, taxes, total, sumLines, poTotal: null };
    }
  } else {
    return msg("El documento no tiene líneas. Añádelas o corrige la extracción antes de crear el borrador.");
  }
  if (lines.every((line) => line.taxAmount != null)) {
    const lineTaxes = round2(lines.reduce((sum, line) => sum + Number(line.taxAmount ?? 0), 0));
    if (Math.abs(lineTaxes - taxes) > tol) {
      return { ok: false, message: `Las cuotas de impuesto suman ${lineTaxes} pero el total de impuestos del PDF es ${round2(taxes)}. Corrige las cuotas antes de crear el borrador.`, base, taxes, total, sumLines, poTotal: null };
    }
  }
  let poTotal: number | null = null;
  if (pos.length) {
    poTotal = round2(pos.reduce((a, o) => a + (o.amountTotal ?? 0), 0));
  }
  const poNote = poTotal != null && Math.abs(poTotal - total) > tol
    ? ` Los pedidos seleccionados suman ${poTotal}; la diferencia queda registrada para revisión de precios o facturación parcial.`
    : "";
  const roundingNote = Math.abs(sumLines - base) > tol ? ` Diferencia de base ${round2(sumLines - base)} € explicable por el redondeo a 3 decimales; Odoo calculará los impuestos y totales por línea, que deben revisarse en el borrador.` : "";
  return { ok: true, message: `Importes PDF/editor revisados.${roundingNote}${poNote}`, base, taxes, total, sumLines, poTotal };
}

function norm(s: string): string {
  return normalizeSupplierName(s);
}

/** Encuentra la linea del pedido que casa con la descripcion extraida (solapamiento de tokens). */
function findPoLine(pos: OrderShape[], description: string | null): OrderShape["lines"][number] | null {
  if (!description) return null;
  const tokens = norm(description).split(" ").filter((x) => x.length > 2);
  if (!tokens.length) return null;
  for (const po of pos) {
    for (const l of po.lines) {
      if (!l.productName) continue;
      const pt = norm(l.productName).split(" ").filter((x) => x.length > 2);
      const overlap = pt.filter((x) => tokens.includes(x)).length;
      if (pt.length && overlap / Math.min(pt.length, tokens.length) >= 0.6) return l;
    }
  }
  return null;
}

async function currencyId(config: OdooConfig, uid: number, code: string): Promise<number | null> {
  try {
    const rows = await searchRead(config, uid, "res.currency", [["name", "=", code.toUpperCase()]], ["id"], { limit: 1 });
    return rows.length ? Number(rows[0].id) : null;
  } catch {
    return null;
  }
}

async function findProductByLabel(config: OdooConfig, uid: number, label: string): Promise<number | null> {
  try {
    const rows = await searchRead(config, uid, "product.template", [["name", "ilike", label.trim().slice(0, 80)]], ["id"], { limit: 1 });
    return rows.length ? Number(rows[0].id) : null;
  } catch {
    return null;
  }
}

async function partnerByVat(config: OdooConfig, uid: number, vat: string | null): Promise<number | null> {
  if (!vat) return null;
  try {
    const rows = await searchRead(config, uid, "res.partner", [["vat", "ilike", vat.trim()]], ["id"], { limit: 1 });
    return rows.length ? Number(rows[0].id) : null;
  } catch {
    return null;
  }
}

// ===== Mapeo exacto de impuestos (OSS) =====

const EU_COUNTRIES = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","EL","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","SE"]);

/** Infiere el pais a partir del campo country o del prefijo del NIF (ISS). */
function inferCountry(country: string | null, vat: string | null): string | null {
  if (country && /^[A-Z]{2}$/i.test(country)) return country.toUpperCase();
  const m = vat?.match(/^([A-Z]{2})/);
  return m ? m[1].toUpperCase() : null;
}

/** Extrae la tasa (%) de los nombres de impuesto de una linea ("IVA 21%", "21% IVA", "IGIC 7%"...). */
function parseRateFromNames(names: string[]): number | null {
  const joined = (names ?? []).join(" ");
  const m = joined.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
  return m ? Math.round(Number(m[1].replace(",", ".")) * 100) / 100 : null;
}

/** Categoria OSS segun pais: ES domestico, UE intracomunitario, resto importacion/extracomunitario. */
function taxCategoryKey(country: string | null): "es" | "eu" | "imp" {
  if (country === "ES") return "es";
  if (country && EU_COUNTRIES.has(country)) return "eu";
  return "imp";
}

const CATEGORY_KEYWORDS: Record<"es" | "eu" | "imp", string[]> = {
  es: ["IVA soportado (bienes corrientes)", "IVA soportado (servicios corrientes)"],
  eu: ["Adquisición Intracomunitaria. Bienes corrientes", "Adquisición Intracomunitaria. Bienes de inversión", "Adquisición de servicios intracomunitarios"],
  imp: ["Importaciones bienes corrientes", "Importaciones bienes de inversión", "Adquisición de servicios extracomunitarios", "Adquisición Intracomunitario. Bienes corrientes"],
};

// Caché de resolución por pais|tasa (evita repetir llamadas a Odoo).
const taxCache = new Map<string, { id: number; name: string; rate: number } | null>();

export async function resolvePurchaseTax(
  config: OdooConfig,
  uid: number,
  country: string | null,
  rate: number,
): Promise<{ id: number; name: string; rate: number } | null> {
  const cat = taxCategoryKey(country);
  const key = `${cat}|${rate}`;
  if (taxCache.has(key)) return taxCache.get(key) ?? null;
  try {
    const rows = await searchRead(
      config, uid, "account.tax",
      [["type_tax_use", "=", "purchase"], ["active", "=", true], ["amount", "=", rate]],
      ["id", "name", "amount"],
      { order: "id asc" },
    );
    const candidates = rows.map((r) => ({ id: Number(r.id), name: String(r.name ?? ""), rate: Number(r.amount ?? rate) }));
    const keywords = CATEGORY_KEYWORDS[cat];
    let best: { id: number; name: string; rate: number } | null = null;
    let bestScore = -1;
    for (const c of candidates) {
      let score = 0;
      for (let i = 0; i < keywords.length; i++) {
        if (c.name.toLowerCase().includes(keywords[i].toLowerCase())) score += 10 - i;
      }
      if (/iva/i.test(c.name)) score += 1;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (bestScore <= 0) best = candidates[0] ?? null; // tasa unica sin keywords: usar la primera
    taxCache.set(key, best);
    return best;
  } catch {
    taxCache.set(key, null);
    return null;
  }
}

/** Crea el BORRADOR de factura de proveedor en Odoo. No contabiliza nada. */
export async function createSupplierDraft(
  config: OdooConfig,
  uid: number,
  doc: { driveFileId: string; name: string; invoiceBranch?: "goods" | "services" | null; confirmedOdooPartnerId?: number | null; extracted: { supplier: string | null; supplierVat: string | null; invoiceNumber: string | null; invoiceDate: string | null; dueDate: string | null; currency: string | null; base: number | null; taxes: number | null; total: number | null; lines: { productId?: number | null; description: string | null; quantity: number | null; priceUnit: number | null; discount?: number | null; discountExtra?: number | null; promptPaymentDiscount?: number | null; total: number | null; taxNames: string[]; taxId?: number | null; taxAmount?: number | null; accountId?: number | null; sourcePurchaseOrderId?: number | null; genericProductConfirmed?: boolean; pdfPriceVerified?: boolean; qtyReceived?: number | null; qtyInvoiced?: number | null }[] } | null; assignedPurchaseOrderIds: number[] | null; match: { purchaseOrderId: number | null } | null },
  orders: OrderShape[],
  accountingDate: string,
): Promise<DraftResult> {
  const ex = doc.extracted;
  if (!ex) return { ok: false, message: "El documento no tiene datos extraidos", warnings: [] };

  const lines = ex.lines ?? [];
  const { base, taxes, total } = ex;

  // Los importes declarados deben estar presentes, pero sus diferencias numéricas
  // se muestran como advertencias para que el borrador pueda revisarse en Odoo.
  const assignedIds = doc.assignedPurchaseOrderIds?.length ? doc.assignedPurchaseOrderIds : [];
  const amountError = draftAmountCompletenessError(base, taxes, total, lines);
  if (amountError) return { ok: false, message: amountError, warnings: [] };
  const pos = orders.filter((o) => assignedIds.includes(o.id));
  const warnings: string[] = supplierInvoiceAmountWarnings(base!, taxes!, total!, lines, pos);
  const services = doc.invoiceBranch === "services";
  const adjustments = lines.filter((line) => isWebAdjustmentProductId(line.productId));
  if (adjustments.length > 1) return { ok: false, message: "Solo se admite un Ajuste Web por factura.", warnings: [] };
  if (adjustments.some((line) => line.taxId || line.taxAmount !== 0)) return { ok: false, message: "El Ajuste Web debe ir sin impuesto y con cuota de IVA cero.", warnings: [] };
  let webAdjustmentOdooProductId: number | null = null;
  if (adjustments.length) {
    const adjustmentProducts = await searchRead(config, uid, "product.product", [["default_code", "=", WEB_ADJUSTMENT_PRODUCT_CODE], ["active", "=", true]], ["id", "active", "type", "default_code"], { limit: 2 });
    webAdjustmentOdooProductId = resolveWebAdjustmentProductId(adjustmentProducts);
    if (webAdjustmentOdooProductId == null)
      return { ok: false, message: "Debe existir un único producto AJUSTEWEB de tipo servicio activo en Odoo; no se crea el borrador.", warnings: [] };
  }
  if (services && assignedIds.length) return { ok: false, message: "La factura de servicios sin pedido tiene pedidos asociados.", warnings: [] };
  if (services && !lines.some((line) => !isWebAdjustmentProductId(line.productId))) return { ok: false, message: "Añade al menos una línea contable de servicio o comisión.", warnings: [] };
  if (!services && !assignedIds.length) return { ok: false, message: "Selecciona y confirma al menos un pedido de compra antes de crear el borrador.", warnings: [] };
  if (!lines.length) return { ok: false, message: "El documento no tiene líneas. Añádelas antes de crear el borrador.", warnings: [] };
  // El proveedor nunca se infiere para escribir: debe ser el partner real de los pedidos confirmados.
  const partnerId = services ? doc.confirmedOdooPartnerId : pos[0]?.partnerId ?? null;
  if (!partnerId || (!services && pos.some((po) => po.partnerId !== partnerId))) return { ok: false, message: "Confirma un único proveedor existente de Odoo.", warnings: [] };
  const [partner] = await readRows(config, uid, "res.partner", [partnerId], ["active", "vat"]);
  if (!partner || partner.active === false) return { ok: false, message: "El proveedor confirmado no está activo en Odoo.", warnings: [] };
  const docVat = String(ex.supplierVat ?? "").replace(/[^A-Z0-9]/gi, "").replace(/^ES/i, "");
  const partnerVat = String(partner.vat ?? "").replace(/[^A-Z0-9]/gi, "").replace(/^ES/i, "");
  if (services && docVat && partnerVat && docVat !== partnerVat) return { ok: false, message: "El NIF de la factura no coincide con el proveedor Odoo confirmado.", warnings: [] };
  if (!ex.invoiceNumber || !ex.invoiceDate) return { ok: false, message: "Faltan número o fecha de factura. Complétalos antes de crear el borrador.", warnings: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(accountingDate) || Number.isNaN(Date.parse(`${accountingDate}T00:00:00Z`))) return { ok: false, message: "Selecciona una fecha contable válida antes de crear el borrador.", warnings: [] };
  const existing = await searchRead(config, uid, "account.move", [["move_type", "=", "in_invoice"], ["partner_id", "=", partnerId], ["ref", "=", ex.invoiceNumber], ["state", "!=", "cancel"]], ["id", "name", "state"], { limit: 1 });
  if (existing.length) return { ok: false, message: `Ya existe en Odoo una factura de este proveedor con referencia ${ex.invoiceNumber} (${existing[0].name ?? existing[0].id}). Revísala antes de crear otra.`, warnings: [] };

  // ===== Tasa global (de los importes) para lineas sin nombre de impuesto =====
  const globalRate = base > 0 ? Math.round((taxes / base) * 10000) / 100 : null;
  // Pais para el mapeo OSS: campo country de la extraccion o prefijo del NIF (ISS)
  const taxCountry = inferCountry(ex.country ?? null, ex.supplierVat);

  // ===== Construir lineas con impuesto mapeado exacto =====
  const curId = ex.currency ? await currencyId(config, uid, ex.currency) : null;
  const odooLines: unknown[] = [];
  const taxDetail: DraftResult["taxDetail"] = [];
  const livePoLines = new Map<number, { id: number; productId: number; qtyOrdered: number; qtyReceived: number; qtyInvoiced: number }[]>();
  for (const po of pos) {
    const rows = await searchRead(config, uid, "purchase.order.line", [["order_id", "=", po.id]], ["id", "product_id", "product_qty", "qty_received", "qty_invoiced"]);
    livePoLines.set(po.id, rows.map((row) => ({ id: Number(row.id), productId: Array.isArray(row.product_id) ? Number(row.product_id[0]) : 0, qtyOrdered: Number(row.product_qty ?? 0), qtyReceived: Number(row.qty_received ?? 0), qtyInvoiced: Number(row.qty_invoiced ?? 0) })));
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const isAdjustment = isWebAdjustmentProductId(l.productId);
    const manualAccountLine = !l.productId && !l.sourcePurchaseOrderId;
    if (isAdjustment && (l.taxId || l.taxAmount !== 0)) return { ok: false, message: `Línea ${i + 1}: el Ajuste Web debe ir sin impuesto y con cuota de IVA cero.`, warnings: [] };
    if (!isAdjustment && (l.priceUnit == null || !Number.isFinite(l.priceUnit) || !l.quantity || l.quantity <= 0)) return { ok: false, message: `Línea ${i + 1}: faltan cantidad o precio válidos.`, warnings: [] };
    const serviceIdentityError = services && !isAdjustment && !manualAccountLine ? serviceLineIdentityError(l, i) : null;
    if (serviceIdentityError) return { ok: false, message: serviceIdentityError, warnings: [] };
    if ((!l.sourcePurchaseOrderId || !assignedIds.includes(l.sourcePurchaseOrderId) || !l.productId) && !isAdjustment && !services && !manualAccountLine) {
      return { ok: false, message: `Línea ${i + 1}: enlázala a un producto y pedido confirmados, o déjala como línea contable sin producto.`, warnings: [] };
    }
    if (!isAdjustment && !services && !manualAccountLine && !pos.some((po) => po.id === l.sourcePurchaseOrderId && po.lines.some((source) => source.productId === l.productId))) {
      return { ok: false, message: `Línea ${i + 1}: el producto no existe en el pedido de origen confirmado.`, warnings: [] };
    }
    const sourcePoLines = !isAdjustment && !services && !manualAccountLine ? (livePoLines.get(Number(l.sourcePurchaseOrderId)) ?? []).filter((source) => source.productId === l.productId && source.qtyReceived - source.qtyInvoiced + 0.0001 >= Number(l.quantity ?? 0)) : [];
    if (!isAdjustment && !services && !manualAccountLine && sourcePoLines.length !== 1) {
      return { ok: false, message: `Línea ${i + 1}: no hay una única línea de compra para este producto en el pedido confirmado. Revisa la asociación antes de crear el borrador.`, warnings: [] };
    }
    if (!isAdjustment && (!l.taxId || !l.accountId || l.taxAmount == null)) {
      return { ok: false, message: `Línea ${i + 1}: confirma impuesto, cuota y cuenta contable antes de crear el borrador.`, warnings: [] };
    }
    if (!isAdjustment && !services && !manualAccountLine && l.quantity != null) {
      const availableReceived = sourcePoLines[0].qtyReceived - sourcePoLines[0].qtyInvoiced;
      if (l.quantity > availableReceived + 0.0001) {
        return { ok: false, message: `Línea ${i + 1}: recepción incompleta. Factura ${l.quantity}, disponible recibido sin facturar ${Math.max(0, availableReceived)}.`, warnings: [] };
      }
    }
    if (services && !isAdjustment && l.productId) {
      const [product] = await readRows(config, uid, "product.product", [Number(l.productId)], ["type", "active"]);
      const type = String(product?.type ?? "");
      if (product?.active === false || (type !== "service" && type !== "consu")) return { ok: false, message: `Línea ${i + 1}: sólo se admite un servicio o consumible activo confirmado por el operario.`, warnings: [] };
    }

    // Tasa de la linea: por nombre ("IVA 21%") o la global de la factura
    const lineRate = parseRateFromNames(l.taxNames ?? []) ?? globalRate;
    // A taxable early-payment discount must reduce both base and VAT. Keep
    // genuinely tax-free adjustments tax-free when no tax quota was confirmed.
    let taxId: number | null = isAdjustment && !l.taxAmount ? null : (l.taxId ?? null);
    let taxName: string | null = null;
    if (!isAdjustment && !taxId && lineRate != null && lineRate > 0) {
      const resolved = await resolvePurchaseTax(config, uid, taxCountry, lineRate);
      if (resolved) {
        taxId = resolved.id;
        taxName = resolved.name;
        taxDetail.push({ lineIndex: i, taxId: resolved.id, taxName: resolved.name, rate: lineRate });
      } else {
        warnings.push(`Línea ${i + 1}: no se encontró impuesto de compra al ${lineRate}% en Odoo para ${taxCountry ?? "?"} — se crea SIN impuesto (revisar antes de contabilizar)`);
      }
    }

    const cmd: Record<string, unknown> = {
      name: l.description ?? "Linea",
      quantity: l.quantity ?? 1,
      price_unit: l.priceUnit ?? 0,
      discount: effectiveDiscount(l.discount, l.discountExtra, l.promptPaymentDiscount),
    };
    if (isAdjustment) {
      cmd.product_id = webAdjustmentOdooProductId!;
      cmd.tax_ids = [[6, 0, []]];
    } else if (l.productId) cmd.product_id = l.productId;
    if (sourcePoLines.length === 1) cmd.purchase_line_id = sourcePoLines[0].id;
    if (taxId) cmd.tax_ids = [[6, 0, [taxId]]];
    const accountId = l.accountId ?? (isAdjustment ? lines.find((line) => !isWebAdjustmentProductId(line.productId) && line.accountId)?.accountId : null);
    if (accountId) cmd.account_id = accountId;
    if (isAdjustment && !accountId) return { ok: false, message: "El descuento necesita una cuenta contable de compras confirmada.", warnings: [] };
    odooLines.push([0, 0, cmd]);
  }

  const vals: Record<string, unknown> = {
    move_type: "in_invoice",
    partner_id: partnerId,
    ref: ex.invoiceNumber ?? doc.name ?? "",
    invoice_date: ex.invoiceDate,
    date: accountingDate,
    invoice_origin: pos.map((o) => o.name).join(", "),
    invoice_line_ids: odooLines,
  };
  if (curId) vals.currency_id = curId;
  if (ex.dueDate) vals.invoice_date_due = ex.dueDate;

  const moveId = (await executeKw(config, uid, "account.move", "create", [vals])) as number;
  let created: Record<string, unknown> | undefined;
  let createdLines: Record<string, unknown>[] = [];
  let readbackComplete = false;
  try {
    [created] = await readRows(config, uid, "account.move", [moveId], ["name", "state", "ref", "invoice_date_due", "amount_untaxed", "amount_tax", "amount_total", "invoice_line_ids", "tax_totals"]);
    // Odoo 18 exposes the same editable tax widget through tax_totals. Its
    // inverse adjusts the tax journal line and the payable line together.
    // Never change product prices or add a balancing product for a tax delta.
    if (created && Math.abs(Number(created.amount_tax ?? 0) - taxes) > 0.005) {
      if (warnings.some((warning) => warning.startsWith("Cuotas de línea"))) {
        warnings.push("Odoo conserva el impuesto calculado por sus líneas porque difiere del importe declarado; revisa y corrige el borrador antes de contabilizar.");
      } else {
      const selectedTaxIds = new Set(lines.filter((line) => !isWebAdjustmentProductId(line.productId)).map((line) => line.taxId).filter(Boolean));
      if (selectedTaxIds.size !== 1) {
        warnings.push("Odoo calculó otra cuota y hay varios impuestos: ajusta los grupos fiscales en Odoo antes de contabilizar.");
      } else {
        try {
          const [taxRow] = await readRows(config, uid, "account.tax", [Number([...selectedTaxIds][0])], ["tax_group_id"]);
          const groupId = Array.isArray(taxRow?.tax_group_id) ? Number(taxRow.tax_group_id[0]) : 0;
          const amended = planTaxTotalCorrection(created.tax_totals, groupId, taxes);
          await executeKw(config, uid, "account.move", "write", [[moveId], { tax_totals: amended }]);
          [created] = await readRows(config, uid, "account.move", [moveId], ["name", "state", "ref", "invoice_date_due", "amount_untaxed", "amount_tax", "amount_total", "invoice_line_ids"]);
          if (Math.abs(Number(created?.amount_tax ?? 0) - taxes) > 0.005 || Math.abs(Number(created?.amount_total ?? 0) - total) > 0.01) {
            warnings.push("El ajuste de impuesto no quedó reflejado en los totales de Odoo. Revisa el borrador antes de contabilizar.");
          }
        } catch (error) {
          warnings.push(`Borrador creado, pero Odoo no aplicó el ajuste de impuesto: ${error instanceof Error ? error.message : "error desconocido"}. Corrígelo en Odoo antes de contabilizar.`);
        }
      }
      }
    }
    const invoiceLineIds = Array.isArray(created?.invoice_line_ids) ? created.invoice_line_ids.map(Number).filter(Number.isFinite) : [];
    createdLines = invoiceLineIds.length ? await readRows(config, uid, "account.move.line", invoiceLineIds, ["product_id", "purchase_line_id", "quantity", "price_unit", "price_subtotal", "price_total"]) : [];
    readbackComplete = Boolean(created);
    if (created && String(created.ref ?? "") !== ex.invoiceNumber) warnings.push("La referencia de proveedor leída en Odoo no coincide con la factura. Revisa el borrador antes de validarlo.");
    if (created && ex.dueDate && String(created.invoice_date_due ?? "") !== ex.dueDate) warnings.push("El vencimiento leído en Odoo no coincide con el PDF. Revisa el borrador antes de validarlo.");
  } catch (error) {
    warnings.push(`Borrador creado (${moveId}), pero no se pudo releer el desglose: ${error instanceof Error ? error.message : "error de lectura"}. Revísalo en Odoo.`);
  }
  return {
    ok: true,
    moveId,
    name: String(created?.name ?? moveId),
    state: String(created?.state ?? "draft"),
    actual: readbackComplete && created ? {
      reference: String(created.ref ?? ""), dueDate: created.invoice_date_due ? String(created.invoice_date_due) : null,
      base: Number(created?.amount_untaxed ?? 0), taxes: Number(created?.amount_tax ?? 0), total: Number(created?.amount_total ?? 0),
      lines: createdLines.map((line) => ({ productId: Array.isArray(line.product_id) ? Number(line.product_id[0]) : null,
        purchaseLineId: Array.isArray(line.purchase_line_id) ? Number(line.purchase_line_id[0]) : null,
        quantity: Number(line.quantity ?? 0), priceUnit: Number(line.price_unit ?? 0), base: Number(line.price_subtotal ?? 0), total: Number(line.price_total ?? 0) })),
    } : undefined,
    message: `Borrador ${created?.name ?? moveId} creado en Odoo con impuestos mapeados (${taxDetail.length} línea(s))`,
    warnings,
    taxDetail,
  };
}

/** Contabiliza (posted) un borrador ya creado. Accion explicita del usuario. */
export async function postSupplierInvoice(config: OdooConfig, uid: number, moveId: number): Promise<DraftResult> {
  await executeKw(config, uid, "account.move", "action_post", [moveId]);
  const [row] = await readRows(config, uid, "account.move", [moveId], ["name", "state"]);
  return {
    ok: true,
    moveId,
    name: String(row?.name ?? moveId),
    state: String(row?.state ?? "posted"),
    message: `Factura ${row?.name ?? moveId} contabilizada en Odoo`,
    warnings: [],
  };
}

/** Descarta (cancela y elimina) un borrador en Odoo. Solo borradores sin contabilizar. */
export async function discardSupplierDraft(config: OdooConfig, uid: number, moveId: number): Promise<DraftResult> {
  await executeKw(config, uid, "account.move", "action_cancel", [moveId]);
  await executeKw(config, uid, "account.move", "unlink", [moveId]);
  return { ok: true, moveId, name: String(moveId), state: "cancel", message: `Borrador ${moveId} descartado (cancelado y eliminado) en Odoo`, warnings: [] };
}

export async function odooSession(env: Record<string, string | undefined>): Promise<{ config: OdooConfig; uid: number }> {
  const config = getOdooConfig(env);
  if (!config.url || !config.database || !config.username || !config.apiKey) {
    throw new Error("Falta configuracion Odoo (ODOO_URL/DB/USERNAME/API_KEY)");
  }
  const uid = await authenticate(config);
  return { config, uid };
}
