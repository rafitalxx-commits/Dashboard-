// Test unitario del registro de mapeos de proveedor (memoria de correcciones).
import { SupplierMappingStore, mappingKey } from "../backend/supplierInvoices/supplierMappings.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mappings-"));
let failures = 0;
const check = (name: string, cond: boolean) => { console.log(cond ? "OK:" : "FAIL:", name); if (!cond) failures += 1; };

const store = new SupplierMappingStore({ dataDir: dir });
check("empieza vacio", store.size() === 0);

store.upsert({ supplier: "Grupo Empresarial Decominsa SL", vat: null, country: "ES", billingAddress: null }, "test");
check("clave por nombre normalizado", mappingKey("Grupo Empresarial Decominsa SL", null) === "name:GRUPO EMPRESARIAL DECOMINSA SL");
const byName = store.get("grupo empresarial decominsa sl", null);
check("recupera por nombre aunque cambie el formato", byName !== null && byName.supplierName === "Grupo Empresarial Decominsa SL");
check("cuenta samples", byName?.samples === 1);

store.upsert({ supplier: "Decominsa", vat: "ESB87629895", country: "ES", billingAddress: "Calle Falsa 123", odooPartnerId: 1234 }, "test");
const byVat = store.get("cualquier cosa", " esb87629895 ");
check("VAT con espacios resuelve", byVat !== null && byVat.supplierVat === "ESB87629895");
check("direccion recordada", byVat?.billingAddress === "Calle Falsa 123");
check("VAT distinto no cae al nombre", store.get("x", "ESB99999999") === null);

store.upsert({ supplier: "Decominsa SL", vat: "ESB87629895", country: "ES", billingAddress: "Calle Falsa 123" }, "test2");
check("mismo VAT actualiza sin duplicar", store.size() === 2);
const again = store.get("Decominsa SL", "ESB87629895");
check("samples acumula, conserva proveedor Odoo aprendido y guarda usuario", again?.samples === 2 && again.updatedBy === "test2" && again.supplierName === "Decominsa SL" && again.odooPartnerId === 1234);

const reloaded = new SupplierMappingStore({ dataDir: dir });
check("persiste tras reiniciar", reloaded.size() === 2 && reloaded.get("x", "ESB87629895")?.supplierName === "Decominsa SL" && reloaded.get("x", "ESB87629895")?.odooPartnerId === 1234);

store.learnProduct({ supplier: "Decominsa", vat: "ESB87629895", concept: "Comisión marketplace", reference: "COM-1", productId: 43225, sourceDocumentId: "invoice-a" }, "Rafa");
const suggestion = new SupplierMappingStore({ dataDir: dir }).productSuggestion("Decominsa SL", "B87629895", "Comisión marketplace", "COM-1");
check("recuerda equivalencia exacta tras reiniciar", suggestion?.productId === 43225 && suggestion.sourceDocumentId === "invoice-a");
check("no sugiere otro concepto o proveedor", store.productSuggestion("Decominsa", "ESB87629895", "Otro servicio", "COM-1") === null && store.productSuggestion("Otro", "ESB99999999", "Comisión marketplace", "COM-1") === null);
store.learnProduct({ supplier: "Decominsa", vat: "ESB87629895", concept: "Comisión marketplace", reference: "COM-1", productId: 43199, sourceDocumentId: "invoice-b" }, "Rafa");
check("corrección sustituye equivalencia con procedencia", store.productSuggestion("Decominsa", "ESB87629895", "Comisión marketplace", "COM-1")?.productId === 43199 && store.productSuggestion("Decominsa", "ESB87629895", "Comisión marketplace", "COM-1")?.sourceDocumentId === "invoice-b");

rmSync(dir, { recursive: true, force: true });
if (failures) { console.error(`${failures} fallos`); process.exit(1); }
console.log("supplier-mappings: OK");
