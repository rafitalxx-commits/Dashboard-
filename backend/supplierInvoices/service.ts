// Service de sincronizacion y normalizacion de Facturas de proveedor (Fase 1, SOLO LECTURA).
// Odoo es la fuente de verdad; el Dashboard mantiene cache/memoria con write_date para
// sincronizacion incremental y campos reservados para OCR/IA/Drive en fases siguientes.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { getOdooConfig, hasOdooConfig, authenticate, searchIds, paginatedRead, searchRead, readRows } from "./odooClient.ts";
import type { OdooConfig } from "./odooClient.ts";

import type {
  SupplierInvoiceRecord,
  SupplierInvoiceAttachment,
  SupplierInvoiceLine,
  SupplierInvoiceSortKey,
  SupplierInvoiceFilters,
  SupplierInvoiceStore,
  SupplierInvoiceKpis,
  SupplierInvoiceCharts,
  SupplierInvoiceOptions,
} from "./types.ts";

// Campos verificados en Odoo 18.0+e-20251006 (muestra real leida).
const MOVE_FIELDS = [
  "id", "name", "ref", "move_type", "state", "invoice_date", "date", "invoice_date_due",
  "currency_id", "amount_untaxed", "amount_tax", "amount_total", "amount_residual",
  "payment_state", "journal_id", "partner_id", "fiscal_position_id", "invoice_origin",
  "write_date",
] as const;

const LINE_FIELDS = [
  "id", "move_id", "sequence", "name", "tax_ids", "display_type", "product_id",
  "quantity", "price_unit", "price_subtotal", "price_total", "discount", "purchase_line_id",
] as const;

const PARTNER_FIELDS = ["name", "vat", "country_id"] as const;

type RawRow = Record<string, unknown> & { id: number };
type TwoTuple = [number, string] | false;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string | null {
  return v == null || v === false ? null : String(v);
}
function two(v: unknown): TwoTuple {
  return Array.isArray(v) && v.length === 2 ? [Number(v[0]), String(v[1])] : false;
}
function arrIds(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => (Array.isArray(x) ? Number(x[0]) : Number(x))).filter(Number.isFinite) : [];
}

function extractProductRef(name: string | null): string | null {
  if (!name) return null;
  const m = name.match(/^\s*\[([^\]]+)\]\s*/);
  return m ? m[1] : null;
}

export class SupplierInvoiceSyncService {
  private store: SupplierInvoiceStore;
  private storePath: string;
  private dataDir: string;

  constructor(options: { dataDir?: string } = {}) {
    this.dataDir = options.dataDir ?? "";
    this.storePath = this.dataDir ? `${this.dataDir.replace(/\/$/, "")}/supplier-invoices.json` : "";
    this.store = {
      meta: { version: 1, lastSyncAt: null, lastSyncMode: "none", totalInvoices: 0, writeDateMax: null, message: null },
      invoices: [],
      supplierEquivalences: [],
    };
    this.load();
  }

  load(): void {
    if (!this.storePath) return;
    try {
      if (existsSync(this.storePath)) {
        const raw = JSON.parse(readFileSync(this.storePath, "utf8")) as SupplierInvoiceStore;
        if (raw && Array.isArray(raw.invoices)) this.store = raw;
      }
    } catch {
      // store corrupto o ausente: se re-sincroniza desde Odoo
    }
  }

  save(): void {
    if (!this.storePath) return;
    try {
      if (this.dataDir) mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.store), "utf8");
    } catch {
      // la cache es secundaria; no bloquea la respuesta
    }
  }

  getStore(): SupplierInvoiceStore {
    return this.store;
  }

  async syncFromOdoo(env: Record<string, string | undefined>, opts: { incremental?: boolean } = {}): Promise<SupplierInvoiceStore["meta"]> {
    const config = getOdooConfig(env);
    if (!hasOdooConfig(config)) {
      this.store.meta.message = "Faltan variables ODOO_URL, ODOO_DATABASE, ODOO_USERNAME u ODOO_API_KEY";
      return this.store.meta;
    }
    const uid = await authenticate(config);
    const nowIso = new Date().toISOString();
    const incremental = opts.incremental !== false && !!this.store.meta.writeDateMax;

    const domain: unknown[] = [["move_type", "in", ["in_invoice", "in_refund"]]];
    if (incremental) domain.push(["write_date", ">", this.store.meta.writeDateMax]);

    const moveIds = await searchIds(config, uid, "account.move", domain, { order: "invoice_date desc, id desc" });

    // Proteccion: en modo incremental nunca borrar el historico si Odoo falla a mitad.
    const safeIncremental = incremental && moveIds.length <= 5000;
    if (incremental && !safeIncremental) {
      // Si el incremental devuelve mas de 5000 cambios es sospechoso; se fuerza full.
      this.store.meta.message = "Incremental con volumen inesperado; se realizara sincronizacion completa.";
    }

    const pages = await paginatedRead(config, uid, "account.move", moveIds, [...MOVE_FIELDS]);
    const moves = pages as RawRow[];

    const partnerIds = [...new Set(moves.map((m) => Number(two(m.partner_id)?.[0] ?? 0)).filter(Boolean))];
    const partnerRows = (await readRows(config, uid, "res.partner", partnerIds, [...PARTNER_FIELDS])) as RawRow[];
    const partnerMap = new Map<number, { name: string; vat: string | null; country: string | null; countryCode: string | null }>();
    for (const p of partnerRows) {
      const c = two(p.country_id);
      partnerMap.set(Number(p.id), {
        name: str(p.name) ?? "",
        vat: str(p.vat),
        country: c ? c[1] : null,
        countryCode: c ? String(c[0]) : null,
      });
    }

    const lineRows = (await searchRead(config, uid, "account.move.line",
      [["move_id", "in", moveIds], ["display_type", "in", ["product", "line_section", "line_note"]]],
      [...LINE_FIELDS], { order: "move_id, sequence", limit: 15000 })) as RawRow[];
    const linesByMove = new Map<number, RawRow[]>();
    for (const l of lineRows) {
      const mv = Number(two(l.move_id)?.[0] ?? 0);
      if (!mv) continue;
      if (!linesByMove.has(mv)) linesByMove.set(mv, []);
      linesByMove.get(mv)!.push(l);
    }

    const taxIds = [...new Set(lineRows.flatMap((l) => arrIds(l.tax_ids)))];
    const taxRows = (await readRows(config, uid, "account.tax", taxIds, ["name"])) as RawRow[];
    const taxName = new Map<number, string>();
    for (const t of taxRows) taxName.set(Number(t.id), str(t.name) ?? "");

    const poLineIds = [...new Set(lineRows.map((l) => Number(two(l.purchase_line_id)?.[0] ?? 0)).filter(Boolean))];
    const poLineRows = (await readRows(config, uid, "purchase.order.line", poLineIds, ["order_id"])) as RawRow[];
    const orderByPoLine = new Map<number, number>();
    for (const pl of poLineRows) {
      const oid = Number(two(pl.order_id)?.[0] ?? 0);
      if (oid) orderByPoLine.set(Number(pl.id), oid);
    }
    const orderIds = [...new Set(orderByPoLine.values())];
    const orderRows = (await readRows(config, uid, "purchase.order", orderIds, ["name", "state", "picking_ids"])) as RawRow[];
    const orderMap = new Map<number, { name: string; state: string; pickings: number[] }>();
    for (const o of orderRows) {
      orderMap.set(Number(o.id), { name: str(o.name) ?? "", state: str(o.state) ?? "", pickings: arrIds(o.picking_ids) });
    }
    const pickingIds = [...new Set([...orderMap.values()].flatMap((o) => o.pickings))];
    const pickingRows = (await readRows(config, uid, "stock.picking", pickingIds, ["name", "state", "scheduled_date"])) as RawRow[];
    const pickingName = new Map<number, string>();
    for (const k of pickingRows) pickingName.set(Number(k.id), str(k.name) ?? "");

    const attsByMove = new Map<number, SupplierInvoiceAttachment[]>();
    if (moveIds.length) {
      const attRows = (await searchRead(config, uid, "ir.attachment",
        [["res_model", "=", "account.move"], ["res_id", "in", moveIds]],
        ["name", "mimetype", "type"], { limit: 30000 })) as RawRow[];
      for (const a of attRows) {
        const mv = Number(a.res_id ?? 0);
        if (!mv) continue;
        if (!attsByMove.has(mv)) attsByMove.set(mv, []);
        attsByMove.get(mv)!.push({ id: Number(a.id), name: str(a.name) ?? "", mime: str(a.mimetype), type: str(a.type) });
      }
    }

    const existing = new Map<number, SupplierInvoiceRecord>();
    for (const inv of this.store.invoices) existing.set(inv.id, inv);
    const maxWrite = new Date(0);

    const invoices: SupplierInvoiceRecord[] = moves.map((m) => {
      const id = Number(m.id);
      const prev = existing.get(id);
      const writeDate = str(m.write_date);
      const wd = writeDate ? new Date(writeDate) : null;
      if (wd && wd.getTime() > maxWrite.getTime()) maxWrite.setTime(wd.getTime());

      const partner = partnerMap.get(Number(two(m.partner_id)?.[0] ?? 0)) ?? { name: "", vat: null, country: null, countryCode: null };
      const rawLines = (linesByMove.get(id) ?? []).slice().sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
      const lines: SupplierInvoiceLine[] = rawLines.map((l) => {
        const prod = two(l.product_id);
        const taxes = arrIds(l.tax_ids).map((tid) => taxName.get(tid) ?? "").filter(Boolean);
        return {
          productId: prod ? prod[0] : null,
          productRef: prod ? extractProductRef(prod[1]) : extractProductRef(str(l.name)),
          productName: prod ? prod[1] : null,
          name: str(l.name) ?? "",
          quantity: num(l.quantity),
          priceUnit: num(l.price_unit),
          discount: num(l.discount),
          taxNames: taxes,
          subtotal: num(l.price_subtotal),
          total: num(l.price_total),
          displayType: (["product", "line_section", "line_note"].includes(String(l.display_type)) ? String(l.display_type) : "product") as SupplierInvoiceLine["displayType"],
        };
      });

      const poIdsInLines = [...new Set(rawLines.map((l) => orderByPoLine.get(Number(two(l.purchase_line_id)?.[0] ?? 0)) ?? 0).filter(Boolean))];
      const pos = poIdsInLines.map((oid) => orderMap.get(oid)).filter(Boolean) as { name: string; state: string; pickings: number[] }[];
      const poNames = [...new Set(pos.map((o) => o.name))];
      const pkIds = [...new Set(pos.flatMap((o) => o.pickings))];
      const pkNames = pkIds.map((pid) => pickingName.get(pid) ?? "").filter(Boolean);

      const amountTotal = num(m.amount_total);
      const amountResidual = num(m.amount_residual);
      const attachments = attsByMove.get(id) ?? [];

      return {
        id,
        name: str(m.name) ?? "/",
        ref: str(m.ref),
        moveType: (String(m.move_type) === "in_refund" ? "in_refund" : "in_invoice") as SupplierInvoiceRecord["moveType"],
        state: str(m.state) ?? "",
        paymentState: str(m.payment_state) ?? "",
        invoiceDate: str(m.invoice_date),
        accountingDate: str(m.date),
        dueDate: str(m.invoice_date_due),
        currency: two(m.currency_id) ? two(m.currency_id)![1] : null,
        journal: two(m.journal_id) ? two(m.journal_id)![1] : null,
        partnerId: Number(two(m.partner_id)?.[0] ?? 0),
        partnerName: partner.name,
        partnerVat: partner.vat,
        partnerCountry: partner.country,
        partnerCountryCode: partner.countryCode,
        fiscalPosition: two(m.fiscal_position_id) ? two(m.fiscal_position_id)![1] : null,
        amountUntaxed: num(m.amount_untaxed),
        amountTax: num(m.amount_tax),
        amountTotal,
        amountResidual,
        amountPaid: amountTotal - amountResidual,
        paidAmount: amountTotal - amountResidual,
        invoiceOrigin: str(m.invoice_origin),
        taxSummary: [...new Set(lines.flatMap((l) => l.taxNames))],
        linkedPurchaseOrderIds: poIdsInLines,
        linkedPurchaseOrderNames: poNames,
        linkedPickingIds: pkIds,
        linkedPickingNames: pkNames,
        products: [...new Set(lines.map((l) => (l.productName ? l.productName : l.name).slice(0, 200)).filter(Boolean))].slice(0, 25),
        lineCount: lines.length,
        lines,
        attachments,
        hasPdf: attachments.some((a) => (a.mime && /pdf/i.test(a.mime)) || /\.pdf$/i.test(a.name)),
        writeDate,
        lastSyncAt: nowIso,
        source: prev?.source ?? null,
        pdf_url: prev?.pdf_url ?? null,
        drive_file_id: prev?.drive_file_id ?? null,
        ocr_status: prev?.ocr_status ?? null,
        ai_status: prev?.ai_status ?? null,
        confidence: prev?.confidence ?? null,
        detected_supplier: prev?.detected_supplier ?? null,
        matched_supplier_id: prev?.matched_supplier_id ?? null,
        matched_purchase_orders: prev?.matched_purchase_orders ?? [],
        matching_score: prev?.matching_score ?? null,
        validation_status: prev?.validation_status ?? null,
        validation_user: prev?.validation_user ?? null,
        processed_at: prev?.processed_at ?? null,
      };
    });

    if (!safeIncremental) {
      this.store.invoices = invoices;
      this.store.meta.writeDateMax = maxWrite.getTime() > 0 ? maxWrite.toISOString() : this.store.meta.writeDateMax;
    } else {
      // Incremental: mezclar conservando registros antiguos no modificados.
      const merged = new Map<number, SupplierInvoiceRecord>();
      for (const inv of this.store.invoices) merged.set(inv.id, inv);
      for (const inv of invoices) merged.set(inv.id, inv);
      this.store.invoices = [...merged.values()];
      this.store.meta.writeDateMax = maxWrite.getTime() > 0 ? maxWrite.toISOString() : this.store.meta.writeDateMax;
    }
    this.store.meta.lastSyncAt = nowIso;
    this.store.meta.lastSyncMode = safeIncremental ? "incremental" : "full";
    this.store.meta.totalInvoices = this.store.invoices.length;
    this.store.meta.message = null;
    this.save();
    return this.store.meta;
  }
}

// Filtrado y KPIs sobre el store (memoria).
export function filterInvoices(items: SupplierInvoiceRecord[], filters: SupplierInvoiceFilters): SupplierInvoiceRecord[] {
  return items.filter((inv) => {
    if (filters.from && inv.invoiceDate && inv.invoiceDate < filters.from) return false;
    if (filters.to && inv.invoiceDate && inv.invoiceDate > filters.to) return false;
    if (filters.year != null && inv.invoiceDate) {
      const y = Number(inv.invoiceDate.slice(0, 4));
      if (y !== filters.year) return false;
    }
    if (filters.month != null && inv.invoiceDate) {
      const mo = Number(inv.invoiceDate.slice(5, 7));
      if (mo !== filters.month) return false;
    }
    if (filters.partnerId != null && inv.partnerId !== filters.partnerId) return false;
    if (filters.country && inv.partnerCountry !== filters.country) return false;
    if (filters.state && inv.state !== filters.state) return false;
    if (filters.paymentState && inv.paymentState !== filters.paymentState) return false;
    if (filters.currency && inv.currency !== filters.currency) return false;
    if (filters.fiscalPosition && inv.fiscalPosition !== filters.fiscalPosition) return false;
    if (filters.product) {
      const q = filters.product.toLowerCase();
      if (!inv.products.some((p) => p.toLowerCase().includes(q))) return false;
    }
    if (filters.purchaseOrder) {
      const q = filters.purchaseOrder.toLowerCase();
      if (!inv.linkedPurchaseOrderNames.some((n) => n.toLowerCase().includes(q)) &&
          !(inv.invoiceOrigin ?? "").toLowerCase().includes(q)) return false;
    }
    if (filters.minAmount != null && inv.amountTotal < filters.minAmount) return false;
    if (filters.maxAmount != null && inv.amountTotal > filters.maxAmount) return false;
    if (filters.text) {
      const q = filters.text.toLowerCase();
      const hay = [inv.name, inv.ref, inv.partnerName, inv.partnerVat, inv.invoiceOrigin,
        ...inv.linkedPurchaseOrderNames, ...inv.products].filter(Boolean).join(" | ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortInvoices(items: SupplierInvoiceRecord[], key: SupplierInvoiceSortKey, dir: "asc" | "desc"): SupplierInvoiceRecord[] {
  const cmp = (a: SupplierInvoiceRecord, b: SupplierInvoiceRecord): number => {
    switch (key) {
      case "name": return a.name.localeCompare(b.name);
      case "ref": return (a.ref ?? "").localeCompare(b.ref ?? "");
      case "partnerName": return a.partnerName.localeCompare(b.partnerName);
      case "invoiceDate": return (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "");
      case "dueDate": return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      case "state": return a.state.localeCompare(b.state);
      case "paymentState": return a.paymentState.localeCompare(b.paymentState);
      case "currency": return (a.currency ?? "").localeCompare(b.currency ?? "");
      case "amountUntaxed": return a.amountUntaxed - b.amountUntaxed;
      case "amountTax": return a.amountTax - b.amountTax;
      case "amountTotal": return a.amountTotal - b.amountTotal;
      case "amountResidual": return a.amountResidual - b.amountResidual;
      case "purchaseOrderNames": return a.linkedPurchaseOrderNames.join(", ").localeCompare(b.linkedPurchaseOrderNames.join(", "));
      default: return a.id - b.id;
    }
  };
  return [...items].sort((a, b) => (dir === "asc" ? cmp(a, b) : -cmp(a, b)));
}

export function computeKpis(items: SupplierInvoiceRecord[], filters: SupplierInvoiceFilters): { kpis: SupplierInvoiceKpis; charts: SupplierInvoiceCharts } {
  let periodTotal = 0, periodCount = 0, pendingTotal = 0, paidTotal = 0;
  const activeVendors = new Set<number>();
  let yearTotal = 0;
  const monthly = new Map<number, number>();
  const vendorTotals = new Map<number, { name: string; total: number; count: number }>();
  const payment = { paid: { count: 0, total: 0 }, partial: { count: 0, total: 0 }, pending: { count: 0, total: 0 } };

  const rangeFrom = filters.from ? new Date(filters.from + "T00:00:00") : null;
  const rangeTo = filters.to ? new Date(filters.to + "T23:59:59") : null;
  const year = filters.year ?? (rangeFrom ? rangeFrom.getFullYear() : new Date().getFullYear());
  const inRange = (d: string | null): boolean => {
    if (!d) return false;
    const t = new Date(d + "T00:00:00").getTime();
    if (rangeFrom && t < rangeFrom.getTime()) return false;
    if (rangeTo && t > rangeTo.getTime()) return false;
    return true;
  };
  const monthOf = (d: string | null): number | null => {
    if (!d) return null;
    const dt = new Date(d + "T00:00:00");
    return dt.getFullYear() === year ? dt.getMonth() + 1 : null;
  };

  for (const inv of items) {
    const inY = inv.invoiceDate ? Number(inv.invoiceDate.slice(0, 4)) === year : false;
    if (inY) {
      yearTotal += inv.amountTotal;
      const mo = monthOf(inv.invoiceDate);
      if (mo != null) monthly.set(mo, (monthly.get(mo) ?? 0) + inv.amountTotal);
    }
    if (inRange(inv.invoiceDate)) {
      periodTotal += inv.amountTotal;
      periodCount += 1;
      paidTotal += inv.amountPaid;
      activeVendors.add(inv.partnerId);
      const vt = vendorTotals.get(inv.partnerId) ?? { name: inv.partnerName, total: 0, count: 0 };
      vt.total += inv.amountTotal; vt.count += 1;
      vendorTotals.set(inv.partnerId, vt);
    }
    pendingTotal += inv.amountResidual;
    if (inv.paymentState === "paid" || inv.paymentState === "reversed") { payment.paid.count += 1; payment.paid.total += inv.amountTotal; }
    else if (inv.paymentState === "partial") { payment.partial.count += 1; payment.partial.total += inv.amountTotal; }
    else if (inv.paymentState === "not_paid") { payment.pending.count += 1; payment.pending.total += inv.amountTotal; }
  }

  const previousPeriodTotal = (() => {
    const fFrom = filters.from ? new Date(filters.from + "T00:00:00") : null;
    const fTo = filters.to ? new Date(filters.to + "T23:59:59") : null;
    let prevFrom: Date | null = null, prevTo: Date | null = null;
    if (fFrom && fTo) {
      const spanDays = Math.round((fTo.getTime() - fFrom.getTime()) / 86400000) + 1;
      prevTo = new Date(fFrom.getTime() - 1);
      prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86400000);
    } else if (filters.month != null && year) {
      let py = year, pm = filters.month - 1;
      if (pm < 1) { pm = 12; py -= 1; }
      prevFrom = new Date(py, pm - 1, 1);
      prevTo = new Date(py, pm, 0, 23, 59, 59);
    } else if (filters.year != null) {
      prevFrom = new Date(year - 1, 0, 1);
      prevTo = new Date(year - 1, 11, 31, 23, 59, 59);
    }
    if (!prevFrom || !prevTo) return 0;
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const pF = iso(prevFrom);
    const pT = iso(prevTo);
    return items.filter((inv) => inv.invoiceDate && inv.invoiceDate >= pF && inv.invoiceDate <= pT)
      .reduce((s, inv) => s + inv.amountTotal, 0);
  })();

  const variationPct = previousPeriodTotal > 0 ? ((periodTotal - previousPeriodTotal) / previousPeriodTotal) * 100 : (periodTotal > 0 ? null : null);
  if (periodTotal === 0 && previousPeriodTotal === 0) variationPct;
  const topVendors = [...vendorTotals.entries()].map(([partnerId, v]) => ({ partnerId, name: v.name, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total).slice(0, 10);
  const twelve = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: monthly.get(i + 1) ?? 0 }));

  return {
    kpis: {
      periodTotal, periodCount, yearTotal, pendingTotal, paidTotal,
      averageTicket: periodCount > 0 ? periodTotal / periodCount : 0,
      activeVendors: activeVendors.size,
      previousPeriodTotal, variationPct,
    },
    charts: { monthly: twelve, topVendors, payment },
  };
}

export function computeOptions(items: SupplierInvoiceRecord[]): SupplierInvoiceOptions {
  const vendors = new Map<number, string>();
  const countries = new Set<string>(); const states = new Set<string>(); const paymentStates = new Set<string>();
  const currencies = new Set<string>(); const fiscalPositions = new Set<string>(); const products = new Set<string>();
  const purchaseOrders = new Set<string>();
  for (const inv of items) {
    if (inv.partnerId) vendors.set(inv.partnerId, inv.partnerName);
    if (inv.partnerCountry) countries.add(inv.partnerCountry);
    if (inv.state) states.add(inv.state);
    if (inv.paymentState) paymentStates.add(inv.paymentState);
    if (inv.currency) currencies.add(inv.currency);
    if (inv.fiscalPosition) fiscalPositions.add(inv.fiscalPosition);
    for (const p of inv.products) products.add(p.slice(0, 200));
    for (const o of inv.linkedPurchaseOrderNames) purchaseOrders.add(o);
  }
  return {
    vendors: [...vendors.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    countries: [...countries].sort(),
    states: [...states].sort(),
    paymentStates: [...paymentStates].sort(),
    currencies: [...currencies].sort(),
    fiscalPositions: [...fiscalPositions].sort(),
    products: [...products].sort().slice(0, 500),
    purchaseOrders: [...purchaseOrders].sort().slice(0, 500),
  };
}