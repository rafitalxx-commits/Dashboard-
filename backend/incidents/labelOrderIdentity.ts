/** Accept only the exact Odoo order reference or its verified numeric ID. */
export function labelOrderMatches(value: unknown, orderReference: string, orderId: unknown): boolean {
 const label = typeof value === 'string' ? value.trim() : '';
 const id = Number(orderId);
 return Boolean(label && orderReference && (label === orderReference || (Number.isSafeInteger(id) && id > 0 && label === `#${id}`)));
}
