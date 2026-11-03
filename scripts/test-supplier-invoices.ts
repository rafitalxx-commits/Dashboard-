import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SupplierInvoiceSyncService, computeKpis, filterInvoices } from "../backend/supplierInvoices/service.ts";

const tempDir = mkdtempSync(join(tmpdir(), "supplier-invoices-test-"));
try {
  const fixture = {
    meta: { version: 1, lastSyncAt: null, lastSyncMode: "none", totalInvoices: 1, writeDateMax: null, message: null },
    supplierEquivalences: [],
    invoices: [{
      id: 1, name: "BILL/TEST/001", ref: "TEST-001", moveType: "in_invoice", state: "posted", paymentState: "paid",
      invoiceDate: "2026-01-15", accountingDate: "2026-01-15", dueDate: "2026-02-15", currency: "EUR", journal: "Test",
      partnerId: 10, partnerName: "Proveedor de prueba", partnerVat: null, partnerCountry: "España", partnerCountryCode: "ES",
      fiscalPosition: null, amountUntaxed: 100, amountTax: 21, amountTotal: 121, amountResidual: 0, amountPaid: 121,
      invoiceOrigin: "P03881", taxSummary: ["21%"], linkedPurchaseOrderIds: [3881], linkedPurchaseOrderNames: ["P03881"],
      linkedPickingIds: [], linkedPickingNames: [], products: ["Producto de prueba"], lineCount: 1,
      lines: [{ productId: 1, productRef: "TEST", productName: "Producto de prueba", name: "Producto de prueba", quantity: 1,
        priceUnit: 100, discount: 0, taxNames: ["21%"], subtotal: 100, total: 121, displayType: "product" }],
      attachments: [], hasPdf: false, writeDate: null, lastSyncAt: null, source: null, pdf_url: null, drive_file_id: null,
      ocr_status: null, ai_status: null, confidence: null, detected_supplier: null, matched_supplier_id: null,
      matched_purchase_orders: [], matching_score: null, validation_status: null, validation_user: null, processed_at: null,
    }],
  };
  writeFileSync(join(tempDir, "supplier-invoices.json"), JSON.stringify(fixture));
  const service = new SupplierInvoiceSyncService({ dataDir: tempDir });
  service.load();
  const all = service.getStore().invoices;
  assert.equal(all.length, 1, "La prueba usa únicamente el fixture local temporal");
  assert.ok(all.every((invoice) => invoice.lines && Array.isArray(invoice.lines)), "Las lineas son necesarias para matching futuro");
  assert.ok(all.every((invoice) => invoice.source === null && invoice.ocr_status === null), "La Fase 1 no procesa OCR/IA");
  const p03881 = filterInvoices(all, { purchaseOrder: "P03881" });
  assert.ok(p03881.some((invoice) => invoice.linkedPurchaseOrderNames.includes("P03881")), "La relacion compra se basa en relacion real Odoo");
  const paid = filterInvoices(all, { paymentState: "paid" });
  assert.ok(paid.length > 0, "Filtro pago pagado");
  const kpis = computeKpis(all, { year: 2026 }).kpis;
  assert.ok(kpis.periodCount >= 0 && kpis.activeVendors >= 0, "KPIs calculados");
  const routes = readFileSync(new URL("../backend/supplierInvoices/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /supplier-invoices\/sync/);
  assert.match(routes, /supplier-invoices\/export/);
  assert.doesNotMatch(routes, /execute_kw.*create|button_confirm|write\(/);
  console.log(`Facturas proveedor: ${all.length} fixture temporal, filtros/KPIs/relaciones de compra validados en solo lectura.`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
