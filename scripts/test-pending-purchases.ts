import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chooseSupplierPrice } from "../backend/purchases/supplierPricing.ts";

const rows = [
  { product_tmpl_id: [10, "Template"] as [number, string], product_id: false as const, min_qty: 0, price: 12, discount: 25, price_discounted: 9, sequence: 1 },
  { product_tmpl_id: [10, "Template"] as [number, string], product_id: [101, "Variant"] as [number, string], min_qty: 0, price: 10, sequence: 1 },
  { product_tmpl_id: [10, "Template"] as [number, string], product_id: false as const, min_qty: 20, price: 8, sequence: 1 },
];
assert.equal(chooseSupplierPrice(101, 10, rows)?.price, 10);
assert.equal(chooseSupplierPrice(102, 10, rows)?.price_discounted, undefined);
assert.equal(chooseSupplierPrice(102, 10, rows)?.price, 8);
assert.equal(chooseSupplierPrice(101, 99, rows), undefined);

const purchaseView = readFileSync(new URL("../src/modules/receptions/ReceptionsView.tsx", import.meta.url), "utf8");
assert.match(purchaseView, /cancelPendingPurchase\(actionPreview\.orderId\)/);
assert.doesNotMatch(purchaseView, /cancelPendingPurchase\(actionPreview\.orderId, true\)/);
assert.match(purchaseView, /Cancelando en Odoo…/);
assert.match(purchaseView, /role="alert"/);
assert.match(purchaseView, /Descartar presupuesto/);
assert.match(purchaseView, /Borrador local de .* descartado\. No se había creado en Odoo/);
assert.match(purchaseView, /Stock total Odoo:/);
assert.match(purchaseView, /stockTotal: product\.stockTotal/);
const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
assert.match(viteConfig, /"qty_available"/);
assert.match(viteConfig, /stockTotal: Number\(product\.qty_available \?\? 0\)/);
console.log("Compras pendientes: selección de tarifa de proveedor verificada");
console.log("Compras pendientes: descarte local y cancelación real protegidos contra regresiones");
console.log("Compras pendientes: stock total Odoo presente en búsquedas y líneas");
