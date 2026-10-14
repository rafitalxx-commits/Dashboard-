import assert from "node:assert/strict";
import {
  isClosedOdooDelivery,
  isDeliveryIncidentStillPending,
  isReportableDeliveryIncidentReason,
  isServiceOnlyOrder,
} from "../backend/odooDeliveryIncidentRules.ts";

const productTypes = new Map([[1, "service"], [2, "consu"]]);
assert.equal(isServiceOnlyOrder([{ product_id: [1, "Servicio"] }], productTypes), true);
assert.equal(isServiceOnlyOrder([{ product_id: [2, "Producto"] }], productTypes), false);
assert.equal(isServiceOnlyOrder([], productTypes), false);
assert.equal(isClosedOdooDelivery("done"), true);
assert.equal(isClosedOdooDelivery("cancel"), true);
assert.equal(isClosedOdooDelivery("assigned"), false);
assert.equal(isDeliveryIncidentStillPending("confirmed", true, false), true);
assert.equal(isDeliveryIncidentStillPending(undefined, false, false), true);
assert.equal(isDeliveryIncidentStillPending("done", true, false), false);
assert.equal(isDeliveryIncidentStillPending("cancel", true, false), false);
assert.equal(isDeliveryIncidentStillPending(undefined, false, true), false);
assert.equal(isReportableDeliveryIncidentReason("No hay una etiqueta válida creada desde el dashboard."), false);
assert.equal(isReportableDeliveryIncidentReason("No hay una etiqueta de envío válida con seguimiento."), false);
assert.equal(isReportableDeliveryIncidentReason("No hay una etiqueta generada y vinculada al pedido en Dashboard."), false);
assert.equal(isReportableDeliveryIncidentReason("No hay albaran asociado en Odoo."), true);
assert.equal(isReportableDeliveryIncidentReason("Odoo dejó el albarán sin reservar."), true);
console.log("Delivery incidents: OK");
