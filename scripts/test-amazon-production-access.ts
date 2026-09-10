import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

const amazonNav = appSource.match(
  /\{\s*label: "Amazon Messages",[\s\S]*?\n\s*\},/,
)?.[0];

assert.ok(amazonNav, "Amazon Messages must exist in the navigation");
assert.match(
  amazonNav,
  /permission: "amazonMessages"/,
  "Amazon Messages must use its dedicated permission",
);
assert.doesNotMatch(
  amazonNav,
  /productionNav:\s*false/,
  "Amazon Messages must not be hidden from production navigation",
);

assert.match(
  appSource,
  /item\.productionNav !== false\s*&&\s*!item\.navGroup\s*&&\s*can\(item\.permission\)/,
  "Visible navigation must enforce the signed-in user's permission",
);
assert.match(
  appSource,
  /item\.productionNav !== false\s*&&\s*item\.view === activeView\s*&&\s*authUser\.permissions\.includes\(item\.permission\)/,
  "Direct routes must enforce the signed-in user's permission",
);

const adminDefaults = serverSource.match(
  /if \(role === "admin"\) \{\s*return \[[\s\S]*?\n\s*\];\s*\}/,
)?.[0];
assert.ok(adminDefaults, "Admin permission defaults must be defined");
assert.match(
  adminDefaults,
  /"amazonMessages"/,
  "Administrators must receive Amazon Messages access",
);

const nonAdminDefaults = serverSource.match(
  /if \(role === "printer"\)[^\n]*\n\s*return \["dashboard", "orders"\];/,
)?.[0];
assert.ok(nonAdminDefaults, "Non-admin permission defaults must be defined");
assert.doesNotMatch(
  nonAdminDefaults,
  /amazonMessages/,
  "Printer and viewer roles must not receive Amazon Messages access",
);

assert.match(
  serverSource,
  /user\.role === "admin" && !permissions\.includes\("amazonMessages"\)/,
  "Existing administrators must be migrated to the dedicated permission",
);

console.log("Amazon Messages production access checks passed.");
