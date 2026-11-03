import assert from "node:assert/strict";
import { extractCorreosExpressPdf } from "../backend/supplierInvoices/correosExpressPdf.ts";

const pdf = `Factura original\nFacturaF260900001\nFecha emisión:30/09/2026
Proveedor - emisor\nESA28799120\nCORREOS EXPRESS PAQUETERIA URGENTE
Líneas de detalle
90-Internacional\nEst\nORIGEN DESTINO 1 bulto
Expte.: 975790001; ; Albarán: 9030000000000001 (29/09/2026);
Suplemento fuel: 1,09\n11,581,00 UnidadesIVA 21%12,67
33-DEVOLUCIONORIGEN DESTINO 1 bulto
Expte.: 975790004; ; Albarán: 3300000000000002 (30/09/2026);
0,001,00 UnidadesIVA 0%0,00
Totales\nBruto antes de impuesto:12,67\nImpuestos repercutidos:2,66\nTotal factura:15,33
Divisa:Euro (EUR)\nDatos de vencimiento\n30/10/202615,33`;
const result = extractCorreosExpressPdf(pdf)!;
assert.ok(result);
assert.equal(result.shipmentCount, 2); assert.equal(result.lines.length, 3);
assert.equal(result.lines[0].priceUnit, 11.58);
assert.equal(result.lines[1].total, 1.09); assert.equal(result.lines[1].quantity, null, "do not invent a printed fuel quantity");
assert.equal(result.lines[2].total, 0, "zero lines must not disappear");
assert.equal(result.fields.dueDate, "2026-10-30");
assert.equal(extractCorreosExpressPdf(pdf.replace("ESA28799120", "ESB12345678")), null);
assert.equal(extractCorreosExpressPdf(pdf.replace("Bruto antes de impuesto:12,67", "Bruto antes de impuesto:12,68")), null);
assert.equal(extractCorreosExpressPdf(pdf.replace("Suplemento fuel: 1,09", "Suplemento fuel: 1,10")), null);
assert.equal(extractCorreosExpressPdf(pdf.replace("Albarán: 3300000000000002", "Referencia: 3300000000000002")), null);
assert.equal(extractCorreosExpressPdf(pdf.replace("11,581,00", "1..1,581,00")), null);
assert.equal(extractCorreosExpressPdf(pdf + "\nFacturaF260900002"), null, "a multi-invoice bundle is not one invoice");
console.log("Correos PDF: complete shipment/fuel rows, zero rows, arithmetic and strict-template rejection OK");
