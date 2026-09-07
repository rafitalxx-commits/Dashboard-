import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type PendingReceiptLine = {
  lineId: string;
  productId?: string;
  sku: string;
  name: string;
  orderedQty: number;
  receivedQty: number;
  pendingQty: number;
};

export type PendingReceipt = {
  id: string;
  receptionId: string;
  receptionRef: string;
  purchaseRef: string;
  supplier: string;
  operatorId: string;
  operatorName: string;
  pendingReceptionRef: string;
  requiresNewOperator: true;
  status: "pending" | "completed";
  lines: PendingReceiptLine[];
  createdAt: string;
  updatedAt: string;
};

export type ReceptionHistory = {
  id: string;
  receptionId: string;
  receptionRef: string;
  purchaseRef: string;
  supplier: string;
  operatorId: string;
  operatorName: string;
  outcome: "total" | "partial_backorder" | "partial_no_backorder" | "cancelled";
  pendingReceptionRef?: string;
  lines: PendingReceiptLine[];
  createdAt: string;
};

type Store = { version: 2; receipts: PendingReceipt[]; history: ReceptionHistory[] };
const empty = (): Store => ({ version: 2, receipts: [], history: [] });

export function createPendingReceipts(options: { dataDir?: string } = {}) {
  const dataDir = options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data";
  const file = join(dataDir, "pending-receipts.json");
  const read = (): Store => {
    try {
      if (!existsSync(file)) return empty();
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Store>;
      return { version: 2, receipts: parsed.receipts ?? [], history: parsed.history ?? [] };
    }
    catch { return empty(); }
  };
  const write = (store: Store) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 }); };
  const list = () => read().receipts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const save = (input: Omit<PendingReceipt, "id" | "status" | "createdAt" | "updatedAt" | "pendingReceptionRef" | "requiresNewOperator">) => {
    const lines = (input.lines || []).filter((line) => Number(line.pendingQty) > 0);
    if (!input.receptionId || !input.purchaseRef || !lines.length) throw new Error("No hay cantidades pendientes para guardar");
    const store = read(); const now = new Date().toISOString();
    const index = store.receipts.findIndex((item) => item.receptionId === input.receptionId && item.status === "pending");
    const previous = index >= 0 ? store.receipts[index] : undefined;
    const sequence = String(store.receipts.length + store.history.length + 1).padStart(5, "0");
    const pendingReceptionRef = previous?.pendingReceptionRef || `ALM/IN/LAB-${sequence}`;
    const receipt: PendingReceipt = { ...input, id: previous?.id || `pending-${input.receptionId}-${Date.now()}`, pendingReceptionRef, requiresNewOperator: true, status: "pending", lines, createdAt: previous?.createdAt || now, updatedAt: now };
    if (index >= 0) store.receipts[index] = receipt; else store.receipts.unshift(receipt);
    const history: ReceptionHistory = { id: `history-${input.receptionId}-${Date.now()}`, receptionId: input.receptionId, receptionRef: input.receptionRef, purchaseRef: input.purchaseRef, supplier: input.supplier, operatorId: input.operatorId, operatorName: input.operatorName, outcome: "partial_backorder", pendingReceptionRef, lines: input.lines, createdAt: now };
    store.history = [history, ...store.history.filter((item) => item.receptionId !== input.receptionId)];
    write(store); return { receipt, receipts: listFrom(store) };
  };
  const saveHistory = (input: Omit<ReceptionHistory, "id" | "createdAt">) => {
    const store = read(); const now = new Date().toISOString();
    const history: ReceptionHistory = { ...input, id: `history-${input.receptionId}-${Date.now()}`, createdAt: now };
    store.history = [history, ...store.history.filter((item) => item.receptionId !== input.receptionId)];
    write(store); return { history, entries: store.history };
  };
  const listHistory = () => read().history.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { list, save, listHistory, saveHistory };
}

function listFrom(store: Store) { return [...store.receipts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)); }
