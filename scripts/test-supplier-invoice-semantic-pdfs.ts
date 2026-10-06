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
VEHICULO-TEST-0001
08/09/2026
65688
CLIENTE DE PRUEBAS SL
B12345678
PROVEEDOR AUTOMOCION DE PRUEBAS SL
NIF: B87654321
03690 CIUDAD DE PRUEBAS
`;
const parsed = extractPdfData(workshopInvoice, 1, "factura.pdf");
assert.equal(parsed.supplier, "PROVEEDOR AUTOMOCION DE PRUEBAS SL", "el rol Montador y el número de factura no son el emisor");
assert.equal(parsed.supplierVat, "B87654321", "el CIF del cliente no debe confundirse con el del emisor");
const merged = mergeExtracted(parsed, {
  supplier: "Montador", supplierVat: "B12345678", country: null, invoiceNumber: null,
  invoiceDate: null, dueDate: null, currency: null, base: null, taxes: null, total: null,
  lines: [], confidence: 95, warnings: [],
}, "Prueba sintética");
assert.equal(merged.supplier, parsed.supplier, "una respuesta IA contradictoria no reemplaza al emisor con evidencia fiscal local");
assert.equal(merged.supplierVat, parsed.supplierVat);
assert.ok(merged.warnings.some((warning) => /discrepa.*emisor/i.test(warning)), "el conflicto se hace visible para revisión humana");

const labeledIssuer = extractPdfData(`
Customer ID
00000001
Dirección de entrega
03690 CIUDAD DE PRUEBAS
Montador
VEHICULO-TEST-0001
Cliente: EXAMPLE CUSTOMER SL
CIF B12345678
Emisor: PROVEEDOR AUTOMOCION DE PRUEBAS SL
NIF B87654321
`, 1, "invoice.pdf");
assert.equal(labeledIssuer.supplier, "PROVEEDOR AUTOMOCION DE PRUEBAS SL", "el nombre del emisor etiquetado se extrae sin confundir roles o dirección");
assert.equal(labeledIssuer.supplierVat, "B87654321", "se conserva el VAT del emisor, no el VAT del comprador");

for (const roleOnly of [
  `Customer ID\n00000001\n`,
  `Dirección de entrega\n03690 CIUDAD DE PRUEBAS\nCódigo postal 08001\n`,
  `Montador\nVEHICULO-TEST-0001\n`,
]) {
  const rejected = extractPdfData(roleOnly, 1, "invoice.pdf");
  assert.notEqual(rejected.supplier, "Customer ID");
  assert.notEqual(rejected.supplier, "03690 CIUDAD DE PRUEBAS");
  assert.notEqual(rejected.supplier, "VEHICULO-TEST-0001");
}

console.log("Identidad semántica del emisor: OK");
