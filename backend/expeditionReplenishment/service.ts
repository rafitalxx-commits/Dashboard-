import type { createProductLocations, ProductLocation } from "../products/locations";

export type ReplenishmentItem = {
  productId: number;
  reference: string;
  name: string;
  uom: string;
  preferred: { code: string; quantity: number; active: boolean };
  sources: Array<{ code: string; quantity: number; active: boolean }>;
};
type Locations = ReturnType<typeof createProductLocations>;

export function createExpeditionReplenishment(locations: Locations, catalog: { list: () => { products: Array<{ id: number; reference: string; name: string; uom: string }> } }) {
  const list = (): ReplenishmentItem[] => {
    const snapshot = locations.summary();
    const entries = new Map(snapshot.locationCatalog.map((item) => [item.code, item]));
    const products = new Map(catalog.list().products.map((item) => [item.id, item]));
    const groups = new Map<number, ProductLocation[]>();
    for (const location of snapshot.locations) {
      const group = groups.get(location.productId) ?? [];
      group.push(location);
      groups.set(location.productId, group);
    }
    const items: ReplenishmentItem[] = [];
    for (const [productId, group] of groups) {
      const preferences = group.filter((item) => item.preferred);
      // Do not invent a preferred location for legacy/malformed assignments.
      if (preferences.length !== 1) continue;
      const preferred = preferences[0];
      if (!Number.isFinite(preferred.quantity) || preferred.quantity > 0 || entries.get(preferred.code)?.kind !== "physical") continue;
      const sources = group.filter((item) => item.code !== preferred.code && Number.isFinite(item.quantity) && item.quantity > 0 && entries.get(item.code)?.kind === "physical")
        .map((item) => ({ code: item.code, quantity: item.quantity, active: entries.get(item.code)?.active === true }))
        .sort((a, b) => a.code.localeCompare(b.code));
      if (!sources.length) continue;
      const product = products.get(productId);
      items.push({ productId, reference: product?.reference || `#${productId}`, name: product?.name || "Producto sin ficha en catálogo", uom: product?.uom || "uds",
        preferred: { code: preferred.code, quantity: preferred.quantity, active: entries.get(preferred.code)?.active === true }, sources });
    }
    return items.sort((a, b) => a.preferred.quantity - b.preferred.quantity || a.reference.localeCompare(b.reference, "es"));
  };
  const transfer = (input: { productId: number; fromCode: string; toCode: string; quantity: number; requestId: string }) => {
    if (!input.requestId || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestId)) throw new Error("Identificador de movimiento inválido");
    // A lost response may be retried with the same identity; the ledger saves its identity together with the balances.
    if (!locations.summary().transferRequests?.[input.requestId]) {
      const current = list().find((item) => item.productId === Number(input.productId));
      if (!current || current.preferred.code !== input.toCode) throw new Error("El aviso o la ubicación preferente ha cambiado. Actualiza antes de reponer.");
      if (!current.preferred.active || !current.sources.some((source) => source.code === input.fromCode && source.active)) throw new Error("Selecciona una ubicación física activa con existencias");
    }
    locations.transfer(input);
    return { items: list() };
  };
  return { list, transfer };
}
