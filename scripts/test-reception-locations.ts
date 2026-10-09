import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductLocations } from "../backend/products/locations.ts";

const dataDir = mkdtempSync(join(tmpdir(), "reception-locations-"));
try {
  const store = createProductLocations({ dataDir });
  store.saveCatalogEntry({ code: "A101" });
  store.saveCatalogEntry({ code: "B202" });
  store.save({ productId: 2, code: "A101", quantity: 7, preferred: true });
  store.applyValidatedReception({ receptionId: 100, moveIds: [501, 502], allocations: [
    { productId: 1, code: "B202", quantity: 5 },
    { productId: 2, code: "A101", quantity: 3 },
    { productId: 2, code: "B202", quantity: 2 },
  ] });
  assert.deepEqual(store.forProduct(1).map(({ code, quantity, preferred }) => ({ code, quantity, preferred })), [
    { code: "B202", quantity: 5, preferred: true },
  ]);
  assert.deepEqual(store.forProduct(2).map(({ code, quantity, preferred }) => ({ code, quantity, preferred })), [
    { code: "A101", quantity: 10, preferred: true },
    { code: "B202", quantity: 2, preferred: false },
  ]);
  assert.equal(store.applyValidatedReception({ receptionId: 100, moveIds: [501, 502], allocations: [{ productId: 1, code: "B202", quantity: 5 }] }).applied, false);
  assert.equal(store.forProduct(1)[0].quantity, 5);
  assert.deepEqual(store.applyOdooMovements({ moves: [
    { id: 501, productId: 1, quantity: 5, direction: "in" },
    { id: 503, productId: 1, quantity: 2, direction: "in" },
  ] }).skipped, 1);
  assert.equal(store.forProduct(1)[0].quantity, 7);
  assert.throws(() => store.applyValidatedReception({ receptionId: 102, moveIds: [503], allocations: [{ productId: 1, code: "B202", quantity: 2 }] }), /sincronización ya registró/i);
  assert.equal(store.forProduct(1)[0].quantity, 7);
  assert.throws(() => store.applyValidatedReception({ receptionId: 101, moveIds: [504], allocations: [{ productId: 3, code: "C303", quantity: 1 }] }), /ubicación activa/i);
  assert.equal(store.forProduct(3).length, 0);
  const persisted = JSON.parse(readFileSync(join(dataDir, "product-locations.json"), "utf8"));
  assert.ok(persisted.processedReceptionIds.includes(100));
  assert.ok(persisted.odooMovementSync.processedMoveIds.includes(501));
  console.log("Reception locations: new, existing, idempotent, sync dedupe and invalid catalog OK");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
