export type DeliveryIncidentOrderLine = {
  product_id?: false | [number, string];
};

export function isClosedOdooDelivery(state?: string) {
  return state === "done" || state === "cancel";
}

// A missing Dashboard label is a normal prerequisite, not a failed Odoo delivery.
// Keep it visible on the order as "Sin etiqueta dashboard", but out of the
// operational incident queue until a labelled delivery actually fails.
export function isReportableDeliveryIncidentReason(reason: string) {
  const normalized = reason.trim().toLowerCase();
  return normalized !== "no hay una etiqueta válida creada desde el dashboard." &&
    normalized !== "no hay una etiqueta de envío válida con seguimiento." &&
    normalized !== "no hay una etiqueta generada y vinculada al pedido en dashboard.";
}

export function isDeliveryIncidentStillPending(
  pickingState: string | undefined,
  hasPicking: boolean,
  serviceOnly: boolean,
) {
  if (isClosedOdooDelivery(pickingState)) return false;
  return hasPicking || !serviceOnly;
}

export function isServiceOnlyOrder(
  lines: DeliveryIncidentOrderLine[],
  productTypes: Map<number, string>,
) {
  return lines.length > 0 && lines.every((line) => {
    const productId = Array.isArray(line.product_id) ? line.product_id[0] : 0;
    return productTypes.get(productId) === "service";
  });
}
