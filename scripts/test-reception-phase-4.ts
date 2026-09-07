import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductLocations, DISPATCH_PENDING_LOCATION } from "../backend/products/locations.ts";
import { createLocationPlan, isLocationPlanBalanced, updateReceivedQuantity } from "../src/modules/receptions/locationPlan.ts";
import type { InventoryReceptionLine } from "../src/services/odooTypes.ts";

const testDir = mkdtempSync(join(tmpdir(), "dashboard-reception-phase-4-"));
try {
  const repository = createProductLocations({ dataDir: testDir });
  const dispatch = repository.catalog(true).find((item) => item.code === DISPATCH_PENDING_LOCATION);
  assert.equal(dispatch?.label, "Pendiente de envío");
  assert.equal(dispatch?.kind, "dispatch");

  repository.saveCatalogEntry({ code: "A101" });
  repository.saveCatalogEntry({ code: "B202", active: false });
  repository.save({ productId: 10, code: "A101", quantity: 0, preferred: true });
  assert.throws(
    () => repository.save({ productId: 10, code: "B202", quantity: 0 }),
    /ubicación activa del catálogo/,
  );
  assert.throws(
    () => repository.save({ productId: 10, code: "C303", quantity: 0 }),
    /ubicación activa del catálogo/,
    "assigning a product cannot create a catalogue location implicitly",
  );

  const activeLocations = repository.catalog(true);
  const underOrder: InventoryReceptionLine = {
    id: "P04875-line-zero",
    productId: "10",
    name: "Línea Bajo pedido",
    sku: "SKU-10",
    barcode: "",
    expectedQty: 1,
    processedQty: 0,
    pendingQty: 1,
    uom: "uds",
    classification: "under_order",
    saleOrderRefs: ["S100001"],
  };
  const replenishment: InventoryReceptionLine = {
    ...underOrder,
    id: "P04875-line-one",
    name: "Línea Reposición",
    classification: "replenishment",
    saleOrderRefs: [],
    preferredLocation: "A101",
  };
  const dispatchPlan = createLocationPlan(underOrder, activeLocations);
  assert.deepEqual(dispatchPlan.allocations, [{
    id: "P04875-line-zero-dispatch",
    location: DISPATCH_PENDING_LOCATION,
    quantity: 1,
  }]);
  const zeroReceivedPlan = { ...dispatchPlan, receivedQty: 0, allocations: [], ready: false };
  assert.equal(isLocationPlanBalanced(zeroReceivedPlan, activeLocations.map((item) => item.code)), true);
  const receivedPlan = createLocationPlan(replenishment, activeLocations);
  assert.equal(isLocationPlanBalanced(receivedPlan, activeLocations.map((item) => item.code)), true);
  assert.equal(receivedPlan.receivedQty, 1);
  assert.equal(receivedPlan.allocations[0]?.location, "A101");

  const productWithoutLocation = { ...replenishment, id: "P04875-no-location", preferredLocation: undefined };
  const manualPlan = createLocationPlan(productWithoutLocation, activeLocations);
  assert.equal(manualPlan.allocations.length, 1);
  assert.equal(manualPlan.allocations[0]?.location, "");
  assert.equal(manualPlan.allocations[0]?.quantity, 1);
  assert.equal(isLocationPlanBalanced(manualPlan, activeLocations.map((item) => item.code)), false);

  const zeroLinePlan = updateReceivedQuantity(dispatchPlan, 0);
  assert.equal(zeroLinePlan.receivedQty, 0);
  assert.deepEqual(zeroLinePlan.allocations, []);
  assert.equal(isLocationPlanBalanced(zeroLinePlan, activeLocations.map((item) => item.code)), true);

  const partialSourcePlan = {
    ...receivedPlan,
    receivedQty: 2,
    allocations: [{ ...receivedPlan.allocations[0], quantity: 2 }],
  };
  const oneReceivedPlan = updateReceivedQuantity(partialSourcePlan, 1);
  assert.equal(oneReceivedPlan.receivedQty, 1);
  assert.equal(oneReceivedPlan.allocations[0]?.quantity, 1);
  assert.equal(isLocationPlanBalanced(oneReceivedPlan, activeLocations.map((item) => item.code)), true);
} finally {
  rmSync(testDir, { recursive: true, force: true });
}

console.log("Recepciones Fase 4: catálogo activo y parcial P04875 verificados");
