import assert from "node:assert/strict";
import { isConcatenatedInvoiceNumber, parseInvoiceAgentReply } from "../backend/supplierInvoices/agentReply.ts";

const reply = { reply: "Factura leída", proposal: { fields: { total: 927.24 }, lines: [{ description: "Producto", quantity: 1 }] }, unresolved: ["IVA pendiente"] };
const single = JSON.stringify({ result: { payloads: [{ text: JSON.stringify(reply) }] } });
const nested = JSON.stringify({ result: { payloads: [{ text: single }] } });

for (const raw of [JSON.stringify(reply), single, nested, `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``]) {
  assert.deepEqual(parseInvoiceAgentReply(raw), reply);
}
assert.throws(() => parseInvoiceAgentReply(JSON.stringify({ result: { payloads: [{ text: "sin JSON" }] } })), /JSON estructurado/);
assert.equal(isConcatenatedInvoiceNumber("30/09/2026293043091229B54685144"), true);
assert.equal(isConcatenatedInvoiceNumber("WEB-13413/CEN-2026"), false);
console.log("supplier agent reply: OK");
