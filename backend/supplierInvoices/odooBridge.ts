// Fase 3: puente Dashboard -> Odoo (facturas de proveedor).
// Crea un BORRADOR de factura (account.move in_invoice) en Odoo desde un documento
// VALIDADA, y permite contabilizarlo despues. NUNCA escribe si la puerta
// SUPPLIER_INVOICES_ODOO_WRITE_ENABLED no esta en "true".
//
// Reglas de negocio (Rafa, 2026-09-13):
//  - No se puede crear el borrador si los importes no cuadran:
//    base + impuestos = total  (tolerancia 0.02) y lineas = base.
//    Con pedido asociado, el total de la factura debe coincidir con el del pedido.
//  - El impuesto se mapea EXACTO contra account.tax de Odoo por pais y tasa
//    (critico para OSS / declaraciones trimestrales de los paises donde se comercia).

import type { OdooConfig } from "./odooClient.ts";
import { authenticate, executeKw, searchRead, readRows, getOdooConfig } from "./odooClient.ts";
import { normalizeSupplierName } from "./documentInbox.ts";

export interface DraftResult {
  ok: boolean;
  moveId?: number;
  name?: string;
  state?: string;
  message: string;
  warnings: string[];
  taxDetail?: { lineIndex: number; taxId: number; taxName: string; rate: number }[];
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

export interface AmountsCheck {
  ok: boolean;
  message: string;
  base: number;
  taxes: number;
  total: number;
  sumLines: number;
  poTotal: number | null;
}

/** Validacion pura de importes (gates 1-3): base+impuestos=total, lineas=base, total=pedido. */
export function validateAmounts(
  base: number | null,
  taxes: number | null,
  total: number | null,
  lines: { total: number | null }[],
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
    sumLines = round2(lines.reduce((a, l) => a + (l.total ?? 0), 0));
    if (Math.abs(sumLines - base) > tol) {
      return { ok: false, message: `Las líneas suman ${sumLines} pero la Base es ${round2(base)}. Corrige las líneas del documento en el Dashboard.`, base, taxes, total, sumLines, poTotal: null };
    }
  } else {
    return msg("El documento no tiene líneas. Añádelas o corrige la extracción antes de crear el borrador.");
  }
  let poTotal: number | null = null;
  if (pos.length) {
    poTotal = round2(pos.reduce((a, o) => a + (o.amountTotal ?? 0), 0));
    if (Math.abs(poTotal - total) > tol) {
      return { ok: false, message: `El total de la factura (${round2(total)}) no coincide con el del pedido ${pos.map((o) => o.name).join(", ")} (${poTotal}). Revisa importes o asociación.`, base, taxes, total, sumLines, poTotal };
    }
  }
  return { ok: true, message: "Importes cuadran", base, taxes, total, sumLines, poTotal };
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
  doc: { driveFileId: string; name: string; extracted: { supplier: string | null; supplierVat: string | null; invoiceNumber: string | null; invoiceDate: string | null; dueDate: string | null; currency: string | null; base: number | null; taxes: number | null; total: number | null; lines: { description: string | null; quantity: number | null; priceUnit: number | null; total: number | null; taxNames: string[] }[] } | null; assignedPurchaseOrderIds: number[] | null; match: { purchaseOrderId: number | null } | null },
  orders: OrderShape[],
): Promise<DraftResult> {
  const ex = doc.extracted;
  if (!ex) return { ok: false, message: "El documento no tiene datos extraidos", warnings: [] };

  const lines = ex.lines ?? [];
  const { base, taxes, total } = ex;

  // ===== GATE 1-3: validacion de importes (base+impuestos=total, lineas=base, total=pedido) =====
  const assignedIds = doc.assignedPurchaseOrderIds?.length
    ? doc.assignedPurchaseOrderIds
    : doc.match?.purchaseOrderId ? [doc.match.purchaseOrderId] : [];
  const pos = orders.filter((o) => assignedIds.includes(o.id));
  const check = validateAmounts(ex.base, ex.taxes, ex.total, lines, pos);
  if (!check.ok) return { ok: false, message: check.message, warnings: [] };

  // ===== Partner: el pedido asociado manda (id real de Odoo); si no, por NIF =====
  let partnerId = pos[0]?.partnerId ?? null;
  if (!partnerId) partnerId = await partnerByVat(config, uid, ex.supplierVat);
  if (!partnerId) {
    return { ok: false, message: `No se pudo resolver el proveedor en Odoo (${ex.supplier ?? "?"}). Asocia el pedido de compra o revisa el NIF.`, warnings: [] };
  }

  // ===== Tasa global (de los importes) para lineas sin nombre de impuesto =====
  const globalRate = base > 0 ? Math.round((taxes / base) * 10000) / 100 : null;
  // Pais para el mapeo OSS: campo country de la extraccion o prefijo del NIF (ISS)
  const taxCountry = inferCountry(ex.country ?? null, ex.supplierVat);

  // ===== Construir lineas con impuesto mapeado exacto =====
  const warnings: string[] = [];
  const curId = ex.currency ? await currencyId(config, uid, ex.currency) : null;
  const odooLines: unknown[] = [];
  const taxDetail: DraftResult["taxDetail"] = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const poLine = findPoLine(pos, l.description);
    let productId = poLine?.productId ?? null;
    if (!productId && l.description) productId = await findProductByLabel(config, uid, l.description);

    // Tasa de la linea: por nombre ("IVA 21%") o la global de la factura
    const lineRate = parseRateFromNames(l.taxNames ?? []) ?? globalRate;
    let taxId: number | null = null;
    let taxName: string | null = null;
    if (lineRate != null && lineRate > 0) {
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
      quantity: l.quantity ?? poLine?.qtyOrdered ?? 1,
      price_unit: l.priceUnit ?? poLine?.priceUnit ?? 0,
    };
    if (productId) cmd.product_id = productId;
    else warnings.push(`Línea ${i + 1} sin producto en Odoo: ${l.description ?? "?"} (solo importe)`);
    if (taxId) cmd.tax_ids = [[6, 0, [taxId]]];
    odooLines.push([0, 0, cmd]);
  }

  const today = new Date().toISOString().slice(0, 10);
  const vals: Record<string, unknown> = {
    move_type: "in_invoice",
    partner_id: partnerId,
    ref: ex.invoiceNumber ?? doc.name ?? "",
    invoice_date: ex.invoiceDate ?? today,
    date: ex.invoiceDate ?? today,
    invoice_origin: pos.map((o) => o.name).join(", "),
    invoice_line_ids: odooLines,
  };
  if (curId) vals.currency_id = curId;
  if (ex.dueDate) vals.invoice_date_due = ex.dueDate;

  const moveId = (await executeKw(config, uid, "account.move", "create", [vals])) as number;
  const [created] = await readRows(config, uid, "account.move", [moveId], ["name", "state"]);
  return {
    ok: true,
    moveId,
    name: String(created?.name ?? moveId),
    state: String(created?.state ?? "draft"),
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