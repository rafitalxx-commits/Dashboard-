import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { registerSupplierInvoicesPhase2Routes } from "../backend/supplierInvoices/phase2Routes.ts";

const root = mkdtempSync(join(tmpdir(), "invoice-confirm-match-"));
const dir = join(root, "supplier-invoices");
mkdirSync(dir, { recursive: true });
mkdirSync(join(dir, "inbox"));
const doc = {
  driveFileId: "MOCK-PDF", name: "factura.pdf", status: "PENDIENTE_COTEJO", confirmedOdooPartnerId: null,
  invoiceBranch: "goods", assignedPurchaseOrderIds: null, pdfLinesAccepted: false, pdfCached: true,
  extracted: { supplier: "Proveedor detectado", supplierVat: "B12345678", invoiceNumber: "F-1", invoiceDate: null,
    dueDate: null, country: "ES", currency: "EUR", billingAddress: null, base: 100, taxes: 21, total: 121,
    lines: [{ description: "Artículo A", reference: "ART-123", quantity: 1, priceUnit: 100, discount: 0,
      taxNames: [], total: 100, productId: null, purchaseLineId: null }],
    textPreview: "Emisor: Proveedor Uno\nNIF: B12345678\nPedido P12345\nART-123 Artículo A", needsOcr: false,
    warnings: [], pdfPages: 1, docType: "factura" },
};
writeFileSync(join(dir, "docInbox.json"), JSON.stringify({ meta: { version: 2, lastScanAt: null, lastScanResult: null, totalDocuments: 1, driveFolderId: null }, documents: [doc] }));
writeFileSync(join(dir, "purchase-orders.json"), JSON.stringify({ meta: { version: 1, lastPoSyncAt: null, totalOrders: 0, message: null }, orders: [] }));

const originalFetch = globalThis.fetch;
const calls: Array<{ model: string; method: string }> = [];
let currentOrder = true;
globalThis.fetch = async (_input, init) => {
  const req = JSON.parse(String(init?.body)) as { params: { service: string; args: unknown[] } };
  if (req.params.service === "common") return Response.json({ result: 7 });
  const [, , , model, method] = req.params.args as [string, number, string, string, string];
  calls.push({ model, method });
  let result: unknown = [];
  if (model === "purchase.order" && method === "search") result = currentOrder ? [110] : [];
  else if (model === "purchase.order" && method === "read") result = [{ id: 110, name: "P12345", state: "purchase", invoice_status: "to invoice",
    partner_id: [22, "Proveedor Uno"], currency_id: [1, "EUR"], date_order: "2026-10-01", amount_total: 121,
    amount_untaxed: 100, order_line: [210], picking_ids: [] }];
  else if (model === "res.partner" && method === "read") result = [{ id: 22, name: "Proveedor Uno", vat: "B12345678", active: true, country_id: [34, "España"] }];
  else if (model === "purchase.order.line" && method === "read") result = [{ id: 210, order_id: [110, "P12345"], product_id: [303, "Artículo A"], name: "Artículo A",
    product_qty: 1, qty_received: 1, qty_invoiced: 0, price_unit: 100, price_subtotal: 100, price_total: 121, discount: 0, taxes_id: [] }];
  else if (model === "product.product" && method === "read") result = [{ id: 303, product_tmpl_id: [33, "Artículo A"], default_code: "ART-123", barcode: "" }];
  return Response.json({ result });
};

const handlers = new Map<string, (request: any, response: any) => void>();
registerSupplierInvoicesPhase2Routes({ middlewares: { use: (route, handler) => handlers.set(route, handler) } },
  { getSessionUser: (cookie) => cookie === "session=ok" ? { id: "rafa", name: "Rafa", role: "admin", permissions: ["supplierBilling"] } : undefined },
  { dataDir: root, env: { ODOO_URL: "https://odoo.invalid", ODOO_DATABASE: "test", ODOO_USERNAME: "test", ODOO_API_KEY: "mock",
    SUPPLIER_INVOICES_ODOO_WRITE_ENABLED: "false", SUPPLIER_INVOICES_DRIVE_WRITE_ENABLED: "false" } });

async function call(body: unknown, cookie = "session=ok") {
  const handler = handlers.get("/api/odoo/supplier-invoices/inbox/confirm-match");
  assert.ok(handler);
  const request = Readable.from([JSON.stringify(body)]) as any;
  request.method = "POST"; request.headers = { cookie }; request.url = "/api/odoo/supplier-invoices/inbox/confirm-match";
  return await new Promise<{ status: number; body: any }>((resolve) => {
    const response: any = { statusCode: 200, writableEnded: false, setHeader() {}, end(text: string) {
      this.writableEnded = true; resolve({ status: this.statusCode, body: JSON.parse(text) });
    } };
    handler(request, response);
  });
}

try {
  const body = { id: "MOCK-PDF", confirmedOdooPartnerId: 22, purchaseOrderIds: [110], invoiceBranch: "goods",
    fields: { invoiceNumber: "F-1", base: 100, taxes: 21, total: 121 } };
  assert.equal((await call(body, "")).status, 401, "la ruta combinada requiere sesión");
  const result = await call(body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.freshness.source, "live_odoo");
  assert.equal(result.body.document.confirmedOdooPartnerId, 22);
  assert.deepEqual(result.body.document.assignedPurchaseOrderIds, [110]);
  assert.equal(result.body.document.extracted.lines[0].productId, 303, "coteja por referencia exacta del producto Odoo");
  assert.equal(result.body.document.extracted.lines[0].matchCandidates[0].purchaseLineId, 210, "conserva identidad de línea de compra en el candidato cotejado");
  assert.equal(result.body.document.pdfSourceLines[0].priceUnit, 100, "preserva la fuente PDF sin sobrescribirla");
  assert.ok(calls.every(({ method }) => ["search", "read", "search_read"].includes(method)), "solo consulta Odoo: no create/write/button");
  const persisted = JSON.parse(readFileSync(join(dir, "docInbox.json"), "utf8")).documents[0];
  assert.deepEqual(persisted.assignedPurchaseOrderIds, [110], "persiste únicamente en el store temporal de test");

  currentOrder = false;
  const stale = await call(body);
  assert.equal(stale.status, 409, "rechaza pedido que ya no está pendiente según la lectura fresca");
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "docInbox.json"), "utf8")).documents[0].assignedPurchaseOrderIds, [110], "el rechazo no altera el cotejo guardado");
  console.log("confirm-match: proveedor/pedido revalidados, cotejo local atómico y rechazo obsoleto (Odoo simulado, solo lectura)");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
}
