import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductLocations } from "../backend/products/locations.ts";

const dataDir = mkdtempSync(join(tmpdir(), "dashboard-inventory-zone-sync-"));
const locations = createProductLocations({ dataDir });

locations.replaceFromInventory([{ productId: 101, locationCode: "C101", quantity: 20 }], "2026-08-27T09:00:00.000Z");
assert.deepEqual(locations.inventoryTotalsAfterReplace([{ productId: 101, locationCode: "C105", quantity: 30 }]), { 101: 50 });

locations.replaceFromInventory([{ productId: 101, locationCode: "C105", quantity: 30 }]);
const initialBaseline = locations.summary().odooMovementSync?.baselineAt;
locations.applyOdooMovements({ moves: [], syncedAt: "2026-08-27T09:10:00.000Z" });
assert.deepEqual(locations.inventoryTotalsAfterReplace([{ productId: 101, locationCode: "C101", quantity: 10 }]), { 101: 40 });

locations.replaceFromInventory([{ productId: 101, locationCode: "C101", quantity: 10 }]);
assert.equal(locations.summary().odooMovementSync?.baselineAt, initialBaseline);
assert.equal(locations.summary().odooMovementSync?.lastSyncedAt, "2026-08-27T09:10:00.000Z");

locations.applyOdooMovements({ moves: [{ id: 1, productId: 101, quantity: 5, direction: "out" }] });
assert.deepEqual(locations.forProduct(101).map((item) => [item.code, item.quantity]), [["C101", 5], ["C105", 30]]);
console.log("Inventory zone sync: OK");
