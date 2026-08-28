export type SalesChannel = string;
export type ShippingCarrier = string;

export type ProductCondition = {
  operator: "contains" | "not_contains";
  value: string;
};

export type PostalCodeCondition = {
  operator: "matches" | "not_matches";
  value: string;
};

export type ShippingRuleConditions = {
  channels?: SalesChannel[];
  countries?: string[];
  postalCode?: PostalCodeCondition | null;
  postalCodeStartsWith?: string;
  weightFromKg?: number | null;
  weightToKg?: number | null;
  product?: ProductCondition | null;
  shippingMethods?: string[];
};

export type ShippingRule = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  isDefault: boolean;
  forceCarrier: boolean;
  carrier: ShippingCarrier;
  service: string;
  conditions: ShippingRuleConditions;
  createdAt: string;
  updatedAt: string;
};

export type ShippingRulesStore = {
  version: 1;
  rules: ShippingRule[];
  catalogs: ShippingRuleCatalogs;
  updatedAt: string;
};

export type ShippingRuleCatalogs = {
  channels: string[];
  carriers: Array<{ id: string; label: string; services: Array<{ id: string; label: string }> }>;
  countries: Array<{ code: string; label: string }>;
};

export type ShippingRuleOrderLine = {
  sku?: string;
  name?: string;
  quantity?: number;
  weightKg?: number;
};

export type ShippingRuleOrderInput = {
  id?: string;
  odooRef?: string;
  externalRef?: string;
  channel?: string;
  countryCode?: string;
  country?: string;
  postalCode?: string;
  weightKg?: number;
  shippingMethod?: string;
  items?: ShippingRuleOrderLine[];
};

export type RuleEvaluation = {
  ruleId: string;
  ruleName: string;
  priority: number;
  matched: boolean;
  forced: boolean;
  reasons: string[];
  carrier: string;
  service: string;
};

export type ShippingRuleResolution = {
  appliedRule: ShippingRule | null;
  carrier: string;
  service: string;
  usedDefault: boolean;
  evaluations: RuleEvaluation[];
};
