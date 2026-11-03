import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductInventories } from "../backend/products/inventories.ts";

const dataDir = mkdtempSync(join(tmpdir(), "dashboard-inventory-discard-"));
const inventories = createProductInventories({
  dataDir,
  catalog: () => [{ id: 101, name: "Producto de prueba", reference: "TEST", barcode: "", onHand: 4 }],
});

const draft = inventories.create({
  name: "Borrador cancelable",
  scope: { type: "general", productSelection: { mode: "all" }, allowedLocationCodes: [] },
});
inventories.discard(draft.id);
assert.equal(inventories.list().length, 0, "Cancelar debe eliminar el borrador del Dashboard");

const active = inventories.create({
  name: "Conteo cancelable",
  scope: { type: "general", productSelection: { mode: "all" }, allowedLocationCodes: [] },
});
inventories.start(active.id, { id: "u1", code: "TEST", name: "Prueba" });
inventories.count(active.id, { productId: 101, locationCode: "A101", quantity: 7, operator: { id: "u1", code: "TEST", name: "Prueba" } });
assert.equal(inventories.find(active.id).counts.length, 1, "El conteo debe existir antes de cancelar");
inventories.discard(active.id);
assert.equal(inventories.list().length, 0, "Cancelar debe borrar también los conteos en curso");

const finished = inventories.create({
  name: "No cancelable",
  scope: { type: "general", productSelection: { mode: "all" }, allowedLocationCodes: [] },
});
inventories.start(finished.id, { id: "u1", code: "TEST", name: "Prueba" });
inventories.status(finished.id, "review");
assert.throws(() => inventories.discard(finished.id), /Solo se pueden cancelar inventarios en curso/);
assert.equal(inventories.find(finished.id).status, "review", "Nunca se elimina un inventario en revisión");

const storePath = join(dataDir, "product-inventories.json");
assert.ok(existsSync(storePath));
assert.equal(JSON.parse(readFileSync(storePath, "utf8")).inventories.length, 1);
console.log("Inventory discard: active drafts and counts are removed locally; reviewed inventories are protected.");
