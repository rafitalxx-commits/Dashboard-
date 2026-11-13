import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appCss = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");
const avatarRule = appCss.match(/\.session-avatar\s*\{([^}]+)\}/)?.[1];

assert.ok(avatarRule, "session avatar style should exist");
assert.match(avatarRule, /flex:\s*0 0 40px;/);
assert.match(avatarRule, /width:\s*40px;/);
assert.match(avatarRule, /height:\s*40px;/);

console.log("Session avatar size is 40px");
