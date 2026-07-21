/**
 * Test de integracion HTTP para CRUD de tareas con store temporal.
 *
 * Arranca Vite dev server en 127.0.0.1 con un puerto libre y un store temporal en /tmp,
 * ejecuta operaciones GET / POST / PATCH / DELETE contra /hermes-updated/api/tasks
 * y verifica el ciclo completo. No toca datos reales.
 *
 * Uso: npm run test:tasks-api
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "127.0.0.1";
const READY_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

let viteProcess: ChildProcess | null = null;
let tempDir: string | null = null;
let baseUrl = "";
let apiTasks = "";
let apiGoogleAccounts = "";

async function main() {
  // 1. Crear directorio temporal y store vacio
  tempDir = mkdtempSync(join(tmpdir(), "dashboard-tasks-api-"));
  const storePath = join(tempDir, "tasks.json");
  writeFileSync(storePath, JSON.stringify({ tasks: [] }, null, 2) + "\n", {
    mode: 0o600,
  });

  console.log(`[test] Temp dir: ${tempDir}`);
  console.log(`[test] Store path: ${storePath}`);

  // 2. Arrancar Vite dev server en un puerto libre
  const port = await findFreePort();
  baseUrl = `http://${HOST}:${port}`;
  apiTasks = `${baseUrl}/hermes-updated/api/tasks`;
  apiGoogleAccounts = `${baseUrl}/hermes-updated/api/google/accounts`;

  const viteEnv = {
    ...process.env,
    DASHBOARD_TASK_STORE: storePath,
  };

  console.log(`[test] Starting Vite dev server on ${HOST}:${port} ...`);
  viteProcess = spawn(
    "npx",
    ["vite", "--port", String(port), "--host", HOST, "--strictPort"],
    {
      cwd: process.cwd(),
      env: viteEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  viteProcess.stdout?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[vite] ${line}`);
  });
  viteProcess.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.error(`[vite:err] ${line}`);
  });

  viteProcess.on("exit", (code, signal) => {
    console.log(`[vite] Process exited (code=${code}, signal=${signal})`);
  });

  // 3. Esperar a que el servidor responda
  await waitForServer(READY_TIMEOUT_MS);
  console.log("[test] Vite server is ready");

  // 3b. Verificar base OAuth multicuenta sin secretos
  console.log("[test] GET /hermes-updated/api/google/accounts ...");
  const googleAccounts = await httpGet(apiGoogleAccounts);
  assert.equal(googleAccounts.status, 200, "GET google accounts should return 200");
  assert.ok(
    Array.isArray(googleAccounts.body.accounts),
    "Google accounts endpoint should return { accounts: [...] }",
  );
  assert.deepEqual(
    googleAccounts.body.accounts.map((account: any) => account.accountKey).sort(),
    ["personal", "work"],
    "Google accounts endpoint should expose personal and work accounts",
  );
  console.log("[test] OK - google accounts endpoint exposes personal/work");

  // 4. Verificar GET inicial (lista vacia)
  console.log("[test] GET /hermes-updated/api/tasks (expect empty list) ...");
  const initialList = await httpGet(apiTasks);
  assert.equal(initialList.status, 200, "GET tasks should return 200");
  assert.ok(
    Array.isArray(initialList.body.tasks),
    "GET tasks should return { tasks: [...] }",
  );
  assert.equal(
    initialList.body.tasks.length,
    0,
    "Initial task list should be empty",
  );
  console.log("[test] OK - initial list is empty");

  // 5. POST - crear tarea
  const uniqueTitle = `Test task ${Date.now()}`;
  const taskPayload = {
    title: uniqueTitle,
    detail: "Tarea de prueba automatica para CRUD integration test",
    category: "Operativa",
    priority: "Media",
    status: "Pendiente",
    dueDate: "2026-12-31",
  };
  console.log(`[test] POST create task: "${uniqueTitle}" ...`);
  const createRes = await httpPost(apiTasks, taskPayload);
  assert.equal(createRes.status, 201, "POST should return 201");
  const created = createRes.body;
  assert.ok(created.id, "Created task should have an id");
  assert.equal(created.title, uniqueTitle, "Title should match");
  assert.equal(created.status, "Pendiente", "Status should be Pendiente");
  assert.equal(created.dueDate, "2026-12-31", "dueDate should match");
  assert.ok(created.createdAt, "Should have createdAt");
  console.log(`[test] OK - created task id=${created.id}`);

  // 6. GET - verificar que la tarea aparece en la lista
  console.log("[test] GET tasks (expect 1 task) ...");
  const listAfterCreate = await httpGet(apiTasks);
  assert.equal(listAfterCreate.status, 200, "GET should return 200");
  assert.equal(
    listAfterCreate.body.tasks.length,
    1,
    "List should contain exactly 1 task",
  );
  assert.equal(
    listAfterCreate.body.tasks[0].id,
    created.id,
    "Listed task id should match created id",
  );
  console.log("[test] OK - task appears in list");

  // 7. PATCH - cambiar status a Hecha
  console.log(`[test] PATCH task ${created.id} -> status=Hecha ...`);
  const patchRes = await httpPatch(
    `${apiTasks}/${encodeURIComponent(created.id)}`,
    { status: "Hecha" },
  );
  assert.equal(patchRes.status, 200, "PATCH should return 200");
  assert.equal(patchRes.body.status, "Hecha", "Status should be Hecha after PATCH");
  assert.equal(patchRes.body.id, created.id, "Patched task id should match");
  console.log("[test] OK - status updated to Hecha");

  // 8. GET - verificar que el cambio persiste
  const listAfterPatch = await httpGet(apiTasks);
  assert.equal(
    listAfterPatch.body.tasks[0].status,
    "Hecha",
    "List should reflect patched status",
  );
  console.log("[test] OK - patched status persists in list");

  // 9. DELETE - eliminar tarea
  console.log(`[test] DELETE task ${created.id} ...`);
  const deleteRes = await httpDelete(
    `${apiTasks}/${encodeURIComponent(created.id)}`,
  );
  assert.equal(deleteRes.status, 200, "DELETE should return 200");
  assert.equal(deleteRes.body.ok, true, "DELETE should return { ok: true }");
  console.log("[test] OK - task deleted");

  // 10. GET - verificar que la lista vuelve a estar vacia
  const listAfterDelete = await httpGet(apiTasks);
  assert.equal(
    listAfterDelete.body.tasks.length,
    0,
    "List should be empty after DELETE",
  );
  console.log("[test] OK - list is empty after delete");

  console.log("\n[test] ALL TESTS PASSED");
}

// --- HTTP helpers ---

type HttpResponse = {
  status: number;
  body: any;
};

async function httpGet(url: string): Promise<HttpResponse> {
  return fetchWithTimeout(url, { method: "GET" });
}

async function httpPost(url: string, body: unknown): Promise<HttpResponse> {
  return fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function httpPatch(url: string, body: unknown): Promise<HttpResponse> {
  return fetchWithTimeout(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function httpDelete(url: string): Promise<HttpResponse> {
  return fetchWithTimeout(url, { method: "DELETE" });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let parsed: any = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string = "";
  while (Date.now() < deadline) {
    if (viteProcess?.exitCode !== null && viteProcess?.killed === false) {
      // process still running
    }
    if (viteProcess?.exitCode !== null && !viteProcess?.killed) {
      throw new Error(
        `Vite process exited early (code=${viteProcess.exitCode}) before server was ready`,
      );
    }
    try {
      const res = await fetch(apiTasks, { method: "GET" });
      if (res.ok || res.status === 200) {
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err.message;
    }
    await sleep(500);
  }
  throw new Error(
    `Vite server did not become ready within ${timeoutMs}ms. Last error: ${lastError}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not resolve a free port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

// --- Cleanup ---

async function cleanup(): Promise<void> {
  if (viteProcess) {
    console.log("[test] Killing Vite process ...");
    try {
      viteProcess.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            viteProcess?.kill("SIGKILL");
          } catch {
            // ignore
          }
          resolve();
        }, 5_000);
        viteProcess?.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch (err) {
      console.error("[test] Error killing Vite:", err);
      try {
        viteProcess.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    viteProcess = null;
  }

  if (tempDir) {
    console.log(`[test] Removing temp dir: ${tempDir}`);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error("[test] Error removing temp dir:", err);
    }
    tempDir = null;
  }
}

// --- Entry point with cleanup ---

main()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\n[test] TEST FAILED:", err.message);
    if (err.stack) {
      console.error(err.stack);
    }
    await cleanup();
    process.exit(1);
  });
