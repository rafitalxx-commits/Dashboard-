import assert from "node:assert/strict";
import { archiveMismatch } from "../shared/supplierInvoiceArchiveGate.ts";

const pdf = { invoiceNumber: "INV-7", dueDate: "2026-10-31", base: 100, taxes: 21, total: 121,
  lines: [{ description: "Producto impreso", productId: 17, sourcePurchaseLineId: 99, quantity: 2, priceUnit: 50, total: 100, taxAmount: 21 }] };
const draft = { reference: "INV-7", dueDate: "2026-10-31", base: 100, taxes: 21, total: 121,
  lines: [{ description: "Producto impreso", productId: 17, purchaseLineId: 99, quantity: 2, priceUnit: 50, base: 100, total: 121 }] };
assert.equal(archiveMismatch(pdf, draft), null);
assert.match(archiveMismatch(pdf, { ...draft, lines: [{ ...draft.lines[0], purchaseLineId: 98 }] })!, /línea 1/);
assert.match(archiveMismatch(pdf, { ...draft, lines: [{ ...draft.lines[0], description: "Nombre del catálogo" }] })!, /descripción/);
assert.match(archiveMismatch(pdf, { ...draft, total: 120 })!, /importes/);
assert.match(archiveMismatch(pdf, draft, ["Redondeo pendiente"])!, /avisos/);
assert.match(archiveMismatch(pdf, { ...draft, dueDate: "2026-11-01" })!, /vencimiento/);
const servicePdf = { ...pdf, lines: [{ description: "Resumen servicios", productId: null, quantity: 1, priceUnit: 100, total: 100, taxAmount: 21 }] };
const serviceDraft = { ...draft, lines: [{ ...draft.lines[0], description: "Línea contable", productId: null, purchaseLineId: null }] };
assert.equal(archiveMismatch(servicePdf, serviceDraft, [], "services"), null, "servicios pueden tener desglose contable sin producto");
assert.match(archiveMismatch(servicePdf, serviceDraft)!, /PDF no está completamente cotejada/, "mercancía conserva el cotejo estricto");
assert.match(archiveMismatch(servicePdf, { ...serviceDraft, base: 99 }, [], "services")!, /importes/, "servicios no relajan importes");
assert.match(archiveMismatch(servicePdf, { ...serviceDraft, lines: [] }, [], "services")!, /no contiene líneas/, "servicios no admiten borrador vacío");
console.log("Puerta de archivo Odoo→Drive: coincidencia y bloqueos OK");
