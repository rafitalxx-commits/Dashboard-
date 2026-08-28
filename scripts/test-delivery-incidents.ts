import assert from "node:assert/strict";
import { isClosedOdooDelivery, isServiceOnlyOrder } from "../backend/odooDeliveryIncidentRules.ts";

const productTypes = new Map([[1, "service"], [2, "consu"]]);
assert.equal(isServiceOnlyOrder([{ product_id: [1, "Servicio"] }], productTypes), true);
assert.equal(isServiceOnlyOrder([{ product_id: [2, "Producto"] }], productTypes), false);
assert.equal(isServiceOnlyOrder([], productTypes), false);
assert.equal(isClosedOdooDelivery("done"), true);
assert.equal(isClosedOdooDelivery("cancel"), true);
assert.equal(isClosedOdooDelivery("assigned"), false);
console.log("Delivery incidents: OK");
