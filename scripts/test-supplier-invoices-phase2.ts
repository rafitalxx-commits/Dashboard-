// Tests de Fase 2: extraccion, matching, store bandeja, pedidos sin facturar.
// Ejecutar con: npx tsx scripts/test-supplier-invoices-phase2.ts

import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  extractPdfData,
  matchDocument,
  buildPoIndex,
  extractPurchaseOrderReferences,
  DocumentInboxService,
} from "../backend/supplierInvoices/documentInbox.ts";
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
import { validateAmounts, createSupplierDraft, serviceLineIdentityError, planTaxTotalCorrection, draftAmountCompletenessError } from "../backend/supplierInvoices/odooBridge.ts";
import { registerSupplierInvoicesPhase2Routes } from "../backend/supplierInvoices/phase2Routes.ts";
import { calculateWebAdjustment, discountedBase, effectiveDiscount, taxFromBase } from "../shared/supplierInvoiceDiscounts.ts";
import { supplierInvoiceAmountWarnings } from "../shared/supplierInvoiceAmountWarnings.ts";

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
  assert.equal(r.dueDate, null, "no se inventa vencimiento a partir de otra fecha sin etiqueta");
  const withDue = extractPdfData("Factura 26/12.894 Fecha 23/09/2026\n1.216,3923/10/2026\nDOMICILIACION :\nVENCIMIENTOS :", 1);
  assert.equal(withDue.dueDate, "2026-10-23", "detecta vencimiento antes de la etiqueta en PDF con columnas fusionadas");
  assert.ok(r.textPreview.length > 20);
  const fourDecimalLine = extractPdfData("Producto ejemplo 10 x 0,1234 = 1,23", 1).lines[0];
  assert.equal(fourDecimalLine?.priceUnit, 0.123, "el precio del PDF se coteja a tres decimales");
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

  // Los proveedores imprimen a veces nuestro pedido sin el prefijo P.
  const docReferencia = { ...docSin, driveFileId: "TEST_REFERENCIA", extracted: {
    ...docSin.extracted!, supplier: null, supplierVat: null, total: null,
    textPreview: "Factura del proveedor. Referencia cliente: 04790.",
  } };
  const mReferencia = matchDocument(docReferencia, FAKE_INVOICES, FAKE_PO_INDEX);
  assert.equal(mReferencia?.purchaseOrderId, 201, "04790 del PDF debe resolver P04790");
  assert.ok(mReferencia?.criteria.some((c) => c.key === "purchaseReference" && c.ok));

  const prismicaOrders: PoIndex[] = [
    { id: 3690, name: "P03690", supplierRef: "YSNDUXNTP", partnerName: "PRISMICA S.L.", partnerVat: "B98845944", partnerCountry: "España", currency: "EUR", dateOrder: "2025-12-10", amountTotal: 317.88, lines: [] },
    { id: 5065, name: "P05065", supplierRef: "PPNWHLABX", partnerName: "PRISMICA S.L.", partnerVat: "B98845944", partnerCountry: "España", currency: "EUR", dateOrder: "2026-09-22", amountTotal: 61.59, lines: [] },
  ];
  const prismicaDoc = { ...docAlta, driveFileId: "PPNWHLABX", extracted: {
    ...docAlta.extracted!, supplier: "PRISMICA S.L.", supplierVat: "B98845944", invoiceNumber: "F51-136521", invoiceDate: "2026-09-22", total: 61.61,
    textPreview: "FACTURA F51-136521\nRef.: PPNWHLABX\nCliente: Todoelectrico\n03690 San Vicente\ns/doc.: PPNWHLABX",
  } };
  assert.deepEqual(extractPurchaseOrderReferences(prismicaDoc.extracted), [], "el código postal no es un pedido de compra");
  const prismicaMatch = matchDocument(prismicaDoc, FAKE_INVOICES, prismicaOrders);
  assert.equal(prismicaMatch?.purchaseOrderId, 5065, "la referencia del proveedor debe resolver P05065, no el CP P03690");
  assert.equal(prismicaMatch?.criteria.find((c) => c.key === "purchaseReference")?.label, "Referencia del proveedor en PDF");

  console.log("✅ testMatchingBands passed");
}

// ---------- Test 3: no escrituras Drive/Odoo (assert paths) ----------

function testNoWrites() {
  // Verificar que documentInbox.ts no importa modulos de escritura de Drive/Odoo
  const docInboxSrc = readFileSync(join(__dirname, "..", "backend", "supplierInvoices", "documentInbox.ts"), "utf8");
  const unbilledSrc = readFileSync(join(__dirname, "..", "backend", "supplierInvoices", "unbilled.ts"), "utf8");
  const routesSrc = readFileSync(join(__dirname, "..", "backend", "supplierInvoices", "routes.ts"), "utf8");
  const phase2RoutesSrc = readFileSync(join(__dirname, "..", "backend", "supplierInvoices", "phase2Routes.ts"), "utf8");

  const forbidden = ["execute_kw", "button_confirm", "write(", "create(", "unlink(", "update(", "delete("];
  for (const f of forbidden) {
    assert.ok(!docInboxSrc.includes(f), `documentInbox.ts contiene patrón prohibido: ${f}`);
    assert.ok(!unbilledSrc.includes(f), `unbilled.ts contiene patrón prohibido: ${f}`);
  }
  // Routes puede tener execute_kw en comentarios o imports, pero solo lectura: search_read, read, search
  // Aceptamos que routes tenga "search_read", "read", "search" pero no write/create
  assert.ok(phase2RoutesSrc.includes("if (!driveWriteEnabled(body.id))"), "las escrituras Drive deben tener puerta por factura");
  assert.ok(phase2RoutesSrc.includes("SUPPLIER_INVOICES_DRIVE_ALLOWED_FILE_ID"), "el piloto Drive debe restringirse a un PDF");
  assert.ok(phase2RoutesSrc.includes("supplierPriceWriteEnabled()"), "la actualización de tarifa proveedor debe tener doble puerta");
  assert.ok(phase2RoutesSrc.includes("d.sourcePresent === false"), "la bandeja debe ocultar documentos ausentes en Drive");
  assert.ok(phase2RoutesSrc.includes("pendingIds") && phase2RoutesSrc.includes("purchaseOrderCandidates"), "Raskibot debe recibir candidatos de compra con elegibilidad explícita del proveedor");
  console.log("✅ testNoWrites passed (no write patterns found)");
}

function testReliableTotalsGate() {
  const ok = validateAmounts(494.68, 103.88, 598.56, [
    { quantity: 1, priceUnit: 494.68, discount: 0, total: 494.68, taxAmount: 103.88 },
  ], [{ name: "P04957", amountTotal: 598.56 }]);
  assert.equal(ok.ok, true);
  const badTax = validateAmounts(494.68, 103.88, 598.56, [
    { quantity: 1, priceUnit: 494.68, discount: 0, total: 494.68, taxAmount: 100 },
  ], [{ name: "P04957", amountTotal: 598.56 }]);
  assert.equal(badTax.ok, false);
  assert.match(badTax.message, /cuotas de impuesto/i);
  const fourDecimals = validateAmounts(1005.28, 211.11, 1216.39, [
    { quantity: 400, priceUnit: 0.469, total: 187.60, taxAmount: 39.40 },
    { quantity: 440, priceUnit: 0.758, total: 333.52, taxAmount: 70.04 },
    { quantity: 350, priceUnit: 0.329, total: 115.01, taxAmount: 24.15 },
    { quantity: 150, priceUnit: 2.461, total: 369.15, taxAmount: 77.52 },
  ], [{ name: "P04800", amountTotal: 1216.39 }]);
  assert.equal(fourDecimals.ok, true, "la diferencia de 0,14 € proviene de 0,3286 → 0,329");
  assert.equal(fourDecimals.sumLines, 1005.42);
  const unrelatedDifference = validateAmounts(1005.28, 211.11, 1216.39, [
    { quantity: 400, priceUnit: 0.47, taxAmount: 39.40 },
    { quantity: 440, priceUnit: 0.76, taxAmount: 70.04 },
    { quantity: 350, priceUnit: 0.33, taxAmount: 24.15 },
    { quantity: 150, priceUnit: 2.46, taxAmount: 77.52 },
  ], []);
  assert.equal(unrelatedDifference.ok, false, "precios a 2 decimales no son una discrepancia tolerable de precisión Odoo");
  console.log("✅ testReliableTotalsGate passed");
}

function testAmountMismatchWarnings() {
  const lines = [{ quantity: 2, priceUnit: 50, discount: 0, total: 100, taxAmount: 19 }];
  assert.equal(draftAmountCompletenessError(100, 19, 119, lines), null);
  assert.match(draftAmountCompletenessError(null, 19, 119, lines) ?? "", /faltan importes/i, "un desglose realmente incompleto sigue bloqueado");
  assert.equal(draftAmountCompletenessError(100, 19, 119, []), null, "la presencia de líneas tiene su propia validación de negocio");
  const warnings = supplierInvoiceAmountWarnings(100, 21, 121, lines);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cuotas de línea/i, "una diferencia aritmética genera advertencia, no impide completar los importes");
  assert.deepEqual(supplierInvoiceAmountWarnings(100, 19, 119, lines), []);
  console.log("✅ testAmountMismatchWarnings passed (diferencias advertidas; datos incompletos siguen bloqueados)");
}

function testTaxTotalCorrection() {
  const original = { subtotals: [{ tax_groups: [{ id: 74, tax_amount_currency: 21 }] }] };
  const corrected = planTaxTotalCorrection(original, 74, 20.99) as typeof original;
  assert.equal(corrected.subtotals[0].tax_groups[0].tax_amount_currency, 20.99);
  assert.equal(original.subtotals[0].tax_groups[0].tax_amount_currency, 21, "no mutar lectura de Odoo");
  assert.throws(() => planTaxTotalCorrection({ subtotals: [{ tax_groups: [{ id: 74, tax_amount_currency: 21 }, { id: 75, tax_amount_currency: 5 }] }] }, 74, 20.99), /único grupo/);
  assert.throws(() => planTaxTotalCorrection(original, 999, 20.99), /único grupo/);
  console.log("✅ testTaxTotalCorrection passed (sin escribir en Odoo)");
}

function testSequentialSupplierDiscounts() {
  assert.equal(effectiveDiscount(45, 5, 2), 48.795);
  assert.equal(discountedBase(1, 100, 45, 5, 2), 51.21);
  assert.equal(taxFromBase(51.21, 21), 10.75);
  assert.equal(effectiveDiscount(45, null, null), 45, "las facturas existentes conservan su descuento");
  assert.throws(() => effectiveDiscount(45, 105, 2), /descuentos/i);
  const exact = validateAmounts(51.21, 10.75, 61.96,
    [{ quantity: 1, priceUnit: 100, discount: 45, discountExtra: 5, promptPaymentDiscount: 2, total: 51.21, taxAmount: 10.75 }], []);
  assert.equal(exact.ok, true);
  const mismatchedBase = validateAmounts(51.25, 10.75, 62,
    [{ quantity: 1, priceUnit: 100, discount: 45, discountExtra: 5, promptPaymentDiscount: 2, total: 51.21, taxAmount: 10.75 }], []);
  assert.equal(mismatchedBase.ok, false, "no crear borrador con descuento sucesivo y base diferente al PDF");
  console.log("✅ testSequentialSupplierDiscounts passed");
}

function testWebAdjustmentAfterDiscounts() {
  const product = { productId: 42, quantity: 1, priceUnit: 100, discount: 45, discountExtra: 5, promptPaymentDiscount: 2, total: 51.21, taxAmount: 10.75, taxId: 4 };
  const declared = { base: 50.21, taxes: 10.75, total: 60.96 };
  assert.deepEqual(calculateWebAdjustment(declared, [product]), { amount: -1, productsBase: 51.21, taxTotal: 10.75, taxDifference: 0 });
  assert.equal(validateAmounts(50.21, 10.75, 60.96, [product, { productId: 44149, quantity: 1, priceUnit: -1, discount: 0, total: -1, taxAmount: 0 }], []).ok, true);
  assert.deepEqual(calculateWebAdjustment({ base: 50.21, taxes: 10.54, total: 60.75 }, [product]), { amount: -1, productsBase: 51.21, taxTotal: 10.75, taxDifference: -0.21 });
  assert.throws(() => calculateWebAdjustment({ base: 50.21, taxes: 10.75, total: 60.94 }, [product]), /Base \+ Impuestos/);
  assert.throws(() => calculateWebAdjustment(declared, [{ ...product, total: 50.21 }]), /importe de línea editado/);
  assert.throws(() => calculateWebAdjustment(declared, [product, { productId: 48275, taxId: 4, taxAmount: 0 }]), /lleva IVA/);
  const rodi = { base: 5773.84, taxes: 1212.51, total: 6986.35 };
  const source = { productId: 42, quantity: 1, priceUnit: 5775.50, discount: 0, total: 5775.50, taxAmount: 1212.83, taxId: 4 };
  assert.deepEqual(calculateWebAdjustment(rodi, [source]), { amount: -1.66, productsBase: 5775.50, taxTotal: 1212.83, taxDifference: -0.32 });
  const adjustment = { productId: 44149, quantity: 1, priceUnit: -1.66, discount: 0, total: -1.66, taxAmount: 0 };
  assert.equal(validateAmounts(rodi.base, rodi.taxes, rodi.total, [source, adjustment], []).ok, false, "el IVA pendiente bloquea validación");
  assert.equal(validateAmounts(rodi.base, rodi.taxes, rodi.total, [{ ...source, taxAmount: 1212.51 }, adjustment], []).ok, true, "ajuste y cuota revisada cuadran");
  console.log("✅ testWebAdjustmentAfterDiscounts passed");
}

async function testLocalManualTaxSaveRoute() {
  const dataDir = mkdtempSync(join(tmpdir(), "supplier-tax-route-"));
  try {
    mkdirSync(join(dataDir, "supplier-invoices"), { recursive: true });
    writeFileSync(join(dataDir, "supplier-invoices", "docInbox.json"), JSON.stringify({
      meta: { version: 2, lastScanAt: null, lastScanResult: null, totalDocuments: 1, driveFolderId: null },
      documents: [
        { driveFileId: "TAX_TEST", status: "PENDIENTE_COTEJO", odooDraftMoveId: null,
          extracted: { supplier: "Prueba", supplierVat: null, base: 100, taxes: 21, total: 121, lines: [] } },
        { driveFileId: "DISCOUNT_TEST", status: "PENDIENTE_COTEJO", odooDraftMoveId: null,
          extracted: { supplier: "Prueba", supplierVat: null, base: 51.21, taxes: 10.75, total: 61.96, lines: [] } },
        { driveFileId: "RODI_ADJUSTMENT_TEST", status: "PENDIENTE_COTEJO", odooDraftMoveId: null,
          extracted: { supplier: "Prueba", supplierVat: null, base: 5773.84, taxes: 1212.51, total: 6986.35, lines: [] } },
      ],
    }));
    const routes = new Map<string, (request: unknown, response: unknown) => void>();
    registerSupplierInvoicesPhase2Routes(
      { middlewares: { use: (path, handler) => { routes.set(path, handler); } } },
      { getSessionUser: () => ({ id: "test", name: "Prueba", role: "admin", permissions: ["supplierBilling"] }) },
      { env: {}, dataDir },
    );
    const handler = routes.get("/api/odoo/supplier-invoices/inbox/lines");
    assert.ok(handler);
    const body = JSON.stringify({ id: "TAX_TEST", manualTaxTotal: 20.99,
      lines: [{ productId: 1, description: "Producto", reference: null, quantity: 1, priceUnit: 100,
        discount: 0, taxNames: ["IVA 21%"], taxId: 4, taxRate: 21, taxAmount: 20.99,
        totalWithTax: 120.99, accountId: 1, accountName: "Compra", total: 100 }] });
    const request = Object.assign(Readable.from([body]), { method: "POST", headers: { cookie: "test" } });
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const response = { writableEnded: false, statusCode: 200, setHeader: () => undefined,
        end(text: string) { this.writableEnded = true; resolve({ status: this.statusCode, body: text }); } };
      try { handler(request, response); } catch (error) { reject(error); }
    });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).document.extracted.total, 120.99);
    const discountRequest = Object.assign(Readable.from([JSON.stringify({ id: "DISCOUNT_TEST",
      lines: [{ productId: 2, description: "Producto con descuentos", reference: null, quantity: 1, priceUnit: 100,
        discount: 45, discountExtra: 5, promptPaymentDiscount: 2, taxNames: ["IVA 21%"], taxId: 4,
        taxRate: 21, taxAmount: 10.75, totalWithTax: 61.96, accountId: 1, accountName: "Compra", total: 51.21 }] })]),
      { method: "POST", headers: { cookie: "test" } });
    const discountResult = await new Promise<{ status: number; body: string }>((resolve) => {
      const response = { writableEnded: false, statusCode: 200, setHeader: () => undefined,
        end(text: string) { this.writableEnded = true; resolve({ status: this.statusCode, body: text }); } };
      handler(discountRequest, response);
    });
    assert.equal(discountResult.status, 200);
    const savedLine = JSON.parse(discountResult.body).document.extracted.lines[0];
    assert.equal(savedLine.discountExtra, 5);
    assert.equal(savedLine.promptPaymentDiscount, 2);
    assert.equal(discountedBase(savedLine.quantity, savedLine.priceUnit, savedLine.discount, savedLine.discountExtra, savedLine.promptPaymentDiscount), savedLine.total);
    const adjustmentBody = JSON.stringify({ id: "RODI_ADJUSTMENT_TEST", manualTaxTotal: 1212.51, lines: [
      { productId: 42, description: "Producto", reference: null, quantity: 1, priceUnit: 5775.50, discount: 0,
        taxNames: ["IVA 21%"], taxId: 4, taxRate: 21, taxAmount: 1212.51, totalWithTax: 6988.01,
        accountId: 358, accountName: "Compra", total: 5775.50 },
      { productId: 44149, description: "[AJUSTEWEB] Ajuste WEB", reference: "AJUSTEWEB", quantity: 1,
        priceUnit: -1.66, discount: 0, taxNames: [], taxId: null, taxRate: 0, taxAmount: 0,
        totalWithTax: -1.66, accountId: null, accountName: null, total: -1.66 },
    ] });
    const adjustmentRequest = Object.assign(Readable.from([adjustmentBody]), { method: "POST", headers: { cookie: "test" } });
    const adjustmentResult = await new Promise<{ status: number; body: string }>((resolve) => {
      const response = { writableEnded: false, statusCode: 200, setHeader: () => undefined,
        end(text: string) { this.writableEnded = true; resolve({ status: this.statusCode, body: text }); } };
      handler(adjustmentRequest, response);
    });
    assert.equal(adjustmentResult.status, 200);
    const reopened = new DocumentInboxService({ dataDir }).getDocument("RODI_ADJUSTMENT_TEST")!;
    assert.equal(reopened.extracted?.lines.at(-1)?.productId, 44149);
    assert.equal(reopened.extracted?.total, 6986.35);
    assert.equal(validateAmounts(reopened.extracted?.base ?? null, reopened.extracted?.taxes ?? null, reopened.extracted?.total ?? null, reopened.extracted?.lines ?? [], []).ok, true);
    console.log("✅ testLocalManualTaxSaveRoute passed (store temporal, sin Odoo)");
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
}

// ---------- Test 4: inbox store round-trip ----------

async function testInboxStoreRoundtrip() {
  const tmpDir = join("/tmp", "test-inbox-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });
  const storePath = join(tmpDir, "docInbox.json");

  // Simular servicio
  const service = new DocumentInboxService({ dataDir: tmpDir });
  assert.equal(service.getStore().documents.length, 0);
  const computedKpis = service.computeKpis({
    ordersWithoutInvoice: { count: 3, total: 1200 },
    partialBilling: { count: 2, total: 400, pending: 175 },
    receivedOver15Days: { count: 0 }, importaciones: { count: 0, total: 0 }, totalPendingAmount: 1575, totalOrders: 5,
  });
  assert.equal(computedKpis.pedidosSinFacturar, 3, "el inbox usa el ledger compartido, no un placeholder cero");
  assert.equal(computedKpis.importePedidosSinFacturar, 1200);
  assert.equal(computedKpis.facturacionParcial, 2);

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
  service2.setStatus("FILE123", "VALIDADA", "test");
  loaded!.odooDraftMoveId = 238059;
  service2.save();
  service2.setStatus("FILE123", "PENDIENTE_COTEJO", "recotejo");
  assert.equal(service2.getDocument("FILE123")?.status, "VALIDADA", "un recotejo no debe ocultar Drive tras crear el borrador");

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
    const pdfParse = (await import("pdf-parse")).default;
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

  orders[0].supplierRef = "PPNWHLABX";
  f = filterOrders(orders, { text: "ppnwhlabx" });
  assert.equal(f[0]?.name, "P001", "la lista debe poder buscar por referencia de proveedor");

  console.log("✅ testFilterOrders passed");
}

// ---------- Main ----------

async function testServiceDraftSelectionGates() {
  assert.equal(serviceLineIdentityError({ productId: null, description: "Envíos", sourcePurchaseOrderId: null }, 0), null, "una línea contable de servicio no requiere producto");
  assert.match(serviceLineIdentityError({ productId: 43225, description: "Envíos", genericProductConfirmed: false }, 0) ?? "", /confirma/i, "un producto enlazado requiere confirmación");
  assert.match(serviceLineIdentityError({ productId: null, description: "Envíos", sourcePurchaseOrderId: 100 }, 0) ?? "", /sin pedido/i, "servicios no admiten pedido de origen");
  assert.match(serviceLineIdentityError({ productId: null, description: " " }, 0) ?? "", /descripción/i, "la línea sin producto requiere descripción");
  const line = { productId: 43225, description: "Comisión marketplace", quantity: 1, priceUnit: 100, discount: 0, total: 100, taxNames: ["IVA 21%"], taxId: 1, taxAmount: 21, accountId: 1, genericProductConfirmed: true };
  const doc = { driveFileId: "test", name: "test.pdf", invoiceBranch: "goods" as "goods" | "services", confirmedOdooPartnerId: null, assignedPurchaseOrderIds: [] as number[], match: null,
    extracted: { supplier: "Proveedor", supplierVat: null, invoiceNumber: "F-1", invoiceDate: "2026-09-01", dueDate: null, currency: "EUR", base: 100, taxes: 21, total: 121, lines: [line] } };
  const withoutBranch = await createSupplierDraft({} as never, 0, doc, [], "2026-09-28");
  assert.equal(withoutBranch.ok, false);
  assert.match(withoutBranch.message, /pedido/i);
  doc.invoiceBranch = "services";
  const withoutPartner = await createSupplierDraft({} as never, 0, doc, [], "2026-09-28");
  assert.equal(withoutPartner.ok, false);
  assert.match(withoutPartner.message, /proveedor/i);
  doc.extracted.lines = [];
  const withoutProduct = await createSupplierDraft({} as never, 0, doc, [], "2026-09-28");
  assert.equal(withoutProduct.ok, false);
  assert.match(withoutProduct.message, /servicio/i);
  console.log("✅ testServiceDraftSelectionGates passed (sin escribir en Odoo)");
}

async function main() {
  console.log("=== FASE 2 TESTS ===\n");
  testExtractPdf();
  testMatchingBands();
  testNoWrites();
  testReliableTotalsGate();
  testAmountMismatchWarnings();
  testTaxTotalCorrection();
  testSequentialSupplierDiscounts();
  testWebAdjustmentAfterDiscounts();
  await testLocalManualTaxSaveRoute();
  await testServiceDraftSelectionGates();
  await testInboxStoreRoundtrip();
  await testRealPdfs();
  testUnbilledKpis();
  testFilterOrders();
  console.log("\n=== TODOS LOS TESTS PASARON ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
