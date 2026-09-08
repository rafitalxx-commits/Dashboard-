export type OdooRelation = false | [number, string];

export type ReceptionTraceMove = {
  id: number;
  state?: string;
  product_uom_qty?: number;
  move_dest_ids?: number[];
  purchase_line_id?: OdooRelation;
  sale_line_id?: OdooRelation;
};

export type ReceptionSaleOrderAllocation = {
  saleOrderRef: string;
  quantity: number;
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

/**
 * Splits the still-pending quantity of an incoming move using explicit Odoo
 * procurement links only. The last active move for each sale line is counted,
 * which avoids counting every leg of a multi-step route while still supporting
 * split/backorder delivery moves.
 */
export function buildSaleOrderAllocationsByReceptionMove(
  rootPendingQtyByMoveId: Map<number, number>,
  moves: ReceptionTraceMove[],
  purchaseLines: ReceptionPurchaseLineTrace[],
  saleLines: ReceptionSaleLineTrace[],
) {
  const movesById = new Map(moves.map((move) => [move.id, move]));
  const purchaseLinesById = new Map(purchaseLines.map((line) => [line.id, line]));
  const saleOrderBySaleLineId = new Map(
    saleLines.map((line) => [line.id, relationName(line.order_id)]),
  );
  const result = new Map<number, ReceptionSaleOrderAllocation[]>();

  for (const [rootMoveId, rawRootPendingQty] of rootPendingQtyByMoveId) {
    const rootPendingQty = Math.max(0, Number(rawRootPendingQty) || 0);
    const rootMove = movesById.get(rootMoveId);
    const purchaseLine = purchaseLinesById.get(
      relationId(rootMove?.purchase_line_id) ?? 0,
    );
    const directOrder = relationName(purchaseLine?.sale_order_id);
    const directSaleLineOrder = saleOrderBySaleLineId.get(
      relationId(purchaseLine?.sale_line_id) ?? 0,
    );
    const directRef = directOrder || directSaleLineOrder;
    if (directRef) {
      result.set(rootMoveId, rootPendingQty > 0
        ? [{ saleOrderRef: directRef, quantity: rootPendingQty }]
        : []);
      continue;
    }

    const reachable = new Set<number>();
    const queue = [rootMoveId];
    while (queue.length) {
      const moveId = queue.shift()!;
      if (reachable.has(moveId)) continue;
      reachable.add(moveId);
      queue.push(...(movesById.get(moveId)?.move_dest_ids ?? []));
    }

    const demandByOrder = new Map<string, number>();
    for (const moveId of reachable) {
      if (moveId === rootMoveId) continue;
      const move = movesById.get(moveId);
      const saleLineId = relationId(move?.sale_line_id);
      const saleOrderRef = saleOrderBySaleLineId.get(saleLineId ?? 0);
      if (!move || !saleLineId || !saleOrderRef || move.state === "done" || move.state === "cancel") continue;
      const hasActiveChildForSameSaleLine = (move.move_dest_ids ?? []).some((childId) => {
        const child = movesById.get(childId);
        return relationId(child?.sale_line_id) === saleLineId
          && child?.state !== "done"
          && child?.state !== "cancel";
      });
      if (hasActiveChildForSameSaleLine) continue;
      const quantity = Math.max(0, Number(move.product_uom_qty) || 0);
      if (quantity > 0) demandByOrder.set(
        saleOrderRef,
        (demandByOrder.get(saleOrderRef) ?? 0) + quantity,
      );
    }

    let remaining = rootPendingQty;
    const allocations = [...demandByOrder.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "es"))
      .flatMap(([saleOrderRef, requestedQty]) => {
        const quantity = Math.min(remaining, requestedQty);
        remaining -= quantity;
        return quantity > 0 ? [{ saleOrderRef, quantity }] : [];
      });
    result.set(rootMoveId, allocations);
  }

  return result;
}
