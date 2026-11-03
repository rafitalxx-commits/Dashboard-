import assert from "node:assert/strict";
import { PurchaseOrdersLedger } from "../backend/supplierInvoices/unbilled.ts";

const originalFetch = globalThis.fetch;
const calls: Array<{ model: string; method: string; args: unknown[]; kwargs: Record<string, unknown> }> = [];
globalThis.fetch = async (_input, init) => {
  const request = JSON.parse(String(init?.body)) as { params: { service: string; method: string; args: unknown[] } };
  if (request.params.service === "common") return Response.json({ result: 7 });
  const [, , , model, method, args, kwargs] = request.params.args as [string, number, string, string, string, unknown[], Record<string, unknown>];
  calls.push({ model, method, args, kwargs });
  let result: unknown = [];
  if (model === "purchase.order" && method === "search") result = [110]; // P12345; P12346 is invoiced and not returned
  else if (model === "purchase.order" && method === "read") result = [{
    id: 110, name: "P12345", state: "purchase", invoice_status: "to invoice", partner_id: [22, "Proveedor Uno"],
    currency_id: [1, "EUR"], date_order: "2026-10-01", user_id: [4, "Comprador"], origin: "SO/1", partner_ref: "REF-A",
    amount_total: 121, amount_untaxed: 100, order_line: [210], picking_ids: [310],
  }];
  else if (model === "res.partner" && method === "read") result = [{ id: 22, name: "Proveedor Uno", vat: "B12345678", country_id: [34, "España"] }];
  else if (model === "purchase.order.line" && method === "read") result = [{
    id: 210, order_id: [110, "P12345"], product_id: [303, "Producto A"], name: "Producto A",
    product_qty: 2, qty_received: 2, qty_invoiced: 0, price_unit: 50, price_subtotal: 100, price_total: 121, discount: 0, taxes_id: [5],
  }];
  else if (model === "stock.picking" && method === "read") result = [{ id: 310, name: "WH/IN/1", state: "done", scheduled_date: "2026-10-02", date_done: "2026-10-02" }];
  return Response.json({ result });
};

try {
  const ledger = new PurchaseOrdersLedger();
  const fresh = await ledger.refreshPendingOrdersForPartner({ ODOO_URL: "https://odoo.invalid", ODOO_DATABASE: "test", ODOO_USERNAME: "test", ODOO_API_KEY: "mock" }, 22);
  assert.deepEqual(fresh.map((order) => order.name), ["P12345"]);
  assert.equal(fresh[0].invoiceStatus, "to invoice");
  assert.equal(fresh[0].partnerVat, "B12345678");
  assert.equal(fresh[0].lines[0].productId, 303);
  assert.equal(fresh[0].lines[0].qtyPending, 2);
  const query = calls.find((call) => call.model === "purchase.order" && call.method === "search");
  assert.ok(JSON.stringify(query?.args).includes("invoice_status"));
  assert.ok(JSON.stringify(query?.args).includes("to invoice"));
  assert.ok(calls.every((call) => call.method === "search" || call.method === "read"), "solo llamadas Odoo de lectura");
  console.log("Pedidos actuales por proveedor: OK (Odoo simulado, solo lectura)");
} finally {
  globalThis.fetch = originalFetch;
}
