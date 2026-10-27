import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductInventories } from "../backend/products/inventories.ts";

const dataDir = mkdtempSync(join(tmpdir(), "dashboard-inventory-bom-"));
const catalog = [
  { id: 101, name: "Componente", reference: "COMP", barcode: "", onHand: 4, isKit: false },
  { id: 102, name: "Kit fabricado", reference: "KIT", barcode: "", onHand: 2, isKit: true },
];
const inventories = createProductInventories({ dataDir, catalog: () => catalog });
const operator = { id: "user-1", code: "TEST", name: "Prueba" };

const all = inventories.create({ name: "General", scope: { type: "general", productSelection: { mode: "all" }, allowedLocationCodes: [] } });
assert.deepEqual(all.plannedProductIds, [101], "El inventario general excluye productos fabricados");

const selected = inventories.create({ name: "Selección", scope: { type: "products", productSelection: { mode: "ids", ids: [101, 102] }, allowedLocationCodes: [] } });
assert.deepEqual(selected.plannedProductIds, [101], "La selección explícita también excluye kits");

const active = inventories.start(all.id, operator);
assert.throws(() => inventories.count(active.id, { productId: 102, locationCode: "A101", quantity: 9, operator }), /No se pueden contar kits/);
inventories.count(active.id, { productId: 101, locationCode: "A101", quantity: 7, operator });
assert.equal(inventories.find(active.id).counts.length, 1, "Se permite contar los componentes");

catalog[1]!.isKit = false;
const legacy = inventories.create({ name: "Conteo anterior con producto aún no identificado", scope: { type: "general", productSelection: { mode: "all" }, allowedLocationCodes: [] } });
inventories.start(legacy.id, operator);
inventories.count(legacy.id, { productId: 102, locationCode: "A101", quantity: 5, operator });
catalog[1]!.isKit = true;
inventories.status(legacy.id, "review");
assert.throws(() => inventories.assertNoManufacturedCounts(legacy.id), /No se ha enviado ningún cambio a Odoo/);
assert.equal(inventories.find(legacy.id).counts.length, 1, "Los conteos históricos se conservan para revisión");

console.log("Inventory manufactured-product filter: selection/count gates and legacy Odoo-send guard pass.");
