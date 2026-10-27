import type { ProductLocation } from "./locations";

type CatalogLocation = Pick<ProductLocation, "code" | "quantity" | "preferred">;

/** Join Dashboard-owned locations to catalog rows without changing either store. */
export function withCatalogLocations<T extends { id: number }>(
  products: T[],
  locations: ProductLocation[],
) {
  const byProduct = new Map<number, ProductLocation[]>();
  for (const location of locations) {
    const rows = byProduct.get(location.productId) ?? [];
    rows.push(location);
    byProduct.set(location.productId, rows);
  }
  return products.map((product) => {
    const sourceLocations = [...(byProduct.get(product.id) ?? [])].sort(
      (left, right) => Number(right.preferred) - Number(left.preferred) || left.code.localeCompare(right.code, "es"),
    );
    const localLocations: CatalogLocation[] = sourceLocations.map(({ code, quantity, preferred }) => ({ code, quantity, preferred }));
    const preferred = sourceLocations.find((location) => location.preferred);
    return {
      ...product,
      localLocations,
      physicalLocations: localLocations.map((location) => location.code),
      locationSummary: {
        preferredCode: preferred?.code,
        preferredQuantity: preferred?.quantity,
        replenishmentMin: preferred?.replenishmentMin,
        needsReplenishment: Boolean(
          preferred &&
          preferred.replenishmentMin !== undefined &&
          preferred.quantity <= preferred.replenishmentMin
        ),
      },
    };
  });
}
