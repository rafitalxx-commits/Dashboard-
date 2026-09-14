// Registro de mapeos de proveedor (Fase 2 LAB): memoria de correcciones humanas.
// Cuando se corrige un campo en una factura, se aprende el valor canonico por
// proveedor (VAT si existe, si no nombre normalizado) y se auto-aplica en la
// proxima extraccion de ese mismo proveedor. Solo persiste en el registro local.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeSupplierName } from "./documentInbox.ts";

export interface SupplierMapping {
  supplierName: string;
  supplierVat: string | null;
  country: string | null;
  billingAddress: string | null;
  updatedAt: string;
  updatedBy: string;
  samples: number;
}

interface SupplierMappingsFile {
  mappings: Record<string, SupplierMapping>;
}

/** Clave del mapeo: el VAT manda (inequivoco); sin VAT, nombre normalizado.
 *  Normaliza el prefijo de pais del VAT (ESB87629895 == B87629895) para que las
 *  correcciones aprendidas casen con extracciones futuras aunque cambie el formato. */
export function mappingKey(supplier: string | null, vat: string | null): string {
  const raw = (vat ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const v = raw.length > 9 && /^[A-Z]{2}/.test(raw) ? raw.slice(2) : raw;
  if (v) return `vat:${v}`;
  return `name:${normalizeSupplierName(supplier)}`;
}

export class SupplierMappingStore {
  private data: SupplierMappingsFile = { mappings: {} };
  private storePath: string;

  constructor(options: { dataDir?: string } = {}) {
    this.storePath = options.dataDir
      ? `${options.dataDir.replace(/\/$/, "")}/supplier-invoices/supplierMappings.json`
      : "";
    this.load();
  }

  load(): void {
    if (!this.storePath) return;
    try {
      if (existsSync(this.storePath)) {
        const raw = JSON.parse(readFileSync(this.storePath, "utf8")) as SupplierMappingsFile;
        if (raw && raw.mappings) this.data = raw;
      }
    } catch {
      // store corrupto: se reconstruye vacio
    }
  }

  save(): void {
    if (!this.storePath) return;
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.data, "utf8"));
    } catch {
      // cache secundaria
    }
  }

  /** Busca mapeo conocido por VAT exacto o, sin VAT, por nombre normalizado. */
  get(supplier: string | null, vat: string | null): SupplierMapping | null {
    const key = mappingKey(supplier, vat);
    return this.data.mappings[key] ?? null;
  }

  /** Aprende/actualiza el mapeo canonico de un proveedor con lo corregido por el usuario. */
  upsert(input: { supplier: string | null; vat: string | null; country: string | null; billingAddress: string | null }, user: string): SupplierMapping {
    const key = mappingKey(input.supplier, input.vat);
    const prev = this.data.mappings[key];
    const next: SupplierMapping = {
      supplierName: (input.supplier ?? prev?.supplierName ?? "").trim(),
      supplierVat: input.vat ? input.vat.trim().toUpperCase() : prev?.supplierVat ?? null,
      country: input.country ?? prev?.country ?? null,
      billingAddress: input.billingAddress ?? prev?.billingAddress ?? null,
      updatedAt: new Date().toISOString(),
      updatedBy: user,
      samples: (prev?.samples ?? 0) + 1,
    };
    this.data.mappings[key] = next;
    this.save();
    return next;
  }

  list(): SupplierMapping[] {
    return Object.values(this.data.mappings);
  }

  size(): number {
    return Object.keys(this.data.mappings).length;
  }
}
