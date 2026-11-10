import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildConfirmShipmentRequest, createAmazonSpApiClient } from "../backend/amazonSpApi/client.ts";

// Offline only: verify source plus the exact public-asset candidate, then the real serializer.
globalThis.fetch = async () => { throw new Error("Network forbidden in this test"); };
const source = readFileSync(new URL("../src/modules/expeditions/ExpeditionsView.tsx", import.meta.url), "utf8");
const definition = source.match(/function amazonShippingMethod\(carrier: string, carrierStatus\?: string\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(definition);
const sourceFn = vm.runInNewContext(`(${definition.replaceAll(": string", "").replace("carrierStatus?", "carrierStatus")})`, {
  shippingServiceLabel: (id: string) => `label:${id}`,
});
const variants: Array<[string, Function]> = [["source", sourceFn]];
if (process.argv[2]) {
  const bundle = readFileSync(process.argv[2], "utf8");
  const definition = bundle.match(/function Kj\(t,s\)\{[^{}]+\}/)?.[0];
  assert.ok(definition);
  assert.equal((bundle.match(/shippingMethod:Kj\(/g) || []).length, 2, "manual and automatic paths");
  variants.push(["public candidate", vm.runInNewContext(`(${definition})`, { pm: (id: string) => `label:${id}` })]);
}
let checks = 0;
for (const [name, method] of variants) {
  for (const [carrier, service, expected] of [
    ["MRW", "mrw-urgent-1900-expedition", "Urgente 19"],
    ["mrw", "mrw-urgent-1900-expedition", "Urgente 19"],
    ["MRW", "mrw-urgente-14", "MRW"],
    ["MRW", "mrw-economy", "MRW"],
    ["MRW", undefined, "MRW"],
    ["DHL", "mrw-urgent-1900-expedition", "DHL"],
    ["DHL", "dhl-connect-b2c", "DHL"],
    ["GLS", "96", "GLS"],
    ["Correos Express", "cex-paq24", "label:cex-paq24"],
  ]) {
    assert.equal(method(carrier, service), expected, `${name}: ${carrier}/${service}`); checks++;
  }
  const draft = {
    pickingId: 1, saleOrderId: 1, saleOrderName: "TEST-OFFLINE", amazonOrderId: "407-8153142-2001119",
    tracking: "00229F091174", carrier: "MRW", carrierCode: "MRW",
    shippingMethod: method("MRW", "mrw-urgent-1900-expedition"), shipmentDate: "2026-11-10T14:28:00Z",
    marketplaceId: "TEST", packageReferenceId: "1", orderItems: [{orderItemId: "TEST", quantity: 1}],
  };
  const request = buildConfirmShipmentRequest({ endpoint: "https://example.invalid", marketplaceId: "TEST" }, draft);
  assert.equal(request.body.packageDetail.shippingMethod, "Urgente 19");
  assert.equal(request.body.packageDetail.carrierCode, "MRW");
  assert.equal(request.body.packageDetail.carrierName, "MRW");
  assert.equal(request.body.packageDetail.trackingNumber, "00229F091174");
  const result = await createAmazonSpApiClient({ MARKETPLACE_ID: "TEST" }).confirmShipment(draft, {dryRun: true});
  assert.equal(result.dryRun, true);
  assert.equal(result.request.body.packageDetail.shippingMethod, "Urgente 19"); checks++;
}
console.log(`PASS: ${checks} cases; manual+automatic call sites; real serializer/dry-run; no network or writes`);
