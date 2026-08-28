import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { correosExpressServices } from "../correosExpress/client.ts";
import type { ShippingRule, ShippingRuleCatalogs, ShippingRulesStore } from "./types.ts";

export function createShippingRulesRepository(options: { dataDir?: string } = {}) {
  const storePath = join(options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data", "shipping-rules.json");

  function read(): ShippingRulesStore {
    ensureStore();
    return normalizeStore(JSON.parse(readFileSync(storePath, "utf8")) as Partial<ShippingRulesStore>);
  }

  function write(store: ShippingRulesStore) {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(normalizeStore(store), null, 2)}\n`, { mode: 0o600 });
  }

  function ensureStore() {
    if (existsSync(storePath)) return;
    write(defaultStore());
  }

  function createRule(input: Partial<ShippingRule>) {
    const store = read();
    const rule = normalizeRule({ ...input, id: `shipping-rule-${Date.now()}` });
    store.rules.push(rule);
    store.updatedAt = new Date().toISOString();
    write(store);
    return { store, rule };
  }

  function updateRule(ruleId: string, patch: Partial<ShippingRule>) {
    const store = read();
    const index = store.rules.findIndex((rule) => rule.id === ruleId);
    if (index < 0) throw new Error("Regla no encontrada");
    const rule = normalizeRule({ ...store.rules[index], ...patch, id: ruleId });
    store.rules[index] = rule;
    store.updatedAt = new Date().toISOString();
    write(store);
    return { store, rule };
  }

  function duplicateRule(ruleId: string) {
    const store = read();
    const source = store.rules.find((rule) => rule.id === ruleId);
    if (!source) throw new Error("Regla no encontrada");
    const rule = normalizeRule({
      ...source,
      id: `shipping-rule-${Date.now()}`,
      name: `${source.name} copia`,
      priority: source.priority - 1,
      active: false,
      isDefault: false,
    });
    store.rules.push(rule);
    store.updatedAt = new Date().toISOString();
    write(store);
    return { store, rule };
  }

  function deleteRule(ruleId: string) {
    const store = read();
    const rule = store.rules.find((item) => item.id === ruleId);
    if (rule?.isDefault) throw new Error("La regla por defecto no se puede eliminar");
    store.rules = store.rules.filter((item) => item.id !== ruleId);
    store.updatedAt = new Date().toISOString();
    write(store);
    return { store };
  }

  return { createRule, deleteRule, duplicateRule, read, updateRule };
}

function defaultStore(): ShippingRulesStore {
  const now = new Date().toISOString();
  return {
    version: 1,
    catalogs: defaultCatalogs(),
    updatedAt: now,
    rules: [
      normalizeRule({
        id: "rule-force-mrw-spain-next-day",
        name: "Amazon Next Day Espana",
        active: true,
        priority: 100,
        carrier: "mrw",
        service: "mrw-urgent-1900-expedition",
        conditions: { channels: ["Amazon"], countries: ["ES"], shippingMethods: ["19", "19:00", "Next Day"] },
      }),
      normalizeRule({
        id: "rule-force-mrw-spain-1400",
        name: "Amazon MRW 14 Espana",
        active: false,
        priority: 95,
        carrier: "mrw",
        service: "mrw-urgent-1400-expedition",
        conditions: { channels: ["Amazon"], countries: ["ES"], shippingMethods: ["14", "14:00"] },
      }),
      normalizeRule({
        id: "rule-genei-europe",
        name: "Genei Europa",
        active: true,
        priority: 50,
        carrier: "genei",
        service: "genei-global-express",
        conditions: { countries: ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "RO", "SK", "SI", "SE", "CH"] },
      }),
      normalizeRule({
        id: "rule-default",
        name: "Regla por defecto",
        active: true,
        priority: 0,
        isDefault: true,
        carrier: "genei",
        service: "genei-default",
        conditions: {},
      }),
    ],
  };
}

function normalizeStore(value: Partial<ShippingRulesStore>): ShippingRulesStore {
  return {
    version: 1,
    catalogs: normalizeCatalogs(value.catalogs),
    updatedAt: value.updatedAt || new Date().toISOString(),
    rules: (value.rules?.length ? value.rules : defaultStore().rules)
      .map(normalizeRule)
      .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name)),
  };
}

function normalizeCatalogs(catalogs?: Partial<ShippingRuleCatalogs>): ShippingRuleCatalogs {
  const defaults = defaultCatalogs();
  return {
    channels: defaults.channels,
    carriers: mergeCatalogItems(defaults.carriers, catalogs?.carriers, "id"),
    countries: mergeCatalogItems(defaults.countries, catalogs?.countries, "code"),
  };
}

function mergeCatalogItems<T extends Record<string, unknown>>(defaults: T[], current: T[] | undefined, key: keyof T) {
  const byKey = new Map<string, T>();
  for (const item of defaults) byKey.set(String(item[key]), item);
  for (const item of current || []) {
    const itemKey = String(item[key] || "");
    if (!itemKey || byKey.has(itemKey)) continue;
    byKey.set(itemKey, item);
  }
  return Array.from(byKey.values());
}

function normalizeRule(input: Partial<ShippingRule>): ShippingRule {
  const now = new Date().toISOString();
  const carrier = String(input.carrier || "").trim();
  return {
    id: String(input.id || `shipping-rule-${Date.now()}`),
    name: String(input.name || "Nueva regla").trim(),
    active: input.active !== false,
    priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 10,
    isDefault: input.isDefault === true,
    forceCarrier: input.forceCarrier === true,
    carrier,
    service: normalizeService(carrier, input.service),
    conditions: {
      channels: normalizeChannels(input.conditions?.channels),
      countries: normalizeStringList(input.conditions?.countries).map((country) => country.toUpperCase()),
      postalCode: normalizePostalCodeCondition(input.conditions?.postalCode, input.conditions?.postalCodeStartsWith),
      postalCodeStartsWith: String(input.conditions?.postalCodeStartsWith || "").trim(),
      weightFromKg: normalizeOptionalNumber(input.conditions?.weightFromKg),
      weightToKg: normalizeOptionalNumber(input.conditions?.weightToKg),
      product: input.conditions?.product?.value
        ? {
            operator: input.conditions.product.operator === "not_contains" ? "not_contains" : "contains",
            value: String(input.conditions.product.value).trim(),
          }
        : null,
      shippingMethods: normalizeStringList(input.conditions?.shippingMethods),
    },
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function normalizeService(carrier: string, service: unknown) {
  const value = String(service || "").trim();
  if (carrier === "mrw" && (value === "mrw-urgente-14" || value === "mrw-14" || value === "mrw-1400")) return "mrw-urgent-1400-expedition";
  if (carrier === "mrw" && (value === "mrw-urgente-10" || value === "mrw-urgente" || value === "mrw-19" || value === "mrw-1900")) return "mrw-urgent-1900-expedition";
  return value;
}

function normalizeStringList(values?: string[]) {
  return Array.from(new Set((values || []).map((value) => String(value).trim()).filter(Boolean)));
}

function normalizeChannels(values?: string[]) {
  return Array.from(new Set(normalizeStringList(values).map((value) => {
    if (/amazon/i.test(value)) return "Amazon";
    if (/prestashop|web|website|webside/i.test(value)) return "Webside";
    if (/odoo|sales/i.test(value)) return "Sales";
    return value;
  })));
}

function normalizePostalCodeCondition(
  condition?: { operator?: string; value?: string } | null,
  legacyStartsWith?: string,
) {
  const value = String(condition?.value || legacyStartsWith || "").trim();
  if (!value) return null;
  return {
    operator: condition?.operator === "not_matches" ? "not_matches" as const : "matches" as const,
    value,
  };
}

function normalizeOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function defaultCatalogs(): ShippingRuleCatalogs {
  return {
    channels: ["Amazon", "Webside", "Sales"],
    carriers: [
      {
        id: "genei",
        label: "Genei",
        services: [
          { id: "genei-default", label: "Mas barato permitido por Genei" },
          { id: "genei-global-express", label: "Genei: Global Express / FedEx" },
          { id: "genei-dhl", label: "Genei: DHL" },
          { id: "genei-correos-express", label: "Genei: Correos Express" },
          { id: "genei-mrw", label: "Genei: MRW" },
          { id: "genei-ups", label: "Genei: UPS" },
          { id: "genei-seur", label: "Genei: SEUR" },
        ],
      },
      {
        id: "mrw",
        label: "MRW directo",
        services: [
          { id: "mrw-urgent-1900-expedition", label: "MRW Urgent 19:00 Expedition 0-80kg" },
          { id: "mrw-urgent-1400-expedition", label: "MRW Urgent 14:00 Expedition" },
          { id: "mrw-ecommerce", label: "MRW Ecommerce" },
        ],
      },
      {
        id: "correos-express",
        label: "Correos Express directo",
        services: correosExpressServices(),
      },
      {
        id: "dhl",
        label: "DHL directo",
        services: [
          { id: "dhl-connect-b2c", label: "DHL Connect (B2C)" },
        ],
      },
    ],
    countries: [
      { code: "ES", label: "Espana" },
      { code: "PT", label: "Portugal" },
      { code: "AT", label: "Austria" },
      { code: "BE", label: "Belgica" },
      { code: "BG", label: "Bulgaria" },
      { code: "HR", label: "Croacia" },
      { code: "CY", label: "Chipre" },
      { code: "CZ", label: "Chequia" },
      { code: "DK", label: "Dinamarca" },
      { code: "EE", label: "Estonia" },
      { code: "FI", label: "Finlandia" },
      { code: "FR", label: "Francia" },
      { code: "DE", label: "Alemania" },
      { code: "GR", label: "Grecia" },
      { code: "HU", label: "Hungria" },
      { code: "IE", label: "Irlanda" },
      { code: "IT", label: "Italia" },
      { code: "LV", label: "Letonia" },
      { code: "LT", label: "Lituania" },
      { code: "LU", label: "Luxemburgo" },
      { code: "MT", label: "Malta" },
      { code: "NL", label: "Paises Bajos" },
      { code: "PL", label: "Polonia" },
      { code: "RO", label: "Rumania" },
      { code: "SK", label: "Eslovaquia" },
      { code: "SI", label: "Eslovenia" },
      { code: "SE", label: "Suecia" },
      { code: "CH", label: "Suiza" },
    ],
  };
}
