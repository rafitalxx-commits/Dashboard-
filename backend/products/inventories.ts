import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type InventoryScope = {
  type: "general" | "products" | "supplier" | "locations";
  productSelection: {
    mode: "all" | "filtered" | "ids";
    ids?: number[];
    query?: string;
    supplier?: string;
    filter?: string;
  };
  allowedLocationCodes: string[];
  /** Products planned in each counted zone. Kept separately so a zone never
   * accidentally exposes the full catalogue during a location inventory. */
  plannedProductIdsByLocation?: Record<string, number[]>;
};

export type ProductInventory = {
  id: string;
  name: string;
  status: "draft" | "in_progress" | "review" | "validated" | "finalized";
  scope: InventoryScope;
  plannedProductIds: number[];
  createdAt: string;
  updatedAt: string;
  operator?: InventoryOperator;
  startedAt?: string;
  finishedAt?: string;
  validatedAt?: string;
  validatedBy?: InventoryOperator;
  finalizedAt?: string;
  sentAt?: string;
  sentBy?: InventoryOperator;
  odooResults?: Array<{ productId: number; before: number; counted: number; changed: boolean; error?: string }>;
  counts: InventoryCount[];
  recountProductIds?: number[];
  recountRevision?: number;
};
export type InventoryOperator = { id: string; code: string; name: string };
export type InventoryCount = {
  id: string; productId: number; locationCode: string; quantity: number;
  operator: InventoryOperator; countedAt: string; revision: number;
};

type CatalogProduct = {
  id: number;
  name: string;
  reference: string;
  barcode: string;
  supplierNames?: string[];
  physicalLocations?: string[];
  onHand?: number;
};
type Store = { version: 1; inventories: ProductInventory[] };
const empty = (): Store => ({ version: 1, inventories: [] });

const cleanCode = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
const validLocation = (value: string) => /^[A-Z]+\d+\d{2}$/.test(value);

export function createProductInventories(options: {
  dataDir?: string;
  catalog: () => CatalogProduct[];
}) {
  const dataDir =
    options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data";
  const file = join(dataDir, "product-inventories.json");
  const read = (): Store => {
    try {
      return existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as Store)
        : empty();
    } catch {
      return empty();
    }
  };
  const write = (store: Store) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  };
  const resolveProducts = (
    selection: InventoryScope["productSelection"],
    catalog: CatalogProduct[],
  ) => {
    if (selection.mode === "all") return catalog.map((product) => product.id);
    if (selection.mode === "ids")
      return [
        ...new Set(
          (selection.ids || [])
            .map(Number)
            .filter((id) => catalog.some((product) => product.id === id)),
        ),
      ];
    const query = String(selection.query || "")
      .trim()
      .toLowerCase();
    const supplier = String(selection.supplier || "");
    const filter = String(selection.filter || "all");
    return catalog
      .filter((product) => {
        if (
          query &&
          ![product.name, product.reference, product.barcode].some((value) =>
            value.toLowerCase().includes(query),
          )
        )
          return false;
        if (supplier && !(product.supplierNames || []).includes(supplier))
          return false;
        if (filter === "ean") return !product.barcode;
        if (filter === "location")
          return !(product.physicalLocations || []).length;
        return true;
      })
      .map((product) => product.id);
  };
  const list = () =>
    read().inventories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const find = (id: string) => {
    const inventory = read().inventories.find((item) => item.id === id);
    if (!inventory) throw new Error("Inventario no encontrado");
    return inventory;
  };
  const save = (inventory: ProductInventory) => {
    const store = read(); const index = store.inventories.findIndex((item) => item.id === inventory.id);
    if (index < 0) throw new Error("Inventario no encontrado");
    store.inventories[index] = inventory; write(store); return inventory;
  };
  const create = (
    input: Partial<ProductInventory> & {
      name?: unknown;
      scope?: Partial<InventoryScope>;
    },
  ) => {
    const type = input.scope?.type;
    if (
      !type ||
      !["general", "products", "supplier", "locations"].includes(type)
    )
      throw new Error("Tipo de inventario inválido");
    const selection = input.scope?.productSelection || { mode: "all" as const };
    if (!(["all", "filtered", "ids"] as string[]).includes(selection.mode))
      throw new Error("Alcance de productos inválido");
    const allowedLocationCodes = [
      ...new Set(
        (input.scope?.allowedLocationCodes || [])
          .map(cleanCode)
          .filter(validLocation),
      ),
    ];
    if (type === "locations" && !allowedLocationCodes.length)
      throw new Error("Indica al menos una ubicación válida");
    const catalog = options.catalog();
    const selectedProductIds = resolveProducts(selection, catalog);
    const plannedProductIdsByLocation =
      type === "locations"
        ? Object.fromEntries(
            allowedLocationCodes.map((code) => [
              code,
              selectedProductIds.filter((productId) =>
                catalog
                  .find((product) => product.id === productId)
                  ?.physicalLocations?.map(cleanCode)
                  .includes(code),
              ),
            ]),
          )
        : undefined;
    const plannedProductIds =
      type === "locations"
        ? [...new Set(Object.values(plannedProductIdsByLocation).flat())]
        : selectedProductIds;
    if (type !== "general" && !plannedProductIds.length)
      throw new Error(type === "locations" ? "No hay productos asignados a esta ubicación" : "El alcance no contiene productos");
    const now = new Date().toISOString();
    const inventory: ProductInventory = {
      id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(input.name || "Inventario").trim() || "Inventario",
      status: "draft",
      scope: {
        type,
        productSelection: selection,
        allowedLocationCodes,
        plannedProductIdsByLocation,
      },
      plannedProductIds,
      createdAt: now,
      updatedAt: now,
      counts: [],
    };
    const store = read();
    store.inventories.unshift(inventory);
    write(store);
    return inventory;
  };
  const start = (id: string, operator: InventoryOperator) => {
    const inventory = find(id);
    if (inventory.status !== "draft" && inventory.status !== "in_progress") throw new Error("El inventario no se puede iniciar");
    inventory.status = "in_progress"; inventory.operator = operator; inventory.startedAt ||= new Date().toISOString(); inventory.updatedAt = new Date().toISOString();
    return save(inventory);
  };
  const count = (id: string, input: { productId: number; locationCode: string; quantity: number; operator: InventoryOperator; revision?: number }) => {
    const inventory = find(id);
    if (inventory.status !== "in_progress") throw new Error("El conteo está bloqueado. Abre un reconteo para corregir cantidades");
    const code = cleanCode(input.locationCode);
    if (!validLocation(code)) throw new Error("Ubicación no válida");
    if (inventory.scope.allowedLocationCodes.length && !inventory.scope.allowedLocationCodes.includes(code)) throw new Error("Ubicación fuera del alcance de este inventario");
    const productId = Number(input.productId);
    const zoneProducts = inventory.scope.plannedProductIdsByLocation?.[code];
    if (!inventory.plannedProductIds.includes(productId) || (zoneProducts && !zoneProducts.includes(productId)) || (inventory.recountProductIds?.length && !inventory.recountProductIds.includes(productId))) throw new Error("Producto fuera del alcance de este inventario");
    const quantity = Math.max(0, Math.floor(Number(input.quantity) || 0)); const now = new Date().toISOString();
    // A recount never overwrites the original count: it creates a new,
    // auditable revision that becomes the effective quantity for that line.
    const revision = inventory.recountProductIds?.length
      ? Math.max(2, Number(inventory.recountRevision) || 2)
      : 1;
    const existing = inventory.counts.find((item) => item.productId === Number(input.productId) && item.locationCode === code && item.revision === revision);
    const entry: InventoryCount = { id: existing?.id || `count-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, productId: Number(input.productId), locationCode: code, quantity, operator: input.operator, countedAt: now, revision };
    inventory.counts = existing ? inventory.counts.map((item) => item.id === existing.id ? entry : item) : [...inventory.counts, entry]; inventory.updatedAt = now;
    return save(inventory);
  };
  const status = (id: string, action: "review" | "validate", operator?: InventoryOperator) => {
    const inventory = find(id); const now = new Date().toISOString();
    if (action === "review") { if (inventory.status !== "in_progress") throw new Error("El conteo no está activo"); inventory.status = "review"; inventory.finishedAt = now; inventory.recountProductIds = undefined; inventory.recountRevision = undefined; }
    else { if (inventory.status !== "review") throw new Error("El inventario debe estar en revisión"); inventory.status = "validated"; inventory.validatedAt = now; inventory.validatedBy = operator; }
    inventory.updatedAt = now; return save(inventory);
  };
  const recount = (id: string, productIds: number[]) => {
    const inventory = find(id); if (inventory.status !== "review") throw new Error("El inventario debe estar en revisión");
    const selected = [...new Set(productIds.map(Number))].filter((productId) => inventory.plannedProductIds.includes(productId));
    if (!selected.length) throw new Error("Selecciona al menos un producto para recontar");
    const nextRevision = Math.max(1, ...inventory.counts.map((count) => count.revision || 1)) + 1;
    inventory.status = "in_progress"; inventory.recountProductIds = selected; inventory.recountRevision = nextRevision; inventory.updatedAt = new Date().toISOString(); return save(inventory);
  };
  const finalize = (id: string, operator: InventoryOperator, results: ProductInventory["odooResults"]) => {
    const inventory = find(id);
    if (inventory.status !== "validated") throw new Error("Primero valida el inventario");
    if (results.some((result) => result.error)) throw new Error("Hay referencias con error; revisa y reintenta solo las fallidas");
    inventory.status = "finalized"; inventory.sentAt = new Date().toISOString(); inventory.finalizedAt = inventory.sentAt; inventory.sentBy = operator; inventory.odooResults = results; inventory.updatedAt = inventory.sentAt;
    return save(inventory);
  };
  return { create, list, find, start, count, status, recount, finalize };
}
