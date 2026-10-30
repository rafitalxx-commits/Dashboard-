import type { createProductLocations, LocationMovement } from "./locations.ts";

type Read = (model: string, args: unknown[], kwargs: Record<string, unknown>) => Promise<any[]>;
const relation = (value: unknown) => Array.isArray(value) ? Number(value[0]) : Number(value) || 0;
const sqlDate = (value: string) => new Date(value).toISOString().slice(0, 19).replace("T", " ");

/** Only customer -> sellable warehouse entries. No RPC writes, no quantity inference. */
export async function readCustomerReturnMovements(read: Read, since: string, until: string): Promise<LocationMovement[]> {
  const pages = async (model: string, domain: unknown[], fields: string[]) => {
    const all: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await read(model, [domain], { fields, order: "id asc", limit: 1000, offset, ...(["product.product", "uom.uom"].includes(model) ? { context: { active_test: false } } : {}) });
      all.push(...page);
      if (page.length < 1000) return all;
    }
  };
  const roots = await read("stock.location", [[["complete_name", "=", "ALM/Stock"]]], { fields: ["id"], limit: 2 });
  if (roots.length !== 1) throw new Error("No se pudo identificar un único ALM/Stock para las devoluciones");
  const warehouse = await pages("stock.location", [["id", "child_of", roots[0].id], ["usage", "=", "internal"], ["scrap_location", "=", false]], ["id"]);
  const warehouseIds = new Set(warehouse.map((row) => row.id));
  const moves = await pages("stock.move", [
    ["state", "=", "done"], ["scrapped", "=", false],
    ["write_date", ">=", sqlDate(since)], ["write_date", "<=", sqlDate(until)],
    ["location_id.usage", "=", "customer"], ["location_dest_id", "in", [...warehouseIds]],
  ], ["id", "product_id", "quantity", "product_uom", "state", "scrapped", "location_id", "location_dest_id", "write_date", "picking_id", "origin", "origin_returned_move_id"]);
  if (!moves.length) return [];
  const products = await pages("product.product", [["id", "in", [...new Set(moves.map((row) => relation(row.product_id)))]]], ["id", "uom_id"]);
  const productUom = new Map(products.map((row) => [row.id, relation(row.uom_id)]));
  const uomIds = [...new Set([...productUom.values(), ...moves.map((row) => relation(row.product_uom))])];
  const units = await pages("uom.uom", [["id", "in", uomIds]], ["id", "factor", "category_id", "rounding"]);
  const unitById = new Map(units.map((row) => [row.id, row]));
  // Odoo can retain zero-done lines in a validated partial return. They carry no stock.
  return moves.filter((row) => row.quantity !== false && Number(row.quantity) !== 0).map((row) => {
    const productId = relation(row.product_id);
    const from = unitById.get(relation(row.product_uom));
    const to = unitById.get(productUom.get(productId));
    // Fail closed: no cursor advance when a fetched record cannot be trusted.
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || !Number.isSafeInteger(productId) || productId <= 0 || row.state !== "done" || row.scrapped || !warehouseIds.has(relation(row.location_dest_id)) || !from || !to || relation(from.category_id) !== relation(to.category_id) || !(Number(from.factor) > 0) || !(Number(to.factor) > 0) || !(Number(to.rounding) > 0) || !Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) {
      throw new Error(`Movimiento de devolución ${row.id}: datos o unidad de medida inválidos; sincronización pendiente`);
    }
    const raw = Number(row.quantity) / Number(from.factor) * Number(to.factor);
    const quantity = Number((Math.round((raw + Number.EPSILON) / Number(to.rounding)) * Number(to.rounding)).toPrecision(15));
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Movimiento de devolución ${row.id}: cantidad convertida inválida`);
    return { id: row.id, odooMoveId: row.id, productId, quantity, direction: "in", pickingReference: Array.isArray(row.picking_id) ? String(row.picking_id[1]) : undefined, originReference: row.origin || undefined, returnedMoveId: relation(row.origin_returned_move_id) || undefined };
  });
}

export function createCustomerReturnSync(options: { locations: ReturnType<typeof createProductLocations>; read: () => Promise<Read>; now?: () => string }) {
  const now = options.now || (() => new Date().toISOString());
  const startedAt = now();
  let inFlight: Promise<unknown> | null = null;
  const start = () => {
    if (options.locations.summary().odooMovementSync) options.locations.startCustomerReturnMovements(startedAt);
  };
  const sync = () => {
    // Concurrent catalog refreshes and automatic polls share one query/application.
    if (inFlight) return inFlight;
    const work = (async () => {
      start();
      const state = options.locations.summary().odooMovementSync;
      if (!state) return { applied: 0, warnings: ["Sin base de ubicaciones; devoluciones pendientes de sincronizar"] };
      const until = now();
      const read = await options.read();
      const moves = await readCustomerReturnMovements(read, state.customerReturnsLastSyncedAt!, until);
      // Balances, move IDs and the separate return cursor commit in one store write.
      return options.locations.applyOdooMovements({ moves, syncedAt: until, customerReturns: true });
    })();
    inFlight = work;
    void work.finally(() => { inFlight = null; }).catch(() => {});
    return work;
  };
  return { start, sync };
}
