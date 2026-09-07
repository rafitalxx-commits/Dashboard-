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
  status: "pending" | "completed";
  lines: PendingReceiptLine[];
  createdAt: string;
  updatedAt: string;
};

type Store = { version: 1; receipts: PendingReceipt[] };
const empty = (): Store => ({ version: 1, receipts: [] });

export function createPendingReceipts(options: { dataDir?: string } = {}) {
  const dataDir = options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data";
  const file = join(dataDir, "pending-receipts.json");
  const read = (): Store => {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Store : empty(); }
    catch { return empty(); }
  };
  const write = (store: Store) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 }); };
  const list = () => read().receipts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const save = (input: Omit<PendingReceipt, "id" | "status" | "createdAt" | "updatedAt">) => {
    const lines = (input.lines || []).filter((line) => Number(line.pendingQty) > 0);
    if (!input.receptionId || !input.purchaseRef || !lines.length) throw new Error("No hay cantidades pendientes para guardar");
    const store = read(); const now = new Date().toISOString();
    const index = store.receipts.findIndex((item) => item.receptionId === input.receptionId && item.status === "pending");
    const previous = index >= 0 ? store.receipts[index] : undefined;
    const receipt: PendingReceipt = { ...input, id: previous?.id || `pending-${input.receptionId}-${Date.now()}`, status: "pending", lines, createdAt: previous?.createdAt || now, updatedAt: now };
    if (index >= 0) store.receipts[index] = receipt; else store.receipts.unshift(receipt);
    write(store); return { receipt, receipts: listFrom(store) };
  };
  return { list, save };
}

function listFrom(store: Store) { return [...store.receipts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)); }
