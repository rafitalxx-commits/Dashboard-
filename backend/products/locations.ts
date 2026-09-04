import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ProductLocation = {
  productId: number;
  code: string;
  row: string;
  shelf: string;
  height: string;
  quantity: number;
  preferred: boolean;
  replenishmentMin?: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductLocationChange = {
  id: string;
  productId: number;
  code: string;
  previousQuantity: number;
  quantity: number;
  reason: "manual" | "replenishment" | "inventory" | "odoo_movement";
  createdAt: string;
};

export type OdooMovementSyncResult = {
  processed: number;
  applied: number;
  skipped: number;
  warnings: string[];
  baselineAt?: string;
  lastSyncedAt?: string;
};

type Store = {
  version: 2;
  locations: ProductLocation[];
  changes: ProductLocationChange[];
  odooMovementSync?: {
    baselineAt: string;
    lastSyncedAt: string;
    processedMoveIds: number[];
  };
};
const empty = (): Store => ({ version: 2, locations: [], changes: [] });

/** A101 means row A, shelf 1 and height 01.  P/V are not location concepts. */
export function parseLocationCode(input: unknown) {
  const code = String(input ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const match = code.match(/^([A-Z]+)(\d+)(\d{2})$/);
  if (!match) throw new Error("Ubicación inválida. Usa Fila + Estantería + Altura, por ejemplo A101");
  return { code, row: match[1], shelf: match[2], height: match[3] };
}

export function createProductLocations(options: { dataDir?: string } = {}) {
  const dataDir = options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data";
  const file = join(dataDir, "product-locations.json");
  const read = (): Store => {
    try {
      const stored = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Partial<Store> : empty();
      return {
        version: 2,
        locations: stored.locations || [],
        changes: stored.changes || [],
        odooMovementSync: stored.odooMovementSync,
      };
    }
    catch { return empty(); }
  };
  const write = (store: Store) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 }); };
  const forProduct = (productId: number) => read().locations.filter((item) => item.productId === productId).sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.code.localeCompare(b.code));
  const save = (input: { productId: number; code: unknown; quantity?: unknown; preferred?: unknown; replenishmentMin?: unknown; reason?: "manual" | "replenishment" }) => {
    const productId = Number(input.productId);
    if (!Number.isInteger(productId) || productId <= 0) throw new Error("Producto inválido");
    const location = parseLocationCode(input.code);
    const quantity = Number(input.quantity ?? 0);
    if (!Number.isFinite(quantity)) throw new Error("Cantidad inválida");
    const minimum = input.replenishmentMin === undefined || input.replenishmentMin === "" ? undefined : Number(input.replenishmentMin);
    if (minimum !== undefined && (!Number.isFinite(minimum) || minimum < 0)) throw new Error("Mínimo de reposición inválido");
    const store = read(); const now = new Date().toISOString(); const index = store.locations.findIndex((item) => item.productId === productId && item.code === location.code);
    const previous = index >= 0 ? store.locations[index] : undefined;
    const preferred = input.preferred === undefined ? previous?.preferred ?? false : Boolean(input.preferred);
    if (preferred) store.locations = store.locations.map((item) => item.productId === productId ? { ...item, preferred: false, replenishmentMin: undefined } : item);
    const value: ProductLocation = { productId, ...location, quantity, preferred, replenishmentMin: preferred ? minimum : undefined, createdAt: previous?.createdAt ?? now, updatedAt: now };
    if (index >= 0) store.locations[index] = value; else store.locations.push(value);
    if ((previous?.quantity ?? 0) !== quantity) store.changes.unshift({ id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, productId, code: location.code, previousQuantity: previous?.quantity ?? 0, quantity, reason: input.reason === "replenishment" ? "replenishment" : "manual", createdAt: now });
    write(store); return { location: value, locations: forProductFrom(store, productId) };
  };
  const remove = (productId: number, code: unknown) => {
    const parsed = parseLocationCode(code); const store = read(); const before = store.locations.length;
    store.locations = store.locations.filter((item) => !(item.productId === productId && item.code === parsed.code));
    if (store.locations.length === before) throw new Error("Ubicación no encontrada"); write(store); return { locations: forProductFrom(store, productId) };
  };
  const transfer = (input: { productId: number; fromCode: unknown; toCode: unknown; quantity: unknown }) => {
    const productId = Number(input.productId); const from = parseLocationCode(input.fromCode); const to = parseLocationCode(input.toCode); const quantity = Number(input.quantity);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error("Movimiento de reposición inválido");
    if (from.code === to.code) throw new Error("El origen y el destino deben ser distintos");
    const store = read(); const fromIndex = store.locations.findIndex((item) => item.productId === productId && item.code === from.code);
    if (fromIndex < 0) throw new Error("Ubicación de origen no encontrada");
    const source = store.locations[fromIndex]; if (source.quantity < quantity) throw new Error("No hay cantidad suficiente en la ubicación de origen");
    const toIndex = store.locations.findIndex((item) => item.productId === productId && item.code === to.code); const target = toIndex >= 0 ? store.locations[toIndex] : undefined; const now = new Date().toISOString();
    store.locations[fromIndex] = { ...source, quantity: source.quantity - quantity, updatedAt: now };
    const destination: ProductLocation = target ? { ...target, quantity: target.quantity + quantity, updatedAt: now } : { productId, ...to, quantity, preferred: false, createdAt: now, updatedAt: now };
    if (toIndex >= 0) store.locations[toIndex] = destination; else store.locations.push(destination);
    store.changes.unshift({ id: `loc-${Date.now()}-to`, productId, code: to.code, previousQuantity: target?.quantity ?? 0, quantity: destination.quantity, reason: "replenishment", createdAt: now }, { id: `loc-${Date.now()}-from`, productId, code: from.code, previousQuantity: source.quantity, quantity: source.quantity - quantity, reason: "replenishment", createdAt: now });
    write(store); return { locations: forProductFrom(store, productId) };
  };
  type InventoryCountInput = { productId: number; locationCode: string; quantity: number };
  const inventoryTotalsAfterReplace = (counts: InventoryCountInput[]) => {
    const store = read();
    const quantities = new Map<string, { productId: number; quantity: number }>();
    for (const item of store.locations) quantities.set(`${item.productId}:${item.code}`, { productId: item.productId, quantity: item.quantity });
    const affectedProductIds = new Set<number>();
    for (const count of counts) {
      const productId = Number(count.productId); const location = parseLocationCode(count.locationCode); const quantity = Number(count.quantity);
      if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity < 0) throw new Error("Conteo de inventario inválido");
      quantities.set(`${productId}:${location.code}`, { productId, quantity });
      affectedProductIds.add(productId);
    }
    const totals: Record<number, number> = {};
    for (const productId of affectedProductIds) totals[productId] = 0;
    for (const item of quantities.values()) if (affectedProductIds.has(item.productId)) totals[item.productId] += item.quantity;
    return totals;
  };
  const replaceFromInventory = (counts: InventoryCountInput[], baselineAt = new Date().toISOString()) => {
    const store = read(); const now = new Date().toISOString();
    for (const count of counts) {
      const productId = Number(count.productId); const location = parseLocationCode(count.locationCode); const quantity = Number(count.quantity);
      if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity < 0) throw new Error("Conteo de inventario inválido");
      const index = store.locations.findIndex((item) => item.productId === productId && item.code === location.code);
      const previous = index >= 0 ? store.locations[index] : undefined;
      const value: ProductLocation = {
        productId, ...location, quantity, preferred: previous?.preferred ?? !store.locations.some((item) => item.productId === productId && item.preferred),
        replenishmentMin: previous?.replenishmentMin,
        createdAt: previous?.createdAt ?? now, updatedAt: now,
      };
      if (index >= 0) store.locations[index] = value; else store.locations.push(value);
      if ((previous?.quantity ?? 0) !== quantity) store.changes.unshift({ id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, productId, code: location.code, previousQuantity: previous?.quantity ?? 0, quantity, reason: "inventory", createdAt: now });
    }
    // Only the first partial inventory establishes the Odoo movement watermark.
    // Later zone counts replace their own location and retain the watermark, so
    // Odoo moves are neither replayed nor forgotten after each new zone.
    if (!store.odooMovementSync) store.odooMovementSync = { baselineAt, lastSyncedAt: baselineAt, processedMoveIds: [] };
    write(store); return { locations: store.locations, baselineAt: store.odooMovementSync.baselineAt };
  };
  const applyOdooMovements = (input: { moves: Array<{ id: number; productId: number; quantity: number; direction: "in" | "out" }>; syncedAt?: string }): OdooMovementSyncResult => {
    const store = read(); const state = store.odooMovementSync;
    if (!state) throw new Error("Primero finaliza un inventario para crear la base de ubicaciones");
    const known = new Set(state.processedMoveIds); const warnings: string[] = []; let processed = 0; let applied = 0; let skipped = 0; const now = new Date().toISOString();
    for (const move of input.moves) {
      if (!Number.isInteger(move.id) || known.has(move.id)) { skipped += 1; continue; }
      known.add(move.id); processed += 1;
      const quantity = Number(move.quantity);
      const locations = store.locations.filter((item) => item.productId === Number(move.productId));
      const preferred = locations.find((item) => item.preferred);
      if (!Number.isFinite(quantity) || quantity <= 0 || !preferred) {
        warnings.push(`Movimiento ${move.id}: producto sin ubicación preferente o cantidad inválida.`); continue;
      }
      if (move.direction === "in") {
        preferred.quantity += quantity; preferred.updatedAt = now;
        store.changes.unshift({ id: `odoo-${move.id}`, productId: preferred.productId, code: preferred.code, previousQuantity: preferred.quantity - quantity, quantity: preferred.quantity, reason: "odoo_movement", createdAt: now }); applied += 1;
        continue;
      }
      let pending = quantity;
      const sources = [preferred, ...locations.filter((item) => item.code !== preferred.code).sort((a, b) => a.code.localeCompare(b.code))];
      for (const source of sources) {
        if (!pending) break;
        const used = Math.min(source.quantity, pending); if (!used) continue;
        const before = source.quantity; source.quantity -= used; source.updatedAt = now; pending -= used;
        store.changes.unshift({ id: `odoo-${move.id}-${source.code}`, productId: source.productId, code: source.code, previousQuantity: before, quantity: source.quantity, reason: "odoo_movement", createdAt: now });
      }
      if (pending > 0) warnings.push(`Movimiento ${move.id}: faltan ${pending} uds. por ubicar; revisa el reparto físico.`);
      applied += 1;
    }
    state.processedMoveIds = [...known].slice(-50000); state.lastSyncedAt = input.syncedAt || now; write(store);
    return { processed, applied, skipped, warnings, baselineAt: state.baselineAt, lastSyncedAt: state.lastSyncedAt };
  };
  return { forProduct, save, remove, transfer, inventoryTotalsAfterReplace, replaceFromInventory, applyOdooMovements, summary: () => read() };
}

function forProductFrom(store: Store, productId: number) { return store.locations.filter((item) => item.productId === productId).sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.code.localeCompare(b.code)); }
