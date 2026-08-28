import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDhlClient } from "../backend/dhl/client.ts";

const calls: Array<{ path: string; authorization?: string; body: unknown }> = [];
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  calls.push({ path: request.url || "", authorization: request.headers.authorization, body });
  response.setHeader("Content-Type", "application/json");
  if (request.url?.endsWith("/authenticate")) return response.end(JSON.stringify("preproduction-token"));
  if (request.url?.endsWith("/shipment")) return response.end(JSON.stringify({ Tracking: "DHL-PRE-TRACK", AWB: "DHL-PRE-AWB", LP: ["DHL-PRE-LP"], Label: Buffer.from("%PDF-1.4\\n%DHL PRE\\n").toString("base64") }));
  return response.end(JSON.stringify({ ok: true }));
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const client = createDhlClient({
  DHL_LAB_MOCK: "false",
  DHL_API_BASE_URL: `http://127.0.0.1:${address.port}/cimapi/api/v1`,
  DHL_USERNAME: "preproduction-user",
  DHL_PASSWORD: "preproduction-password",
  DHL_CUSTOMER_ACCOUNT: "PRE-ACCOUNT",
});
const shipment = {
  reference: "DHL-PRE-TEST-001",
  destination: { name: "Cliente PRE", address: "Calle Prueba 1", town: "Madrid", postalCode: "28001", countryCode: "ES", phone: "600000000", email: "pre@example.test" },
  packages: [{ weight: 1.25 }],
};

try {
  const created = await client.createShipment(shipment);
  assert.equal((created as { Tracking: string }).Tracking, "DHL-PRE-TRACK");
  await client.quote({ origin: "28001", destination: "08001" });
  await client.track({ Tracking: "DHL-PRE-TRACK" });
  await client.print("6", "DHL-PRE-TRACK");
  await client.remove("6", "DHL-PRE-TRACK");
  assert.equal(calls[0].path, "/cimapi/api/v1/customer/authenticate");
  assert.equal(calls[1].path, "/cimapi/api/v1/customer/shipment");
  assert.equal(calls[1].authorization, "Bearer preproduction-token");
  assert.equal((calls[1].body as { Customer: string }).Customer, "PRE-ACCOUNT");
  assert.match(calls[4].path, /Action=PRINT/);
  assert.match(calls[5].path, /Action=DELETE/);
  assert.equal(calls.length, 6, "El token debe reutilizarse durante todas las llamadas posteriores");
  console.log("DHL preproduction HTTP test passed");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
