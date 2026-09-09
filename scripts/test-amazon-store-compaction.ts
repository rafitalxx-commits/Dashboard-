import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compactAmazonMessageContent,
  compactAmazonMessagesStoreFile,
} from "../backend/amazonMessages/contentCompaction.ts";

const encoded = Buffer.alloc(12_000, 7).toString("base64").match(/.{1,76}/g)!.join("\r\n");
const raw = `El cliente necesita una solución urgente.\r\n\r\nContent-Type: image/jpeg\r\nContent-Transfer-Encoding: base64\r\n--boundary_123\r\n${encoded}\r\n--boundary_123--`;
const compacted = compactAmazonMessageContent(raw);
assert.match(compacted.content, /solución urgente/);
assert.doesNotMatch(compacted.content, /Content-Transfer-Encoding/i);
assert.ok(compacted.removedEncodedLines > 100);
assert.ok(compacted.content.length < 200);

const tempDir = mkdtempSync(join(tmpdir(), "amazon-store-compaction-"));
const input = join(tempDir, "store.json");
const output = join(tempDir, "store.compacted.json");
try {
  const fixture = {
    messages: [{ messageId: "m1", content: raw }],
    knowledgeExamples: [{ content: encoded }],
  };
  writeFileSync(input, `${JSON.stringify(fixture, null, 2)}\n`);
  const stats = await compactAmazonMessagesStoreFile(input, output);
  const result = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(stats.contentFields, 1);
  assert.equal(stats.changedFields, 1);
  assert.match(result.messages[0].content, /solución urgente/);
  assert.equal(result.knowledgeExamples[0].content, encoded, "non-message content must remain untouched");
  assert.ok(readFileSync(output).length < readFileSync(input).length);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("Amazon store compaction tests passed");
