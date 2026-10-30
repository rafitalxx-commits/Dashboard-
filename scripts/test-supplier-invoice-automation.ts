import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { invoiceAutomationUser } from "../backend/supplierInvoices/automationAuth.ts";
import { prepareInvoiceBatch, type Checkpoint } from "../backend/supplierInvoices/automationBatch.ts";
import { registerSupplierInvoicesPhase2Routes } from "../backend/supplierInvoices/phase2Routes.ts";
import { DocumentInboxService } from "../backend/supplierInvoices/documentInbox.ts";
import { DriveClient } from "../backend/supplierInvoices/driveClient.ts";
import { runInvoiceAgent, reviewInvoice } from "../backend/supplierInvoices/agentRunner.ts";
import { EventEmitter } from "node:events";

const token = "synthetic-test-token-not-a-real-secret-1234567890";
const env = { SUPPLIER_INVOICES_AUTOMATION_ENABLED: "true", SUPPLIER_INVOICES_AUTOMATION_TOKEN_SHA256: createHash("sha256").update(token).digest("hex") };
const headers = { authorization: `Bearer ${token}` };
let promptPath = "";
const longTask = { pdfText: "Full document evidence ".repeat(12_000) };
const fakeSpawn = (_command: string, args: string[]) => {
  assert.ok(!args.includes("--message"));
  promptPath = args[args.indexOf("--message-file") + 1];
  assert.deepEqual(JSON.parse(readFileSync(promptPath, "utf8")), longTask);
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  queueMicrotask(() => { child.stdout.emit("data", "structured-result"); child.emit("close", 0); });
  return child;
};
assert.equal(await runInvoiceAgent(longTask, "synthetic", fakeSpawn as any), "structured-result");
assert.equal(existsSync(promptPath), false, "private document transport removed after completion");
await assert.rejects(() => runInvoiceAgent(longTask, "synthetic", (() => { throw new Error("spawn failed"); }) as any), /spawn failed/);
await assert.rejects(() => runInvoiceAgent({ pdfText: "x".repeat(4 * 1024 * 1024) }, "synthetic"), /4 MiB/);
let reviewCalls = 0;
const reviewTask = { rules: ["Keep every line"], documents: [{ pdfText: longTask.pdfText }] };
const reviewed = await reviewInvoice(reviewTask, "selected-pdf-only", false, async (task: any, key) => {
  reviewCalls++; assert.equal(key, "selected-pdf-only"); assert.deepEqual(task.documents, reviewTask.documents);
  return reviewCalls === 1 ? JSON.stringify({ reply: "Missing proposal" })
    : JSON.stringify({ reply: "OK", confidence: 90, proposal: { fields: { invoiceNumber: "LAB-1" }, lines: [{ description: "Evidenced service" }] }, unresolved: [] });
});
assert.equal(reviewCalls, 2); assert.equal(reviewed.proposal?.lines.length, 1);
reviewCalls = 0;
await assert.rejects(() => reviewInvoice(reviewTask, "selected-pdf-only", false, async () => { reviewCalls++; return "{}"; }), /JSON estructurado/);
assert.equal(reviewCalls, 2, "a persistently malformed proposal must not create an infinite retry loop");
reviewCalls = 0;
await reviewInvoice(reviewTask, "selected-pdf-only", true, async () => { reviewCalls++; return JSON.stringify({ reply: "Answer only" }); });
assert.equal(reviewCalls, 1, "human questions do not require invoice proposals");
assert.equal(invoiceAutomationUser({ headers, method: "GET", url: "/" }, env, "GET")?.id, "invoice-automation");
assert.equal(invoiceAutomationUser({ headers, url: "/" }, { ...env, SUPPLIER_INVOICES_AUTOMATION_ENABLED: "false" }, "GET"), null);
assert.equal(invoiceAutomationUser({ headers: { authorization: `Bearer ${"x".repeat(45)}` }, url: "/" }, env, "GET"), null);
assert.equal(invoiceAutomationUser({ headers, method: "POST", url: "/" }, env, "GET"), null);
assert.equal(invoiceAutomationUser({ headers, url: "/archive" }, env, "GET"), null);

// Exercise the registered application handlers, not just a token helper.
const dir = mkdtempSync(join(tmpdir(), "invoice-automation-"));
try {
  const routes = new Map<string, (req: any, res: any) => Promise<void>>();
  registerSupplierInvoicesPhase2Routes({ middlewares: { use: (path, handler) => { routes.set(path, handler as any); } } },
    { getSessionUser: () => undefined }, { env, dataDir: dir });
  async function call(path: string, method: string, extraHeaders: object = headers, body = "{}", url = "/") {
    const req = Object.assign(Readable.from([body]), { headers: extraHeaders, method, url });
    let responseBody = "";
    const res = { statusCode: 200, writableEnded: false, setHeader() {}, end(value: string) { responseBody = value; this.writableEnded = true; } };
    await routes.get(path)!(req, res);
    return { status: res.statusCode, body: responseBody ? JSON.parse(responseBody) : null };
  }
  const root = "/api/odoo/supplier-invoices/inbox";
  assert.equal((await call(root, "GET")).status, 200, "machine identity can read the inbox without browser cookies");
  assert.equal((await call(root, "GET", {})).status, 401);
  assert.equal((await call(root, "GET", headers, "{}", "/unknown")).status, 401, "prefix routing cannot widen the grant");
  assert.equal((await call(`${root}/scan`, "POST")).status, 500, "passes auth but fails closed without Drive config");
  assert.equal((await call(`${root}/raskibot-extract`, "POST", headers, '{"ids":["missing"]}')).status, 404);
  const allowed = new Set([root, `${root}/scan`, `${root}/raskibot-extract`]);
  let forbidden = 0;
  for (const [path] of routes) {
    if (allowed.has(path)) continue;
    for (const method of ["GET", "POST"]) {
      assert.equal((await call(path, method)).status, 401, `${method} ${path} must still require a human session`);
      forbidden++;
    }
  }
  console.log(`Auth application boundary OK: ${forbidden} non-granted route/method combinations denied`);
  const store = new DocumentInboxService({ dataDir: dir });
  store.getStore().documents.push({ driveFileId: "changed_pdf", sourcePresent: true, pdfCached: true, extracted: { lines: [] } } as any);
  mkdirSync(join(dir, "supplier-invoices/inbox"), { recursive: true });
  writeFileSync(join(dir, "supplier-invoices/inbox/changed_pdf.pdf"), "%PDF- stale cached content");
  const originalDownload = DriveClient.prototype.download;
  const originalMeta = DriveClient.prototype.getFileMeta;
  DriveClient.prototype.getFileMeta = async () => ({ id: "changed_pdf", parents: ["inbox-folder"], modifiedTime: "new-version" }) as any;
  DriveClient.prototype.download = async () => { throw new Error("fresh-source-download"); };
  try {
    await store.prepareForReview("changed_pdf", {}, [], []);
    await assert.rejects(() => store.prepareForReview("changed_pdf", { SUPPLIER_INVOICES_DRIVE_FOLDER_ID: "inbox-folder" }, [], [], true), /fresh-source-download/, "changed PDFs must not be reviewed from stale cached bytes");
    await assert.rejects(() => store.prepareForReview("changed_pdf", { SUPPLIER_INVOICES_DRIVE_FOLDER_ID: "different-folder" }, [], [], true), /ya no está/, "a PDF moved since the batch manifest must not be analyzed");
  } finally { DriveClient.prototype.download = originalDownload; DriveClient.prototype.getFileMeta = originalMeta; }
  const fetchBefore = globalThis.fetch;
  const freshDir = join(dir, "fresh-download"); mkdirSync(freshDir);
  const freshPath = join(freshDir, "versioned.pdf"); writeFileSync(freshPath, "%PDF-old");
  const drive = new DriveClient({}); (drive as any).accessToken = "synthetic";
  let downloads = 0;
  globalThis.fetch = async () => { downloads++; return new Response("%PDF-new"); };
  try {
    await drive.download("versioned", freshDir); assert.equal(downloads, 0);
    await drive.download("versioned", freshDir, true); assert.equal(downloads, 1);
    assert.equal(readFileSync(freshPath, "utf8"), "%PDF-new", "refresh must really bypass the Drive client's existing-file cache");
    globalThis.fetch = async () => new Response("not a PDF");
    await assert.rejects(() => drive.download("versioned", freshDir, true), /PDF válido/);
    assert.equal(readFileSync(freshPath, "utf8"), "%PDF-new", "an invalid refresh must preserve the prior PDF");
  } finally { globalThis.fetch = fetchBefore; }
} finally { rmSync(dir, { recursive: true, force: true }); }

const doc = (id: string, changes: object = {}) => ({ driveFileId: id, modifiedTime: "v1", sourcePresent: true, status: "SIN_REVISAR", ...changes });
const state = (): Checkpoint => ({ version: 1, target: "synthetic-lab", documents: {} });
const checkpoint = state();
const calls: string[] = [];
let saves = 0, active = 0, maxActive = 0;
let manifest = [doc("good"), doc("partial"), doc("failed"), doc("validated", { status: "VALIDADA" }), doc("odoo", { odooDraftMoveId: 42 }), doc("absent", { sourcePresent: false }), doc("archived", { movedTo: "folder" })];
const api = async (path: string, method: "GET" | "POST", body?: any) => {
  calls.push(`${method} ${path}`);
  if (path.endsWith("/scan")) return { status: "ok" };
  if (method === "GET") return { items: manifest };
  const id = body.ids[0];
  assert.equal(body.ids.length, 1);
  active++; maxActive = Math.max(maxActive, active);
  await Promise.resolve();
  active--;
  if (id === "failed") throw new Error("PDF sin OCR");
  return { status: "ok", document: { driveFileId: id }, scanOutcome: { status: id === "partial" ? "partial" : "complete", unresolved: [] },
    verification: { ready: id !== "partial", blockers: id === "partial" ? ["Cuenta ambigua"] : [] } };
};
const first = await prepareInvoiceBatch(api, checkpoint, () => { saves++; });
assert.deepEqual(first, { present: 7, prepared: 1, pending: 1, failed: 1, skipped: 4 });
assert.equal(maxActive, 1);
assert.equal(saves, 3, "checkpoint saved after every selected document");
assert.deepEqual(checkpoint.documents.partial.blockers, ["Cuenta ambigua"]);
assert.deepEqual(await prepareInvoiceBatch(api, checkpoint, () => {}), { present: 7, prepared: 0, pending: 0, failed: 1, skipped: 6 });
manifest = [doc("good", { modifiedTime: "v2" })];
assert.equal((await prepareInvoiceBatch(api, checkpoint, () => {})).prepared, 1, "changed source is reviewed again");
assert.ok(calls.every((call) => /inbox(?:\/scan|\/raskibot-extract)?$/.test(call)), "batch never calls validation, Odoo writes or archive");
await assert.rejects(() => prepareInvoiceBatch(async () => { throw Object.assign(new Error("Auth failed"), { status: 401 }); }, state(), () => {}), /Auth failed/);
await assert.rejects(() => prepareInvoiceBatch(api, state(), () => { throw new Error("disk full"); }), /disk full/);
const missingVerification = async (path: string, method: string) => method === "GET" ? { items: [doc("noCotejo")] }
  : path.endsWith("/scan") ? {} : { status: "ok", document: { driveFileId: "noCotejo" }, scanOutcome: { status: "complete" } };
assert.equal((await prepareInvoiceBatch(missingVerification, state(), () => {})).pending, 1, "AI extraction alone is not verified");
console.log("Batch OK: sequential review, per-file checkpoint, resume, stale source, errors, independent verification and no final actions");

// Real CLI -> HTTP -> durable checkpoint, using only synthetic external data.
const cliDir = mkdtempSync(join(tmpdir(), "invoice-automation-cli-"));
let reviews = 0;
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 401; res.end("{}"); return; }
  if (req.method === "GET" && req.url?.endsWith("/inbox")) { res.end(JSON.stringify({ items: [doc("cli_pdf")] })); return; }
  if (req.method === "POST" && req.url?.endsWith("/scan")) { res.end("{}"); return; }
  if (req.method === "POST" && req.url?.endsWith("/raskibot-extract")) {
    reviews++; res.end(JSON.stringify({ status: "ok", document: { driveFileId: "cli_pdf" }, scanOutcome: { status: "complete" }, verification: { ready: true, blockers: [] } })); return;
  }
  res.statusCode = 404; res.end("{}");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const port = (server.address() as { port: number }).port;
  const tokenPath = join(cliDir, "token"); const statePath = join(cliDir, "checkpoint.json");
  writeFileSync(tokenPath, token, { mode: 0o600 });
  const run = () => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/prepare-supplier-invoices.ts"], {
      env: { ...process.env, SUPPLIER_INVOICES_AUTOMATION_URL: `http://127.0.0.1:${port}`, SUPPLIER_INVOICES_AUTOMATION_TOKEN_FILE: tokenPath, SUPPLIER_INVOICES_AUTOMATION_STATE_FILE: statePath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject); child.on("close", (code) => resolve({ code, output }));
  });
  assert.equal((await run()).code, 0);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).documents.cli_pdf.outcome, "prepared");
  assert.equal((await run()).code, 0); assert.equal(reviews, 1, "fresh CLI resumes without duplicate AI calls");
  writeFileSync(`${statePath}.lock`, "synthetic-active-owner");
  assert.notEqual((await run()).code, 0, "overlapping run is refused");
  rmSync(`${statePath}.lock`);
  writeFileSync(tokenPath, "x".repeat(45));
  const denied = await run(); assert.notEqual(denied.code, 0);
  assert.equal(existsSync(`${statePath}.lock`), false, "auth failure releases the lock");
  assert.ok(!denied.output.includes("x".repeat(45)), "credential must not leak into CLI output");
  console.log("CLI HTTP + disk OK: authenticated headless execution, fresh-process resume, overlap guard and auth failure");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(cliDir, { recursive: true, force: true });
}
