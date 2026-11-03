import assert from "node:assert/strict";
import { withCatalogLocations } from "../backend/products/catalogLocations.ts";
import type { ProductLocation } from "../backend/products/locations.ts";

const location = (productId: number, code: string, quantity: number, preferred = false, replenishmentMin?: number): ProductLocation => ({
  productId, code, quantity, preferred, replenishmentMin,
  row: "", shelf: "", height: "", createdAt: "", updatedAt: "",
});
const products = [{ id: 1, name: "Varios" }, { id: 2, name: "Vacío" }];
const rows = [
  location(1, "B101", 3),
  location(1, "A101", 0, true, 2),
  location(99, "Z101", 5, true),
];
const result = withCatalogLocations(products, rows);

assert.deepEqual(result[0].localLocations, [
  { code: "A101", quantity: 0, preferred: true },
  { code: "B101", quantity: 3, preferred: false },
], "all Dashboard locations and the zero-quantity preferred location survive");
assert.deepEqual(result[0].physicalLocations, ["A101", "B101"]);
assert.deepEqual(result[0].locationSummary, {
  preferredCode: "A101",
  preferredQuantity: 0,
  replenishmentMin: 2,
  needsReplenishment: true,
});
assert.deepEqual(result[1].localLocations, [], "a truly unlocated product stays empty");
assert.equal(result[1].locationSummary.preferredCode, undefined);
assert.equal("localLocations" in products[0], false, "joining does not mutate the catalog store");
console.log("Catalog Dashboard locations: OK");
