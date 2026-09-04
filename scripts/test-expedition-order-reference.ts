import assert from "node:assert/strict";
import {
  buildExactExpeditionOrderDomain,
  expeditionReferencesMatch,
  isCompleteExpeditionOrderReference,
  matchesExpeditionOrder,
  normalizeExpeditionOrderReference,
} from "../backend/expeditionOrderReference.ts";

assert.equal(isCompleteExpeditionOrderReference("11"), false);
assert.equal(isCompleteExpeditionOrderReference("88"), false);
assert.equal(isCompleteExpeditionOrderReference("S100188"), true);
assert.equal(isCompleteExpeditionOrderReference("S100388"), true);
assert.equal(isCompleteExpeditionOrderReference("S100311"), true);
assert.equal(isCompleteExpeditionOrderReference("196440"), true);
assert.equal(isCompleteExpeditionOrderReference("403-0386316-3911503"), true);
assert.equal(normalizeExpeditionOrderReference("40303863163911503"), "403-0386316-3911503");
assert.equal(expeditionReferencesMatch("106232", "#106232"), true);
assert.equal(matchesExpeditionOrder("S100188", { id: "S100188", odooRef: "#106232", externalRef: "196440" }), true);
assert.equal(matchesExpeditionOrder("S100188", { id: "S100388", odooRef: "#106484", externalRef: "403-0386316-3911503" }), false);
assert.equal(matchesExpeditionOrder("406-1278307-0442738", { id: "S100311", odooRef: "#106386", externalRef: "406-1278307-0442738" }), true);

const exactDomain = JSON.stringify(buildExactExpeditionOrderDomain("S100188"));
assert.equal(exactDomain.includes("ilike"), false);
assert.equal(exactDomain.includes('"="'), true);

console.log("Expedition order reference integrity: OK");
