import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { registerSupplierInvoicesPhase2Routes } from "../backend/supplierInvoices/phase2Routes.ts";

const root = mkdtempSync(join(tmpdir(), "invoice-proposal-test-"));
const dir = join(root, "supplier-invoices");
mkdirSync(dir);
const path = join(dir, "docInbox.json");
const doc = {
  driveFileId: "PDF-1", name: "factura.pdf", status: "PENDIENTE_COTEJO", assignedPurchaseOrderIds: null,
  odooDraftMoveId: null, reviewChat: [], match: null,
  extracted: { supplier: "Original", supplierVat: null, invoiceNumber: null, invoiceDate: null, dueDate: null,
    country: null, currency: "EUR", billingAddress: null, base: null, taxes: null, total: null,
    lines: [], textPreview: "", needsOcr: false, warnings: [], pdfPages: 1, docType: "factura" },
  reviewProposal: { at: "2026-09-24T00:00:00Z", fields: { supplier: "Propuesto", invoiceNumber: "FAC-42", total: 121 },
    lines: [{ description: "Artículo", reference: null, quantity: 1, priceUnit: 100, discount: 45,
      discountExtra: 5, promptPaymentDiscount: 2,
      taxNames: [], total: 51.21, confidence: 85, aiProductCandidateId: 123, aiPurchaseOrderCandidateId: 45 }],
    unresolved: ["Confirmar pedido"] },
};
const freshDoc = { ...doc, driveFileId: "PDF-2", name: "nueva.pdf", reviewProposal: null, pdfCached: true,
  extracted: { ...doc.extracted, supplier: "Proveedor Propuesto", lines: [{ productId: null, description: "Artículo", reference: null, quantity: 1, priceUnit: 100, discount: 45, taxNames: [], total: 55, confidence: 90 }], textPreview: "Nº PEDIDO P00045. Origen: SUP-REF-45. Emisor: Proveedor Con VAT\nNIF: ESB12524773. Producto EAN 8431234567890 [ART-123]. Ref adicional EXT-46, EXT-47. DTO 45%, extra 5%, pronto pago 2%." } };
const conflictDoc = { ...freshDoc, driveFileId: "PDF-3", name: "conflicto.pdf", reviewProposal: null,
  extracted: { ...freshDoc.extracted, supplierVat: "B00000000" } };
writeFileSync(path, JSON.stringify({ meta: { version: 2, lastScanAt: null, lastScanResult: null, totalDocuments: 3, driveFolderId: null }, documents: [doc, freshDoc, conflictDoc] }));
mkdirSync(join(dir, "inbox"));
writeFileSync(join(dir, "inbox", "PDF-2.pdf"), "%PDF-1.4\n");
writeFileSync(join(dir, "inbox", "PDF-3.pdf"), "%PDF-1.4\n");
writeFileSync(join(root, "products-catalog.json"), JSON.stringify({ products: [{ id: 123, templateId: 12, name: "Artículo", reference: "ART-123", barcode: "8431234567890", supplierNames: ["Propuesto"], type: "consu" }] }));
const fakeOpenclaw = join(root, "openclaw");
writeFileSync(fakeOpenclaw, `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(root, "agent-args.txt")}'\nprintf '%s\\n' '{"reply":"Lectura completada","proposal":{"fields":{"supplier":"Propuesto","invoiceNumber":"FAC-43"},"lines":[{"description":"Artículo","reference":"8431234567890 / ART-123","quantity":1,"priceUnit":100,"discount":45,"discountExtra":5,"promptPaymentDiscount":2,"total":51.21,"productCandidateId":123,"purchaseOrderCandidateId":45}]},"unresolved":[]}'\n`);
chmodSync(fakeOpenclaw, 0o755);
const originalPath = process.env.PATH;
process.env.PATH = `${root}:${originalPath ?? ""}`;
writeFileSync(join(dir, "purchase-orders.json"), JSON.stringify({ meta: { version: 1, lastPoSyncAt: null, totalOrders: 1, message: null }, orders: [{
  id: 45, name: "P00045", state: "purchase", partnerId: 5, partnerName: "Propuesto", partnerVat: null, supplierRef: "SUP-REF-45",
  currency: "EUR", dateOrder: "2026-09-01", amountTotal: 266.2, amountUntaxed: 220,
  pickings: [], receivedQty: 3, orderedQty: 3, allReceived: true, lastReceptionAt: null, daysSinceReception: null,
  linkedInvoiceIds: [], linkedInvoiceNames: [], billedAmount: 0, pendingAmount: 266.2, billedPct: 0, billingSplit: false,
  status: "SIN_FACTURA", lines: [
    { productId: 123, productName: "Artículo", qtyOrdered: 1, qtyReceived: 1, qtyInvoiced: 0, qtyPending: 1, priceUnit: 80, discount: 0, subtotal: 80, taxIds: [] },
    { productId: 124, productName: "Sin lectura PDF", qtyOrdered: 2, qtyReceived: 2, qtyInvoiced: 0, qtyPending: 2, priceUnit: 70, discount: 0, subtotal: 140, taxIds: [] },
  ],
}, {
  id: 46, name: "P00046", state: "purchase", partnerId: 6, partnerName: "Proveedor Con VAT", partnerVat: "B12524773", supplierRef: "EXT-46",
  currency: "EUR", dateOrder: "2026-08-01", amountTotal: 10, amountUntaxed: 10,
  pickings: [], receivedQty: 1, orderedQty: 1, allReceived: true, lastReceptionAt: null, daysSinceReception: null,
  linkedInvoiceIds: [], linkedInvoiceNames: [], billedAmount: 0, pendingAmount: 10, billedPct: 0, billingSplit: false,
  status: "SIN_FACTURA", lines: [{ productId: 999, productName: "Otro", qtyOrdered: 1, qtyReceived: 1, qtyInvoiced: 0, qtyPending: 1, priceUnit: 80, discount: 0, subtotal: 80, taxIds: [] }],
}, {
  id: 47, name: "P00047", state: "purchase", partnerId: 7, partnerName: "Otro Proveedor", partnerVat: "X123456789", supplierRef: "EXT-47",
  currency: "EUR", dateOrder: "2026-07-01", amountTotal: 10, amountUntaxed: 10,
  pickings: [], receivedQty: 1, orderedQty: 1, allReceived: true, lastReceptionAt: null, daysSinceReception: null,
  linkedInvoiceIds: [], linkedInvoiceNames: [], billedAmount: 0, pendingAmount: 10, billedPct: 0, billingSplit: false,
  status: "SIN_FACTURA", lines: [{ productId: 1000, productName: "Diferente", qtyOrdered: 1, qtyReceived: 1, qtyInvoiced: 0, qtyPending: 1, priceUnit: 80, discount: 0, subtotal: 80, taxIds: [] }],
}] }));
const handlers = new Map<string, (request: any, response: any) => void>();
registerSupplierInvoicesPhase2Routes({ middlewares: { use: (route, handler) => handlers.set(route, handler) } },
  { getSessionUser: (cookie) => cookie === "session=ok" ? { id: "1", name: "Rafa", role: "admin", permissions: ["supplierBilling"] } : undefined },
  { dataDir: root, env: { SUPPLIER_INVOICES_ODOO_WRITE_ENABLED: "false", SUPPLIER_INVOICES_DRIVE_WRITE_ENABLED: "false" } });
async function call(route: string, body: unknown, cookie = "session=ok") {
  const handler = handlers.get(route);
  assert.ok(handler, `ruta ${route}`);
  return await new Promise<{ status: number; body: any }>((resolve) => {
    const request = Readable.from([JSON.stringify(body)]) as any;
    request.method = "POST"; request.headers = { cookie }; request.url = route;
    const response: any = { statusCode: 200, writableEnded: false, setHeader() {}, end(text: string) {
      this.writableEnded = true; resolve({ status: this.statusCode, body: JSON.parse(text) });
    } };
    handler(request, response);
  });
}
try {
  const extract = "/api/odoo/supplier-invoices/inbox/raskibot-extract";
  const apply = "/api/odoo/supplier-invoices/inbox/raskibot-proposal/apply";
  const scanned = await call(extract, { ids: ["PDF-2"] });
  assert.equal(scanned.status, 200, "escaneo aislado del documento elegido");
  assert.equal(scanned.body.document.extracted.supplier, "Propuesto", "rellena la lectura sin botón Aplicar");
  assert.equal(scanned.body.document.extracted.lines[0].discountExtra, 5);
  assert.equal(scanned.body.document.extracted.lines[0].promptPaymentDiscount, 2);
  assert.equal(scanned.body.document.assignedPurchaseOrderIds, null, "el escaneo no confirma pedidos en Odoo");
  assert.equal(scanned.body.document.extracted.lines[0].productId, undefined, "no inventa identidad de producto Odoo");
  assert.equal(scanned.body.document.extracted.lines[0].aiProductCandidateId, 123, "solo se conserva el candidato con referencia literal del PDF");
  assert.equal(scanned.body.document.extracted.lines[0].aiPurchaseOrderCandidateId, null, "no conserva un pedido explícito con proveedor aún no elegible");
  assert.equal((await call("/api/odoo/supplier-invoices/inbox/product-candidate", { id: "PDF-2", productId: 999 })).status, 404, "el endpoint de revisión no acepta IDs fuera de la sugerencia de esta factura");
  const capturedArgs = readFileSync(join(root, "agent-args.txt"), "utf8").trim().split(/\n/);
  const capturedTask = JSON.parse(capturedArgs.at(-1)!);
  assert.ok(capturedArgs.includes("agent:raskibot:invoice-review-v3-PDF-2"), "el análisis usa hilo limpio con las reglas actuales versionadas");
  const agentDoc = capturedTask.documents[0];
  assert.equal(agentDoc.candidateDiagnostics.purchaseOrderCandidates, 3, "el agente recibe candidatos por referencia literal y proveedor pendiente");
  const explicitPo = agentDoc.purchaseOrderCandidates.find((o: any) => o.id === 45);
  assert.equal(explicitPo.name, "P00045", "el candidato explícito llega al agente");
  assert.equal(explicitPo.explicitReferenceKind, "order-name-and-supplier-reference", "nombre interno y referencia externa identifican el mismo pedido");
  assert.equal(explicitPo.lines[0].reference, "ART-123", "referencias de catálogo quedan junto a la línea del pedido");
  assert.ok(agentDoc.catalogCandidates[0].matchedReferences.includes("8431234567890") && agentDoc.catalogCandidates[0].matchedReferences.includes("ART123"), "EAN y referencia del texto PDF encuentran producto aunque heurística no haya detectado reference");
  assert.ok(capturedTask.rules.some((rule: string) => rule.includes("no digas que el catálogo está vacío")), "Raskibot debe respetar los candidatos literales del backend");
  assert.ok(capturedTask.rules.some((rule: string) => rule.includes("proponer correcciones estructuradas del borrador local")), "Raskibot puede proponer correcciones estructuradas locales");
  assert.ok(capturedTask.rules.some((rule: string) => rule.includes("no escribas directamente en el Dashboard, sus stores, Odoo ni Drive")), "Raskibot nunca escribe en Dashboard, Odoo ni Drive");
  assert.ok(capturedTask.rules.some((rule: string) => rule.includes("Nunca confirmes proveedor, pedido o producto")), "las identidades externas requieren confirmación humana");
  const fakeReply = readFileSync(fakeOpenclaw, "utf8").replace('"productCandidateId":123', '"productCandidateId":999').replace('"purchaseOrderCandidateId":45', '"purchaseOrderCandidateId":47');
  writeFileSync(fakeOpenclaw, fakeReply);
  const conflictScan = await call(extract, { ids: ["PDF-3"] });
  assert.equal(conflictScan.body.document.extracted.lines[0].aiProductCandidateId, null, "descarta un producto que el modelo inventó fuera del catálogo candidato exacto");
  assert.equal(conflictScan.body.document.extracted.lines[0].aiPurchaseOrderCandidateId, null, "descarta un pedido con conflicto de proveedor aunque lo proponga el modelo");
  assert.ok(conflictScan.body.document.reviewChat.at(-1).content.includes("sugerencia(s) de pedido se descartaron"), "explica el rechazo de una identidad no elegible");
  const conflictTask = JSON.parse(readFileSync(join(root, "agent-args.txt"), "utf8").trim().split(/\n/).at(-1)!);
  const conflictCandidates = conflictTask.documents[0].purchaseOrderCandidates;
  const issuerResolved = conflictCandidates.find((o: any) => o.id === 46);
  const explicitConflict = conflictCandidates.find((o: any) => o.id === 47);
  assert.equal(issuerResolved.pdfIssuerVatMatch, true, "NIF explícito junto al proveedor del PDF resuelve el NIF heurístico del cliente");
  assert.equal(issuerResolved.vatConflict, false, "la evidencia de emisor prevalece sobre el NIF heurístico preliminar");
  assert.equal(issuerResolved.invoiceEligible, true, "un candidato pendiente vuelve a ser utilizable tras verificar proveedor en el PDF");
  assert.equal(explicitConflict.vatConflict, true, "referencia literal de otro proveedor sigue mostrando conflicto");
  assert.equal(explicitConflict.invoiceEligible, false, "el conflicto real sin resolver bloquea facturar el candidato");
  assert.ok(capturedTask.rules.some((rule: string) => rule.includes("diferencias de cantidad o precio")), "las instrucciones separan identidad de discrepancias");
  assert.equal((await call("/api/odoo/supplier-invoices/inbox/no-po-lines", { id: "PDF-2" })).status, 409, "un pedido explícito impide usar la rama sin pedido");
  assert.equal((await call(extract, { ids: ["PDF-1", "PDF-2"] })).status, 400, "una respuesta no debe aplicarse a dos PDFs");
  assert.equal((await call(apply, { id: "PDF-1" }, "")).status, 401, "la propuesta requiere sesión");
  const lineSaved = await call("/api/odoo/supplier-invoices/inbox/lines", { id: "PDF-2", lines: [{
    productId: 123, description: "Artículo", reference: null, quantity: 1, priceUnit: 100, discount: 45,
    discountExtra: 5, promptPaymentDiscount: 2, taxNames: [], total: 51.21, sourcePurchaseOrderId: null,
  }] });
  assert.equal(lineSaved.status, 200, "selección manual de producto guardada en el editor local");
  const remapped = await call("/api/odoo/supplier-invoices/inbox/polink", { id: "PDF-2", purchaseOrderIds: [45] });
  assert.equal(remapped.status, 200);
  assert.equal(remapped.body.document.extracted.lines[0].productId, 123, "se conserva el producto elegido manualmente");
  assert.equal(remapped.body.document.extracted.lines[0].sourcePurchaseOrderId, 45, "el producto existente se enlaza a su línea única del pedido");
  assert.equal(remapped.body.document.extracted.lines[0].pdfPriceVerified, false, "el precio distinto sigue marcado para revisión");
  assert.equal(remapped.body.document.pdfSourceLines[0].productId, undefined, "el original PDF se mantiene separado de la identidad Odoo");
  const beforeRescan = remapped.body.document;
  writeFileSync(fakeOpenclaw, `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(root, "agent-args.txt")}'\nprintf '%s\\n' '{"reply":"Propuesta local","proposal":{"fields":{"supplier":"Proveedor Distinto","invoiceNumber":"FAC-99"},"lines":[{"description":"Artículo","reference":"ART-123","quantity":1,"priceUnit":100,"discount":45,"productCandidateId":123,"purchaseOrderCandidateId":45}]},"unresolved":[]}';\n`);
  const rescanned = await call(extract, { ids: ["PDF-2"] });
  assert.equal(rescanned.status, 200, "rescan sobre factura con selección humana confirmada");
  assert.deepEqual(rescanned.body.document.assignedPurchaseOrderIds, beforeRescan.assignedPurchaseOrderIds, "rescan conserva el pedido confirmado");
  assert.equal(rescanned.body.document.confirmedOdooPartnerId, beforeRescan.confirmedOdooPartnerId, "rescan conserva proveedor Odoo confirmado");
  assert.equal(rescanned.body.document.extracted.lines[0].productId, beforeRescan.extracted.lines[0].productId, "rescan conserva producto humano confirmado");
  assert.equal(rescanned.body.document.extracted.supplier, beforeRescan.extracted.supplier, "rescan no sustituye el emisor confirmado");
  const accepted = await call(apply, { id: "PDF-1" });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.document.extracted.supplier, "Propuesto");
  assert.equal(accepted.body.document.extracted.lines[0].productId, undefined, "el agente no asigna producto Odoo");
  assert.equal(accepted.body.document.assignedPurchaseOrderIds, null, "el agente no asigna pedidos");
  assert.equal(accepted.body.document.reviewProposal, null);
  assert.equal((await call(apply, { id: "PDF-1" })).status, 404, "no se acepta dos veces");
  const persisted = JSON.parse(readFileSync(path, "utf8")).documents[0];
  assert.equal(persisted.extracted.invoiceNumber, "FAC-42");
  const linked = await call("/api/odoo/supplier-invoices/inbox/polink", { id: "PDF-1", purchaseOrderIds: [45] });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.document.pdfSourceLines[0].priceUnit, 100, "se conserva el precio leído del PDF");
  assert.equal(linked.body.document.extracted.lines[0].priceUnit, 100, "el precio del PDF no se reemplaza por Odoo");
  assert.equal(linked.body.document.extracted.lines[0].discount, 45);
  assert.equal(linked.body.document.extracted.lines[0].discountExtra, 5);
  assert.equal(linked.body.document.extracted.lines[0].promptPaymentDiscount, 2);
  assert.equal(linked.body.document.extracted.lines[0].total, 51.21, "descuentos sucesivos, no sumados");
  assert.equal(linked.body.document.extracted.lines[0].odooPurchasePriceUnit, 80, "queda visible la discrepancia del pedido");
  assert.equal(linked.body.document.extracted.lines[0].pdfPriceVerified, false, "un precio PDF distinto del pedido requiere revisión aunque el producto coincida");
  assert.equal(linked.body.document.pdfSourceLines.length, 1, "la lectura PDF original se conserva para auditoría");
  assert.equal(linked.body.document.extracted.lines.length, 1, "sólo se incorpora la línea facturable leída del PDF");
  assert.equal((await call("/api/odoo/supplier-invoices/inbox/status", { id: "PDF-1", status: "VALIDADA" })).status, 409, "no validar con precio PDF sin verificar");
  assert.equal((await call("/api/odoo/supplier-invoices/inbox/odoo-draft", { id: "PDF-1" })).status, 403, "escritura Odoo sigue bloqueada");
  assert.equal((await call("/api/odoo/supplier-invoices/inbox/odoo-post", { id: "PDF-1" })).status, 403, "Dashboard nunca contabiliza; se valida en Odoo");
  console.log("✅ propuesta local: sesión, aislamiento por PDF, aceptación única y persistencia; sin asociación Odoo");
  console.log("✅ cotejo PDF/pedido: conserva diferencia de precio, marca no verificados y bloquea escritura");
} finally { process.env.PATH = originalPath; rmSync(root, { recursive: true, force: true }); }
