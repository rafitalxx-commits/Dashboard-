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
assert.match(purchaseView, /cancelPendingPurchase\(\s*actionPreview\.orderId\s*,?\s*\)/);
assert.doesNotMatch(purchaseView, /cancelPendingPurchase\(\s*actionPreview\.orderId\s*,\s*true\s*\)/);
assert.match(purchaseView, /Cancelando en Odoo…/);
assert.match(purchaseView, /role="alert"/);
assert.match(purchaseView, /Descartar presupuesto/);
assert.match(purchaseView, /Borrador local de .* descartado\. No se había creado en Odoo/);
assert.match(purchaseView, /Stock total Odoo:/);
assert.match(purchaseView, /stockTotal: product\.stockTotal/);
assert.match(purchaseView, /Añade líneas antes de confirmar o enviar el email/);
assert.match(purchaseView, /actionPreview\.lineCount === 0/);
assert.match(purchaseView, /guárdalo en Odoo antes de confirmar o enviar el email/);
assert.match(purchaseView, /const confirmPurchase = async/);
assert.match(purchaseView, /confirmAndSendPendingPurchase\(actionPreview\.orderId, false\)/);
assert.match(purchaseView, /confirmPendingPurchase\(actionPreview\.orderId, false, false\)/);
assert.match(purchaseView, /Confirmar sin email/);
assert.match(purchaseView, /Confirmar y enviar email/);
assert.match(purchaseView, /sendConfirmedPurchaseEmail/);
assert.match(purchaseView, /previewAction\(reception, "confirm-no-email"\)/);
assert.match(purchaseView, /previewAction\(reception, "confirm-email"\)/);
assert.match(purchaseView, /void confirmPurchase\(actionKind === "confirm-email"\)/);
assert.doesNotMatch(purchaseView, /previewAction\(reception, "confirm"\)/);
assert.doesNotMatch(purchaseView, /const simulateConfirmation = async/);
// El presupuesto vacío creado en Odoo llega con fecha esperada vacía:
// el guardado de líneas debe rellenar la fecha en vez de fallar la validación.
assert.match(
  purchaseView,
  /expectedDate: \(\s*line\.expectedDate \|\|\s*confirming\.expectedDate \|\|\s*new Date\(\)\.toISOString\(\)\s*\)\.slice\(\s*0,\s*10,?\s*\)/,
);
assert.match(
  purchaseView,
  /reception\.expectedDate \|\|\s*new Date\(\)\.toISOString\(\)\.slice\(0, 10\),/,
);
const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const odooClient = readFileSync(new URL("../src/services/odooClient.ts", import.meta.url), "utf8");
assert.match(odooClient, /pending-purchases\/send-email/);
assert.match(odooClient, /pending-purchases\/confirm-and-send-email/);
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appStyles = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");
assert.match(viteConfig, /"qty_available"/);
assert.match(viteConfig, /async function sendOdooPurchaseOrderEmail/);
assert.match(viteConfig, /async function sendNativePurchaseOrderEmail/);
assert.match(viteConfig, /"purchase\.order", "action_rfq_send"/);
assert.match(viteConfig, /"mail\.compose\.message",\s*"action_send_mail"/);
assert.match(viteConfig, /"mail\.message"/);
assert.match(viteConfig, /env\.ODOO_WRITE_ENABLED = process\.env\.ODOO_WRITE_ENABLED \?\? env\.ODOO_WRITE_ENABLED/);
assert.match(viteConfig, /const readOnlyMethods = new Set\(\[\s*"search",/);
assert.match(viteConfig, /new Set\(\["product_qty", "price_unit", "discount", "date_planned", "name"\]\)/);
assert.doesNotMatch(viteConfig, /sourceLines\.length === 0\) return \[\];/);
assert.match(viteConfig, /cleanText\(order\.date_order\)\.slice\(0, 10\)/);
assert.match(viteConfig, /stockTotal: Number\(product\.qty_available \?\? 0\)/);
assert.equal(
  viteConfig.match(/formatCatalogProductName\(product\)/g)?.length,
  2,
);
assert.match(viteConfig, /"origin", "partner_id", "state"/);
assert.match(viteConfig, /originRefsByPurchaseId/);
assert.match(viteConfig, /\[\[\["name", "in", originRefs\]\]\]/);
assert.match(viteConfig, /\["draft", "sent", "purchase", "done"\]/);
assert.doesNotMatch(viteConfig, /delivery_is_printed !== true/);
assert.match(odooClient, /fetch\(receptionsApiPath\("\/api\/odoo\/sales-purchase-alerts"\)\)/);
assert.match(app, /className="icon-button purchase-alert-icon"/);
assert.match(app, /purchase-alert-icon is-confirmed/);
assert.match(app, /pendingSalesPurchaseAlerts/);
assert.match(app, /className="sales-purchase-drawer"/);
assert.match(appStyles, /\.sales-purchase-drawer\s*\{\s*position:\s*absolute/);
assert.match(appStyles, /\.purchase-alert-icon\s*\{/);
assert.match(appStyles, /\.purchase-alert-icon\.is-confirmed\s*\{/);
assert.match(appStyles, /\.order-kpis \.kpi span \{ color: #334155; font-weight: 800; \}/);
assert.match(appStyles, /\.kpi-rose \{ background: #ffe8ed;/);
assert.match(app, /\{ label: "4 dias", value: "4d" \}/);
assert.match(app, /className="segmented-control range-chips"/);
assert.doesNotMatch(app, /\{ label: "Ayer", value: "yesterday" \}/);
assert.doesNotMatch(app, /\{ label: "30 dias"/);
assert.doesNotMatch(app, /preset === "yesterday"/);
assert.match(appStyles, /\.segmented-control\.range-chips\s*\{\s*flex-direction:\s*row/);
assert.match(appStyles, /\.range-bar \.custom-range\s*\{\s*flex-direction:\s*row/);
assert.match(app, /useState<RangePreset>\("4d"\)/);
assert.match(app, /const needsCompleteOrderDataset/);
assert.match(app, /Filtro aplicado: \$\{sortedOrders\.length\} pedidos de todos los bloques/);
assert.match(odooClient, /fetch\(receptionsApiPath\(`\/api\/odoo\/orders\?/);
assert.match(app, /const orderChannelFilterOptions = \["Amazon FBM", "Website", "Sales"\]/);
assert.match(app, /status\.includes\("pendiente stock"\)/);
assert.match(app, /Odoo real · acciones habilitadas/);
assert.match(app, /Preserve the prior dataset while the selected filter gathers every block/);
assert.match(app, /if \(option === "Website"\) return channel === "website" \|\| channel === "web"/);
assert.match(app, /if \(option === "Sales"\) return channel === "sales" \|\| channel === "sale" \|\| channel === "ventas" \|\| channel === "venta"/);
assert.match(app, /if \(option === "Amazon FBM"\) \{\n    return fulfillment === "FBM"/);
console.log("Compras pendientes: selección de tarifa de proveedor verificada");
console.log("Compras pendientes: descarte local y cancelación real protegidos contra regresiones");
console.log("Compras pendientes: stock total Odoo presente en búsquedas y líneas");
console.log("Compras pendientes: fecha prevista con respaldo para presupuestos vacíos");
console.log("Compras pendientes: valores de variante visibles sin el nombre del atributo");
console.log("Compras pendientes: enlaces explícitos de origen venta→compra visibles en alertas");
console.log("Compras pendientes: alertas usan la API aislada del LAB");
console.log("Compras pendientes: carrito destacado y panel lateral verificados");
console.log("Pedidos: filtros agregan todos los bloques y el rango inicial es de cuatro días");
console.log("Pedidos: selector de fechas horizontal 1/4/7/Rango en movil y PC");
console.log("Pedidos: filtros FBM, Website y Sales permanecen visibles durante la carga");
