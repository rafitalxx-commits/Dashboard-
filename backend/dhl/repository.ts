import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DhlShipmentRecord } from "./types.ts";
type Store = { shipments: DhlShipmentRecord[] };
export function createDhlRepository(env: Record<string, string>) { const path = join(env.DASHBOARD_DATA_DIR || ".dashboard-data", "dhl-shipments.json"); const read = (): Store => { if (!existsSync(path)) return { shipments: [] }; const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Store>; return { shipments: value.shipments || [] }; }; const write = (value: Store) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); };
  return { find(reference: string) { return read().shipments.find((item) => item.reference === reference) || null; }, findByReferenceOrTracking(value: string) { return read().shipments.find((item) => item.reference === value || item.tracking === value || item.awb === value) || null; }, list() { return read().shipments; }, save(record: DhlShipmentRecord) { const store = read(); const index = store.shipments.findIndex((item) => item.reference === record.reference); if (index < 0) store.shipments.unshift(record); else store.shipments[index] = record; write(store); return record; } };
}
