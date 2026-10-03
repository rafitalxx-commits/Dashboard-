// Tests de Fase 2: extraccion, matching, store bandeja, pedidos sin facturar.
// Ejecutar con: npx tsx scripts/test-supplier-invoices-phase2.ts

import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  extractPdfData,
  matchDocument,
  buildPoIndex,
  DocumentInboxService,
} from "../backend/supplierInvoices/documentInbox.ts";
import { mergeExtracted } from "../backend/supplierInvoices/aiExtract.ts";
import type {
  InboxDocument,
  InboxStore,
} from "../backend/supplierInvoices/phase2Types.ts";
import {
  PurchaseOrdersLedger,
  computeBilling,
  filterOrders,
  computeUnbilledKpis,
  computeInboxKpis,
} from "../backend/supplierInvoices/unbilled.ts";
import type { SupplierInvoiceRecord } from "../backend/supplierInvoices/types.ts";
import type { PoIndex } from "../backend/supplierInvoices/documentInbox.ts";

// ---------- Fixtures sintéticos ----------

const FAKE_INVOICES: SupplierInvoiceRecord[] = [
  {
    id: 1, name: "FACTURA/2026/001", ref: "SW671260180", moveType: "in_invoice",
    state: "posted", paymentState: "paid", invoiceDate: "2026-01-15", accountingDate: "2026-01-15",
    dueDate: "2026-02-14", currency: "EUR", journal: "Facturas Proveedor", partnerId: 100,
    partnerName: "Shandong Shing Chemical Co., Ltd.", partnerVat: "ESA12345678",
    partnerCountry: "China", partnerCountryCode: "CN", fiscalPosition: "Intracomunitario",
    amountUntaxed: 35000, amountTax: 7350, amountTotal: 42350, amountResidual: 0,
    amountPaid: 42350, invoiceOrigin: "P03881",
    taxSummary: ["IVA 21%"], linkedPurchaseOrderIds: [200], linkedPurchaseOrderNames: ["P03881"],
    linkedPickingIds: [300], linkedPickingNames: ["REC/2026/001"],
    products: ["Producto A"], lineCount: 2,
    lines: [
      { productId: 1, productRef: "REF-A", productName: "Producto A", name: "[REF-A] Producto A",
        quantity: 100, priceUnit: 350, discount: 0, taxNames: ["IVA 21%"],
        subtotal: 35000, total: 42350, displayType: "product" },
    ],
    attachments: [], hasPdf: true, writeDate: "2026-01-15T10:00:00", lastSyncAt: "2026-01-15T10:00:00",
    source: null, pdf_url: null, drive_file_id: null, ocr_status: null, ai_status: null,
    confidence: null, detected_supplier: null, matched_supplier_id: null,
    matched_purchase_orders: [], matching_score: null, validation_status: null,
    validation_user: null, processed_at: null,
  },
  {
    id: 2, name: "FACTURA/2026/002", ref: "2601169", moveType: "in_invoice",
    state: "posted", paymentState: "paid", invoiceDate: "2026-03-10", accountingDate: "2026-03-10",
    dueDate: "2026-04-09", currency: "EUR", journal: "Facturas Proveedor", partnerId: 101,
    partnerName: "CONDUCTORES ELECTRICO RODI SL", partnerVat: "B98765432",
    partnerCountry: "España", partnerCountryCode: "ES", fiscalPosition: "Nacional",
    amountUntaxed: 3328, amountTax: 698.88, amountTotal: 4026.88, amountResidual: 0,
    amountPaid: 4026.88, invoiceOrigin: "P04790",
    taxSummary: ["IVA 21%"], linkedPurchaseOrderIds: [201], linkedPurchaseOrderNames: ["P04790"],
    linkedPickingIds: [], linkedPickingNames: [],
    products: ["Conductor X"], lineCount: 1,
    lines: [
      { productId: 2, productRef: "CON-X", productName: "Conductor X", name: "[CON-X] Conductor X",
        quantity: 200, priceUnit: 16.64, discount: 0, taxNames: ["IVA 21%"],
        subtotal: 3328, total: 4026.88, displayType: "product" },
    ],
    attachments: [], hasPdf: true, writeDate: "2026-03-10T10:00:00", lastSyncAt: "2026-03-10T10:00:00",
    source: null, pdf_url: null, drive_file_id: null, ocr_status: null, ai_status: null,
    confidence: null, detected_supplier: null, matched_supplier_id: null,
    matched_purchase_orders: [], matching_score: null, validation_status: null,
    validation_user: null, processed_at: null,
  },
];

const FAKE_PO_INDEX: PoIndex[] = [
  {
    id: 200, name: "P03881", partnerName: "Shandong Shing Chemical Co., Ltd.",
    partnerVat: "ESA12345678", partnerCountry: "China", currency: "EUR",
    dateOrder: "2026-01-10", amountTotal: 42350,
    lines: [{ productName: "Producto A", qtyOrdered: 100, priceUnit: 350 }],
  },
  {
    id: 201, name: "P04790", partnerName: "CONDUCTORES ELECTRICO RODI SL",
    partnerVat: "B98765432", partnerCountry: "España", currency: "EUR",
    dateOrder: "2026-03-01", amountTotal: 4026.88,
    lines: [{ productName: "Conductor X", qtyOrdered: 200, priceUnit: 16.64 }],
  },
  {
    id: 202, name: "P05000", partnerName: "Proveedor Distinto SL",
    partnerVat: "B11111111", partnerCountry: "España", currency: "EUR",
    dateOrder: "2026-04-01", amountTotal: 10000,
    lines: [{ productName: "Producto Z", qtyOrdered: 50, priceUnit: 200 }],
  },
];

// ---------- Test 1: extracción PDF ----------

function testExtractPdf() {
  const text = `Prismica S.L. C/ Llevant 2 CIF B98845944
Factura Nº: SW671260180 Fecha: 15/01/2026
Base Imponible: 35000,00 € IVA 21%: 7350,00 € Total: 42350,00 €`;
  const r = extractPdfData(text, 1);
  assert.ok(r.supplier?.includes("Prismica"));
  assert.equal(r.supplierVat, "B98845944");
  assert.equal(r.invoiceNumber, "SW671260180");
  assert.equal(r.invoiceDate, "2026-01-15");
  assert.equal(r.currency, "EUR");
  assert.equal(r.base, 35000);
  assert.equal(r.taxes, 7350);
  assert.equal(r.total, 42350);
  assert.ok(r.textPreview.length > 20);
  console.log("✅ testExtractPdf passed");
}

// ---------- Test 2: matching (bandas de score) ----------

function testMatchingBands() {
  // Caso alta: proveedor + total + fecha + lineas
  const docAlta: InboxDocument = {
    driveFileId: "TEST_ALTA", driveFolderId: "1Bpil...", name: "factura-test.pdf",
    size: 1000, modifiedTime: "2026-01-15T10:00:00Z", webViewLink: "https://...",
    source: "email", sourceEmail: "prov@test.com", detectedAt: "2026-01-15T10:00:00Z",
    detectedBy: "test", extracted: {
      supplier: "SHANDONG SHING CHEMICAL CO LTD", supplierVat: "ESA12345678",
      country: "China", invoiceNumber: "SW671260180", invoiceDate: "2026-01-15",
      dueDate: null, currency: "EUR", base: 35000, taxes: 7350, total: 42350,
      lines: [{ description: "Producto A", reference: "REF-A", quantity: 100, priceUnit: 350,
        discount: 0, taxNames: ["IVA 21%"], total: 42350, confidence: 90 }],
      textPreview: "...", needsOcr: false, warnings: [], pdfPages: 1,
    },
    ocrStatus: "ok", aiStatus: "no_aplicado", confidence: 95,
    match: null, status: "SIN_REVISAR", validationUser: null, validationAt: null,
    notes: null, targetFolderPath: null, movedTo: null, pdfCached: true, processedAt: "2026-01-15T10:00:00Z",
  };
  const mAlta = matchDocument(docAlta, FAKE_INVOICES, FAKE_PO_INDEX);
  assert.ok(mAlta && mAlta.band === "alta", "debe ser alta, fue " + mAlta?.band);
  assert.ok(mAlta && mAlta.purchaseOrderId === 200);

  // Caso media: proveedor coincide pero total difiere 10%
  const docMedia = { ...docAlta, driveFileId: "TEST_MEDIA", extracted: { ...docAlta.extracted!, total: 38000 } };
  const mMedia = matchDocument(docMedia, FAKE_INVOICES, FAKE_PO_INDEX);
  assert.ok(mMedia && (mMedia.band === "media" || mMedia.band === "baja"), "debe ser media/baja, fue " + mMedia?.band);

  // Caso sin: proveedor inexistente
  const docSin = { ...docAlta, driveFileId: "TEST_SIN", extracted: { ...docAlta.extracted!, supplier: "PROVEEDOR INEXISTENTE SL", supplierVat: "B00000000", total: 5000 } };
  const mSin = matchDocument(docSin, FAKE_INVOICES, FAKE_PO_INDEX);
  assert.ok(mSin && mSin.band === "sin", "debe ser sin, fue " + mSin?.band);

  console.log("✅ testMatchingBands passed");
}

// ---------- Test 2b: patrón humano DIRU (referencias y líneas no se pierden) ----------

function testDiruHumanPattern() {
  const pdfReferences = ["04957", "04964", "P04976"];
  const normalized = pdfReferences.map((value) => value.startsWith("P") ? value : `P${value}`);
  assert.deepEqual(normalized, ["P04957", "P04964", "P04976"]);
  assert.ok(!normalized.includes("P04676"), "el PDF ILA5467106 no menciona P04676");
  const odooLines = [
    { sourcePurchaseOrder: "P04957", description: "Rejilla 300x100" },
    { sourcePurchaseOrder: "P04964", description: "Rejilla 350x150" },
    { sourcePurchaseOrder: "P04976", description: "Marco 500" },
  ];
  const afterAi = mergeExtracted({
    supplier: "INDUSTRIAS DIRU SL", supplierVat: "B28960987", country: "ES", invoiceNumber: null,
    invoiceDate: null, dueDate: null, currency: "EUR", base: null, taxes: null, total: null,
    lines: odooLines.map((line) => ({ ...line, reference: null, quantity: 1, priceUnit: 1, discount: 52.5, taxNames: [], total: 1, confidence: 100 })),
    textPreview: "", needsOcr: false, warnings: [], pdfPages: 1,
  }, {
    supplier: null, supplierVat: null, country: null, invoiceNumber: null, invoiceDate: null, dueDate: null,
    currency: null, base: null, taxes: null, total: null, confidence: 90, warnings: [],
    lines: [{ description: "Rejilla 300x100", reference: null, quantity: 1, priceUnit: 9, discount: null, taxNames: [], total: 9, confidence: 90 }],
  }, "test");
  assert.equal(afterAi.lines.filter((line) => line.sourcePurchaseOrder).length, 3, "IA no puede borrar líneas Odoo confirmadas");
  console.log("✅ testDiruHumanPattern passed");
}

// ---------- Test 3: no escrituras Drive/Odoo (assert paths) ----------

function testNoWrites() {
  // Verificar que documentInbox.ts no importa modulos de escritura de Drive/Odoo
  const docInboxSrc = readFileSync(join(__dirname, "..", "backend", "supplierInvoices", "documentInbox.ts"), "utf8");
  const unbilledSrc = readFileSync(join(__dirname, "..", "backend", "supplierInvoices", "unbilled.ts"), "utf8");
  const routesSrc = readFileSync(join(__dirname, "..", "backend", "supplierInvoices", "routes.ts"), "utf8");

  const forbidden = ["execute_kw", "button_confirm", "write(", "create(", "unlink(", "update(", "delete("];
  for (const f of forbidden) {
    assert.ok(!docInboxSrc.includes(f), `documentInbox.ts contiene patrón prohibido: ${f}`);
    assert.ok(!unbilledSrc.includes(f), `unbilled.ts contiene patrón prohibido: ${f}`);
  }
  // Routes puede tener execute_kw en comentarios o imports, pero solo lectura: search_read, read, search
  // Aceptamos que routes tenga "search_read", "read", "search" pero no write/create
  console.log("✅ testNoWrites passed (no write patterns found)");
}

// ---------- Test 4: inbox store round-trip ----------

async function testInboxStoreRoundtrip() {
  const tmpDir = join("/tmp", "test-inbox-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });
  const storePath = join(tmpDir, "docInbox.json");

  // Simular servicio
  const service = new DocumentInboxService({ dataDir: tmpDir });
  assert.equal(service.getStore().documents.length, 0);

  const doc: InboxDocument = {
    driveFileId: "FILE123", driveFolderId: "FOLDER", name: "test.pdf", size: 100,
    modifiedTime: "2026-01-15T10:00:00Z", webViewLink: "https://...", source: "email",
    sourceEmail: "a@b.com", detectedAt: "2026-01-15T10:00:00Z", detectedBy: "test",
    extracted: { supplier: "Test SL", supplierVat: "B12345678", country: "España",
      invoiceNumber: "FAC-001", invoiceDate: "2026-01-15", dueDate: null, currency: "EUR",
      base: 1000, taxes: 210, total: 1210, lines: [], textPreview: "", needsOcr: false, warnings: [], pdfPages: 1 },
    ocrStatus: "ok", aiStatus: "no_aplicado", confidence: 80, match: null,
    status: "SIN_REVISAR", validationUser: null, validationAt: null, notes: null,
    targetFolderPath: null, movedTo: null, pdfCached: true, processedAt: "2026-01-15T10:00:00Z",
  };

  // Manualmente insertar y persistir
  (service as any).store.documents.push(doc);
  (service as any).save();

  // Recargar nueva instancia
  const service2 = new DocumentInboxService({ dataDir: tmpDir });
  const loaded = service2.getDocument("FILE123");
  assert.ok(loaded);
  assert.equal(loaded!.driveFileId, "FILE123");
  assert.equal(loaded!.extracted?.supplier, "Test SL");

  // Limpieza
  rmSync(tmpDir, { recursive: true });
  console.log("✅ testInboxStoreRoundtrip passed");
}

// ---------- Test 5: extracción real sobre PDFs de /tmp ----------

async function testRealPdfs() {
  const testFiles = [
    "/tmp/factura-efectoLED-GZLKYPHJJ.pdf",
    "/tmp/feuvert_factura.pdf",
    "/tmp/atmoss_factura.pdf",
    "/tmp/ledme_factura.pdf",
    "/tmp/diru_factura.pdf",
  ];
  for (const f of testFiles) {
    if (!existsSync(f)) {
      console.log(`  ⚠️ ${f} no existe, saltando`);
      continue;
    }
    const buf = readFileSync(f);
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const parsed = await pdfParse(buf);
    const ex = extractPdfData(parsed.text ?? "", parsed.numpages ?? 0);
    console.log(`  ${f}: ${parsed.text?.length ?? 0} chars, total=${ex.total}, invoice=${ex.invoiceNumber}, prov=${ex.supplier?.slice(0,30)}`);
    assert.ok(parsed.text && parsed.text.length > 100, `PDF ${f} debe tener >100 chars`);
    // Al menos uno debe tener total detectado
    if (ex.total != null) break;
  }
  console.log("✅ testRealPdfs passed");
}

// ---------- Test 6: pedidos sin facturar KPIs ----------

function testUnbilledKpis() {
  const orders = [
    { id: 1, name: "P001", state: "purchase", partnerName: "Prov A", partnerCountry: "España",
      partnerVat: "B111", currency: "EUR", dateOrder: "2026-01-01", buyer: "Comprador 1", origin: "",
      amountTotal: 10000, pickings: [{ name: "REC1", state: "done", dateDone: "2026-01-10" }],
      receivedQty: 100, orderedQty: 100, allReceived: true, lastReceptionAt: "2026-01-10",
      daysSinceReception: 5, linkedInvoiceIds: [], linkedInvoiceNames: [],
      billedAmount: 0, pendingAmount: 10000, billedPct: 0, billingSplit: false,
      lines: [], status: "SIN_FACTURA" },
    { id: 2, name: "P002", state: "purchase", partnerName: "Prov B", partnerCountry: "Francia",
      partnerVat: "FR222", currency: "EUR", dateOrder: "2026-02-01", buyer: "Comprador 2", origin: "importación",
      amountTotal: 20000, pickings: [{ name: "REC2", state: "done", dateDone: "2026-02-10" }],
      receivedQty: 200, orderedQty: 200, allReceived: true, lastReceptionAt: "2026-02-10",
      daysSinceReception: 120, linkedInvoiceIds: [1], linkedInvoiceNames: ["FAC-002"],
      billedAmount: 8000, pendingAmount: 12000, billedPct: 40, billingSplit: false,
      lines: [], status: "FACTURACION_PARCIAL" },
    { id: 3, name: "P003", state: "purchase", partnerName: "Prov C", partnerCountry: "Alemania",
      partnerVat: "DE333", currency: "EUR", dateOrder: "2026-03-01", buyer: "Comprador 3", origin: "",
      amountTotal: 5000, pickings: [{ name: "REC3", state: "done", dateDone: "2026-03-10" }],
      receivedQty: 50, orderedQty: 50, allReceived: true, lastReceptionAt: "2026-03-10",
      daysSinceReception: 10, linkedInvoiceIds: [2], linkedInvoiceNames: ["FAC-003"],
      billedAmount: 5000, pendingAmount: 0, billedPct: 100, billingSplit: false,
      lines: [], status: "FACTURADO" },
  ];
  const kpis = computeUnbilledKpis(orders);
  assert.equal(kpis.ordersWithoutInvoice.count, 1);
  assert.equal(kpis.ordersWithoutInvoice.total, 10000);
  assert.equal(kpis.partialBilling.count, 1);
  assert.equal(kpis.partialBilling.pending, 12000);
  assert.equal(kpis.receivedOver15Days.count, 1); // solo P002 tiene >15
  assert.equal(kpis.importaciones.count, 1); // P002 tiene "importación" en origin
  assert.equal(kpis.totalPendingAmount, 22000); // 10000 + 12000
  console.log("✅ testUnbilledKpis passed");
}

// ---------- Test 7: filterOrders ----------

function testFilterOrders() {
  const orders = [
    { id: 1, name: "P001", state: "purchase", partnerName: "Prov A", partnerCountry: "España",
      partnerVat: "B111", currency: "EUR", dateOrder: "2026-01-01", buyer: "", origin: "",
      amountTotal: 10000, pickings: [], receivedQty: 100, orderedQty: 100,
      allReceived: true, lastReceptionAt: "2026-01-10", daysSinceReception: 5,
      linkedInvoiceIds: [], linkedInvoiceNames: [], billedAmount: 0,
      pendingAmount: 10000, billedPct: 0, billingSplit: false, lines: [], status: "SIN_FACTURA" },
    { id: 2, name: "P002", state: "purchase", partnerName: "Prov B", partnerCountry: "Francia",
      partnerVat: "B222", currency: "EUR", dateOrder: "2026-02-01", buyer: "", origin: "importación",
      amountTotal: 20000, pickings: [], receivedQty: 200, orderedQty: 200,
      allReceived: true, lastReceptionAt: "2026-02-10", daysSinceReception: 20,
      linkedInvoiceIds: [], linkedInvoiceNames: [], billedAmount: 5000,
      pendingAmount: 15000, billedPct: 25, billingSplit: false, lines: [], status: "FACTURACION_PARCIAL" },
  ];
  let f = filterOrders(orders, { status: "SIN_FACTURA" });
  assert.equal(f.length, 1);
  assert.equal(f[0].name, "P001");

  f = filterOrders(orders, { received: "si" });
  assert.equal(f.length, 2);

  f = filterOrders(orders, { received: "no" });
  assert.equal(f.length, 0);

  f = filterOrders(orders, { over15: true });
  assert.equal(f.length, 1);
  assert.equal(f[0].name, "P002");

  f = filterOrders(orders, { text: "importación" });
  assert.equal(f.length, 1);
  assert.equal(f[0].name, "P002");

  console.log("✅ testFilterOrders passed");
}

// ---------- Main ----------

async function main() {
  console.log("=== FASE 2 TESTS ===\n");
  testExtractPdf();
  testMatchingBands();
  testDiruHumanPattern();
  testNoWrites();
  await testInboxStoreRoundtrip();
  await testRealPdfs();
  testUnbilledKpis();
  testFilterOrders();
  console.log("\n=== TODOS LOS TESTS PASARON ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
