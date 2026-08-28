import type {
  RuleEvaluation,
  ShippingRule,
  ShippingRuleOrderInput,
  ShippingRuleResolution,
} from "./types.ts";

export function resolveShippingRule(
  rules: ShippingRule[],
  order: ShippingRuleOrderInput,
  forceRuleId?: string,
): ShippingRuleResolution {
  const forcedRule = forceRuleId ? rules.find((rule) => rule.id === forceRuleId && rule.active) : undefined;
  if (forcedRule) {
    return {
      appliedRule: forcedRule,
      carrier: forcedRule.carrier,
      service: forcedRule.service,
      usedDefault: Boolean(forcedRule.isDefault),
      evaluations: [{
        ruleId: forcedRule.id,
        ruleName: forcedRule.name,
        priority: forcedRule.priority,
        matched: true,
        forced: true,
        reasons: ["Regla elegida manualmente"],
        carrier: forcedRule.carrier,
        service: forcedRule.service,
      }],
    };
  }
  const activeRules = rules
    .filter((rule) => rule.active && !rule.isDefault)
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
  const forcedRules = activeRules.filter((rule) => rule.forceCarrier);
  const normalRules = activeRules.filter((rule) => !rule.forceCarrier);
  const evaluations: RuleEvaluation[] = [];

  for (const rule of [...forcedRules, ...normalRules]) {
    const evaluation = evaluateRule(rule, order);
    evaluations.push(evaluation);
    if (evaluation.matched) {
      return {
        appliedRule: rule,
        carrier: rule.carrier,
        service: rule.service,
        usedDefault: false,
        evaluations,
      };
    }
  }

  const defaultRule = rules.find((rule) => rule.active && rule.isDefault) ?? rules.find((rule) => rule.isDefault) ?? null;
  if (defaultRule) {
    const defaultEvaluation = hasConditions(defaultRule)
      ? evaluateRule(defaultRule, order)
      : {
          ruleId: defaultRule.id,
          ruleName: defaultRule.name,
          priority: defaultRule.priority,
          matched: true,
          forced: defaultRule.forceCarrier,
          reasons: ["Regla por defecto"],
          carrier: defaultRule.carrier,
          service: defaultRule.service,
        };
    evaluations.push(defaultEvaluation);
    if (!defaultEvaluation.matched) {
      return {
        appliedRule: null,
        carrier: "",
        service: "",
        usedDefault: false,
        evaluations,
      };
    }
  }

  return {
    appliedRule: defaultRule,
    carrier: defaultRule?.carrier ?? "",
    service: defaultRule?.service ?? "",
    usedDefault: true,
    evaluations,
  };
}

function hasConditions(rule: ShippingRule) {
  return Boolean(
    rule.conditions.channels?.length ||
    rule.conditions.countries?.length ||
    rule.conditions.postalCode?.value ||
    rule.conditions.postalCodeStartsWith ||
    rule.conditions.weightFromKg !== null && rule.conditions.weightFromKg !== undefined ||
    rule.conditions.weightToKg !== null && rule.conditions.weightToKg !== undefined ||
    rule.conditions.product?.value ||
    rule.conditions.shippingMethods?.length
  );
}

export function evaluateRule(rule: ShippingRule, order: ShippingRuleOrderInput): RuleEvaluation {
  const reasons: string[] = [];
  const checks = [
    matchList(rule.conditions.channels, order.channel, "Canal"),
    matchCountry(rule.conditions.countries, order.countryCode || order.country),
    matchPostalCode(rule.conditions.postalCode, rule.conditions.postalCodeStartsWith, order.postalCode),
    matchWeight(rule.conditions.weightFromKg, rule.conditions.weightToKg, order.weightKg),
    matchProduct(rule.conditions.product, order.items || []),
    matchShippingMethod(rule.conditions.shippingMethods, order.shippingMethod),
  ].filter(Boolean) as Array<{ matched: boolean; reason: string }>;

  for (const check of checks) reasons.push(check.reason);
  const matched = checks.every((check) => check.matched);
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    priority: rule.priority,
    matched,
    forced: rule.forceCarrier,
    reasons,
    carrier: rule.carrier,
    service: rule.service,
  };
}

function matchList(values: string[] | undefined, input: string | undefined, label: string) {
  const normalizedValues = (values || []).map(normalizeText).filter(Boolean);
  if (!normalizedValues.length) return null;
  const normalizedInput = normalizeText(input);
  const matched = normalizedValues.includes(normalizedInput);
  return { matched, reason: matched ? `${label} coincide` : `${label} no coincide` };
}

function matchShippingMethod(values: string[] | undefined, input: string | undefined) {
  const normalizedValues = (values || []).map(normalizeText).filter(Boolean);
  if (!normalizedValues.length) return null;
  const normalizedInput = normalizeText(input);
  const matched = normalizedValues.some((value) => normalizedInput === value || normalizedInput.includes(value));
  return { matched, reason: matched ? "Metodo envio coincide" : "Metodo envio no coincide" };
}

function matchCountry(countries: string[] | undefined, input: string | undefined) {
  const normalizedCountries = (countries || []).map(normalizeText).filter(Boolean);
  if (!normalizedCountries.length) return null;
  const normalizedInput = normalizeText(input);
  const matched = normalizedCountries.includes(normalizedInput);
  return { matched, reason: matched ? "Pais coincide" : "Pais no coincide" };
}

function matchPostalCode(
  condition: ShippingRule["conditions"]["postalCode"],
  legacyStartsWith: string | undefined,
  postalCode: string | undefined,
) {
  const value = String(condition?.value || legacyStartsWith || "").trim();
  if (!value) return null;
  const rawMatched = postalCodeMatchesAnyPattern(postalCode, value);
  const excludes = condition?.operator === "not_matches";
  const matched = excludes ? !rawMatched : rawMatched;
  return { matched, reason: matched ? "Codigo postal coincide" : "Codigo postal no coincide" };
}

function matchWeight(from: number | null | undefined, to: number | null | undefined, weight: number | undefined) {
  const hasFrom = from !== null && from !== undefined && Number.isFinite(Number(from));
  const hasTo = to !== null && to !== undefined && Number.isFinite(Number(to));
  if (!hasFrom && !hasTo) return null;
  const value = Number(weight);
  if (!Number.isFinite(value)) return { matched: false, reason: "Peso no disponible" };
  const matched = (!hasFrom || value >= Number(from)) &&
    (!hasTo || value <= Number(to));
  return { matched, reason: matched ? "Peso coincide" : "Peso fuera de rango" };
}

function matchProduct(condition: ShippingRule["conditions"]["product"], items: NonNullable<ShippingRuleOrderInput["items"]>) {
  const value = normalizeText(condition?.value);
  if (!condition || !value) return null;
  const productText = items.map((item) => `${item.sku || ""} ${item.name || ""}`).join("\n");
  const contains = normalizeText(productText).includes(value);
  const matched = condition.operator === "contains" ? contains : !contains;
  return { matched, reason: matched ? "Producto coincide" : "Producto no coincide" };
}

function normalizeText(value?: string) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

function postalCodeMatchesAnyPattern(postalCode: string | undefined, patterns: string) {
  const normalizedPostalCode = normalizePostalCode(postalCode);
  if (!normalizedPostalCode) return false;
  return patterns
    .split(/[,;\n]+/)
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .some((pattern) => postalCodeMatchesPattern(normalizedPostalCode, pattern));
}

function postalCodeMatchesPattern(postalCode: string, pattern: string) {
  const normalizedPattern = normalizePostalCode(pattern);
  if (!normalizedPattern) return false;
  if (normalizedPattern.includes("*")) {
    const expression = `^${normalizedPattern.split("*").map(escapeRegExp).join(".*")}$`;
    return new RegExp(expression).test(postalCode);
  }
  return postalCode.startsWith(normalizedPattern);
}

function normalizePostalCode(value?: string) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "").toUpperCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
