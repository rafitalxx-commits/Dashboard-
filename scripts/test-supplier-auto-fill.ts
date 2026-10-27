import assert from "node:assert/strict";
import { autoFillInvoiceDraft } from "../backend/supplierInvoices/autoFill.ts";
import type { InboxDocument, PurchaseOrderRecord } from "../backend/supplierInvoices/phase2Types.ts";

const source = { description: "LED 12W A123", reference: "A123", quantity: 2, priceUnit: 10, discount: 0,
  taxNames: [], total: 20, confidence: 100 };
const doc = (): InboxDocument => ({
  driveFileId: "test", driveFolderId: null, name: "test.pdf", size: null, modifiedTime: null, webViewLink: null,
  source: "manual", sourceEmail: null, detectedAt: null, detectedBy: null, ocrStatus: "ok", aiStatus: "ok",
  confidence: 100, match: null, status: "PENDIENTE_COTEJO", validationUser: null, validationAt: null,
  notes: null, targetFolderPath: null, movedTo: null, odooDraftMoveId: null, odooDraftName: null,
  odooDraftState: null, assignedPurchaseOrderIds: null, pdfCached: true, processedAt: null,
  pdfSourceLines: [{ ...source }], extracted: { supplier: "LED S.L.", supplierVat: "B12345678", country: "ES",
    invoiceNumber: "FV-42", invoiceDate: "2026-10-01", dueDate: null, currency: "EUR", base: 20,
    taxes: 4.2, total: 24.2, lines: [{ ...source }], textPreview: "", needsOcr: false,
    warnings: [], pdfPages: 1, billingAddress: null, docType: "factura" },
});
const order = (): PurchaseOrderRecord => ({
  id: 5, name: "P05089", partnerId: 1, partnerName: "LED S.L.", partnerVat: "B12345678",
  partnerCountry: "ES", currency: "EUR", dateOrder: null, buyer: null, origin: null, amountTotal: 24.2,
  pickings: [], receivedQty: 2, orderedQty: 2, allReceived: true, lastReceptionAt: null,
  daysSinceReception: null, linkedInvoiceIds: [], linkedInvoiceNames: [], billedAmount: 0,
  pendingAmount: 24.2, billedPct: 0, billingSplit: false, state: "purchase", invoiceStatus: "to invoice",
  status: "SIN_FACTURA", lines: [],
});
const text = "LED S.L. NIF B12345678 factura FV-42 pedido P05089 LED 12W A123 2 x 10,00 base 20 IVA 4,20 total 24,20";
const reads = (changes: Record<string, any> = {}) => ({
  search: async (model: string) => model === "res.partner" ? changes.partners ?? [{ id: 1, vat: "B12345678", active: true, name: "LED S.L." }]
    : model === "purchase.order" ? changes.liveOrders ?? [] : changes.duplicates ?? [],
  read: async (model: string) => changes[model] ?? ({
    "purchase.order": [{ id: 5, name: "P05089", partner_id: [1, "LED S.L."], state: "purchase", invoice_status: "to invoice", order_line: [10] }],
    "purchase.order.line": [{ id: 10, order_id: [5, "P05089"], product_id: [20, "LED"], name: "LED 12W A123", product_qty: 2, qty_received: 2, qty_invoiced: 0, price_unit: 10, discount: 0, taxes_id: [30] }],
    "product.product": [{ id: 20, active: true, default_code: "A123", barcode: false, name: "LED", property_account_expense_id: [40, "Compras"] }],
    "account.tax": [{ id: 30, active: true, type_tax_use: "purchase", amount_type: "percent", amount: 21 }],
    "account.account": [{ id: 40, deprecated: false, name: "Compras" }],
  } as Record<string, any[]>)[model] ?? [],
});

const valid = doc();
const completed = await autoFillInvoiceDraft(valid, text, [order()], reads());
assert.equal(valid.confirmedOdooPartnerId, 1);
assert.deepEqual(valid.assignedPurchaseOrderIds, [5]);
assert.equal(valid.extracted!.lines[0].sourcePurchaseLineId, 10);
assert.equal(valid.extracted!.lines[0].productId, 20);
assert.equal(valid.extracted!.lines[0].taxAmount, 4.2);
assert.equal(valid.extracted!.lines[0].accountId, 40);
assert.equal(valid.extracted!.lines[0].pdfPriceVerified, true);
assert.equal(completed.pending.length, 0);

const staleLedger = doc();
const liveFound = await autoFillInvoiceDraft(staleLedger, text, [], reads({ liveOrders: [{ id: 5, name: "P05089", partner_ref: false,
  partner_id: [1, "LED S.L."], state: "purchase", invoice_status: "to invoice" }] }));
assert.deepEqual(staleLedger.assignedPurchaseOrderIds, [5], "live Odoo read must recover a stale local ledger");
assert.equal(liveFound.pending.length, 0);

const categoryExpense = doc();
await autoFillInvoiceDraft(categoryExpense, text, [order()], reads({
  "product.product": [{ id: 20, active: true, default_code: "A123", categ_id: [8], property_account_expense_id: false }],
  "product.category": [{ id: 8, property_account_expense_categ_id: [40] }],
}));
assert.equal(categoryExpense.extracted!.lines[0].accountId, 40, "category expense account may fill a missing product account");

const multiple = doc();
const second = { ...source, description: "LED 24W B456", reference: "B456", quantity: 1, priceUnit: 5, total: 5 };
multiple.pdfSourceLines!.push({ ...second }); multiple.extracted!.lines.push({ ...second });
multiple.extracted!.base = 25; multiple.extracted!.taxes = 5.25; multiple.extracted!.total = 30.25;
const secondOrder = { ...order(), id: 6, name: "P05090" };
const multiReads = reads({
  "purchase.order": [
    { id: 5, name: "P05089", partner_id: [1], state: "purchase", invoice_status: "to invoice", order_line: [10] },
    { id: 6, name: "P05090", partner_id: [1], state: "purchase", invoice_status: "to invoice", order_line: [11] },
  ],
  "purchase.order.line": [
    { id: 10, order_id: [5], product_id: [20], name: "LED 12W A123", product_qty: 2, qty_received: 2, qty_invoiced: 0, price_unit: 10, discount: 0, taxes_id: [30] },
    { id: 11, order_id: [6], product_id: [21], name: "LED 24W B456", product_qty: 1, qty_received: 1, qty_invoiced: 0, price_unit: 5, discount: 0, taxes_id: [30] },
  ],
  "product.product": [
    { id: 20, active: true, default_code: "A123", property_account_expense_id: [40] },
    { id: 21, active: true, default_code: "B456", property_account_expense_id: [40] },
  ],
});
const multiResult = await autoFillInvoiceDraft(multiple, `${text} pedido P05090 LED 24W B456 1 x 5,00`, [order(), secondOrder], multiReads);
assert.deepEqual(multiple.assignedPurchaseOrderIds, [5, 6]);
assert.equal(multiple.extracted!.lines[1].sourcePurchaseLineId, 11);
assert.equal(multiResult.pending.length, 0);

const reviewed = doc();
reviewed.operatorLinesEdited = true;
reviewed.extracted!.lines[0].accountId = 99;
const enriched = await autoFillInvoiceDraft(reviewed, text, [order()], reads());
assert.equal(reviewed.extracted!.lines[0].accountId, 99, "operator account must be preserved");
assert.equal(reviewed.extracted!.lines[0].productId, 20, "missing proven identity may be completed");
assert.ok(enriched.applied.length);

for (const [label, pdf, hints, overrides] of [
  ["no explicit order", text.replace("P05089", ""), [order()], {}],
  ["duplicate supplier", text, [order()], { partners: [{ id: 1, vat: "B12345678" }, { id: 2, vat: "B12345678" }] }],
  ["duplicate invoice", text, [order()], { duplicates: [{ id: 99 }] }],
  ["unreceived", text, [order()], { "purchase.order.line": [{ id: 10, order_id: [5], product_id: [20], name: "LED 12W A123", product_qty: 2, qty_received: 1, qty_invoiced: 0, price_unit: 10, discount: 0, taxes_id: [30] }] }],
  ["product without exact code", text, [order()], { "product.product": [{ id: 20, active: true, default_code: "X999", barcode: false, property_account_expense_id: [40] }] }],
] as const) {
  const test = doc();
  const result = await autoFillInvoiceDraft(test, pdf, hints as PurchaseOrderRecord[], reads(overrides));
  assert.ok(result.pending.length, label);
  assert.equal(test.extracted!.lines[0].productId ?? null, null, label);
  assert.equal(test.assignedPurchaseOrderIds, null, label);
}
console.log("supplier auto-fill: exact match, reviewed-line preservation plus 5 ambiguity/safety cases passed");
