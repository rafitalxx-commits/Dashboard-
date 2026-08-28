import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDhlRoutes } from "../backend/dhl/routes.ts";

type Handler = (request: EventEmitter & { method: string; url: string; headers: Record<string, string> }, response: Response) => Promise<void>;
type Response = { statusCode: number; headers: Record<string, string>; body: Buffer; setHeader: (name: string, value: string) => void; end: (value?: string | Buffer) => void };

let handler: Handler | undefined;
registerDhlRoutes(
  { middlewares: { use: (_path, registered: Handler) => { handler = registered; } } },
  { getSessionUser: () => ({ permissions: ["expeditions"] }) },
  { DHL_LAB_MOCK: "true", DASHBOARD_DATA_DIR: mkdtempSync(join(tmpdir(), "dhl-lab-")) },
);
assert.ok(handler, "La ruta DHL debe registrarse");

async function request(method: string, path: string, payload?: unknown) {
  return await new Promise<Response>((resolve, reject) => {
    const input = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> };
    input.method = method;
    input.url = `/${path}`;
    input.headers = {};
    const response: Response = {
      statusCode: 200,
      headers: {},
      body: Buffer.alloc(0),
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(value = "") { this.body = Buffer.isBuffer(value) ? value : Buffer.from(value); resolve(this); },
    };
    Promise.resolve(handler!(input, response)).catch(reject);
    process.nextTick(() => {
      if (payload !== undefined) input.emit("data", Buffer.from(JSON.stringify(payload)));
      input.emit("end");
    });
  });
}

const shipment = {
  reference: "DHL-LAB-TEST-001",
  destination: { name: "Cliente LAB", address: "Calle Prueba 1", town: "Madrid", postalCode: "28001", countryCode: "ES", phone: "600000000", email: "lab@example.test" },
  packages: [{ weight: 1.25 }],
};
const status = await request("GET", "status");
assert.equal(status.statusCode, 200);
assert.equal(JSON.parse(status.body.toString()).labMock, true);

const created = await request("POST", "shipments/real", shipment);
assert.equal(created.statusCode, 201);
assert.equal(JSON.parse(created.body.toString()).shipment.status, "created");
const tracking = JSON.parse(created.body.toString()).shipment.tracking;

const duplicate = await request("POST", "shipments/real", shipment);
assert.equal(duplicate.statusCode, 409);

const label = await request("GET", `shipments/${shipment.reference}/label`);
assert.equal(label.statusCode, 200);
assert.match(label.body.toString(), /^%PDF-1.4/);
const labelByTracking = await request("GET", `shipments/${tracking}/label`);
assert.equal(labelByTracking.statusCode, 200);

const cancelled = await request("DELETE", `shipments/${tracking}`);
assert.equal(cancelled.statusCode, 200);
assert.equal(JSON.parse(cancelled.body.toString()).shipment.status, "cancelled");

console.log("DHL LAB integration test passed");
