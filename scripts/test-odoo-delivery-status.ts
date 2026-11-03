import assert from "node:assert/strict";
import { isDashboardShipmentStatus, isDeliveryStatusEligible, isRecordedDashboardLabel, isRecordedDashboardShipment, isSendcloudReadyToValidate } from "../backend/odooDeliveryStatus.ts";

const validStatuses = [
  "Listo para recoger",
  "Shipped",
  "Enviado",
  "Expédié",
  "Etiqueta creada",
  "ready_to_send",
  "shipment_on_route",
  "En ruta",
  "Entregado",
];

const invalidStatuses = [
  "",
  "Sin etiqueta",
  "Pendiente",
  "Cancelado",
  "Error en etiqueta",
  "Unshipped",
];

for (const status of validStatuses) {
  assert.equal(
    isSendcloudReadyToValidate(status),
    true,
    `${status} should be valid for Odoo delivery validation`,
  );
}

for (const status of invalidStatuses) {
  assert.equal(
    isSendcloudReadyToValidate(status),
    false,
    `${status} should not be valid for Odoo delivery validation`,
  );
}

for (const source of ["genei-label-created", "mrw-label-created", "dhl-label-created", "correos-express-label-created", "future-carrier-label-created", "expeditions-print"]) {
  assert.equal(isRecordedDashboardShipment({ source, shipmentCode: "EXP-123", tracking: "TRK-123" }), true, source);
}
assert.equal(isRecordedDashboardShipment({ source: "future-carrier-label-created", shipmentCode: "EXP-123", tracking: "" }), true);
assert.equal(isRecordedDashboardLabel({ source: "future-carrier-label-created", shipmentCode: "EXP-123", tracking: "" }), true);
assert.equal(isRecordedDashboardShipment({ source: "future-carrier-label-created", shipmentCode: "", tracking: "TRK-123" }), false);
assert.equal(isRecordedDashboardShipment({ source: "external-import", shipmentCode: "EXP-123", tracking: "TRK-123" }), false);
assert.equal(isRecordedDashboardShipment({ source: "genei-label-created", shipmentCode: "EXP-123", tracking: "TRK-123", reissuedAt: "2026-10-14T12:00:00Z" }), false);
assert.equal(isDashboardShipmentStatus("dashboard-shipment-recorded", "EXP-123"), true);
assert.equal(isDashboardShipmentStatus("dashboard-shipment-recorded", ""), false);
assert.equal(isDashboardShipmentStatus("external-status", "EXP-123"), false);
assert.equal(isDeliveryStatusEligible("dashboard-shipment-recorded", "", "Transportista futuro", "EXP-123"), true);
assert.equal(isDeliveryStatusEligible("external-status", "TRK-123", "MRW"), true);
assert.equal(isDeliveryStatusEligible("external-status", "TRK-123", "Transportista futuro"), false);

console.log("Odoo delivery status validation rules OK");
