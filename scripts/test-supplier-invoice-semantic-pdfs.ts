import assert from "node:assert/strict";
import { extractPdfData } from "../backend/supplierInvoices/documentInbox.ts";
import { mergeExtracted } from "../backend/supplierInvoices/aiExtract.ts";

// Fixture sintético: reproduce el orden de columnas del PDF de taller sin
// guardar datos reales. La matrícula/orden aparece bajo «Montador» antes del
// cliente y del bloque fiscal del emisor.
const workshopInvoice = `
Factura Nº:
Fecha
Cliente
Nombre
N.I.F
Dirección
Montador
VE2-05015781
08/09/2026
65688
TODOELECTRICO SUMINISTROS E INSTALACIONES SL
B54685144
FEU VERT IBERICA S.A.U.
NIF: A79783254
03690 SAN VICENTE (ALICANTE)
`;
const parsed = extractPdfData(workshopInvoice, 1, "factura.pdf");
assert.equal(parsed.supplier, "FEU VERT IBERICA S.A.U.", "el rol Montador y el número de factura no son el emisor");
assert.equal(parsed.supplierVat, "A79783254", "el CIF del cliente no debe confundirse con el del emisor");
const merged = mergeExtracted(parsed, {
  supplier: "Montador", supplierVat: "B54685144", country: null, invoiceNumber: null,
  invoiceDate: null, dueDate: null, currency: null, base: null, taxes: null, total: null,
  lines: [], confidence: 95, warnings: [],
}, "Prueba sintética");
assert.equal(merged.supplier, parsed.supplier, "una respuesta IA contradictoria no reemplaza al emisor con evidencia fiscal local");
assert.equal(merged.supplierVat, parsed.supplierVat);
assert.ok(merged.warnings.some((warning) => /discrepa.*emisor/i.test(warning)), "el conflicto se hace visible para revisión humana");

const labeledIssuer = extractPdfData(`
Customer ID
05015781
Dirección de entrega
03690 SAN VICENTE (ALICANTE)
Montador
VE2-05015781
Cliente: TODOELECTRICO SUMINISTROS SL
CIF B54685144
Emisor: FEU VERT IBERICA S.A.U.
NIF A79783254
`, 1, "invoice.pdf");
assert.equal(labeledIssuer.supplier, "FEU VERT IBERICA S.A.U.", "el nombre del emisor etiquetado se extrae sin confundir roles o dirección");
assert.equal(labeledIssuer.supplierVat, "A79783254", "se conserva el VAT del emisor, no el VAT del comprador");

for (const roleOnly of [
  `Customer ID\n05015781\n`,
  `Dirección de entrega\n03690 SAN VICENTE (ALICANTE)\nCódigo postal 08001\n`,
  `Montador\nVE2-05015781\n`,
]) {
  const rejected = extractPdfData(roleOnly, 1, "invoice.pdf");
  assert.notEqual(rejected.supplier, "Customer ID");
  assert.notEqual(rejected.supplier, "03690 SAN VICENTE (ALICANTE)");
  assert.notEqual(rejected.supplier, "VE2-05015781");
}

console.log("Identidad semántica del emisor: OK");
