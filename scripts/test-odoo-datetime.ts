import assert from "node:assert/strict";
import { formatOdooMadrid } from "../backend/odooDateTime.ts";
assert.equal(formatOdooMadrid("2026-08-25 06:28:00"), "2026-08-25 08:28");
assert.equal(formatOdooMadrid("2026-01-25 06:28:00"), "2026-01-25 07:28");
console.log("Odoo Madrid datetime: OK");
