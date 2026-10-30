// No scheduler is installed by this command. Token and state paths are explicit.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prepareInvoiceBatch, type Checkpoint } from "../backend/supplierInvoices/automationBatch.ts";

const base = process.env.SUPPLIER_INVOICES_AUTOMATION_URL?.replace(/\/$/, "");
const tokenFile = process.env.SUPPLIER_INVOICES_AUTOMATION_TOKEN_FILE;
const stateFile = process.env.SUPPLIER_INVOICES_AUTOMATION_STATE_FILE;
if (!base || !tokenFile || !stateFile) throw new Error("Configura URL, TOKEN_FILE y STATE_FILE de SUPPLIER_INVOICES_AUTOMATION");
const target = new URL(base);
if (target.username || target.password || target.search || target.hash ||
    (target.protocol !== "https:" && !(target.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(target.hostname))))
  throw new Error("Usa HTTPS o un LAB en loopback, sin credenciales/query en la URL");
const token = readFileSync(tokenFile, "utf8").trim();
if (!/^[A-Za-z0-9_-]{43,256}$/.test(token)) throw new Error("Token técnico inválido");
const statePath = resolve(stateFile);
mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
const lockPath = `${statePath}.lock`;
// Fail closed on overlap or an interrupted owner; inspect the PID before clearing.
const lock = openSync(lockPath, "wx", 0o600);
writeFileSync(lock, String(process.pid));
try {
  const state: Checkpoint = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8"))
    : { version: 1, target: base, documents: {} };
  if (state.version !== 1 || state.target !== base || !state.documents || Array.isArray(state.documents))
    throw new Error("Checkpoint incompatible o perteneciente a otro entorno");
  const save = () => {
    const temp = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(temp, statePath);
  };
  const api = async (path: string, method: "GET" | "POST", body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(390_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${typeof result?.message === "string" ? result.message.slice(0, 800) : path}`), { status: response.status });
    return result;
  };
  const summary = await prepareInvoiceBatch(api, state, save);
  console.log(JSON.stringify({ ...summary, humanValidationRequired: true }));
  if (summary.failed) process.exitCode = 1;
} finally {
  closeSync(lock);
  unlinkSync(lockPath);
}
