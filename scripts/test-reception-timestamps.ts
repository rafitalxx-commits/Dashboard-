import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/services/odooTypes.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/modules/receptions/InventoryReceptionsView.tsx", import.meta.url), "utf8");
const inventoryApi = vite.slice(
  vite.indexOf("async function getOdooInventoryReceptions"),
  vite.indexOf("async function getOdooSalesPurchaseAlerts"),
);

assert.match(inventoryApi, /"create_date"/);
assert.match(inventoryApi, /fields: \["id", "partner_ref", "order_type", "date_approve"\]/);
assert.match(inventoryApi, /orderConfirmedAtByPurchaseId[\s\S]*purchase\.date_approve/);
assert.match(
  inventoryApi,
  /partialEntryCreatedAt: getRelationId\(picking\.backorder_id\)\s*\?\s*formatDate\(cleanText\(picking\.create_date\)\)/,
);
assert.match(types, /orderConfirmedAt\?: string/);
assert.match(types, /partialEntryCreatedAt\?: string/);
assert.match(view, /<ReceiptDates reception=\{item\}\/>/);
assert.match(view, /<ReceiptDates reception=\{reception\}\/>/);
assert.match(view, /aria-label=\{orderLabel\}/);
assert.match(view, /aria-label=\{partialLabel\}/);
assert.match(view, /CalendarCheck aria-hidden="true"/);
assert.match(view, /PackagePlus aria-hidden="true"/);
assert.match(view, /reception\.status === "Pendiente"/);
assert.match(view, /orderConfirmedAt \|\| "—"/);
assert.match(view, /partialEntryCreatedAt \|\| "—"/);

console.log("Recepciones: fuentes Odoo y fechas compactas con iconos verificadas");
