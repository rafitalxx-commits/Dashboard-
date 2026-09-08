export type SupplierPriceRow = {
  product_tmpl_id?: false | [number, string];
  product_id?: false | [number, string];
  min_qty?: number;
  price?: number;
  discount?: number;
  price_discounted?: number;
  currency_id?: false | [number, string];
  delay?: number;
  sequence?: number;
};

const relationId = (value: SupplierPriceRow["product_id"]) => Array.isArray(value) ? value[0] : 0;

export function chooseSupplierPrice(productId: number, templateId: number, rows: SupplierPriceRow[]) {
  return rows
    .filter((row) => relationId(row.product_tmpl_id) === templateId && (!relationId(row.product_id) || relationId(row.product_id) === productId))
    .sort((left, right) => {
      const variantRank = Number(Boolean(relationId(right.product_id))) - Number(Boolean(relationId(left.product_id)));
      return variantRank || Number(left.sequence ?? 1) - Number(right.sequence ?? 1) || Number(right.min_qty ?? 0) - Number(left.min_qty ?? 0);
    })[0];
}
