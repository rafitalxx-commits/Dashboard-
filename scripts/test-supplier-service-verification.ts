import assert from "node:assert/strict";
import { verifyInvoiceForAutomation } from "../backend/supplierInvoices/autoVerifier.ts";

const pdf = `Sendcloud BV NL 8566 13 897 B01
Fecha de factura 12-10-2026
Número de factura 1-26-ES0055773
Descripción IVA Cantidad Total
Recargo - Tasa de devolución Inv. Pasivo 2 17,55 €
Envíos Inv. Pasivo 1 7,85 €
Recargo - Corrección Método de envío Inv. Pasivo 1 2,70 €
Recargo - Recargo combustible Inv. Pasivo 2 0,99 €
Base imponible (sin IVA) 29,09 €
IVA Inv. Pasivo
Importe total 29,09 €`;
const entries = [
  ["Recargo - Tasa de devolución", 2, 8.775, 17.55],
  ["Envíos", 1, 7.85, 7.85],
  ["Recargo - Corrección Método de envío", 1, 2.70, 2.70],
  ["Recargo - Recargo combustible", 2, 0.495, 0.99],
] as const;
const doc = {
  sourcePresent: true, movedTo: null, odooDraftMoveId: null,
  invoiceBranch: "services", pdfLinesAccepted: true, confirmedOdooPartnerId: 528893,
  assignedPurchaseOrderIds: [],
  pdfSourceLines: entries.map(([description, quantity, , total]) => ({ description, quantity, priceUnit: null, total })),
  extracted: {
    docType: "factura", needsOcr: false, invoiceNumber: "1-26-ES0055773",
    invoiceDate: "2026-10-12", supplierVat: "NL 8566 13 897 B01",
    base: 29.09, taxes: 0, total: 29.09,
    lines: entries.map(([description, quantity, priceUnit, total]) => ({
      description, quantity, priceUnit, total, taxAmount: 0,
      taxId: 14, accountId: 383, productId: null, sourcePurchaseOrderId: null,
      genericProductConfirmed: false, pdfPriceVerified: false,
    })),
  },
} as any;
const db = {
  read: async (model: string) => model === "res.partner" ? [{ active: true, vat: "NL856613897B01" }]
    : model === "account.tax" ? [{ active: true, type_tax_use: "purchase", amount: 21, invoice_repartition_line_ids: [1, 2, 3] }]
    : model === "account.tax.repartition.line" ? [{ repartition_type: "base", factor_percent: 100 }, { repartition_type: "tax", factor_percent: 100 }, { repartition_type: "tax", factor_percent: -100 }]
    : model === "account.account" ? [{ deprecated: false }] : [],
  search: async (model: string) => model === "res.partner" ? [{ vat: "NL856613897B01" }] : [],
};
const verify = (value: typeof doc) => verifyInvoiceForAutomation(value, pdf, db);
assert.equal((await verify(doc)).ready, true, "accepted service summary and reverse-charge tax should pass");
for (const [name, change] of [
  ["base", (v: typeof doc) => { v.extracted.base = 28.09; }],
  ["tax", (v: typeof doc) => { v.extracted.lines[0].taxId = null; }],
  ["account", (v: typeof doc) => { v.extracted.lines[0].accountId = null; }],
  ["date", (v: typeof doc) => { v.extracted.invoiceDate = "2026-10-13"; }],
  ["acceptance", (v: typeof doc) => { v.pdfLinesAccepted = false; }],
] as const) {
  const altered = structuredClone(doc);
  change(altered);
  assert.equal((await verify(altered)).ready, false, `${name} must block`);
}
const goods = structuredClone(doc);
goods.invoiceBranch = "goods";
assert.equal((await verify(goods)).ready, false, "goods must keep strict line/product checks");
console.log("supplier service verification: pass");
