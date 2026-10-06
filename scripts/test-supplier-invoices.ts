import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SupplierInvoiceSyncService, computeKpis, filterInvoices } from "../backend/supplierInvoices/service.ts";
import type { SupplierInvoiceRecord } from "../backend/supplierInvoices/types.ts";

const dataDir = mkdtempSync(join(tmpdir(), "supplier-invoices-phase1-"));
try {
  const service = new SupplierInvoiceSyncService({ dataDir });
  const invoice: SupplierInvoiceRecord = {
    id: 900001, name: "TEST/2026/001", ref: "TEST-INV-001", moveType: "in_invoice",
    state: "posted", paymentState: "paid", invoiceDate: "2026-01-15", accountingDate: "2026-01-15",
    dueDate: "2026-02-14", currency: "EUR", journal: "Test Journal", partnerId: 900002,
    partnerName: "Synthetic Supplier SL", partnerVat: "B12345678", partnerCountry: "España",
    partnerCountryCode: "ES", fiscalPosition: "Nacional", amountUntaxed: 100, amountTax: 21,
    amountTotal: 121, amountResidual: 0, amountPaid: 121, invoiceOrigin: "P00001",
    taxSummary: ["IVA 21%"], linkedPurchaseOrderIds: [900003], linkedPurchaseOrderNames: ["P00001"],
    linkedPickingIds: [], linkedPickingNames: [], products: ["Synthetic Product"], lineCount: 1,
    lines: [{ productId: 900004, productRef: "TEST-REF", productName: "Synthetic Product",
      name: "[TEST-REF] Synthetic Product", quantity: 1, priceUnit: 100, discount: 0,
      taxNames: ["IVA 21%"], subtotal: 100, total: 121, displayType: "product" }],
    attachments: [], hasPdf: false, writeDate: "2026-01-15T10:00:00Z", lastSyncAt: "2026-01-15T10:00:00Z",
    source: null, pdf_url: null, drive_file_id: null, ocr_status: null, ai_status: null,
    confidence: null, detected_supplier: null, matched_supplier_id: null, matched_purchase_orders: [],
    matching_score: null, validation_status: null, validation_user: null, processed_at: null,
  };
  service.getStore().invoices.push(invoice);
  service.save();

  const loaded = new SupplierInvoiceSyncService({ dataDir });
  const all = loaded.getStore().invoices;
  assert.equal(all.length, 1, "el servicio carga el fixture sintético persistido");
  assert.ok(all.every((item) => item.lines && Array.isArray(item.lines)), "las líneas están disponibles para matching");
  assert.ok(all.every((item) => item.source === null && item.ocr_status === null), "la Fase 1 no procesa OCR/IA");
  const linked = filterInvoices(all, { purchaseOrder: "P00001" });
  assert.ok(linked.some((item) => item.linkedPurchaseOrderNames.includes("P00001")), "el filtro usa relación de compra explícita");
  assert.equal(filterInvoices(all, { paymentState: "paid" }).length, 1, "filtro por estado de pago");
  const kpis = computeKpis(all, { year: 2026 }).kpis;
  assert.equal(kpis.periodCount, 1);
  assert.equal(kpis.activeVendors, 1);

  const routes = readFileSync(new URL("../backend/supplierInvoices/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /supplier-invoices\/sync/);
  assert.match(routes, /supplier-invoices\/export/);
  assert.doesNotMatch(routes, /execute_kw.*create|button_confirm|write\(/);
  console.log("supplier-invoices phase 1: fixture sintético, filtros, KPIs y rutas de solo lectura OK");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
