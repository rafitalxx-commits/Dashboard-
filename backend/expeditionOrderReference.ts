export function normalizeExpeditionOrderReference(value?: string) {
  const compact = (value || "")
    .trim()
    .replace(/[‘’'`´]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
  return /^\d{17}$/.test(compact)
    ? `${compact.slice(0, 3)}-${compact.slice(3, 10)}-${compact.slice(10)}`
    : compact;
}

export function isCompleteExpeditionOrderReference(value?: string) {
  const reference = normalizeExpeditionOrderReference(value);
  return /^(?:S\d{5,}|#\d{5,}|\d{5,10}|\d{3}-\d{7}-\d{7})$/.test(reference);
}

export function expeditionReferencesMatch(left?: string, right?: string) {
  const normalizedLeft = normalizeExpeditionOrderReference(left);
  const normalizedRight = normalizeExpeditionOrderReference(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  return normalizedLeft.replace(/^#/, "") === normalizedRight.replace(/^#/, "") &&
    /^#?\d+$/.test(normalizedLeft) && /^#?\d+$/.test(normalizedRight);
}

export function matchesExpeditionOrder(
  scannedReference: string,
  order: { id?: string; odooRef?: string; externalRef?: string },
) {
  return [order.id, order.odooRef, order.externalRef]
    .some((candidate) => expeditionReferencesMatch(scannedReference, candidate));
}

export function buildExactExpeditionOrderDomain(value: string): unknown[] {
  const reference = normalizeExpeditionOrderReference(value);
  const numericId = /^#\d+$/.test(reference)
    ? Number(reference.slice(1))
    : /^\d{5,10}$/.test(reference)
      ? Number(reference)
      : null;
  const terms: unknown[] = [
    ["name", "=", reference],
    ["client_order_ref", "=", reference],
    ["origin", "=", reference],
  ];
  if (numericId) terms.unshift(["id", "=", numericId]);
  return [...Array(Math.max(0, terms.length - 1)).fill("|"), ...terms];
}
