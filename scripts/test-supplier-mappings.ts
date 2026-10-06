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

store.upsert({ supplier: "Grupo Empresarial Synthetic Supplier SL", vat: null, country: "ES", billingAddress: null }, "test");
check("clave por nombre normalizado", mappingKey("Grupo Empresarial Synthetic Supplier SL", null) === "name:GRUPO EMPRESARIAL SYNTHETIC SUPPLIER SL");
const byName = store.get("grupo empresarial synthetic supplier sl", null);
check("recupera por nombre aunque cambie el formato", byName !== null && byName.supplierName === "Grupo Empresarial Synthetic Supplier SL");
check("cuenta samples", byName?.samples === 1);

store.upsert({ supplier: "Synthetic Supplier", vat: "ESB12345678", country: "ES", billingAddress: "Calle Falsa 123", odooPartnerId: 1234 }, "test");
const byVat = store.get("cualquier cosa", " esb12345678 ");
check("VAT con espacios resuelve", byVat !== null && byVat.supplierVat === "ESB12345678");
check("direccion recordada", byVat?.billingAddress === "Calle Falsa 123");
check("VAT distinto no cae al nombre", store.get("x", "ESB99999999") === null);

store.upsert({ supplier: "Synthetic Supplier SL", vat: "ESB12345678", country: "ES", billingAddress: "Calle Falsa 123" }, "test2");
check("mismo VAT actualiza sin duplicar", store.size() === 2);
const again = store.get("Synthetic Supplier SL", "ESB12345678");
check("samples acumula, conserva proveedor Odoo aprendido y guarda usuario", again?.samples === 2 && again.updatedBy === "test2" && again.supplierName === "Synthetic Supplier SL" && again.odooPartnerId === 1234);

const reloaded = new SupplierMappingStore({ dataDir: dir });
check("persiste tras reiniciar", reloaded.size() === 2 && reloaded.get("x", "ESB12345678")?.supplierName === "Synthetic Supplier SL" && reloaded.get("x", "ESB12345678")?.odooPartnerId === 1234);

store.learnProduct({ supplier: "Synthetic Supplier", vat: "ESB12345678", concept: "Comisión marketplace", reference: "COM-1", productId: 900001, sourceDocumentId: "invoice-a" }, "Test Operator");
const suggestion = new SupplierMappingStore({ dataDir: dir }).productSuggestion("Synthetic Supplier SL", "B12345678", "Comisión marketplace", "COM-1");
check("recuerda equivalencia exacta tras reiniciar", suggestion?.productId === 900001 && suggestion.sourceDocumentId === "invoice-a");
check("no sugiere otro concepto o proveedor", store.productSuggestion("Synthetic Supplier", "ESB12345678", "Otro servicio", "COM-1") === null && store.productSuggestion("Otro", "ESB99999999", "Comisión marketplace", "COM-1") === null);
store.learnProduct({ supplier: "Synthetic Supplier", vat: "ESB12345678", concept: "Comisión marketplace", reference: "COM-1", productId: 900002, sourceDocumentId: "invoice-b" }, "Test Operator");
check("corrección sustituye equivalencia con procedencia", store.productSuggestion("Synthetic Supplier", "ESB12345678", "Comisión marketplace", "COM-1")?.productId === 900002 && store.productSuggestion("Synthetic Supplier", "ESB12345678", "Comisión marketplace", "COM-1")?.sourceDocumentId === "invoice-b");

rmSync(dir, { recursive: true, force: true });
if (failures) { console.error(`${failures} fallos`); process.exit(1); }
console.log("supplier-mappings: OK");
