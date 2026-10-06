// Control pedido / recepcion / factura (Fase 2, SOLO LECTURA).
// Sincroniza purchase.order + lineas + stock.picking desde Odoo y los cruza con el cache
// de facturas de Fase 1 (account.move -> linkedPurchaseOrderIds) para detectar pedidos
// sin facturar / parcialmente facturados, y calcular importes pendientes de forma operativa.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getOdooConfig, hasOdooConfig, authenticate, searchIds, paginatedRead, searchRead, readRows } from "./odooClient.ts";
import type { UnbilledStore, PurchaseOrderRecord, UnbilledKpis } from "./phase2Types.ts";

type RawRow = Record<string, unknown> & { id: number };
type TwoTuple = [number, string] | false;

function num(v: unknown): number { return typeof v === "number" && Number.isFinite(v) ? v : 0; }
function str(v: unknown): string | null { return v == null || v === false ? null : String(v); }
function two(v: unknown): TwoTuple { return Array.isArray(v) && v.length === 2 ? [Number(v[0]), String(v[1])] : false; }
function arrIds(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => (Array.isArray(x) ? Number(x[0]) : Number(x))).filter(Number.isFinite) : [];
}

const ORDER_FIELDS = [
  "id", "name", "state", "invoice_status", "partner_id", "currency_id", "date_order", "user_id", "origin", "partner_ref",
  "amount_total", "amount_untaxed", "picking_ids", "order_line",
] as const;

const LINE_FIELDS = [
  "id", "order_id", "product_id", "name", "product_qty", "qty_received", "qty_invoiced",
  "price_unit", "price_subtotal", "price_total", "discount", "taxes_id",
] as const;

const PICKING_FIELDS = ["id", "name", "state", "scheduled_date", "date_done"] as const;
const PARTNER_FIELDS = ["name", "vat", "country_id"] as const;
const USER_FIELDS = ["name"] as const;

const MONTHS_LOOKBACK = 24;

export class PurchaseOrdersLedger {
  private store: UnbilledStore;
  private storePath: string;
  private dataDir: string;

  constructor(options: { dataDir?: string } = {}) {
    this.dataDir = options.dataDir ?? "";
    this.storePath = this.dataDir ? `${this.dataDir.replace(/\/$/, "")}/supplier-invoices/purchase-orders.json` : "";
    this.store = { meta: { version: 1, lastPoSyncAt: null, totalOrders: 0, message: null }, orders: [] };
    this.load();
  }

  load(): void {
    if (!this.storePath) return;
    try {
      if (existsSync(this.storePath)) {
        const raw = JSON.parse(readFileSync(this.storePath, "utf8")) as UnbilledStore;
        if (raw && Array.isArray(raw.orders)) this.store = raw;
      }
    } catch {
      // se reconstruye
    }
  }

  save(): void {
    if (!this.storePath) return;
    try {
      mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.store), "utf8");
    } catch {
      // cache secundaria
    }
  }

  getStore(): UnbilledStore { return this.store; }

  // Lectura puntual: la sincronización masiva puede preceder a una recepción.
  // No cambia Odoo; actualiza únicamente la copia local del pedido consultado.
  async refreshOrderByName(env: Record<string, string | undefined>, name: string): Promise<PurchaseOrderRecord | null> {
    if (!/^P\d{5,7}$/i.test(name)) return null;
    const config = getOdooConfig(env);
    if (!hasOdooConfig(config)) throw new Error("Falta la conexión de lectura con Odoo");
    const uid = await authenticate(config);
    const [order] = (await searchRead(config, uid, "purchase.order", [["name", "=", name.toUpperCase()], ["state", "in", ["purchase", "done"]]], [...ORDER_FIELDS], { limit: 1 })) as RawRow[];
    if (!order) {
      const cached = this.store.orders.find((row) => row.name.toUpperCase() === name.toUpperCase());
      if (cached) {
        this.store.orders = this.store.orders.filter((row) => row.id !== cached.id);
        this.store.meta.totalOrders = this.store.orders.length;
        this.save();
      }
      return null;
    }
    const [partner] = (await readRows(config, uid, "res.partner", [Number(two(order.partner_id)?.[0] ?? 0)], [...PARTNER_FIELDS])) as RawRow[];
    const lineRows = (await readRows(config, uid, "purchase.order.line", arrIds(order.order_line), [...LINE_FIELDS])) as RawRow[];
    const pickingRows = (await readRows(config, uid, "stock.picking", arrIds(order.picking_ids), [...PICKING_FIELDS])) as RawRow[];
    const lines = lineRows.map((line) => {
      const product = two(line.product_id);
      const qtyOrdered = num(line.product_qty), qtyReceived = num(line.qty_received), qtyInvoiced = num(line.qty_invoiced);
      return {
        id: Number(line.id ?? 0) || undefined, productId: product ? product[0] : null, productName: product ? product[1] : str(line.name),
        qtyOrdered, qtyReceived, qtyInvoiced,
        qtyPending: Math.max(0, (qtyReceived > 0 ? qtyReceived : qtyOrdered) - qtyInvoiced),
        priceUnit: num(line.price_unit), discount: num(line.discount), subtotal: num(line.price_subtotal), taxIds: arrIds(line.taxes_id),
      };
    });
    const pickings = pickingRows.map((row) => ({ id: Number(row.id), name: str(row.name) ?? "", state: str(row.state) ?? "", dateDone: str(row.date_done) ?? str(row.scheduled_date) }));
    const doneDates = pickings.filter((row) => row.state === "done" && row.dateDone).map((row) => row.dateDone!).sort();
    const lastReceptionAt = doneDates.at(-1) ?? null;
    const previous = this.store.orders.find((row) => row.id === Number(order.id));
    const record: PurchaseOrderRecord = {
      id: Number(order.id), name: str(order.name) ?? name, state: str(order.state) ?? "purchase",
      invoiceStatus: str(order.invoice_status),
      partnerId: Number(two(order.partner_id)?.[0] ?? 0), partnerName: str(partner?.name) ?? two(order.partner_id)?.[1] ?? "",
      partnerCountry: two(partner?.country_id)?.[1] ?? null, partnerVat: str(partner?.vat),
      currency: two(order.currency_id)?.[1] ?? null, dateOrder: str(order.date_order)?.slice(0, 10) ?? null,
      buyer: previous?.buyer ?? null, origin: str(order.origin), supplierRef: str(order.partner_ref), amountTotal: num(order.amount_total), amountUntaxed: num(order.amount_untaxed),
      pickings, orderedQty: lines.reduce((sum, line) => sum + line.qtyOrdered, 0), receivedQty: lines.reduce((sum, line) => sum + line.qtyReceived, 0),
      allReceived: lines.every((line) => line.qtyOrdered <= 0 || line.qtyReceived >= line.qtyOrdered - 1e-6),
      lastReceptionAt, daysSinceReception: lastReceptionAt ? Math.max(0, Math.floor((Date.now() - new Date(lastReceptionAt).getTime()) / 86400000)) : null,
      linkedInvoiceIds: previous?.linkedInvoiceIds ?? [], linkedInvoiceNames: previous?.linkedInvoiceNames ?? [],
      billedAmount: previous?.billedAmount ?? 0, pendingAmount: previous?.pendingAmount ?? num(order.amount_total), billedPct: previous?.billedPct ?? 0,
      billingSplit: previous?.billingSplit ?? false, lines, status: previous?.status ?? "SIN_RECEPCION",
    };
    this.store.orders = [record, ...this.store.orders.filter((row) => row.id !== record.id)];
    this.store.meta.totalOrders = this.store.orders.length;
    this.save();
    return record;
  }

  /** Fresh candidate list for a human-confirmed supplier; reads Odoo only. */
  async refreshPendingOrdersForPartner(env: Record<string, string | undefined>, partnerId: number): Promise<PurchaseOrderRecord[]> {
    if (!Number.isInteger(partnerId) || partnerId <= 0) throw new Error("Proveedor Odoo no válido");
    const config = getOdooConfig(env);
    if (!hasOdooConfig(config)) throw new Error("Falta la conexión de lectura con Odoo");
    const uid = await authenticate(config);
    const ids = await searchIds(config, uid, "purchase.order", [
      ["partner_id", "=", partnerId], ["state", "in", ["purchase", "done"]], ["invoice_status", "=", "to invoice"],
    ], { order: "date_order desc, id desc" });
    const orders = await paginatedRead(config, uid, "purchase.order", ids, [...ORDER_FIELDS]) as RawRow[];
    const partnerRows = await readRows(config, uid, "res.partner", [partnerId], [...PARTNER_FIELDS]) as RawRow[];
    const partner = partnerRows[0];
    const lineIds = [...new Set(orders.flatMap((order) => arrIds(order.order_line)))];
    const lineRows = await paginatedRead(config, uid, "purchase.order.line", lineIds, [...LINE_FIELDS]) as RawRow[];
    const linesByOrder = new Map<number, RawRow[]>();
    for (const row of lineRows) {
      const orderId = Number(two(row.order_id)?.[0] ?? 0);
      if (!orderId) continue;
      const rows = linesByOrder.get(orderId) ?? [];
      rows.push(row);
      linesByOrder.set(orderId, rows);
    }
    const pickingIds = [...new Set(orders.flatMap((order) => arrIds(order.picking_ids)))];
    const pickingRows = await paginatedRead(config, uid, "stock.picking", pickingIds, [...PICKING_FIELDS]) as RawRow[];
    const now = Date.now();
    const fresh: PurchaseOrderRecord[] = orders.map((order) => {
      const id = Number(order.id);
      const previous = this.store.orders.find((row) => row.id === id);
      const rawLines = (linesByOrder.get(id) ?? []).slice().sort((a, b) => Number(a.id) - Number(b.id));
      const lines = rawLines.map((line) => {
        const product = two(line.product_id);
        const qtyOrdered = num(line.product_qty), qtyReceived = num(line.qty_received), qtyInvoiced = num(line.qty_invoiced);
        return {
          id: Number(line.id ?? 0) || undefined, productId: product ? product[0] : null, productName: product ? product[1] : str(line.name),
          qtyOrdered, qtyReceived, qtyInvoiced,
          qtyPending: Math.max(0, (qtyReceived > 0 ? qtyReceived : qtyOrdered) - qtyInvoiced),
          priceUnit: num(line.price_unit), discount: num(line.discount), subtotal: num(line.price_subtotal), taxIds: arrIds(line.taxes_id),
        };
      });
      const orderPickings = pickingRows.filter((row) => arrIds(order.picking_ids).includes(Number(row.id))).map((row) => ({
        id: Number(row.id), name: str(row.name) ?? "", state: str(row.state) ?? "", dateDone: str(row.date_done) ?? str(row.scheduled_date),
      }));
      const lastReceptionAt = orderPickings.filter((row) => row.state === "done" && row.dateDone).map((row) => row.dateDone!).sort().at(-1) ?? null;
      const daysSinceReception = lastReceptionAt ? Math.max(0, Math.floor((now - new Date(lastReceptionAt).getTime()) / 86400000)) : null;
      return {
        id, name: str(order.name) ?? "", state: str(order.state) ?? "", invoiceStatus: str(order.invoice_status),
        partnerId, partnerName: str(partner?.name) ?? "", partnerCountry: two(partner?.country_id)?.[1] ?? null, partnerVat: str(partner?.vat),
        currency: two(order.currency_id)?.[1] ?? null, dateOrder: str(order.date_order)?.slice(0, 10) ?? null,
        buyer: previous?.buyer ?? null, origin: str(order.origin), supplierRef: str(order.partner_ref),
        amountTotal: num(order.amount_total), amountUntaxed: num(order.amount_untaxed),
        pickings: orderPickings, receivedQty: lines.reduce((sum, line) => sum + line.qtyReceived, 0),
        orderedQty: lines.reduce((sum, line) => sum + line.qtyOrdered, 0),
        allReceived: lines.every((line) => line.qtyOrdered <= 0 || line.qtyReceived >= line.qtyOrdered - 1e-6),
        lastReceptionAt, daysSinceReception, linkedInvoiceIds: previous?.linkedInvoiceIds ?? [],
        linkedInvoiceNames: previous?.linkedInvoiceNames ?? [], billedAmount: previous?.billedAmount ?? 0,
        pendingAmount: previous?.pendingAmount ?? num(order.amount_total), billedPct: previous?.billedPct ?? 0,
        billingSplit: previous?.billingSplit ?? false, lines,
        status: previous?.status ?? "SIN_RECEPCION",
      };
    });
    const freshIds = new Set(fresh.map((order) => order.id));
    this.store.orders = [...fresh, ...this.store.orders.filter((order) => order.partnerId !== partnerId && !freshIds.has(order.id))];
    this.store.meta.totalOrders = this.store.orders.length;
    this.save();
    return fresh;
  }

  async syncFromOdoo(env: Record<string, string | undefined>): Promise<UnbilledStore["meta"]> {
    const config = getOdooConfig(env);
    if (!hasOdooConfig(config)) {
      this.store.meta.message = "Faltan variables ODOO_URL, ODOO_DATABASE, ODOO_USERNAME u ODOO_API_KEY";
      return this.store.meta;
    }
    const uid = await authenticate(config);
    const desde = new Date();
    desde.setMonth(desde.getMonth() - MONTHS_LOOKBACK);
    const desdeIso = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, "0")}-${String(desde.getDate()).padStart(2, "0")}`;

    const domain: unknown[] = [["state", "in", ["purchase", "done"]], ["date_order", ">=", desdeIso]];
    const orderIds = await searchIds(config, uid, "purchase.order", domain, { order: "date_order desc, id desc" });
    const orders = (await paginatedRead(config, uid, "purchase.order", orderIds, [...ORDER_FIELDS])) as RawRow[];

    const partnerIds = [...new Set(orders.map((o) => Number(two(o.partner_id)?.[0] ?? 0)).filter(Boolean))];
    const partnerRows = (await readRows(config, uid, "res.partner", partnerIds, [...PARTNER_FIELDS])) as RawRow[];
    const partnerMap = new Map<number, { name: string; vat: string | null; country: string | null }>();
    for (const p of partnerRows) {
      const c = two(p.country_id);
      partnerMap.set(Number(p.id), { name: str(p.name) ?? "", vat: str(p.vat), country: c ? c[1] : null });
    }

    const userIds = [...new Set(orders.map((o) => Number(two(o.user_id)?.[0] ?? 0)).filter(Boolean))];
    const userRows = (await readRows(config, uid, "res.users", userIds, [...USER_FIELDS])) as RawRow[];
    const userName = new Map<number, string>();
    for (const u of userRows) userName.set(Number(u.id), str(u.name) ?? "");

    const lineIds = [...new Set(orders.flatMap((o) => arrIds(o.order_line)))];
    const lineRows = (await paginatedRead(config, uid, "purchase.order.line", lineIds, [...LINE_FIELDS])) as RawRow[];
    const linesByOrder = new Map<number, RawRow[]>();
    for (const l of lineRows) {
      const oid = Number(two(l.order_id)?.[0] ?? 0);
      if (!oid) continue;
      if (!linesByOrder.has(oid)) linesByOrder.set(oid, []);
      linesByOrder.get(oid)!.push(l);
    }

    const pickingIds = [...new Set(orders.flatMap((o) => arrIds(o.picking_ids)))];
    const pickingRows = (await paginatedRead(config, uid, "stock.picking", pickingIds, [...PICKING_FIELDS])) as RawRow[];
    const pickingsByOrder = new Map<number, RawRow[]>();
    for (const o of orders) {
      const ids = arrIds(o.picking_ids);
      if (ids.length) pickingsByOrder.set(Number(o.id), pickingRows.filter((p) => ids.includes(Number(p.id))));
    }

    const now = new Date();
    const ordersOut: PurchaseOrderRecord[] = orders.map((o) => {
      const id = Number(o.id);
      const partner = partnerMap.get(Number(two(o.partner_id)?.[0] ?? 0)) ?? { name: "", vat: null, country: null };
      const rawLines = (linesByOrder.get(id) ?? []).slice().sort((a, b) => Number(a.id) - Number(b.id));
      const lines = rawLines.map((l) => {
        const prod = two(l.product_id);
        return {
          id: Number(l.id ?? 0) || undefined,
          productId: prod ? prod[0] : null,
          productName: prod ? prod[1] : str(l.name),
          qtyOrdered: num(l.product_qty),
          qtyReceived: num(l.qty_received),
          qtyInvoiced: num(l.qty_invoiced),
          // Una factura puede llegar antes de la recepción. En ese caso la cantidad
          // pendiente es ordered-invoiced; cuando ya hay recepción se usa
          // received-invoiced para no facturar por encima de lo realmente recibido.
          qtyPending: Math.max(0, (num(l.qty_received) > 0 ? num(l.qty_received) : num(l.product_qty)) - num(l.qty_invoiced)),
          priceUnit: num(l.price_unit),
          discount: num(l.discount),
          subtotal: num(l.price_subtotal),
          taxIds: arrIds(l.taxes_id),
        };
      });
      const pickingsRaw = pickingsByOrder.get(id) ?? [];
      const pickings = pickingsRaw.map((p) => ({
        id: Number(p.id),
        name: str(p.name) ?? "",
        state: str(p.state) ?? "",
        dateDone: str(p.date_done) ?? str(p.scheduled_date),
      }));
      const donePickings = pickings.filter((p) => p.state === "done" && p.dateDone);
      const lastReceptionAt = donePickings.map((p) => p.dateDone!).sort().at(-1) ?? null;
      const orderedQty = lines.reduce((s, l) => s + l.qtyOrdered, 0);
      const receivedQty = lines.reduce((s, l) => s + l.qtyReceived, 0);
      const allReceived = lines.every((l) => l.qtyOrdered <= 0 || l.qtyReceived >= l.qtyOrdered - 1e-6);
      const daysSinceReception = lastReceptionAt ? Math.max(0, Math.floor((now.getTime() - new Date(lastReceptionAt).getTime()) / 86400000)) : null;

      return {
        id,
        name: str(o.name) ?? "/",
        state: str(o.state) ?? "",
        invoiceStatus: str(o.invoice_status),
        partnerId: Number(two(o.partner_id)?.[0] ?? 0),
        partnerName: partner.name,
        partnerCountry: partner.country,
        partnerVat: partner.vat,
        currency: two(o.currency_id) ? two(o.currency_id)![1] : null,
        dateOrder: str(o.date_order)?.slice(0, 10) ?? null,
        buyer: Number(two(o.user_id)?.[0] ?? 0) ? userName.get(Number(two(o.user_id)![0])) ?? null : null,
        origin: str(o.origin),
        supplierRef: str(o.partner_ref),
        amountTotal: num(o.amount_total),
        amountUntaxed: num(o.amount_untaxed),
        pickings,
        receivedQty,
        orderedQty,
        allReceived,
        lastReceptionAt,
        daysSinceReception,
        linkedInvoiceIds: [],
        linkedInvoiceNames: [],
        billedAmount: 0,
        pendingAmount: num(o.amount_total),
        billedPct: 0,
        billingSplit: false,
        lines,
        status: "SIN_RECEPCION" as PurchaseOrderRecord["status"],
      };
    });

    this.store.orders = ordersOut;
    this.store.meta.lastPoSyncAt = new Date().toISOString();
    this.store.meta.totalOrders = ordersOut.length;
    this.store.meta.message = null;
    this.save();
    return this.store.meta;
  }
}

// Enriquecimiento de facturacion usando el cache de Fase 1 (relaciones reales factura<->pedido).
export function computeBilling(orders: PurchaseOrderRecord[], invoices: { id: number; moveType: string; state: string; amountTotal: number; linkedPurchaseOrderIds: number[] }[]): PurchaseOrderRecord[] {
  // Facturas contabilizadas (posted) o borrador: solo posted cuenta como facturado real.
  const billingByPo = new Map<number, { amount: number; names: string[]; ids: number[]; split: boolean }>();
  for (const inv of invoices) {
    if (inv.state !== "posted") continue;
    const poIds = inv.linkedPurchaseOrderIds || [];
    if (!poIds.length) continue;
    const sign = inv.moveType === "in_refund" ? -1 : 1;
    const ordersInvolved = orders.filter((o) => poIds.includes(o.id));
    let split = false;
    if (ordersInvolved.length === 1) {
      const e = billingByPo.get(ordersInvolved[0].id) ?? { amount: 0, names: [], ids: [], split: false };
      e.amount += sign * inv.amountTotal;
      e.names.push(inv.name);
      e.ids.push(inv.id);
      billingByPo.set(ordersInvolved[0].id, e);
    } else if (ordersInvolved.length > 1) {
      const weight = ordersInvolved.reduce((s, o) => s + o.amountTotal, 0);
      split = weight > 0;
      for (const o of ordersInvolved) {
        const share = split ? (inv.amountTotal * o.amountTotal) / weight : 0;
        const e = billingByPo.get(o.id) ?? { amount: 0, names: [], ids: [], split: false };
        e.amount += sign * share;
        e.names.push(inv.name);
        e.ids.push(inv.id);
        e.split = e.split || split;
        billingByPo.set(o.id, e);
      }
    }
  }
  return orders.map((o) => {
    const e = billingByPo.get(o.id);
    const billedAmount = e ? e.amount : 0;
    const pendingAmount = Math.max(0, o.amountTotal - billedAmount);
    // Facturado > pedido: incoherencia -> incidencia
    const overBilled = billedAmount > o.amountTotal * 1.01;
    const overReceivedQty = o.lines.some((l) => l.qtyInvoiced > l.qtyReceived + 1e-6);
    let status: PurchaseOrderRecord["status"];
    if (o.state === "purchase" && !o.allReceived && o.daysSinceReception === null) status = "SIN_RECEPCION";
    else if (overBilled || overReceivedQty) status = "INCIDENCIA";
    else if (billedAmount <= 0) status = "SIN_FACTURA";
    else if (billedAmount >= o.amountTotal * 0.99) status = "FACTURADO";
    else status = "FACTURACION_PARCIAL";
    return {
      ...o,
      billedAmount,
      pendingAmount,
      billedPct: o.amountTotal > 0 ? Math.min(100, (billedAmount / o.amountTotal) * 100) : 0,
      billingSplit: Boolean(e?.split),
      linkedInvoiceIds: e?.ids ?? [],
      linkedInvoiceNames: [...new Set(e?.names ?? [])],
      status,
    };
  });
}

export function filterOrders(orders: PurchaseOrderRecord[], f: {
  status?: string | null; partner?: string | null; country?: string | null;
  received?: string | null; over15?: boolean | null; text?: string | null;
}): PurchaseOrderRecord[] {
  return orders.filter((o) => {
    if (f.status && o.status !== f.status) return false;
    if (f.partner && o.partnerName.toLowerCase() !== f.partner.toLowerCase()) return false;
    if (f.country && (o.partnerCountry ?? "").toLowerCase() !== f.country.toLowerCase()) return false;
    if (f.received === "si" && !o.allReceived) return false;
    if (f.received === "no" && o.allReceived) return false;
    if (f.over15 && (o.daysSinceReception ?? 9999) <= 15) return false;
    if (f.text) {
      const q = f.text.toLowerCase();
      const hay = [o.name, o.partnerName, o.origin, o.supplierRef, ...o.linkedInvoiceNames].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function computeUnbilledKpis(orders: PurchaseOrderRecord[]): UnbilledKpis {
  let withoutInvoice = 0, withoutInvoiceTotal = 0;
  let partial = 0, partialTotal = 0, partialPending = 0;
  let over15 = 0, importaciones = 0, importacionesTotal = 0;
  let totalPending = 0;
  for (const o of orders) {
    if (o.status === "SIN_FACTURA") {
      withoutInvoice += 1;
      withoutInvoiceTotal += o.amountTotal;
    } else if (o.status === "FACTURACION_PARCIAL") {
      partial += 1;
      partialTotal += o.amountTotal;
      partialPending += o.pendingAmount;
    }
    if ((o.status === "SIN_FACTURA" || o.status === "FACTURACION_PARCIAL" || o.status === "SIN_RECEPCION") &&
        (o.daysSinceReception ?? 9999) > 15) over15 += 1;
    if (/importaci/i.test(o.origin ?? "") || /import/i.test(o.partnerName)) {
      importaciones += 1;
      importacionesTotal += o.amountTotal;
    }
    if (o.status === "SIN_FACTURA" || o.status === "FACTURACION_PARCIAL" || o.status === "SIN_RECEPCION") {
      totalPending += o.pendingAmount;
    }
  }
  return {
    ordersWithoutInvoice: { count: withoutInvoice, total: withoutInvoiceTotal },
    partialBilling: { count: partial, total: partialTotal, pending: partialPending },
    receivedOver15Days: { count: over15 },
    importaciones: { count: importaciones, total: importacionesTotal },
    totalPendingAmount: totalPending,
    totalOrders: orders.length,
  };
}

export function computeInboxKpis(docCounts: { sinRevisar: number; pendientesCotejo: number; importePendienteCotejo: number; sinCoincidenciaOdoo: number; validadasMes: number; incidencias: number; borradoresListosOdoo: number }, unbilled: UnbilledKpis) {
  return {
    sinRevisar: docCounts.sinRevisar,
    pendientesCotejo: docCounts.pendientesCotejo,
    pedidosSinFacturar: unbilled.ordersWithoutInvoice.count,
    importePedidosSinFacturar: unbilled.ordersWithoutInvoice.total,
    importePendienteCotejo: docCounts.importePendienteCotejo,
    sinCoincidenciaOdoo: docCounts.sinCoincidenciaOdoo,
    facturacionParcial: unbilled.partialBilling.count,
    validadasMes: docCounts.validadasMes,
    incidencias: docCounts.incidencias,
    borradoresListosOdoo: docCounts.borradoresListosOdoo,
  };
}
