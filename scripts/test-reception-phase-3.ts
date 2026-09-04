import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReceptionSessions, normalizeReceptionOperator } from "../backend/receptions/sessions.ts";

assert.deepEqual(normalizeReceptionOperator({ name: " Rafa Almacén " }), {
  id: "manual-rafa-almacen",
  code: "MANUAL",
  name: "Rafa Almacén",
});
assert.throws(() => normalizeReceptionOperator({ name: "" }), /Indica el operario/);

const testDir = mkdtempSync(join(tmpdir(), "dashboard-reception-session-"));
try {
  const sessions = createReceptionSessions({ dataDir: testDir });
  const started = sessions.start({
    receptionId: "123",
    receptionRef: "ALM/IN/00123",
    purchaseRef: "P00123",
    operator: { id: "worker-1", code: "R01", name: "Rafa" },
  });
  assert.equal(started.status, "in_progress");
  assert.equal(started.operator.name, "Rafa");
  assert.equal(sessions.list().length, 1);
  assert.deepEqual(
    sessions.start({
      receptionId: "123",
      receptionRef: "ALM/IN/00123",
      operator: { name: "Otro operario" },
    }),
    started,
    "starting twice keeps the original operator and timestamp",
  );
  assert.equal(sessions.list().length, 1);
  const completed = sessions.complete("123");
  assert.equal(completed.status, "completed");
  assert.equal(completed.operator.code, "R01");
  assert.equal(sessions.list()[0].status, "completed");
  assert.throws(() => sessions.complete("missing"), /no encontrada/);
  const stored = JSON.parse(readFileSync(join(testDir, "reception-sessions.json"), "utf8"));
  assert.equal(stored.sessions[0].receptionId, "123");
  assert.equal(stored.sessions[0].status, "completed");
} finally {
  rmSync(testDir, { recursive: true, force: true });
}

console.log("Recepciones Fase 3: inicio, operario y cierre verificados");
