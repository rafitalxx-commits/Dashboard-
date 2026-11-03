import type { InboxDocument, PurchaseOrderRecord } from "./phase2Types.ts";
import { productReferenceTokens } from "./pdfPurchaseLines.ts";
import { discountedBase } from "../../shared/supplierInvoiceDiscounts.ts";

type Row = Record<string, any>;
export type AutoFillReads = {
  search: (model: string, domain: unknown[], fields: string[]) => Promise<Row[]>;
  read: (model: string, ids: number[], fields: string[]) => Promise<Row[]>;
};
export type AutoFillResult = { applied: string[]; pending: string[] };
const cents = (n: number) => Math.round(n * 100);
const vat = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^ES(?=[A-Z0-9]{9}$)/, "");
const id = (v: unknown) => Array.isArray(v) ? Number(v[0]) : Number(v);
const normalized = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const literal = (text: string, value: string) => Boolean(value && normalized(text).includes(normalized(value)));

/** Prepare only the local draft. AI IDs, names and cached orders are hints, never authority. */
export async function autoFillInvoiceDraft(doc: InboxDocument, pdfText: string, orderHints: PurchaseOrderRecord[], db: AutoFillReads, protectLines = false): Promise<AutoFillResult> {
  const result: AutoFillResult = { applied: [], pending: [] };
  const ex = doc.extracted;
  if (!ex || doc.odooDraftMoveId || doc.status === "VALIDADA" || doc.pdfLinesAccepted || !doc.pdfSourceLines?.length) return result;
  if (doc.operatorLinesEdited || protectLines) {
    // Rescans may enrich missing identities on a reviewed draft, but can never
    // overwrite an operator's line values or re-order their lines.
    const candidate: InboxDocument = structuredClone(doc);
    candidate.operatorLinesEdited = false;
    candidate.pdfSourceLines = candidate.extracted!.lines.map((line) => ({ ...line }));
    const checked = await autoFillInvoiceDraft(candidate, pdfText, orderHints, db);
    if (!doc.confirmedOdooPartnerId && candidate.confirmedOdooPartnerId) {
      doc.confirmedOdooPartnerId = candidate.confirmedOdooPartnerId;
      result.applied.push("Proveedor único por NIF y sin duplicado");
    }
    if (!doc.assignedPurchaseOrderIds?.length && candidate.assignedPurchaseOrderIds?.length) {
      doc.assignedPurchaseOrderIds = candidate.assignedPurchaseOrderIds;
      doc.invoiceBranch = candidate.invoiceBranch;
      result.applied.push("Pedido cotejado con líneas del PDF");
    }
    for (let index = 0; index < ex.lines.length; index++) {
      const current = ex.lines[index], fresh = candidate.extracted!.lines[index];
      if (!fresh || normalized(current.description) !== normalized(fresh.description)
        || current.reference !== fresh.reference || current.quantity !== fresh.quantity || current.priceUnit !== fresh.priceUnit) continue;
      for (const key of ["productId", "sourcePurchaseOrderId", "sourcePurchaseLineId", "sourcePurchaseOrderName", "qtyOrdered", "qtyReceived", "qtyInvoiced", "qtyPending", "pdfPriceVerified", "taxId", "taxRate", "taxAmount", "accountId", "accountName"] as const) {
        if (current[key] == null && fresh[key] != null) (current as any)[key] = fresh[key];
      }
      if (fresh.sourcePurchaseLineId && current.sourcePurchaseLineId === fresh.sourcePurchaseLineId)
        result.applied.push(`Línea ${index + 1}: datos Odoo demostrables completados`);
    }
    result.pending.push(...checked.pending);
    return result;
  }
  if (!ex.supplierVat || !vat(pdfText).includes(vat(ex.supplierVat)) || !ex.invoiceNumber || !pdfText.includes(ex.invoiceNumber)) {
    result.pending.push("Emisor o referencia sin evidencia suficiente en el PDF."); return result;
  }
  const partners = await db.search("res.partner", [["vat", "ilike", vat(ex.supplierVat)]], ["id", "name", "vat", "active"]);
  const matchingPartners = partners.filter((p) => p.active !== false && vat(p.vat) === vat(ex.supplierVat));
  if (matchingPartners.length !== 1) { result.pending.push("El NIF no identifica un único proveedor activo en Odoo."); return result; }
  const partner = matchingPartners[0], partnerId = Number(partner.id);
  if (doc.confirmedOdooPartnerId && doc.confirmedOdooPartnerId !== partnerId) { result.pending.push("El proveedor confirmado difiere del NIF del PDF."); return result; }
  const duplicates = await db.search("account.move", [["move_type", "=", "in_invoice"], ["partner_id", "=", partnerId], ["ref", "=", ex.invoiceNumber], ["state", "!=", "cancel"]], ["id"]);
  if (duplicates.length) { result.pending.push("Ya hay una factura Odoo con esta referencia y proveedor."); return result; }
  if (!doc.confirmedOdooPartnerId) { doc.confirmedOdooPartnerId = partnerId; result.applied.push("Proveedor único por NIF y sin duplicado"); }

  // The local purchase ledger can lag behind Odoo. Search exact PDF tokens in
  // the live supplier orders before deciding that there is no purchase order.
  const tokens = [...new Set((pdfText.toUpperCase().match(/[A-Z0-9][A-Z0-9._/-]{5,}/g) ?? [])
    .filter((token) => token !== vat(ex.supplierVat) && token !== ex.invoiceNumber?.toUpperCase()))].slice(0, 120);
  const liveOrders = tokens.length ? await db.search("purchase.order", [["partner_id", "=", partnerId], ["state", "in", ["purchase", "done"]], "|", ["name", "in", tokens], ["partner_ref", "in", tokens]],
    ["id", "name", "partner_ref", "partner_id", "state", "invoice_status"]) : [];
  const candidates = new Map<number, PurchaseOrderRecord>(orderHints.map((order) => [order.id, order]));
  for (const fresh of liveOrders) candidates.set(Number(fresh.id), { ...candidates.get(Number(fresh.id)), id: Number(fresh.id), name: String(fresh.name ?? ""),
    supplierRef: String(fresh.partner_ref ?? "") || null, partnerId: id(fresh.partner_id), state: String(fresh.state ?? ""),
    invoiceStatus: String(fresh.invoice_status ?? "") } as PurchaseOrderRecord);
  // Only an explicit purchase reference in the PDF can establish a purchase order.
  const eligibleHints = [...candidates.values()].filter((o) => o.partnerId === partnerId && ["purchase", "done"].includes(o.state) && o.invoiceStatus === "to invoice"
    && [o.name, o.supplierRef].some((ref) => {
      if (!ref || ref.length < 4) return false;
      const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`, "i").test(pdfText);
    }));
  if (!eligibleHints.length || eligibleHints.length > 20) { result.pending.push("Pedidos sin referencias explícitas elegibles o demasiados candidatos; revisar manualmente."); return result; }
  const freshOrders = await db.read("purchase.order", eligibleHints.map((order) => order.id), ["name", "partner_id", "state", "invoice_status", "order_line"]);
  const orderIds = new Set(eligibleHints.map((order) => order.id));
  if (freshOrders.length !== eligibleHints.length || freshOrders.some((order) => !orderIds.has(Number(order.id)) || id(order.partner_id) !== partnerId
    || !["purchase", "done"].includes(String(order.state)) || order.invoice_status !== "to invoice")) {
    result.pending.push("Uno o más pedidos cambiaron en Odoo o no pertenecen al proveedor."); return result;
  }
  const orderById = new Map(freshOrders.map((order) => [Number(order.id), order]));
  const lineIds = [...new Set(freshOrders.flatMap((order) => Array.isArray(order.order_line) ? order.order_line.map(Number).filter((x: number) => Number.isInteger(x) && x > 0) : []))];
  const orderLines = lineIds.length ? await db.read("purchase.order.line", lineIds, ["order_id", "product_id", "name", "product_qty", "qty_received", "qty_invoiced", "price_unit", "discount", "taxes_id"]) : [];
  if (orderLines.length !== lineIds.length || orderLines.some((line) => !orderById.has(id(line.order_id)))) {
    result.pending.push("No se pudieron releer todas las líneas de los pedidos."); return result;
  }
  const productIds = [...new Set(orderLines.map((l) => id(l.product_id)).filter((x) => Number.isInteger(x) && x > 0))];
  const products = productIds.length ? await db.read("product.product", productIds, ["active", "default_code", "barcode", "name", "categ_id", "property_account_expense_id"]) : [];
  const byProduct = new Map(products.map((p) => [Number(p.id), p]));
  const categoryIds = [...new Set(products.map((p) => id(p.categ_id)).filter((x) => Number.isInteger(x) && x > 0))];
  const categories = categoryIds.length ? await db.read("product.category", categoryIds, ["property_account_expense_categ_id"]) : [];
  const byCategory = new Map(categories.map((category) => [Number(category.id), category]));
  const proposed = doc.pdfSourceLines.map((pdf, index) => {
    const refs = productReferenceTokens(pdf.reference);
    const matches = orderLines.filter((purchase) => {
      const product = byProduct.get(id(purchase.product_id));
      const codes = [...productReferenceTokens(product?.default_code), ...productReferenceTokens(product?.barcode)];
      return refs.some((ref) => codes.includes(ref));
    });
    if (matches.length !== 1) {
      result.pending.push(`Línea ${index + 1}: referencia sin línea de compra única.`);
      return { ...pdf, sourcePurchaseOrderId: null, sourcePurchaseLineId: null };
    }
    const purchase = matches[0];
    const orderId = id(purchase.order_id);
    return { ...pdf, productId: id(purchase.product_id), sourcePurchaseOrderId: orderId,
      sourcePurchaseOrderName: String(orderById.get(orderId)?.name ?? ""), sourcePurchaseLineId: Number(purchase.id),
      qtyOrdered: Number(purchase.product_qty), qtyReceived: Number(purchase.qty_received),
      qtyInvoiced: Number(purchase.qty_invoiced), qtyPending: Number(purchase.qty_received) - Number(purchase.qty_invoiced),
      odooPurchasePriceUnit: Number(purchase.price_unit), odooPurchaseDiscount: Number(purchase.discount ?? 0),
      taxId: Array.isArray(purchase.taxes_id) && purchase.taxes_id.length === 1 ? Number(purchase.taxes_id[0]) : null,
    };
  });
  if (proposed.length !== doc.pdfSourceLines.length) { result.pending.push("Número de líneas PDF inconsistente."); return result; }
  const taxIds = [...new Set(proposed.flatMap((l) => l.taxId ? [l.taxId] : []))];
  const taxes = taxIds.length ? await db.read("account.tax", taxIds, ["active", "type_tax_use", "amount_type", "amount"]) : [];
  const byTax = new Map(taxes.map((t) => [Number(t.id), t]));
  const expenseAccountId = (product: Row) => id(product.property_account_expense_id) || id(byCategory.get(id(product.categ_id))?.property_account_expense_categ_id);
  const accountIds = [...new Set(products.map(expenseAccountId).filter((x) => Number.isInteger(x) && x > 0))];
  const accounts = accountIds.length ? await db.read("account.account", accountIds, ["deprecated", "name"]) : [];
  const byAccount = new Map(accounts.map((a) => [Number(a.id), a]));
  const allocated = new Map<number, number>();
  const accepted = proposed.map((line, index) => {
    const source = doc.pdfSourceLines![index];
    const purchase = orderLines.find((p) => Number(p.id) === line.sourcePurchaseLineId);
    const product = byProduct.get(Number(line.productId));
    const refs = productReferenceTokens(source.reference);
    const productRefs = [...productReferenceTokens(product?.default_code), ...productReferenceTokens(product?.barcode)];
    const exactCode = refs.some((ref) => productRefs.includes(ref));
    const purchaseId = Number(line.sourcePurchaseLineId);
    const accumulated = (allocated.get(purchaseId) ?? 0) + Number(line.quantity ?? 0);
    allocated.set(purchaseId, accumulated);
    if (!purchase || !product || product.active === false || !exactCode || !literal(pdfText, source.description)
      || line.quantity == null || line.priceUnit == null || line.total == null || line.quantity <= 0
      || !Number.isFinite(line.quantity) || !Number.isFinite(line.priceUnit)
      || !Number.isFinite(Number(purchase.qty_received)) || !Number.isFinite(Number(purchase.qty_invoiced))
      || Number(purchase.qty_received) - Number(purchase.qty_invoiced) + 0.0001 < accumulated) {
      result.pending.push(`Línea ${index + 1}: identidad, texto PDF o recepción no inequívoca.`);
      return { ...source };
    }
    let net: number;
    try { net = discountedBase(line.quantity, line.priceUnit, line.discount, line.discountExtra, line.promptPaymentDiscount); }
    catch { result.pending.push(`Línea ${index + 1}: descuentos no verificables.`); return { ...source }; }
    if (cents(net) !== cents(line.total)) { result.pending.push(`Línea ${index + 1}: precio/descuento no cuadra con la base PDF.`); return { ...source }; }
    const next = { ...line, pdfPriceVerified: true };
    const uniquePurchaseTax = Array.isArray(purchase.taxes_id) && purchase.taxes_id.length === 1 && Number(purchase.taxes_id[0]) === line.taxId;
    const tax = uniquePurchaseTax ? byTax.get(Number(line.taxId)) : null;
    if (tax && tax.active !== false && tax.type_tax_use === "purchase" && tax.amount_type === "percent" && Number.isFinite(Number(tax.amount))) {
      next.taxRate = Number(tax.amount);
      next.taxAmount = Math.round(net * Number(tax.amount)) / 100;
    } else result.pending.push(`Línea ${index + 1}: impuesto sin cotejo único.`);
    const accountId = expenseAccountId(product);
    const account = byAccount.get(accountId);
    if (account && account.deprecated !== true) { next.accountId = accountId; next.accountName = String(account.name ?? ""); }
    else result.pending.push(`Línea ${index + 1}: cuenta contable sin identidad en producto o categoría.`);
    result.applied.push(`Línea ${index + 1}: pedido, producto y precio`);
    return next;
  });
  if (accepted.every((l) => l.taxAmount != null) && ex.taxes != null
    && cents(accepted.reduce((sum, l) => sum + Number(l.taxAmount), 0)) !== cents(ex.taxes)) {
    for (const line of accepted) { line.taxAmount = null; line.taxRate = null; }
    result.pending.push("Las cuotas de línea calculadas no cuadran con el IVA impreso; revisar desglose fiscal.");
  }
  const linked = accepted.filter((line) => line.sourcePurchaseOrderId && line.sourcePurchaseLineId);
  if (linked.length) {
    doc.invoiceBranch = "goods";
    doc.assignedPurchaseOrderIds = [...new Set(linked.map((line) => Number(line.sourcePurchaseOrderId)))];
    doc.extracted!.lines = accepted;
    result.applied.push(`${doc.assignedPurchaseOrderIds.length} pedido(s) con ${linked.length} línea(s) identificada(s)`);
  } else result.pending.push("Hay pedidos explícitos en el PDF, pero ninguna línea se pudo identificar con seguridad; no se vincularon.");
  return result;
}
