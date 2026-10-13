import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductLocations } from "../backend/products/locations.ts";

const dataDir = mkdtempSync(join(tmpdir(), "preferred-deliveries-"));
try {
  const store = createProductLocations({ dataDir });
  store.saveCatalogEntry({ code: "C102" });
  store.saveCatalogEntry({ code: "B202" });
  store.save({ productId: 1, code: "C102", quantity: 4, preferred: true });
  store.save({ productId: 1, code: "B202", quantity: 8 });
  store.replaceFromInventory([{ productId: 1, locationCode: "C102", quantity: 4 }], "2026-10-13T12:00:00.000Z");
  store.startAutomaticOdooMovements("2026-10-13T12:05:00.000Z");
  let result = store.applyOdooMovements({ automatic: true, syncedAt: "2026-10-13T12:06:00.000Z", moves: [
    { id: 106067, productId: 1, quantity: 4, direction: "out" },
  ] });
  assert.equal(result.applied, 1);
  assert.deepEqual(store.forProduct(1).map(({ code, quantity }) => ({ code, quantity })), [
    { code: "C102", quantity: 0 }, { code: "B202", quantity: 8 },
  ]);
  result = store.applyOdooMovements({ automatic: true, moves: [
    { id: 106067, productId: 1, quantity: 4, direction: "out" },
    { id: 106068, productId: 1, quantity: 3, direction: "out" },
  ] });
  assert.equal(result.skipped, 1);
  assert.equal(store.forProduct(1)[0].quantity, -3);
  store.transfer({ productId: 1, fromCode: "B202", toCode: "C102", quantity: 5 });
  assert.deepEqual(store.forProduct(1).map(({ code, quantity }) => ({ code, quantity })), [
    { code: "C102", quantity: 2 }, { code: "B202", quantity: 3 },
  ]);
  const state = store.summary().odooMovementSync!;
  assert.equal(state.lastSyncedAt, "2026-10-13T12:05:00.000Z");
  assert.ok(state.automaticLastSyncedAt);
  assert.deepEqual(state.processedMoveIds, [106067, 106068]);
  console.log("Preferred deliveries: zero, negative, transfer, duplicate and independent automatic cursor OK");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
