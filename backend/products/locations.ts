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

export type LocationCatalogEntry = {
  code: string;
  label: string;
  kind: "physical" | "dispatch";
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export const DISPATCH_PENDING_LOCATION = "PENDIENTE_ENVIO";

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
  version: 3;
  locations: ProductLocation[];
  locationCatalog: LocationCatalogEntry[];
  changes: ProductLocationChange[];
  odooMovementSync?: {
    baselineAt: string;
    lastSyncedAt: string;
    processedMoveIds: number[];
  };
};
const empty = (): Store => ({ version: 3, locations: [], locationCatalog: [], changes: [] });

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
      const locations = stored.locations || [];
      const now = new Date().toISOString();
      const catalogByCode = new Map(
        (stored.locationCatalog || []).map((item) => [item.code, item]),
      );
      for (const location of locations) {
        if (!catalogByCode.has(location.code)) {
          catalogByCode.set(location.code, {
            code: location.code,
            label: location.code,
            kind: "physical",
            active: true,
            createdAt: location.createdAt || now,
            updatedAt: location.updatedAt || now,
          });
        }
      }
      catalogByCode.set(DISPATCH_PENDING_LOCATION, {
        ...(catalogByCode.get(DISPATCH_PENDING_LOCATION) || {
          createdAt: now,
        }),
        code: DISPATCH_PENDING_LOCATION,
        label: "Pendiente de envío",
        kind: "dispatch",
        active: true,
        updatedAt: catalogByCode.get(DISPATCH_PENDING_LOCATION)?.updatedAt || now,
      });
      return {
        version: 3,
        locations,
        locationCatalog: [...catalogByCode.values()],
        changes: stored.changes || [],
        odooMovementSync: stored.odooMovementSync,
      };
    }
    catch { return empty(); }
  };
  const write = (store: Store) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 }); };
  const catalog = (activeOnly = false) => read().locationCatalog
    .filter((item) => !activeOnly || item.active)
    .sort((left, right) => Number(right.active) - Number(left.active) || left.label.localeCompare(right.label, "es"));
  const requireActive = (store: Store, code: unknown, kind?: LocationCatalogEntry["kind"]) => {
    const normalized = String(code ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    const entry = store.locationCatalog.find((item) => item.code === normalized && item.active);
    if (!entry || (kind && entry.kind !== kind)) {
      throw new Error("Selecciona una ubicación activa del catálogo de Productos → Ubicaciones");
    }
    return entry;
  };
  const saveCatalogEntry = (input: { code?: unknown; active?: unknown }) => {
    const parsed = parseLocationCode(input.code);
    const store = read();
    const now = new Date().toISOString();
    const index = store.locationCatalog.findIndex((item) => item.code === parsed.code);
    const previous = index >= 0 ? store.locationCatalog[index] : undefined;
    const value: LocationCatalogEntry = {
      code: parsed.code,
      label: parsed.code,
      kind: "physical",
      active: input.active === undefined ? previous?.active ?? true : Boolean(input.active),
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    if (index >= 0) store.locationCatalog[index] = value;
    else store.locationCatalog.push(value);
    write(store);
    return { location: value, locations: catalogFrom(store) };
  };
  const setCatalogEntryActive = (code: unknown, active: unknown) => {
    const normalized = String(code ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    if (normalized === DISPATCH_PENDING_LOCATION && !Boolean(active)) {
      throw new Error("Pendiente de envío debe permanecer activa para las líneas Bajo pedido");
    }
    const store = read();
    const index = store.locationCatalog.findIndex((item) => item.code === normalized);
    if (index < 0) throw new Error("Ubicación de catálogo no encontrada");
    store.locationCatalog[index] = {
      ...store.locationCatalog[index],
      active: Boolean(active),
      updatedAt: new Date().toISOString(),
    };
    write(store);
    return { location: store.locationCatalog[index], locations: catalogFrom(store) };
  };
  const forProduct = (productId: number) => read().locations.filter((item) => item.productId === productId).sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.code.localeCompare(b.code));
  const save = (input: { productId: number; code: unknown; quantity?: unknown; preferred?: unknown; replenishmentMin?: unknown; reason?: "manual" | "replenishment" }) => {
    const productId = Number(input.productId);
    if (!Number.isInteger(productId) || productId <= 0) throw new Error("Producto inválido");
    const location = parseLocationCode(input.code);
    const quantity = Number(input.quantity ?? 0);
    if (!Number.isFinite(quantity)) throw new Error("Cantidad inválida");
    const minimum = input.replenishmentMin === undefined || input.replenishmentMin === "" ? undefined : Number(input.replenishmentMin);
    if (minimum !== undefined && (!Number.isFinite(minimum) || minimum < 0)) throw new Error("Mínimo de reposición inválido");
    const store = read(); requireActive(store, location.code, "physical"); const now = new Date().toISOString(); const index = store.locations.findIndex((item) => item.productId === productId && item.code === location.code);
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
    const store = read(); requireActive(store, from.code, "physical"); requireActive(store, to.code, "physical"); const fromIndex = store.locations.findIndex((item) => item.productId === productId && item.code === from.code);
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
      const productId = Number(count.productId); const location = parseLocationCode(count.locationCode); requireActive(store, location.code, "physical"); const quantity = Number(count.quantity);
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
      const productId = Number(count.productId); const location = parseLocationCode(count.locationCode); requireActive(store, location.code, "physical"); const quantity = Number(count.quantity);
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
  return {
    forProduct,
    catalog,
    saveCatalogEntry,
    setCatalogEntryActive,
    isActive: (code: unknown, kind?: LocationCatalogEntry["kind"]) => {
      try { requireActive(read(), code, kind); return true; } catch { return false; }
    },
    save,
    remove,
    transfer,
    inventoryTotalsAfterReplace,
    replaceFromInventory,
    applyOdooMovements,
    summary: () => read(),
  };
}

function forProductFrom(store: Store, productId: number) { return store.locations.filter((item) => item.productId === productId).sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.code.localeCompare(b.code)); }
function catalogFrom(store: Store) { return [...store.locationCatalog].sort((left, right) => Number(right.active) - Number(left.active) || left.label.localeCompare(right.label, "es")); }
