import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { GlsShipmentRecord } from "./types.ts";

type Store = { shipments: GlsShipmentRecord[] };
export function createGlsRepository(env: Record<string, string>) {
  const path = join(env.DASHBOARD_DATA_DIR || ".dashboard-data", "gls-shipments.json");
  const read = (): Store => {
    if (!existsSync(path)) return { shipments: [] };
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Store>;
    if (!Array.isArray(value.shipments) || value.shipments.some((item) => !item || typeof item.reference !== "string" || typeof item.status !== "string")) throw new Error("Registro GLS ilegible: no se puede comprobar si existe ya un envío.");
    return { shipments: value.shipments };
  };
  const write = (value: Store) => {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const descriptor = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
        fsyncSync(descriptor);
      } finally { closeSync(descriptor); }
      renameSync(temporary, path);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  };
  return {
    find(reference: string) { return read().shipments.find((item) => item.reference === reference) || null; },
    findByReferenceOrTracking(value: string) { return read().shipments.find((item) => item.reference === value || item.tracking === value) || null; },
    list() { return read().shipments; },
    save(record: GlsShipmentRecord) {
      const store = read();
      const index = store.shipments.findIndex((item) => item.reference === record.reference);
      if (index < 0) store.shipments.unshift(record); else store.shipments[index] = record;
      write(store);
      return record;
    },
  };
}
