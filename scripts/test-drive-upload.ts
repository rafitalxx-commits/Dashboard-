import assert from "node:assert/strict";
import { DriveClient } from "../backend/supplierInvoices/driveClient.ts";

const client = new DriveClient({ SUPPLIER_INVOICES_DRIVE_FOLDER_ID: "sin-revisar" });
(client as any).accessToken = "test-token";
const originalFetch = globalThis.fetch;
let requestUrl = "";
let requestInit: RequestInit | undefined;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  requestUrl = String(input);
  requestInit = init;
  return new Response(JSON.stringify({
    id: "uploaded-123",
    name: "proforma_invoice.pdf",
    mimeType: "application/pdf",
    size: 12,
    parents: ["sin-revisar"],
    webViewLink: "https://drive.google.com/file/d/uploaded-123/view",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

try {
  const bytes = Buffer.from("%PDF-1.7 test-pdf");
  const result = await client.uploadPdf("proforma_invoice.pdf", bytes);
  assert.equal(result.id, "uploaded-123");
  assert.equal(result.parents[0], "sin-revisar");
  assert.match(requestUrl, /uploadType=multipart/);
  assert.equal(requestInit?.method, "POST");
  assert.match(String((requestInit?.headers as Record<string, string>)?.["Content-Type"]), /multipart\/related/);
  const body = Buffer.isBuffer(requestInit?.body) ? requestInit.body.toString("latin1") : "";
  assert.match(body, /"name":"proforma_invoice\.pdf"/);
  assert.match(body, /"parents":\["sin-revisar"\]/);
  assert.ok(body.includes(bytes.toString("latin1")), "adjunta bytes originales del PDF");
  console.log("Drive PDF upload target, metadata and raw bytes OK");
} finally {
  globalThis.fetch = originalFetch;
}
