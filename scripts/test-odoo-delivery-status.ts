import assert from "node:assert/strict";
import { isSendcloudReadyToValidate } from "../backend/odooDeliveryStatus.ts";

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

console.log("Odoo delivery status validation rules OK");
