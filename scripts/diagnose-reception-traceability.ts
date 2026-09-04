import { loadEnv } from "vite";

type Relation = false | [number, string];
type FieldDefinition = { string?: string; type?: string; relation?: string };
type Move = {
  id: number;
  name?: string;
  product_id?: Relation;
  purchase_line_id?: Relation;
  sale_line_id?: Relation;
  move_dest_ids?: number[];
};

const env = loadEnv("development", process.cwd(), "");
const config = {
  url: String(env.ODOO_URL || "").replace(/\/$/, ""),
  database: env.ODOO_DATABASE || "",
  username: env.ODOO_USERNAME || "",
  apiKey: env.ODOO_API_KEY || "",
};

if (!config.url || !config.database || !config.username || !config.apiKey) {
  throw new Error("Falta la configuración local de Odoo");
}

async function rpc(service: string, method: string, args: unknown[]) {
  const response = await fetch(`${config.url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: Date.now(),
    }),
  });
  const payload = await response.json() as { result?: unknown; error?: { data?: { message?: string }; message?: string } };
  if (payload.error) throw new Error(payload.error.data?.message || payload.error.message || "Error RPC de Odoo");
  return payload.result;
}

const uid = Number(await rpc("common", "authenticate", [
  config.database,
  config.username,
  config.apiKey,
  {},
]));
if (!uid) throw new Error("Odoo no aceptó las credenciales locales");

async function executeKw(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) {
  return rpc("object", "execute_kw", [
    config.database,
    uid,
    config.apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
}

const moveFields = await executeKw("stock.move", "fields_get", [], {
  attributes: ["string", "type", "relation"],
}) as Record<string, FieldDefinition>;
const purchaseLineFields = await executeKw("purchase.order.line", "fields_get", [], {
  attributes: ["string", "type", "relation"],
}) as Record<string, FieldDefinition>;

const candidates = ["purchase_line_id", "sale_line_id", "move_dest_ids", "move_orig_ids", "group_id", "origin"];
console.log("Campos relevantes de stock.move:");
for (const name of candidates) console.log(`- ${name}: ${moveFields[name] ? JSON.stringify(moveFields[name]) : "no instalado"}`);
console.log("Campos de purchase.order.line relacionados con venta/movimientos:");
for (const [name, definition] of Object.entries(purchaseLineFields)) {
  if (/sale|move|procure|group/i.test(name) || /sale|move|procure|group/i.test(definition.string || "")) {
    console.log(`- ${name}: ${JSON.stringify(definition)}`);
  }
}

const pickings = await executeKw("stock.picking", "search_read", [[
  ["picking_type_code", "=", "incoming"],
  ["purchase_id", "!=", false],
  ["state", "in", ["assigned", "confirmed", "waiting"]],
]], {
  fields: ["id", "name", "move_ids_without_package"],
  limit: 400,
}) as Array<{ id: number; name: string; move_ids_without_package: number[] }>;

const rootMoveIds = [...new Set(pickings.flatMap((picking) => picking.move_ids_without_package || []))];
const fields = ["id", "name", "product_id", "move_dest_ids", "sale_line_id", "purchase_line_id"]
  .filter((field) => Boolean(moveFields[field]));
const movesById = new Map<number, Move>();
let pending = [...rootMoveIds];
while (pending.length) {
  const ids = pending.splice(0, 500).filter((id) => !movesById.has(id));
  if (!ids.length) continue;
  const rows = await executeKw("stock.move", "read", [ids], { fields }) as Move[];
  for (const row of rows) movesById.set(row.id, row);
  pending.push(...rows.flatMap((row) => row.move_dest_ids || []).filter((id) => !movesById.has(id)));
}

const saleLineIds = [...new Set([...movesById.values()]
  .map((move) => Array.isArray(move.sale_line_id) ? move.sale_line_id[0] : 0)
  .filter(Boolean))];
const saleLines = saleLineIds.length
  ? await executeKw("sale.order.line", "read", [saleLineIds], { fields: ["id", "order_id"] }) as Array<{ id: number; order_id: Relation }>
  : [];
const saleOrderByLine = new Map(saleLines.map((line) => [line.id, Array.isArray(line.order_id) ? line.order_id[1] : ""]));

function saleOrdersFor(rootId: number) {
  const refs = new Set<string>();
  const visited = new Set<number>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const move = movesById.get(id);
    if (!move) continue;
    const saleLineId = Array.isArray(move.sale_line_id) ? move.sale_line_id[0] : 0;
    const ref = saleOrderByLine.get(saleLineId);
    if (ref) refs.add(ref);
    queue.push(...(move.move_dest_ids || []));
  }
  return [...refs].sort();
}

const traced = rootMoveIds.map((id) => ({ id, refs: saleOrdersFor(id) })).filter((item) => item.refs.length);
const purchaseLineIds = [...new Set([...movesById.values()]
  .map((move) => Array.isArray(move.purchase_line_id) ? move.purchase_line_id[0] : 0)
  .filter(Boolean))];
const purchaseLines = purchaseLineIds.length
  ? await executeKw("purchase.order.line", "read", [purchaseLineIds], {
      fields: ["id", "sale_order_id", "sale_line_id", "move_dest_ids"].filter((field) => Boolean(purchaseLineFields[field])),
    }) as Array<{ id: number; sale_order_id?: Relation; sale_line_id?: Relation; move_dest_ids?: number[] }>
  : [];
const directByPurchaseLine = new Map(purchaseLines.map((line) => [
  line.id,
  Array.isArray(line.sale_order_id) ? line.sale_order_id[1] : "",
]));
const direct = rootMoveIds.map((id) => {
  const move = movesById.get(id);
  const purchaseLineId = Array.isArray(move?.purchase_line_id) ? move.purchase_line_id[0] : 0;
  return { id, ref: directByPurchaseLine.get(purchaseLineId) || "" };
}).filter((item) => item.ref);
console.log(`Recepciones abiertas: ${pickings.length}`);
console.log(`Movimientos raíz: ${rootMoveIds.length}`);
console.log(`Líneas vinculadas directamente por purchase_line_id → sale_order_id: ${direct.length}`);
for (const item of direct.slice(0, 20)) console.log(`- move ${item.id} → ${item.ref}`);
console.log(`Líneas vinculadas a venta por cadena move_dest_ids → sale_line_id → order_id: ${traced.length}`);
for (const item of traced.slice(0, 20)) {
  const move = movesById.get(item.id);
  console.log(`- move ${item.id} · ${Array.isArray(move?.product_id) ? move.product_id[1] : move?.name || "Producto"} → ${item.refs.join(", ")}`);
}
