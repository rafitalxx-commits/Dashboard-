import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createProductLocations } from "../backend/products/locations.ts";
import { createExpeditionReplenishment } from "../backend/expeditionReplenishment/service.ts";
import { registerExpeditionReplenishmentRoutes } from "../backend/expeditionReplenishment/routes.ts";

const dataDir = mkdtempSync(join(tmpdir(), "expedition-replenishment-"));
const file = join(dataDir, "product-locations.json");
const locations = createProductLocations({ dataDir });
for (const code of ["A101", "B202", "C303", "D404"]) locations.saveCatalogEntry({ code });
for (const [productId, balance, reserve] of [[1, 0, 8], [2, -3, 10], [3, 2, 5], [4, 0, 0], [5, 0, -2], [6, 0, 4]]) {
  locations.save({ productId, code: "A101", quantity: balance, preferred: true });
  locations.save({ productId, code: productId === 6 ? "D404" : "B202", quantity: reserve });
}
locations.setCatalogEntryActive("D404", false);
// Legacy missing/ambiguous preferences and dispatch allocations do not create false alerts.
const seeded = JSON.parse(readFileSync(file, "utf8"));
const prototype = seeded.locations[0];
seeded.locations.push(
  { ...prototype, productId: 7, code: "A101", quantity: 0, preferred: false },
  { ...prototype, productId: 7, code: "B202", quantity: 8, preferred: false },
  { ...prototype, productId: 8, code: "A101", quantity: 0, preferred: true },
  { ...prototype, productId: 8, code: "PENDIENTE_ENVIO", quantity: 8, preferred: false },
  { ...prototype, productId: 9, code: "A101", quantity: 0, preferred: true },
  { ...prototype, productId: 9, code: "B202", quantity: 8, preferred: true },
);
writeFileSync(file, JSON.stringify(seeded));
const catalog = { list: () => ({ products: [1, 2, 3, 4, 5, 6].map((id) => ({ id, reference: `REF${id}`, name: `Producto ${id}`, uom: "uds" })) }) };
const service = createExpeditionReplenishment(locations, catalog);
assert.deepEqual(service.list().map((item) => item.productId), [2, 1, 6]);
assert.equal(service.list()[0].preferred.quantity, -3);
assert.equal(service.list()[2].sources[0].active, false);
const before = readFileSync(file, "utf8");
for (const invalid of [
  { productId: 2, fromCode: "A101", toCode: "A101", quantity: 1 },
  { productId: 2, fromCode: "B202", toCode: "C303", quantity: 1 },
  { productId: 2, fromCode: "B202", toCode: "A101", quantity: 11 },
  { productId: 2, fromCode: "B202", toCode: "A101", quantity: -1 },
  { productId: 6, fromCode: "D404", toCode: "A101", quantity: 1 },
  { productId: 3, fromCode: "B202", toCode: "A101", quantity: 1 },
]) assert.throws(() => service.transfer({ ...invalid, requestId: "invalid-request-0001" }));
assert.equal(readFileSync(file, "utf8"), before, "invalid transfers do not mutate anything");
const input = { productId: 2, fromCode: "B202", toCode: "A101", quantity: 2, requestId: "replenishment-test-0001" };
service.transfer(input);
assert.equal(service.list().find((item) => item.productId === 2)?.preferred.quantity, -1, "partial debt remains visible");
const after = readFileSync(file, "utf8");
service.transfer(input);
assert.equal(readFileSync(file, "utf8"), after, "duplicate must not write twice");
const restarted = createProductLocations({ dataDir });
const restartedService = createExpeditionReplenishment(restarted, catalog);
restartedService.transfer(input);
assert.equal(readFileSync(file, "utf8"), after, "restart preserves duplicate protection");
assert.throws(() => restartedService.transfer({ ...input, quantity: 1 }), /otro movimiento/);
restartedService.transfer({ ...input, quantity: 2.5, requestId: "replenishment-test-0002" });
assert.equal(restartedService.list().some((item) => item.productId === 2), false);
assert.deepEqual(restarted.forProduct(2).map(({ quantity }) => quantity), [1.5, 5.5]);
assert.equal(restarted.summary().changes.filter((change) => change.productId === 2 && change.reason === "replenishment").length, 4);

let handler: any;
let imageCalls = 0;
registerExpeditionReplenishmentRoutes({ middlewares: { use: (_path, callback) => { handler = callback; } } },
  { getSessionUser: (cookie) => cookie === "exp" ? { permissions: ["expeditions"] } : cookie === "other" ? { permissions: ["products"] } : null }, restartedService,
  async (ids) => { imageCalls++; return Object.fromEntries(ids.map((id) => [id, "photo"])); });
const server = createServer((req, res) => { void handler(req, res); });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
const url = `http://127.0.0.1:${address.port}`;
try {
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Cookie: "other" } })).status, 403);
  const auth = { Cookie: "exp", "Content-Type": "application/json" };
  assert.equal((await fetch(url, { headers: auth })).status, 200, "expeditions permission alone suffices");
  assert.deepEqual(await (await fetch(`${url}/images?ids=99999`, { headers: auth })).json(), {});
  assert.equal(imageCalls, 0, "cannot read arbitrary catalog photos");
  assert.deepEqual(await (await fetch(`${url}/images?ids=1,99999`, { headers: auth })).json(), { "1": "photo" });
  assert.equal((await fetch(url, { method: "DELETE", headers: auth })).status, 405);
  const snapshot = readFileSync(file, "utf8");
  const post = { productId: 1, fromCode: "B202", toCode: "A101", quantity: 1, requestId: "http-replenishment-0001" };
  assert.equal((await fetch(`${url}/transfer`, { method: "POST", headers: { ...auth, Cookie: "other" }, body: JSON.stringify(post) })).status, 403);
  assert.equal(readFileSync(file, "utf8"), snapshot);
  for (let i = 0; i < 2; i++) assert.equal((await fetch(`${url}/transfer`, { method: "POST", headers: auth, body: JSON.stringify(post) })).status, 200);
  assert.equal(createProductLocations({ dataDir }).forProduct(1)[0].quantity, 1);
  assert.equal((await fetch(`${url}/transfer`, { method: "POST", headers: auth, body: "{" })).status, 400);
  console.log("PASS: eligibility, negative/zero, inactive, stock limits, destination, persisted audit/idempotency, auth, images, real HTTP transfer");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(dataDir, { recursive: true, force: true });
}
