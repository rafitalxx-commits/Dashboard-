import assert from "node:assert/strict";
import { extractPurchaseOrderReferences, extractPurchaseOrderReferenceEvidence, extractPdfData } from "../backend/supplierInvoices/documentInbox.ts";

const referenceCases: Array<[string, string[]]> = [
  ["Factura\nPedido: P048940,04\n", ["P04894"]],
  ["Factura\nCO45989P048940,04FR85366990494,00196,00\n", ["P04894"]],
  ["Factura\nPedido: P048500,50\n", ["P04850"]],
  ["Factura\nPO48480,37\n", ["P04848"]],
  ["Factura\nREFXPO48480,37ART123456\n", ["P04848"]],
  ["Factura\nPedido: 04957\n", ["P04957"]],
  ["Factura\nReferencia de pedido: P12345\n", ["P12345"]],
  ["Factura\nCódigo postal 04957\n", []],
  ["Factura\nPedido P04894 y P04850\n", ["P04894", "P04850"]],
  ["Factura\nPedido: 05123\n", ["P05123"]],
  ["Factura\nCódigo postal 05123\n", []],
];

for (const [textPreview, expected] of referenceCases) {
  const knownOrders = ["P04894", "P04850", "P04848", "P04957"];
  const actual = extractPurchaseOrderReferences(extractPdfData(textPreview, 1, "factura.pdf"), knownOrders);
  assert.deepEqual(actual, expected, `referencias incorrectas para: ${textPreview.trim()}`);
}

const evidence = extractPurchaseOrderReferenceEvidence(
  extractPdfData("Pedido de cliente: P048940,04\nPedido proveedor: P04848\n", 1, "multi.pdf"),
  ["P04894"],
);
assert.deepEqual(evidence.map(({ normalized }) => normalized), ["P04894", "P04848"], "conserva orden de aparición entre varios pedidos");
assert.equal(evidence[0].raw, "P048940,04");
assert.equal(evidence[0].source, "customer_order_column");
assert.equal(evidence[0].exactOdooHit, true);
assert.equal(evidence[1].source, "supplier_order_column");
assert.equal(evidence[1].exactOdooHit, false, "una referencia explícita fuera de caché se retiene para lectura Odoo exacta");

console.log("Referencias de pedido en PDF: OK");
