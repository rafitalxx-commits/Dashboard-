export type OdooRelation = false | [number, string];

export type ReceptionTraceMove = {
  id: number;
  move_dest_ids?: number[];
  purchase_line_id?: OdooRelation;
  sale_line_id?: OdooRelation;
};

export type ReceptionPurchaseLineTrace = {
  id: number;
  sale_order_id?: OdooRelation;
  sale_line_id?: OdooRelation;
};

export type ReceptionSaleLineTrace = {
  id: number;
  order_id?: OdooRelation;
};

function relationId(value: OdooRelation | undefined) {
  return Array.isArray(value) && typeof value[0] === "number" ? value[0] : undefined;
}

function relationName(value: OdooRelation | undefined) {
  return Array.isArray(value) ? String(value[1] || "").trim() : "";
}

/**
 * Resolves sale orders using only explicit Odoo relations. The direct custom
 * purchase-line relation wins when populated; downstream stock moves cover the
 * standard MTO chain used by the current database.
 */
export function buildSaleOrderRefsByReceptionMove(
  rootMoveIds: number[],
  moves: ReceptionTraceMove[],
  purchaseLines: ReceptionPurchaseLineTrace[],
  saleLines: ReceptionSaleLineTrace[],
) {
  const movesById = new Map(moves.map((move) => [move.id, move]));
  const purchaseLinesById = new Map(purchaseLines.map((line) => [line.id, line]));
  const saleOrderBySaleLineId = new Map(
    saleLines.map((line) => [line.id, relationName(line.order_id)]),
  );
  const result = new Map<number, string[]>();

  for (const rootMoveId of rootMoveIds) {
    const refs = new Set<string>();
    const rootMove = movesById.get(rootMoveId);
    const purchaseLine = purchaseLinesById.get(
      relationId(rootMove?.purchase_line_id) ?? 0,
    );
    const directOrder = relationName(purchaseLine?.sale_order_id);
    if (directOrder) refs.add(directOrder);
    const directSaleLineOrder = saleOrderBySaleLineId.get(
      relationId(purchaseLine?.sale_line_id) ?? 0,
    );
    if (directSaleLineOrder) refs.add(directSaleLineOrder);

    const visited = new Set<number>();
    const queue = [rootMoveId];
    while (queue.length) {
      const moveId = queue.shift()!;
      if (visited.has(moveId)) continue;
      visited.add(moveId);
      const move = movesById.get(moveId);
      if (!move) continue;
      const saleOrder = saleOrderBySaleLineId.get(
        relationId(move.sale_line_id) ?? 0,
      );
      if (saleOrder) refs.add(saleOrder);
      queue.push(...(move.move_dest_ids ?? []));
    }

    result.set(rootMoveId, [...refs].sort((left, right) => left.localeCompare(right, "es")));
  }

  return result;
}
