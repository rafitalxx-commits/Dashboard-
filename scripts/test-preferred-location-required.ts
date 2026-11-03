import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductLocations } from "../backend/products/locations.ts";

const dataDir = mkdtempSync(join(tmpdir(), "dashboard-preferred-required-"));
try {
  const locations = createProductLocations({ dataDir });
  locations.saveCatalogEntry({ code: "A101" });
  locations.saveCatalogEntry({ code: "B101" });

  assert.throws(() => locations.save({ productId: 1, code: "A101", quantity: 5, preferred: false }), /preferente/);
  assert.deepEqual(locations.forProduct(1), []);
  locations.save({ productId: 1, code: "A101", quantity: 5, preferred: true });
  locations.save({ productId: 1, code: "B101", quantity: 2, preferred: false });

  assert.throws(() => locations.validateSave({ productId: 1, code: "A101", quantity: 5, preferred: false }), /preferente/);
  assert.throws(() => locations.save({ productId: 1, code: "A101", quantity: 5, preferred: false }), /preferente/);
  assert.throws(() => locations.remove(1, "A101"), /preferente/);
  assert.equal(locations.forProduct(1).find((item) => item.code === "A101")?.quantity, 5);

  locations.save({ productId: 1, code: "B101", quantity: 2, preferred: true });
  assert.equal(locations.forProduct(1).filter((item) => item.preferred).length, 1);
  locations.remove(1, "A101");
  locations.remove(1, "B101");
  assert.deepEqual(locations.forProduct(1), []);
  console.log("Preferred-location save/delete invariant: OK");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
