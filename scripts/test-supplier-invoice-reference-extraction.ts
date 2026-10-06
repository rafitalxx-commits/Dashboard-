import assert from "node:assert/strict";
import { extractPurchaseOrderReferences, extractPurchaseOrderReferenceEvidence, extractPdfData } from "../backend/supplierInvoices/documentInbox.ts";

const referenceCases: Array<[string, string[]]> = [
  ["Factura\nPedido: P123450,04\n", ["P12345"]],
  ["Factura\nCO45989P123450,04FR85366990494,00196,00\n", ["P12345"]],
  ["Factura\nPedido: P123460,50\n", ["P12346"]],
  ["Factura\nPO123470,37\n", ["P12347"]],
  ["Factura\nREFXPO123470,37ART123456\n", ["P12347"]],
  ["Factura\nPedido: 12348\n", ["P12348"]],
  ["Factura\nReferencia de pedido: P12345\n", ["P12345"]],
  ["Factura\nCódigo postal 12348\n", []],
  ["Factura\nPedido P12345 y P12346\n", ["P12345", "P12346"]],
  ["Factura\nPedido: 12349\n", ["P12349"]],
  ["Factura\nCódigo postal 12349\n", []],
];

for (const [textPreview, expected] of referenceCases) {
  const knownOrders = ["P12345", "P12346", "P12347", "P12348"];
  const actual = extractPurchaseOrderReferences(extractPdfData(textPreview, 1, "factura.pdf"), knownOrders);
  assert.deepEqual(actual, expected, `referencias incorrectas para: ${textPreview.trim()}`);
}

const evidence = extractPurchaseOrderReferenceEvidence(
  extractPdfData("Pedido de cliente: P123450,04\nPedido proveedor: P12347\n", 1, "multi.pdf"),
  ["P12345"],
);
assert.deepEqual(evidence.map(({ normalized }) => normalized), ["P12345", "P12347"], "conserva orden de aparición entre varios pedidos");
assert.equal(evidence[0].raw, "P123450,04");
assert.equal(evidence[0].source, "customer_order_column");
assert.equal(evidence[0].exactOdooHit, true);
assert.equal(evidence[1].source, "supplier_order_column");
assert.equal(evidence[1].exactOdooHit, false, "una referencia explícita fuera de caché se retiene para lectura Odoo exacta");

console.log("Referencias de pedido en PDF: OK");
