import assert from "node:assert/strict";
import { buildSaleOrderRefsByReceptionMove } from "../backend/receptions/traceability.ts";
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
