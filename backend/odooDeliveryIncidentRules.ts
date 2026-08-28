export type DeliveryIncidentOrderLine = {
  product_id?: false | [number, string];
};

export function isClosedOdooDelivery(state?: string) {
  return state === "done" || state === "cancel";
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
