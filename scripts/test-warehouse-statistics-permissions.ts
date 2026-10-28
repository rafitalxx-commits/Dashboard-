import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerWarehouseWorkersRoutes } from "../backend/warehouseWorkers/routes.ts";

const dataDir = mkdtempSync(join(tmpdir(), "warehouse-statistics-permissions-"));
const workersPath = join(dataDir, "warehouse-workers.json");
const activityPath = join(dataDir, "warehouse-worker-activity.json");
writeFileSync(workersPath, JSON.stringify([{ id: "qa", code: "OP001", name: "QA", active: true }]));
writeFileSync(activityPath, JSON.stringify([{ id: "a", workerId: "qa", result: "label-created" }, { id: "b", workerId: "qa", result: "error" }]));
let handler: any;
registerWarehouseWorkersRoutes({ middlewares: { use: (_path, next) => { handler = next; } } }, {
  getSessionUser: (cookie) => cookie ? { permissions: [cookie] } : undefined,
}, { dataDir });
const server = createServer((req, res) => void handler(req, res));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
try {
  const before = [readFileSync(workersPath, "utf8"), readFileSync(activityPath, "utf8")];
  for (const path of ["/statistics", "/statistics/workers"]) {
    assert.equal((await fetch(url + path)).status, 401);
    assert.equal((await fetch(url + path, { headers: { Cookie: "orders" } })).status, 403);
    for (const permission of ["dashboard", "expeditions"]) {
      const response = await fetch(url + path, { headers: { Cookie: permission } });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(path === "/statistics" ? body.activities.length : body.workers.length, 1);
    }
  }
  assert.equal((await fetch(url, { headers: { Cookie: "expeditions" } })).status, 403, "worker administration is still restricted");
  assert.equal((await fetch(url, { method: "POST", headers: { Cookie: "expeditions", "Content-Type": "application/json" }, body: JSON.stringify({ name: "Forbidden" }) })).status, 403);
  assert.equal((await fetch(url + "/qa", { method: "PATCH", headers: { Cookie: "expeditions", "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) })).status, 403);
  assert.equal((await fetch(url + "/qa", { method: "DELETE", headers: { Cookie: "expeditions" } })).status, 403);
  assert.equal((await fetch(url, { headers: { Cookie: "settings" } })).status, 200);
  assert.deepEqual([readFileSync(workersPath, "utf8"), readFileSync(activityPath, "utf8")], before);
  console.log("PASS statistics GET: Expeditions + legacy Dashboard, denied anonymous/unrelated; management write guards and ledger unchanged");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
}
