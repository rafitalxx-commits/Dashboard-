import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DocumentInboxService, mergeRecoveredExtraction } from "../backend/supplierInvoices/documentInbox.ts";
import { pdfIssuerVatMatches } from "../backend/supplierInvoices/supplierIdentity.ts";
import type { PdfExtractedData } from "../backend/supplierInvoices/phase2Types.ts";

const invoiceText = "Proveedor: C.I.KRANG S.L. - CIF: B54004023\nCliente: TODOELECTRICO SL, CIF B54685144";
assert.equal(pdfIssuerVatMatches(invoiceText, "C.I. KRANG, SL", "ESB54004023"), true, "el CIF del emisor coincide pese a puntuación del sufijo SL");
assert.equal(pdfIssuerVatMatches(invoiceText, "C.I. KRANG, SL", "B00000000"), false, "no acepta un CIF distinto");
assert.equal(pdfIssuerVatMatches(invoiceText, "TODOELECTRICO SL", "B54685144"), false, "no confunde el CIF del comprador con el emisor");

const existing = {
  supplier: "Corrección humana", supplierVat: "B11111111", invoiceNumber: "FAC-HUMANA", invoiceDate: null, dueDate: null,
  country: null, currency: "EUR", billingAddress: null, base: 10, taxes: 2.1, total: 12.1,
  lines: [{ description: "Línea editada", reference: "REF-1", quantity: 2, priceUnit: 5, discount: 0, total: 10 }],
  textPreview: "texto antiguo", needsOcr: false, warnings: ["No se han detectado importes de forma fiable."], pdfPages: 1, docType: "factura",
} as PdfExtractedData;
const fresh = {
  ...existing, supplier: "Lectura nueva", supplierVat: "B22222222", invoiceNumber: null,
  lines: [{ description: "Línea nueva", reference: "REF-2", quantity: 3, priceUnit: 4, discount: 0, total: 12 }],
  textPreview: "texto PDF completo", base: 12, total: 12, warnings: [], pdfPages: 2,
} as PdfExtractedData;
const recovered = mergeRecoveredExtraction(existing, fresh);
assert.equal(recovered.supplier, "Corrección humana", "la recuperación técnica no altera el borrador existente");
assert.equal(recovered.lines[0].description, "Línea editada");
assert.equal(recovered.textPreview, "texto PDF completo", "la evidencia PDF sí se actualiza");
assert.deepEqual(recovered.warnings, [], "quita el aviso de importes cuando la relectura ya extrae importes");

const root = mkdtempSync(join(tmpdir(), "invoice-scan-store-"));
try {
  const blocker = join(root, "not-a-directory");
  writeFileSync(blocker, "file");
  const failingStore = new DocumentInboxService({ dataDir: blocker });
  assert.equal(failingStore.save(), false, "un fallo de escritura de disco no se oculta como éxito");

  const dataDir = join(root, "working");
  const store = new DocumentInboxService({ dataDir });
  store.getStore().documents.push({
    driveFileId: "synthetic", driveFolderId: null, name: "synthetic.pdf", size: null, modifiedTime: null, webViewLink: null,
    source: "manual", sourceEmail: null, detectedAt: null, detectedBy: null, extracted: null, ocrStatus: "pendiente",
    aiStatus: "no_aplicado", confidence: null, match: null, status: "SIN_REVISAR", validationUser: null, validationAt: null,
    notes: null, targetFolderPath: null, movedTo: null, odooDraftMoveId: null, odooDraftName: null, odooDraftState: null,
    assignedPurchaseOrderIds: null, pdfCached: false, processedAt: null,
  });
  assert.equal(store.save(), true, "la escritura atómica confirma persistencia local");
  const reopened = new DocumentInboxService({ dataDir });
  assert.equal(reopened.getDocument("synthetic")?.name, "synthetic.pdf", "el registro se puede releer tras guardar");
} finally { rmSync(root, { recursive: true, force: true }); }

console.log("Seguridad del escaneo de facturas: identidad fiscal, preservación humana y persistencia local OK");
