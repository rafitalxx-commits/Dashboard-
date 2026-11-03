import { discountedBase } from "./supplierInvoiceDiscounts.ts";

type AmountLine = {
  total: number | null;
  quantity?: number | null;
  priceUnit?: number | null;
  discount?: number | null;
  discountExtra?: number | null;
  promptPaymentDiscount?: number | null;
  taxAmount?: number | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Numeric inconsistencies are review warnings, not a reason to block an Odoo draft. */
export function supplierInvoiceAmountWarnings(
  base: number,
  taxes: number,
  total: number,
  lines: AmountLine[],
  purchaseOrders: { name: string; amountTotal: number | null }[] = [],
  tolerance = 0.01,
): string[] {
  const warnings: string[] = [];
  const basePlusTax = round2(base + taxes);
  if (Math.abs(basePlusTax - total) > tolerance) {
    warnings.push(`Base ${round2(base)} + impuestos ${round2(taxes)} = ${basePlusTax}, distinto del total ${round2(total)}.`);
  }

  const lineBase = round2(lines.reduce((sum, line) => sum + (line.quantity != null && line.priceUnit != null
    ? discountedBase(line.quantity, line.priceUnit, line.discount, line.discountExtra, line.promptPaymentDiscount)
    : (line.total ?? 0)), 0));
  if (Math.abs(lineBase - base) > tolerance) {
    warnings.push(`Las líneas suman ${lineBase}, distinto de la base declarada ${round2(base)}.`);
  }

  if (lines.every((line) => line.taxAmount != null)) {
    const lineTaxes = round2(lines.reduce((sum, line) => sum + Number(line.taxAmount ?? 0), 0));
    if (Math.abs(lineTaxes - taxes) > tolerance) {
      warnings.push(`Las cuotas de línea suman ${lineTaxes}, distinto de los impuestos declarados ${round2(taxes)}.`);
    }
  }

  if (purchaseOrders.length) {
    const purchaseTotal = round2(purchaseOrders.reduce((sum, order) => sum + (order.amountTotal ?? 0), 0));
    if (Math.abs(purchaseTotal - total) > tolerance) {
      warnings.push(`Los pedidos seleccionados suman ${purchaseTotal}; el total de la factura es ${round2(total)}.`);
    }
  }
  return warnings;
}
