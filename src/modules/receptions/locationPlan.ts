import type {
  InventoryReceptionLine,
  LocationCatalogEntry,
  ReceptionLocationAllocation,
  ReceptionLocationPlan,
} from "../../services/odooTypes";

export const DISPATCH_PENDING_LOCATION = "PENDIENTE_ENVIO";

export function createLocationPlan(
  line: InventoryReceptionLine,
  locations: LocationCatalogEntry[] = [],
): ReceptionLocationPlan {
  const activeCodes = new Set(locations.filter((item) => item.active).map((item) => item.code));
  const dispatchQty = Math.min(line.pendingQty, Math.max(0, line.pendingShipmentQty ?? (line.classification === "under_order" ? line.pendingQty : 0)));
  const warehouseQty = Math.max(0, line.pendingQty - dispatchQty);
  const allocations: ReceptionLocationAllocation[] = [];
  if (dispatchQty > 0 && activeCodes.has(DISPATCH_PENDING_LOCATION)) {
    allocations.push({ id: `${line.id}-dispatch`, location: DISPATCH_PENDING_LOCATION, quantity: dispatchQty });
  }
  if (warehouseQty > 0) {
    allocations.push({
      id: `${line.id}-preferred`,
      location: line.preferredLocation && activeCodes.has(line.preferredLocation) ? line.preferredLocation : "",
      quantity: warehouseQty,
    });
  }
  return {
    receivedQty: line.pendingQty,
    allocations,
    ready: false,
  };
}

export function allocatedQuantity(allocations: ReceptionLocationAllocation[]) {
  return allocations.reduce((total, allocation) => total + normalizedQuantity(allocation.quantity), 0);
}

export function updateReceivedQuantity(
  plan: ReceptionLocationPlan,
  value: unknown,
): ReceptionLocationPlan {
  const receivedQty = normalizedQuantity(value);
  const allocations = receivedQty === 0
    ? []
    : plan.allocations.length === 1
      ? [{ ...plan.allocations[0], quantity: receivedQty }]
      : plan.allocations;

  return { ...plan, receivedQty, allocations, ready: false };
}

export function isLocationPlanBalanced(
  plan: ReceptionLocationPlan,
  activeLocationCodes?: Iterable<string>,
) {
  const active = activeLocationCodes ? new Set(activeLocationCodes) : undefined;
  if (plan.receivedQty === 0) return plan.allocations.length === 0;
  return plan.receivedQty > 0
    && plan.allocations.length > 0
    && plan.allocations.every((allocation) => allocation.location.trim().length > 0 && (!active || active.has(allocation.location)))
    && Math.abs(allocatedQuantity(plan.allocations) - plan.receivedQty) < 0.0001;
}

export function normalizedQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
}
