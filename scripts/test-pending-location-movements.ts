import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductLocations } from "../backend/products/locations.ts";

const dataDir = mkdtempSync(join(tmpdir(), "pending-location-moves-"));
try {
  const store = createProductLocations({ dataDir });
  store.saveCatalogEntry({ code: "F202" });
  store.save({ productId: 1, code: "F202", quantity: 11, preferred: true });
  store.replaceFromInventory([{ productId: 1, locationCode: "F202", quantity: 11 }], "2026-10-14T08:00:00.000Z");
  store.startAutomaticOdooMovements("2026-10-14T08:01:00.000Z");
  // Simulate a legacy/external record lacking the preferred flag; normal saves now reject this state.
  const file = join(dataDir, "product-locations.json");
  const legacy = JSON.parse(readFileSync(file, "utf8"));
  legacy.locations[0].preferred = false;
  writeFileSync(file, JSON.stringify(legacy));
  const first = store.applyOdooMovements({ automatic: true, syncedAt: "2026-10-14T08:02:00.000Z", moves: [{ id: 101, productId: 1, quantity: 2, direction: "out" }] });
  assert.equal(first.applied, 0);
  assert.equal(first.processed, 0);
  assert.equal(store.forProduct(1)[0].quantity, 11);
  assert.ok(!store.summary().odooMovementSync?.processedMoveIds.includes(101));
  assert.equal(store.summary().odooMovementSync?.pendingMovements?.[0]?.reason, "missing_preferred");
  assert.equal(store.summary().odooMovementSync?.automaticLastSyncedAt, "2026-10-14T08:02:00.000Z");
  const restarted = createProductLocations({ dataDir });
  assert.equal(restarted.summary().odooMovementSync?.pendingMovements?.[0]?.id, 101);
  restarted.save({ productId: 1, code: "F202", quantity: 11, preferred: true });
  const retried = restarted.applyOdooMovements({ automatic: true, syncedAt: "2026-10-14T08:03:00.000Z", moves: [] });
  assert.equal(retried.applied, 1);
  assert.equal(restarted.forProduct(1)[0].quantity, 9);
  assert.deepEqual(restarted.summary().odooMovementSync?.pendingMovements, []);
  assert.ok(restarted.summary().odooMovementSync?.processedMoveIds.includes(101));
  const duplicate = restarted.applyOdooMovements({ automatic: true, moves: [{ id: 101, productId: 1, quantity: 2, direction: "out" }] });
  assert.equal(duplicate.applied, 0);
  assert.equal(restarted.forProduct(1)[0].quantity, 9);
  console.log("Missing preferred: pending, persistent, retried once after assignment OK");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
