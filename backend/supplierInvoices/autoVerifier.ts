// Verificación independiente, de solo lectura, antes de cualquier automatización.
// La salida de Facturas es evidencia propuesta, nunca permiso de escritura.
import type { InboxDocument } from "./phase2Types.ts";
import type { OdooConfig } from "./odooClient.ts";
import { authenticate, getOdooConfig, hasOdooConfig, readRows, searchRead } from "./odooClient.ts";
import { DriveClient } from "./driveClient.ts";
import { discountedBase, isWebAdjustmentProductId } from "../../shared/supplierInvoiceDiscounts.ts";

export type InvoiceVerification = { ready: boolean; checkedAt: string; blockers: string[] };
type Row = Record<string, unknown>;
export type VerificationReads = {
  search: (model: string, domain: unknown[], fields: string[]) => Promise<Row[]>;
  read: (model: string, ids: number[], fields: string[]) => Promise<Row[]>;
};
const cents = (n: number) => Math.round(n * 100);
const idOf = (v: unknown): number => Array.isArray(v) ? Number(v[0]) : Number(v);
const vat = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^ES(?=[A-Z0-9]{9}$)/, "");
const words = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const dateInPdf = (iso: string | null | undefined, pdf: string) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [year, month, day] = iso.split("-");
  return pdf.includes(iso) || pdf.includes(`${day}-${month}-${year}`) || pdf.includes(`${day}/${month}/${year}`);
};
const printedAmount = (pdf: string, label: RegExp): number | null => {
  for (const line of pdf.split(/\r?\n/)) {
    if (!label.test(line)) continue;
    const amounts = [...line.matchAll(/(-?\d[\d.,]*)\s*€/g)];
    if (amounts.length !== 1) continue;
    const raw = amounts[0][1].replace(/\./g, "").replace(",", ".");
    const amount = Number(raw);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
};
const add = (errors: string[], condition: unknown, message: string) => { if (!condition) errors.push(message); };

export async function verifyInvoiceForAutomation(doc: InboxDocument, pdfText: string, db: VerificationReads): Promise<InvoiceVerification> {
  const blockers: string[] = [];
  const finish = (): InvoiceVerification => ({ ready: blockers.length === 0, checkedAt: new Date().toISOString(), blockers: [...new Set(blockers)] });
  const ex = doc.extracted;
  const normalizedPdf = words(pdfText);
  add(blockers, doc.sourcePresent !== false && !doc.movedTo, "PDF ya no está pendiente en la bandeja Drive.");
  add(blockers, !doc.odooDraftMoveId, "Ya hay un borrador Odoo vinculado: reconciliar, no crear otro.");
  add(blockers, ex?.docType === "factura" && !ex?.needsOcr && pdfText.trim().length >= 100, "PDF final con texto completo no verificado.");
  if (!ex) { blockers.push("Falta extracción del PDF."); return finish(); }
  add(blockers, Boolean(ex.invoiceNumber && pdfText.includes(ex.invoiceNumber)), "Referencia de factura sin evidencia literal en el PDF.");
  add(blockers, Boolean(ex.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(ex.invoiceDate)), "Fecha de factura ausente o inválida.");
  if (doc.invoiceBranch === "services") add(blockers, dateInPdf(ex.invoiceDate, pdfText), "Fecha de factura distinta del PDF.");
  add(blockers, Boolean(ex.supplierVat && vat(pdfText).includes(vat(ex.supplierVat))), "NIF del emisor sin evidencia en el PDF.");
  // Los pendientes de una lectura anterior no son un bloqueo perpetuo: el
  // operador puede resolverlos editando el borrador. Las comprobaciones de
  // evidencia PDF/Odoo de abajo deciden sobre el estado ACTUAL del documento.
  add(blockers, doc.invoiceBranch === "goods" || doc.invoiceBranch === "services", "Rama mercancía/servicio sin confirmar.");
  add(blockers, Boolean(doc.confirmedOdooPartnerId), "Proveedor Odoo sin identidad confirmada.");
  add(blockers, ex.lines.length > 0, "No hay líneas de factura comprobables.");
  if (doc.invoiceBranch !== "services") add(blockers, doc.pdfSourceLines?.length === ex.lines.length, "El número de líneas no coincide con la fuente PDF guardada.");
  if (doc.invoiceBranch === "services") add(blockers, doc.pdfLinesAccepted === true, "Líneas de servicio sin pedido no aceptadas.");
  const amounts = [ex.base, ex.taxes, ex.total];
  add(blockers, amounts.every((x) => x != null && Number.isFinite(x)), "Base, IVA o total ausentes.");
  if (amounts.every((x) => x != null && Number.isFinite(x))) {
    add(blockers, cents(ex.base! + ex.taxes!) === cents(ex.total!), "Base + IVA no coincide con total PDF.");
    if (doc.invoiceBranch === "services") {
      const pdfBase = printedAmount(pdfText, /base imponible/i);
      const pdfTotal = printedAmount(pdfText, /(?:importe total|total factura|total a pagar)/i);
      add(blockers, pdfBase != null && cents(ex.base!) === cents(pdfBase), "Base de servicios distinta de la impresa en el PDF o no legible.");
      add(blockers, pdfTotal != null && cents(ex.total!) === cents(pdfTotal), "Total de servicios distinto del impreso en el PDF o no legible.");
      if (pdfBase != null && pdfTotal != null) add(blockers, cents(ex.taxes!) === cents(pdfTotal - pdfBase), "Impuestos de servicios distintos de la diferencia total-base del PDF.");
    }
  }
  let base = 0, tax = 0, adjustments = 0;
  for (let i = 0; i < ex.lines.length; i++) {
    const l = ex.lines[i], n = i + 1, source = doc.pdfSourceLines?.[i];
    const adjustment = isWebAdjustmentProductId(l.productId);
    if (adjustment) adjustments++;
    if (doc.invoiceBranch !== "services") {
      add(blockers, Boolean(source && source.description === l.description && source.quantity === l.quantity && source.priceUnit === l.priceUnit), `Línea ${n}: distinta de la evidencia PDF guardada.`);
      if (!adjustment) add(blockers, words(l.description).length >= 12 && normalizedPdf.includes(words(l.description)), `Línea ${n}: descripción sin evidencia literal en el PDF completo.`);
    } else if (!adjustment) {
      add(blockers, Boolean(l.description?.trim()), `Línea ${n}: falta descripción contable.`);
    }
    if (l.quantity == null || l.priceUnit == null || !Number.isFinite(l.quantity) || !Number.isFinite(l.priceUnit) || l.quantity <= 0) {
      blockers.push(`Línea ${n}: cantidad o precio inválidos.`); continue;
    }
    let net: number;
    try { net = discountedBase(l.quantity, l.priceUnit, l.discount, l.discountExtra, l.promptPaymentDiscount); }
    catch { blockers.push(`Línea ${n}: descuentos inválidos.`); continue; }
    add(blockers, l.total != null && cents(l.total) === cents(net), `Línea ${n}: base distinta de cantidad × precio y descuentos.`);
    add(blockers, l.taxAmount != null && Number.isFinite(l.taxAmount), `Línea ${n}: cuota IVA no confirmada.`);
    if (adjustment) {
      add(blockers, l.quantity === 1 && !l.taxId && l.taxAmount === 0, `Línea ${n}: AJUSTEWEB debe ser cantidad 1 y sin IVA.`);
    } else {
      if (doc.invoiceBranch === "services") add(blockers, Boolean(l.taxId && l.accountId), `Línea ${n}: impuesto o cuenta contable sin confirmar.`);
      else add(blockers, Boolean(l.productId && l.taxId && l.accountId && l.pdfPriceVerified), `Línea ${n}: producto, impuesto, cuenta o precio PDF sin confirmar.`);
      if (doc.invoiceBranch === "goods") add(blockers, Boolean(l.sourcePurchaseOrderId && l.sourcePurchaseLineId), `Línea ${n}: falta línea exacta del pedido Odoo.`);
      if (doc.invoiceBranch === "services") add(blockers, !l.sourcePurchaseOrderId && (!l.productId || l.genericProductConfirmed === true), `Línea ${n}: servicio Odoo sin pedido no confirmado.`);
    }
    base += net; tax += Number(l.taxAmount ?? 0);
  }
  add(blockers, adjustments <= 1, "Hay más de un AJUSTEWEB.");
  if (ex.base != null) add(blockers, cents(base) === cents(ex.base), "Suma de bases de línea distinta de la base PDF; AJUSTEWEB no está justificado.");
  if (ex.taxes != null) add(blockers, cents(tax) === cents(ex.taxes), "Suma de cuotas distinta del IVA PDF.");
  if (blockers.length) return finish();

  try {
    const partnerId = Number(doc.confirmedOdooPartnerId);
    const [partner] = await db.read("res.partner", [partnerId], ["name", "vat", "active"]);
    add(blockers, partner?.active !== false && vat(partner?.vat) === vat(ex.supplierVat), "Proveedor Odoo inactivo o NIF distinto del PDF.");
    const sameVat = await db.search("res.partner", [["vat", "ilike", vat(ex.supplierVat)]], ["id", "vat"]);
    add(blockers, sameVat.filter((p) => vat(p.vat) === vat(ex.supplierVat)).length === 1, "El NIF no identifica un único proveedor Odoo.");
    const duplicates = await db.search("account.move", [["move_type", "=", "in_invoice"], ["partner_id", "=", partnerId], ["ref", "=", ex.invoiceNumber], ["state", "!=", "cancel"]], ["id", "ref"]);
    add(blockers, duplicates.length === 0, "Ya existe una factura no cancelada con esa referencia y proveedor.");
    const poIds = doc.assignedPurchaseOrderIds ?? [];
    if (doc.invoiceBranch === "services") add(blockers, poIds.length === 0, "Servicio sin pedido con pedidos asociados.");
    else add(blockers, poIds.length > 0, "Mercancía sin pedido confirmado.");
    const orders = poIds.length ? await db.read("purchase.order", poIds, ["partner_id", "state", "invoice_status"]) : [];
    add(blockers, orders.length === new Set(poIds).size && poIds.length === new Set(poIds).size,
      "No se pudieron releer todos los pedidos confirmados o hay pedidos repetidos.");
    for (const order of orders) add(blockers, idOf(order.partner_id) === partnerId && ["purchase", "done"].includes(String(order.state)) && order.invoice_status === "to invoice", `Pedido ${order.id}: proveedor/estado/facturación no elegible.`);
    const billedByPurchaseLine = new Map<number, number>();
    for (let i = 0; i < ex.lines.length; i++) {
      const l = ex.lines[i], n = i + 1;
      if (isWebAdjustmentProductId(l.productId)) continue;
      if (l.productId || doc.invoiceBranch !== "services") {
        const [product] = await db.read("product.product", [Number(l.productId)], ["active", "type"]);
        add(blockers, Boolean(product) && product.active !== false && (doc.invoiceBranch !== "services" || ["service", "consu"].includes(String(product.type))), `Línea ${n}: producto Odoo inexistente, inactivo o tipo incompatible.`);
      }
      const [taxRow] = await db.read("account.tax", [Number(l.taxId)], ["active", "type_tax_use", "amount", "invoice_repartition_line_ids"]);
      let taxFactor = 1;
      if (doc.invoiceBranch === "services") {
        const repartitionIds = Array.isArray(taxRow?.invoice_repartition_line_ids) ? taxRow.invoice_repartition_line_ids.map(Number) : [];
        const repartitions = repartitionIds.length ? await db.read("account.tax.repartition.line", repartitionIds, ["repartition_type", "factor_percent"]) : [];
        taxFactor = repartitions.length === repartitionIds.length && repartitions.length > 0
          ? repartitions.filter((row) => row.repartition_type === "tax").reduce((sum, row) => sum + Number(row.factor_percent ?? 0) / 100, 0)
          : NaN;
      }
      add(blockers, Boolean(taxRow) && taxRow.active !== false && taxRow.type_tax_use === "purchase"
        && Number.isFinite(Number(taxRow.amount)) && Number.isFinite(taxFactor)
        && Math.abs(cents(discountedBase(l.quantity!, l.priceUnit!, l.discount, l.discountExtra, l.promptPaymentDiscount) * Number(taxRow.amount) * taxFactor / 100) - cents(l.taxAmount!)) <= 1,
      `Línea ${n}: impuesto Odoo o cuota no coincide.`);
      const [account] = await db.read("account.account", [Number(l.accountId)], ["deprecated"]);
      add(blockers, Boolean(account) && account.deprecated !== true, `Línea ${n}: cuenta contable no disponible.`);
      if (doc.invoiceBranch === "goods") {
        add(blockers, poIds.includes(Number(l.sourcePurchaseOrderId)), `Línea ${n}: pedido no confirmado.`);
        const [pol] = await db.read("purchase.order.line", [Number(l.sourcePurchaseLineId)], ["order_id", "product_id", "product_qty", "qty_received", "qty_invoiced"]);
        const purchaseLineId = Number(l.sourcePurchaseLineId);
        const accumulated = (billedByPurchaseLine.get(purchaseLineId) ?? 0) + Number(l.quantity);
        billedByPurchaseLine.set(purchaseLineId, accumulated);
        add(blockers, Boolean(pol) && idOf(pol.order_id) === l.sourcePurchaseOrderId && idOf(pol.product_id) === l.productId
          && Number.isFinite(Number(pol.qty_received)) && Number.isFinite(Number(pol.qty_invoiced))
          && Number(pol.qty_received) - Number(pol.qty_invoiced) + 0.0001 >= accumulated,
          `Línea ${n}: pedido/producto/recepción o cantidad acumulada ya facturada no coincide.`);
      }
    }
  } catch (error) {
    blockers.push(`No se pudo completar la relectura Odoo: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`);
  }
  return finish();
}

export async function verifyInvoiceWithOdoo(doc: InboxDocument, pdfText: string, env: Record<string, string | undefined>): Promise<InvoiceVerification> {
  const config: OdooConfig = getOdooConfig(env);
  if (!hasOdooConfig(config)) return { ready: false, checkedAt: new Date().toISOString(), blockers: ["Odoo no configurado."] };
  try {
    const drive = new DriveClient(env);
    const source = await drive.getFileMeta(doc.driveFileId);
    if (source.id !== doc.driveFileId || source.name !== doc.name || !source.parents?.includes(drive.getRootFolderId()))
      return { ready: false, checkedAt: new Date().toISOString(), blockers: ["El PDF por ID ya no está en la bandeja Drive o cambió de nombre."] };
    const uid = await authenticate(config);
    return await verifyInvoiceForAutomation(doc, pdfText, {
      search: (model, domain, fields) => searchRead(config, uid, model, domain, fields, { limit: 20 }),
      read: (model, ids, fields) => readRows(config, uid, model, ids, fields),
    });
  } catch (error) {
    return { ready: false, checkedAt: new Date().toISOString(), blockers: [`Odoo no disponible: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`] };
  }
}
