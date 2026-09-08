import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductLocations, DISPATCH_PENDING_LOCATION } from "../backend/products/locations.ts";
import { createPendingReceipts } from "../backend/receptions/pendingReceipts.ts";
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

  const mixedPlan = createLocationPlan({
    ...replenishment,
    id: "P04875-line-mixed",
    pendingQty: 10,
    expectedQty: 10,
    classification: "mixed",
    saleOrderRefs: ["S100001"],
    saleOrderAllocations: [{ saleOrderRef: "S100001", quantity: 3 }],
    pendingShipmentQty: 3,
    warehouseStockQty: 7,
  }, activeLocations);
  assert.deepEqual(mixedPlan.allocations, [
    { id: "P04875-line-mixed-dispatch", location: DISPATCH_PENDING_LOCATION, quantity: 3 },
    { id: "P04875-line-mixed-preferred", location: "A101", quantity: 7 },
  ]);
  assert.equal(isLocationPlanBalanced(mixedPlan, activeLocations.map((item) => item.code)), true);

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

  const pendingReceipts = createPendingReceipts({ dataDir: testDir });
  const saved = pendingReceipts.save({ receptionId: "115975", receptionRef: "ALM/IN/05245", purchaseRef: "P04924", supplier: "Proveedor", operatorId: "OP005", operatorName: "Rafa", lines: [
    { lineId: "tebbde27", productId: "43004", sku: "TEBBDE27", name: "Producto 1", orderedQty: 40, receivedQty: 10, pendingQty: 30 },
    { lineId: "te4517po", productId: "35645", sku: "TE4517PO", name: "Producto 2", orderedQty: 20, receivedQty: 5, pendingQty: 15 },
  ] });
  assert.equal(saved.receipt.purchaseRef, "P04924");
  assert.deepEqual(saved.receipt.lines.map((line) => [line.sku, line.pendingQty]), [["TEBBDE27", 30], ["TE4517PO", 15]]);
  assert.equal(pendingReceipts.list().length, 1);
  for (let index = 0; index < 30; index += 1) {
    pendingReceipts.saveHistory({
      receptionId: `history-${index}`,
      receptionRef: `ALM/IN/${String(index).padStart(5, "0")}`,
      purchaseRef: `P${index}`,
      supplier: "Proveedor",
      operatorId: "OP005",
      operatorName: "Rafa",
      outcome: "total",
      lines: [],
    });
  }
  const firstHistoryPage = pendingReceipts.listHistory({ limit: 25, offset: 0 });
  const secondHistoryPage = pendingReceipts.listHistory({ limit: 25, offset: 25 });
  assert.equal(firstHistoryPage.entries.length, 25);
  assert.equal(secondHistoryPage.entries.length, 6);
  assert.equal(firstHistoryPage.total, 31);
  assert.equal(pendingReceipts.listHistory({ limit: Number.NaN }).limit, 25);
} finally {
  rmSync(testDir, { recursive: true, force: true });
}

console.log("Recepciones Fase 4: catálogo activo y parcial P04875 verificados");
