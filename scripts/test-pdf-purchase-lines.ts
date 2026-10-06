import assert from "node:assert/strict";
import { cotejarPdfConPedidos, preserveOperatorProductSelections, productReferenceTokens } from "../backend/supplierInvoices/pdfPurchaseLines.ts";
import type { PurchaseOrderRecord, PdfExtractedLine } from "../backend/supplierInvoices/phase2Types.ts";

const order = {
  id: 4800, name: "P04800",
  lines: Array.from({ length: 20 }, (_, index) => ({
    productId: index + 1, productName: `Artículo ${index + 1}`, qtyOrdered: 10,
    qtyReceived: 10, qtyInvoiced: 0, qtyPending: 10, priceUnit: 80,
    discount: 0, subtotal: 800, taxIds: [21],
  })),
} as PurchaseOrderRecord;
const pdf = [1, 2, 3].map((index): PdfExtractedLine => ({
  description: `Artículo ${index}`, reference: null, quantity: 10,
  priceUnit: 100, discount: 0, taxNames: [], total: 1000, confidence: 90,
}));
const result = cotejarPdfConPedidos(pdf, [order]);
assert.equal(result.length, 3, "un pedido de 20 líneas sólo incorpora las 3 del PDF");
assert.deepEqual(result.map((line) => line.productId), [1, 2, 3]);
assert.deepEqual(result.map((line) => line.priceUnit), [100, 100, 100], "el precio del PDF no se sustituye por el del pedido");
assert.deepEqual(result.map((line) => line.odooPurchasePriceUnit), [80, 80, 80]);
const unclear = cotejarPdfConPedidos([{ ...pdf[0], description: "Servicio no identificado", priceUnit: null }], [order]);
assert.equal(unclear.length, 1);
assert.equal(unclear[0].productId, null, "no se inventa un enlace Odoo cuando el PDF es ambiguo");
assert.equal(unclear[0].priceUnit, null);
const differingNames = {
  ...order, lines: [
    { ...order.lines[0], productId: 35841, productName: "[PTL2N2M] Perfil negro", qtyPending: 30, priceUnit: 2.88 },
    { ...order.lines[1], productId: 32331, productName: "[B10468BN] Panel LED", qtyPending: 10, priceUnit: 6.8 },
  ],
} as PurchaseOrderRecord;
const reconciled = cotejarPdfConPedidos([
  { ...pdf[0], description: "Perfil Sid Lacado Negro", quantity: 30, priceUnit: 2.88, aiProductCandidateId: 32331 },
  { ...pdf[1], description: "Panel Trielle 60X60", quantity: 10, priceUnit: 6.8 },
  { ...pdf[2], description: "Envío", quantity: 1, priceUnit: null, total: null },
], [differingNames]);
assert.equal(reconciled[0].productId, null, "una similitud nominal no persiste identidad");
assert.equal(reconciled[0].matchCandidates?.length, 0, "similitud débil se mantiene sin propuesta");
assert.equal(reconciled[1].productId, null, "el ID propuesto por IA no sustituye evidencia de producto");
assert.equal(reconciled.length, 2, "una mención sin precio ni importe no genera una línea facturable");
const ambiguousOrder = { ...differingNames, lines: [differingNames.lines[0], { ...differingNames.lines[1], qtyPending: 30, priceUnit: 2.88 }] } as PurchaseOrderRecord;
const ambiguous = cotejarPdfConPedidos([{ ...pdf[0], description: "Sin nombre coincidente", quantity: 30, priceUnit: 2.88 }], [ambiguousOrder]);
assert.equal(ambiguous[0].productId, null, "cantidad y precio repetidos no autorizan una identidad inventada");
const supplierReference = cotejarPdfConPedidos([
  { ...pdf[0], description: "Nombre comercial distinto", reference: "LM3708", quantity: 30, priceUnit: 3.1 },
], [differingNames], [{ productId: 35841, reference: "LM3708", name: "Perfil proveedor ## Negro" }]);
assert.equal(supplierReference[0].productId, 35841, "la referencia del proveedor guardada en Odoo tiene prioridad");
assert.equal(supplierReference[0].pdfPriceVerified, false, "una diferencia de precio requiere revisión aunque el producto esté identificado");
const ambiguousSupplierReference = cotejarPdfConPedidos([
  { ...pdf[0], description: "Nombre comercial distinto", reference: "DUP", quantity: 10, priceUnit: 6.8 },
], [differingNames], [{ productId: 35841, reference: "DUP" }, { productId: 32331, reference: "DUP" }]);
assert.equal(ambiguousSupplierReference[0].productId, null, "una referencia compartida no se resuelve por precio silenciosamente");
console.log("Cotejo PDF/pedido: OK");

const splitRefs = productReferenceTokens("8433373066601 [200205069]");
assert.ok(splitRefs.includes("8433373066601") && splitRefs.includes("200205069"), "EAN y referencia se comparan como códigos separados");
const quantityPriceMismatch = cotejarPdfConPedidos([
  { ...pdf[0], productId: 32331, reference: "8433373066601 [200205069]", quantity: 12, priceUnit: 9.99 },
], [{ ...differingNames, lines: [{ ...differingNames.lines[1], qtyOrdered: 5, qtyReceived: 1, qtyPending: 1 }] } as PurchaseOrderRecord]);
assert.equal(quantityPriceMismatch[0].productId, 32331, "producto humano confirmado enlaza por identidad aunque cantidad/precio difieran");
assert.equal(quantityPriceMismatch[0].sourcePurchaseOrderId, differingNames.id, "se refleja la línea de compra inequívoca");
assert.equal(quantityPriceMismatch[0].quantity, 12, "no se sustituye la cantidad del PDF");
assert.equal(quantityPriceMismatch[0].priceUnit, 9.99, "no se sustituye el precio del PDF");
assert.equal(quantityPriceMismatch[0].pdfPriceVerified, false, "la diferencia de precio sigue pendiente de revisión");
const savedSelection = preserveOperatorProductSelections([pdf[0]], [{ ...pdf[0], productId: 35841, priceUnit: 12 }]);
assert.equal(savedSelection[0].productId, 35841, "el remapeo conserva la selección manual del producto");

const referenceMismatch = cotejarPdfConPedidos([
  { ...pdf[0], description: "Descripción comercial distinta", reference: "8433373066601 [200205069]", quantity: 12, priceUnit: 9.99 },
], [{ ...differingNames, lines: [{ ...differingNames.lines[1], productId: 32331, qtyOrdered: 5, qtyReceived: 1, qtyPending: 1 }] } as PurchaseOrderRecord], [
  { productId: 32331, barcode: "8433373066601", reference: "200205069" },
]);
assert.equal(referenceMismatch[0].productId, 32331, "EAN/SKU emparejan el producto aun cuando cantidad y precio requieren revisión");
assert.equal(referenceMismatch[0].sourcePurchaseOrderId, differingNames.id);
assert.equal(referenceMismatch[0].pdfPriceVerified, false);

const probable = cotejarPdfConPedidos([
  { ...pdf[0], description: "Perfil Sid Negro", quantity: 10, priceUnit: 85 },
], [differingNames]);
assert.equal(probable[0].productId, null, "un nombre parecido sólo crea propuesta, nunca identidad guardada");
assert.equal(probable[0].matchCandidates?.[0]?.identityLevel, "probable");
assert.ok((probable[0].matchCandidates?.[0]?.score ?? 0) > 0);
const noEvidence = cotejarPdfConPedidos([
  { ...pdf[0], description: "Servicio completamente ajeno", quantity: 10, priceUnit: 80 },
], [differingNames]);
assert.equal(noEvidence[0].productId, null);
assert.equal(noEvidence[0].matchCandidates?.length, 0, "sin evidencia textual no se propone por cantidad/precio");
const repeatedProductOrder = { ...order, lines: [
  { ...order.lines[0], id: 74001, qtyPending: 5 },
  { ...order.lines[0], id: 74002, qtyPending: 10 },
] } as PurchaseOrderRecord;
const repeatedPdf = cotejarPdfConPedidos([
  { ...pdf[0], description: "Artículo 1", quantity: 10, total: 1000 },
  { ...pdf[0], description: "Artículo 1", quantity: 5, total: 500 },
], [repeatedProductOrder]);
assert.deepEqual(repeatedPdf.map((line) => line.sourcePurchaseOrderId), [4800, 4800]);
assert.deepEqual(repeatedPdf.map((line) => line.qtyPending), [10, 5], "dos apariciones PDF iguales se conservan como líneas separadas y cotejan contra línea única");
assert.deepEqual(repeatedPdf.map((line) => line.matchCandidates?.[0]?.purchaseLineId), [74002, 74001]);
console.log("Candidatos explicables y líneas repetidas: OK");
const equalPriceStillNeedsReview = cotejarPdfConPedidos([
  { ...pdf[0], description: "Artículo 1", priceUnit: 80, quantity: 10, total: 800 },
], [order]);
assert.equal(equalPriceStillNeedsReview[0].productId, 1);
assert.equal(equalPriceStillNeedsReview[0].pdfPriceVerified, false, "la identidad exacta y el precio igual no marcan automáticamente el precio como verificado");
