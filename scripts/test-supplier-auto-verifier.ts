import assert from "node:assert/strict";
import { verifyInvoiceForAutomation, type VerificationReads } from "../backend/supplierInvoices/autoVerifier.ts";
import type { InboxDocument } from "../backend/supplierInvoices/phase2Types.ts";

const line = { description: "Servicio publicitario EU4", reference: null, quantity: 0.5, priceUnit: 1800,
  discount: 0, total: 900, taxAmount: 189, taxId: 5, accountId: 381, productId: 43199,
  genericProductConfirmed: true, pdfPriceVerified: true, taxNames: ["IVA 21%"], confidence: 100 };
const doc = { driveFileId: "test-id", name: "factura.pdf", sourcePresent: true, movedTo: null,
  odooDraftMoveId: null, invoiceBranch: "services", confirmedOdooPartnerId: 42, assignedPurchaseOrderIds: null,
  pdfLinesAccepted: true, pdfSourceLines: [{ ...line }], lastAiScan: { unresolved: [] },
  extracted: { docType: "factura", needsOcr: false, supplierVat: "B73585788", invoiceNumber: "1-2026/0144",
    invoiceDate: "2026-10-07", base: 900, taxes: 189, total: 1089, lines: [{ ...line }] },
} as unknown as InboxDocument;
const text = `Agloob Marketing B73585788 FACTURA 1-2026/0144 07-10-2026 ${"Servicio publicitario EU4 ".repeat(6)}\nBase imponible 900,00 €\nIVA 189,00 €\nImporte total 1.089,00 €`;
let duplicate = false;
let missingProduct = false;
let missingOrder = false;
let received = 0;
const db: VerificationReads = {
  async read(model) {
    if (model === "product.product" && missingProduct) return [];
    if (model === "purchase.order" && missingOrder) return [];
    const rows: Record<string, Record<string, unknown>> = {
      "res.partner": { id: 42, vat: "B73585788", active: true },
      "product.product": { id: 43199, active: true, type: "service" },
      "account.tax": { id: 5, active: true, type_tax_use: "purchase", amount: 21, invoice_repartition_line_ids: [1] },
      "account.tax.repartition.line": { id: 1, repartition_type: "tax", factor_percent: 100 },
      "account.account": { id: 381, deprecated: false },
      "purchase.order": { id: 12, partner_id: [42, "Agloob"], state: "purchase", invoice_status: "to invoice" },
      "purchase.order.line": { id: 13, order_id: [12, "P1"], product_id: [43199, "Servicio"], product_qty: 1, qty_received: received, qty_invoiced: 0 },
    };
    return rows[model] ? [rows[model]] : [];
  },
  async search(model) {
    if (model === "res.partner") return [{ id: 42, vat: "B73585788" }];
    if (model === "account.move" && duplicate) return [{ id: 123, ref: "1-2026/0144" }];
    return [];
  },
};
assert.equal((await verifyInvoiceForAutomation(doc, text, db)).ready, true, "servicio totalmente cotejado");
const corrected = structuredClone(doc);
corrected.lastAiScan!.unresolved = ["Número pendiente en la lectura anterior"];
assert.equal((await verifyInvoiceForAutomation(corrected, text, db)).ready, true, "un pendiente antiguo ya corregido no bloquea el estado cotejado");
duplicate = true;
assert.match((await verifyInvoiceForAutomation(doc, text, db)).blockers.join(" "), /Ya existe una factura/);
duplicate = false;
missingProduct = true;
assert.match((await verifyInvoiceForAutomation(doc, text, db)).blockers.join(" "), /producto Odoo inexistente/);
missingProduct = false;
const wrong = structuredClone(doc);
wrong.extracted!.lines[0].quantity = 8601;
assert.equal((await verifyInvoiceForAutomation(wrong, text, db)).ready, false, "IBAN/importe falso se bloquea");
const goods = structuredClone(doc);
goods.invoiceBranch = "goods";
goods.assignedPurchaseOrderIds = [12];
goods.extracted!.lines[0].sourcePurchaseOrderId = 12;
goods.extracted!.lines[0].sourcePurchaseLineId = 13;
assert.match((await verifyInvoiceForAutomation(goods, text, db)).blockers.join(" "), /recepción/);
missingOrder = true;
assert.match((await verifyInvoiceForAutomation(goods, text, db)).blockers.join(" "), /releer todos los pedidos/);
missingOrder = false;
received = 0.75;
const repeated = structuredClone(goods);
repeated.extracted!.base = 1800;
repeated.extracted!.taxes = 378;
repeated.extracted!.total = 2178;
repeated.extracted!.lines.push({ ...repeated.extracted!.lines[0] });
repeated.pdfSourceLines!.push({ ...repeated.pdfSourceLines![0] });
assert.match((await verifyInvoiceForAutomation(repeated, text, db)).blockers.join(" "), /cantidad acumulada/);
console.log("Verificador automático: apta, duplicado, PDF falso, producto/pedido ausente y recepción acumulada: OK");
