import assert from "node:assert/strict";
import { buildHomeComparison, comparisonBounds, comparisonChannel } from "../backend/home/comparison.ts";

const now = new Date("2026-10-04T10:00:00Z");
const bounds = comparisonBounds(now);
assert.equal(bounds.today.toISOString(), "2026-10-03T22:00:00.000Z");
assert.equal(bounds.week.toISOString(), "2026-09-27T22:00:00.000Z");
assert.equal(bounds.month.toISOString(), "2026-09-30T22:00:00.000Z");
assert.equal(comparisonChannel({ team: "Amazon FBM", fulfillmentBy: "FBA" }), null);
assert.equal(comparisonChannel({ team: "Amazon FBM", fulfillmentBy: "FBM" }), "fbm");
assert.equal(comparisonChannel({ team: "Website" }), "website");
const data = buildHomeComparison([
  { id: 1, dateDone: "2026-10-04 08:15:00", team: "Amazon FBM", fulfillmentBy: "FBM", amountUntaxed: 100.25 },
  { id: 2, dateDone: "2026-10-04 08:45:00", team: "Website", amountUntaxed: 20.5 },
  { id: 3, dateDone: "2026-10-02 10:10:00", team: "Website", amountUntaxed: 10 },
  { id: 4, dateDone: "2026-10-04 09:00:00", team: "Amazon FBM", fulfillmentBy: "FBA", amountUntaxed: 999 },
  { id: 5, dateDone: "2026-10-04 10:00:01", team: "Website", amountUntaxed: 500 },
  { id: 6, dateDone: "2026-10-03 21:59:59", team: "Website", amountUntaxed: 500 },
], now);
const hour = data.periods.today.find((bucket) => bucket.label === "10h");
assert.deepEqual([hour?.fbmOrders, hour?.websiteOrders, hour?.fbmSales, hour?.websiteSales], [1, 1, 100.25, 20.5]);
assert.equal(data.periods.today.at(-1)?.label, "12h", "no debe crear cubetas para horas futuras");
assert.equal(data.periods.today.reduce((sum, bucket) => sum + bucket.websiteOrders, 0), 1, "excluye ventas fuera del intervalo de Hoy");
assert.equal(data.periods.week.length, 7);
assert.equal(data.periods.week[0].label, "Lun");
assert.equal(data.periods.week[6].label, "Dom");
assert.equal(data.periods.month.length, 4);
assert.equal(data.periods.month[1].websiteSales, 10);
const empty = buildHomeComparison([], now);
assert.equal(empty.periods.today.reduce((sum, bucket) => sum + bucket.fbmOrders + bucket.websiteOrders, 0), 0);
assert.equal(empty.periods.today.length, 13, "un periodo vacío conserva las cubetas hasta la hora actual");
const winter = comparisonBounds(new Date("2026-01-05T09:00:00Z"));
assert.equal(winter.today.toISOString(), "2026-01-04T23:00:00.000Z");
const springChange = comparisonBounds(new Date("2026-03-29T12:00:00Z"));
assert.equal(springChange.today.toISOString(), "2026-03-28T23:00:00.000Z");
const springAfter = comparisonBounds(new Date("2026-03-30T12:00:00Z"));
assert.equal(springAfter.today.toISOString(), "2026-03-29T22:00:00.000Z");
const monthBoundary = comparisonBounds(new Date("2026-10-01T00:30:00Z"));
assert.equal(monthBoundary.month.toISOString(), "2026-09-30T22:00:00.000Z");
console.log("Home comparison timezone, channels, empty periods and boundaries: OK");
