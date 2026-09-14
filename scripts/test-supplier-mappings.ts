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

store.upsert({ supplier: "Decominsa", vat: "ESB87629895", country: "ES", billingAddress: "Calle Falsa 123" }, "test");
const byVat = store.get("cualquier cosa", " esb87629895 ");
check("VAT con espacios resuelve", byVat !== null && byVat.supplierVat === "ESB87629895");
check("direccion recordada", byVat?.billingAddress === "Calle Falsa 123");
check("VAT distinto no cae al nombre", store.get("x", "ESB99999999") === null);

store.upsert({ supplier: "Decominsa SL", vat: "ESB87629895", country: "ES", billingAddress: "Calle Falsa 123" }, "test2");
check("mismo VAT actualiza sin duplicar", store.size() === 2);
const again = store.get("Decominsa SL", "ESB87629895");
check("samples acumula y guarda usuario", again?.samples === 2 && again.updatedBy === "test2" && again.supplierName === "Decominsa SL");

const reloaded = new SupplierMappingStore({ dataDir: dir });
check("persiste tras reiniciar", reloaded.size() === 2 && reloaded.get("x", "ESB87629895")?.supplierName === "Decominsa SL");

rmSync(dir, { recursive: true, force: true });
if (failures) { console.error(`${failures} fallos`); process.exit(1); }
console.log("supplier-mappings: OK");
