import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../src/services/odooClient.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/modules/receptions/InventoryReceptionsView.tsx", import.meta.url), "utf8");

assert.match(vite, /url\.pathname === "\/validate"/);
assert.match(vite, /url\.pathname === "\/cancel"/);
assert.match(vite, /user\.permissions\.includes\("odooWrite"\)/);
assert.match(vite, /Las líneas han cambiado en Odoo/);
assert.match(vite, /stock\.backorder\.confirmation/);
assert.match(vite, /createBackorder \? "process" : "process_cancel_backorder"/);
assert.match(vite, /pendingReception:/);
assert.match(vite, /model === "stock\.move" && method === "create"/);
assert.match(vite, /model === "stock\.picking" && \["button_validate", "action_cancel"\]/);
assert.match(client, /validateInventoryReception/);
assert.match(client, /cancelInventoryReception/);
assert.match(view, /Enviando a Odoo…/);
assert.match(view, /Cancelando en Odoo…/);
assert.match(view, /disabled=\{validating/);
assert.match(vite, /fields: \["id", "partner_ref", "order_type"\]/);
assert.match(vite, /=== "rebastecimiento"/);
assert.match(view, /useState<ReceptionFilter>\("Esperando"\)/);
assert.match(view, /filter === "Importaciones" \? item\.isImportation/);
assert.match(view, /item\.status === filter && !item\.isImportation/);
assert.match(view, /Página \{historyPage\} de \{historyPages\}/);
assert.doesNotMatch(view, /validateSimulation|cancelSimulation|Confirmar simulación/);

console.log("Recepciones Fase 5: escritura Odoo, permisos y feedback verificados");
