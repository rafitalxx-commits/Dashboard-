import type {
  InventoryReceptionLine,
  ReceptionLocationAllocation,
  ReceptionLocationPlan,
} from "../../services/odooTypes";

export function createLocationPlan(line: InventoryReceptionLine): ReceptionLocationPlan {
  return {
    receivedQty: line.pendingQty,
    allocations: line.preferredLocation
      ? [{ id: `${line.id}-preferred`, location: line.preferredLocation, quantity: line.pendingQty }]
      : [],
    ready: false,
  };
}

export function allocatedQuantity(allocations: ReceptionLocationAllocation[]) {
  return allocations.reduce((total, allocation) => total + normalizedQuantity(allocation.quantity), 0);
}

export function isLocationPlanBalanced(plan: ReceptionLocationPlan) {
  return plan.receivedQty > 0
    && plan.allocations.length > 0
    && plan.allocations.every((allocation) => allocation.location.trim().length > 0)
    && Math.abs(allocatedQuantity(plan.allocations) - plan.receivedQty) < 0.0001;
}

export function normalizedQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
}
