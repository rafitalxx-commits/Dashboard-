/** Descuentos sucesivos: cada porcentaje se aplica sobre el neto anterior. */
export const WEB_ADJUSTMENT_PRODUCT_CODE = "AJUSTEWEB";
/** Local-only sentinel; the real product.product variant is resolved from Odoo by default_code before draft creation. */
export const WEB_ADJUSTMENT_LOCAL_SENTINEL = -1;
export const isWebAdjustmentProductId = (id: number | null | undefined): boolean => id === WEB_ADJUSTMENT_LOCAL_SENTINEL;

export function effectiveDiscount(primary: number | null | undefined, extra?: number | null, promptPayment?: number | null): number {
  const rates = [primary ?? 0, extra ?? 0, promptPayment ?? 0];
  if (rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100)) throw new Error("Los descuentos deben estar entre 0 y 100%.");
  return Math.round((1 - rates.reduce((factor, rate) => factor * (1 - rate / 100), 1)) * 100_000_000) / 1_000_000;
}

export function discountedBase(quantity: number, priceUnit: number, primary: number | null | undefined, extra?: number | null, promptPayment?: number | null): number {
  return Math.round(quantity * priceUnit * (1 - effectiveDiscount(primary, extra, promptPayment) / 100) * 100) / 100;
}

export function taxFromBase(base: number, rate: number): number {
  return Math.round(base * rate) / 100;
}

/** Resto de base no gravado, calculado con las mismas bases que recibirá Odoo. */
export function calculateWebAdjustment(
  declared: { base: number | null; taxes: number | null; total: number | null },
  lines: { productId?: number | null; quantity?: number | null; priceUnit?: number | null; discount?: number | null; discountExtra?: number | null; promptPaymentDiscount?: number | null; total?: number | null; taxAmount?: number | null; taxId?: number | null }[],
): { amount: number; productsBase: number; taxTotal: number; taxDifference: number } {
  const { base, taxes, total } = declared;
  if (base == null || taxes == null || total == null || ![base, taxes, total].every(Number.isFinite)) throw new Error("Completa Base, Impuestos y Total antes del ajuste.");
  if (Math.abs(Math.round((base + taxes - total) * 100)) > 1) throw new Error("Base + Impuestos no coincide con el Total declarado.");
  const products = lines.filter((line) => !isWebAdjustmentProductId(line.productId));
  if (!products.length) throw new Error("Añade primero los productos de la factura.");
  if (products.some((line) => line.quantity == null || line.quantity <= 0 || !Number.isFinite(line.quantity) || line.priceUnit == null || !Number.isFinite(line.priceUnit))) throw new Error("Completa cantidad y precio de todos los productos antes del ajuste.");
  if (products.some((line) => line.taxAmount == null || !Number.isFinite(line.taxAmount))) throw new Error("Confirma las cuotas de IVA de los productos antes del ajuste.");
  if (lines.some((line) => isWebAdjustmentProductId(line.productId) && (line.taxId || line.taxAmount))) throw new Error("El Ajuste Web existente lleva IVA; revísalo antes de sustituirlo.");
  const productsBase = Math.round(products.reduce((sum, line) => sum + discountedBase(line.quantity!, line.priceUnit!, line.discount, line.discountExtra, line.promptPaymentDiscount), 0) * 100) / 100;
  if (products.some((line) => line.total != null && Math.abs(line.total - discountedBase(line.quantity!, line.priceUnit!, line.discount, line.discountExtra, line.promptPaymentDiscount)) > 0.01)) throw new Error("Hay un importe de línea editado que no coincide con cantidad, precio y descuentos. Revísalo antes del ajuste.");
  const taxTotal = Math.round(products.reduce((sum, line) => sum + line.taxAmount!, 0) * 100) / 100;
  return { amount: Math.round((base - productsBase) * 100) / 100, productsBase, taxTotal, taxDifference: Math.round((taxes - taxTotal) * 100) / 100 };
}
