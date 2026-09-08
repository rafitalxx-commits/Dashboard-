import assert from "node:assert/strict";
import { buildSaleOrderAllocationsByReceptionMove, buildSaleOrderRefsByReceptionMove } from "../backend/receptions/traceability.ts";
import { allocatedQuantity, isLocationPlanBalanced } from "../src/modules/receptions/locationPlan.ts";

const traced = buildSaleOrderRefsByReceptionMove(
  [1, 10, 20, 30],
  [
    { id: 1, move_dest_ids: [2], purchase_line_id: [101, "POL"] },
    { id: 2, move_dest_ids: [3] },
    { id: 3, move_dest_ids: [2], sale_line_id: [201, "SOL"] },
    { id: 10, purchase_line_id: [110, "POL"] },
    { id: 20, purchase_line_id: [120, "POL"] },
    { id: 30 },
  ],
  [
    { id: 101 },
    { id: 110, sale_order_id: [310, "S100310"] },
    { id: 120, sale_line_id: [220, "SOL"] },
  ],
  [
    { id: 201, order_id: [301, "S100301"] },
    { id: 220, order_id: [320, "S100320"] },
  ],
);

assert.deepEqual(traced.get(1), ["S100301"], "follows downstream moves and survives a cycle");
assert.deepEqual(traced.get(10), ["S100310"], "uses the direct purchase-line sale order relation");
assert.deepEqual(traced.get(20), ["S100320"], "uses the purchase-line sale-line relation");
assert.deepEqual(traced.get(30), [], "does not classify an unrelated receipt as under order");

const allocations = buildSaleOrderAllocationsByReceptionMove(
  new Map([[1, 10], [10, 8], [20, 4], [30, 5]]),
  [
    { id: 1, move_dest_ids: [2], purchase_line_id: [101, "POL"] },
    { id: 2, state: "waiting", product_uom_qty: 3, move_dest_ids: [3], sale_line_id: [201, "SOL"] },
    { id: 3, state: "assigned", product_uom_qty: 3, sale_line_id: [201, "SOL"] },
    { id: 10, purchase_line_id: [110, "POL"] },
    { id: 20, purchase_line_id: [120, "POL"] },
    { id: 30, move_dest_ids: [31, 32] },
    { id: 31, state: "assigned", product_uom_qty: 4, sale_line_id: [231, "SOL"] },
    { id: 32, state: "assigned", product_uom_qty: 4, sale_line_id: [232, "SOL"] },
  ],
  [
    { id: 101 },
    { id: 110, sale_order_id: [310, "S100310"] },
    { id: 120, sale_line_id: [220, "SOL"] },
  ],
  [
    { id: 201, order_id: [301, "S100301"] },
    { id: 220, order_id: [320, "S100320"] },
    { id: 231, order_id: [330, "S100330"] },
    { id: 232, order_id: [331, "S100331"] },
  ],
);
assert.deepEqual(allocations.get(1), [{ saleOrderRef: "S100301", quantity: 3 }], "counts only the final leg of a multi-step sale route");
assert.deepEqual(allocations.get(10), [{ saleOrderRef: "S100310", quantity: 8 }], "assigns a directly related purchase line in full");
assert.deepEqual(allocations.get(20), [{ saleOrderRef: "S100320", quantity: 4 }], "uses the direct sale-line relation in full");
assert.deepEqual(allocations.get(30), [
  { saleOrderRef: "S100330", quantity: 4 },
  { saleOrderRef: "S100331", quantity: 1 },
], "caps linked demand to the still-pending supplier quantity");

const balancedPlan = {
  receivedQty: 200,
  allocations: [
    { id: "a", location: "A-03", quantity: 20 },
    { id: "b", location: "PALLET-05", quantity: 100 },
    { id: "c", location: "PALLET-06", quantity: 80 },
  ],
  ready: false,
};
assert.equal(allocatedQuantity(balancedPlan.allocations), 200);
assert.equal(isLocationPlanBalanced(balancedPlan), true);
assert.equal(isLocationPlanBalanced({ ...balancedPlan, receivedQty: 199 }), false);
assert.equal(isLocationPlanBalanced({
  ...balancedPlan,
  allocations: [{ id: "empty", location: "", quantity: 200 }],
}), false, "requires a real location for every quantity");

console.log("Recepciones Fase 2: trazabilidad y reparto verificados");
