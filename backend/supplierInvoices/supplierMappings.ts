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
  odooPartnerId?: number | null;
  defaultTaxId?: number | null;
  defaultTaxName?: string | null;
  defaultAccountId?: number | null;
  defaultAccountName?: string | null;
  updatedAt: string;
  updatedBy: string;
  samples: number;
}

interface SupplierMappingsFile {
  mappings: Record<string, SupplierMapping>;
  products?: Record<string, { productId: number; concept: string; reference: string | null; updatedAt: string; updatedBy: string; sourceDocumentId: string }>;
}

export function productMappingKey(supplier: string | null, vat: string | null, concept: string, reference: string | null): string {
  const normalizedConcept = normalizeSupplierName(concept);
  const normalizedReference = normalizeSupplierName(reference);
  return `${mappingKey(supplier, vat)}|${normalizedConcept}|${normalizedReference}`;
}

/** Clave del mapeo: el VAT manda (inequivoco); sin VAT, nombre normalizado.
 *  Normaliza el prefijo de pais del VAT (ESB12345678 == B12345678) para que las
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
  upsert(input: { supplier: string | null; vat: string | null; country: string | null; billingAddress: string | null; odooPartnerId?: number | null }, user: string): SupplierMapping {
    const key = mappingKey(input.supplier, input.vat);
    const prev = this.data.mappings[key];
    const next: SupplierMapping = {
      supplierName: (input.supplier ?? prev?.supplierName ?? "").trim(),
      supplierVat: input.vat ? input.vat.trim().toUpperCase() : prev?.supplierVat ?? null,
      country: input.country ?? prev?.country ?? null,
      billingAddress: input.billingAddress ?? prev?.billingAddress ?? null,
      odooPartnerId: input.odooPartnerId === undefined ? prev?.odooPartnerId ?? null
        : typeof input.odooPartnerId === "number" && Number.isInteger(input.odooPartnerId) && input.odooPartnerId > 0 ? input.odooPartnerId : null,
      defaultTaxId: prev?.defaultTaxId ?? null,
      defaultTaxName: prev?.defaultTaxName ?? null,
      defaultAccountId: prev?.defaultAccountId ?? null,
      defaultAccountName: prev?.defaultAccountName ?? null,
      updatedAt: new Date().toISOString(),
      updatedBy: user,
      samples: (prev?.samples ?? 0) + 1,
    };
    this.data.mappings[key] = next;
    this.save();
    return next;
  }

  /** Aprende únicamente una decisión humana ya aplicada a las líneas locales. */
  setFiscalDefaults(supplier: string | null, vat: string | null, input: { taxId?: number | null; taxName?: string | null; accountId?: number | null; accountName?: string | null }, user: string): SupplierMapping | null {
    const current = this.get(supplier, vat);
    if (!current) return null;
    const next: SupplierMapping = {
      ...current,
      defaultTaxId: input.taxId ?? current.defaultTaxId ?? null,
      defaultTaxName: input.taxName ?? current.defaultTaxName ?? null,
      defaultAccountId: input.accountId ?? current.defaultAccountId ?? null,
      defaultAccountName: input.accountName ?? current.defaultAccountName ?? null,
      updatedAt: new Date().toISOString(),
      updatedBy: user,
    };
    this.data.mappings[mappingKey(supplier, vat)] = next;
    this.save();
    return next;
  }

  /** Conserva el identificador impreso en el PDF como alias del proveedor Odoo. */
  learnAlias(supplier: string | null, vat: string | null, canonical: SupplierMapping): void {
    const key = mappingKey(supplier, vat);
    if (key === "name:" || key === mappingKey(canonical.supplierName, canonical.supplierVat)) return;
    this.data.mappings[key] = { ...canonical, samples: Math.max(1, canonical.samples) };
    this.save();
  }

  list(): SupplierMapping[] {
    return Object.values(this.data.mappings);
  }

  size(): number {
    return Object.keys(this.data.mappings).length;
  }

  productSuggestion(supplier: string | null, vat: string | null, concept: string, reference: string | null) {
    return this.data.products?.[productMappingKey(supplier, vat, concept, reference)] ?? null;
  }

  learnProduct(input: { supplier: string | null; vat: string | null; concept: string; reference: string | null; productId: number; sourceDocumentId: string }, user: string): void {
    if (!input.concept.trim() || !Number.isInteger(input.productId) || input.productId <= 0) return;
    this.data.products ??= {};
    this.data.products[productMappingKey(input.supplier, input.vat, input.concept, input.reference)] = {
      productId: input.productId, concept: input.concept.slice(0, 200), reference: input.reference?.slice(0, 60) ?? null,
      updatedAt: new Date().toISOString(), updatedBy: user, sourceDocumentId: input.sourceDocumentId,
    };
    this.save();
  }
}
