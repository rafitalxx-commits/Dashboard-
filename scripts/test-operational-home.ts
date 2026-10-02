import assert from "node:assert/strict";
import { groupShipmentLabels, isHomeOrderUnprinted, isHomeOrderUnsent, labelReferences } from "../backend/home/metrics.ts";

const now = new Date("2026-10-02T13:00:00.000Z");
const labels = [
  { createdAt: "2026-10-02T12:30:00.000Z", tracking: "T1", shipper: "MRW", odooOrderRef: "#101" },
  { createdAt: "2026-09-30T13:00:00.000Z", tracking: "T2", shipper: "DHL", odooOrderRef: "#102" },
  { createdAt: "2026-09-30T12:59:59.000Z", tracking: "T3", shipper: "MRW", odooOrderRef: "#103" },
  { createdAt: "2026-10-02T12:40:00.000Z", shipper: "MRW", odooOrderRef: "#104" },
];
const grouped = groupShipmentLabels(labels, "48h", now);
assert.equal(grouped.total, 2, "48H includes the exact lower boundary, excludes earlier labels and missing tracking");
assert.equal(grouped.points.length, 49, "rolling 48H displays each hourly bucket including the partial end hour");
assert.equal(grouped.points.find((point) => point.at === "2026-10-02T12")?.value, 1);

const refs = labelReferences(labels);
const base = { id: "S101", odooRef: "#101", date: "2026-10-02", channel: "Amazon FBM", fulfillmentBy: "FBM", deliveryPrinted: true, deliveryStatus: "Pendiente" };
assert.equal(isHomeOrderUnsent(base, refs), false, "printed order with generated label is sent");
assert.equal(isHomeOrderUnsent({ ...base, odooRef: "#105" }, refs), true, "printed order without label is still unsent");
assert.equal(isHomeOrderUnprinted({ ...base, deliveryPrinted: false }), true);
assert.equal(isHomeOrderUnprinted({ ...base, deliveryPrinted: false, sendcloud: { status: "Entregado" } }), false);
assert.equal(isHomeOrderUnsent({ ...base, channel: "Website", fulfillmentBy: "", odooRef: "#105" }, refs), true);
assert.equal(isHomeOrderUnsent({ ...base, channel: "Sales", fulfillmentBy: "", odooRef: "#105" }, refs), false);
console.log("Operational Home definitions: OK");
