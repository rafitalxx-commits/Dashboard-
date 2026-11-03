import {
  chmodSync,
  chownSync,
  copyFileSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { compactAmazonMessagesStoreFile } from "../backend/amazonMessages/contentCompaction.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const pathArg = args.find((arg) => !arg.startsWith("--"));
const storePath = resolve(pathArg ?? ".dashboard-data/amazon-messages-store.json");
const originalStat = statSync(storePath);
const beforeSize = originalStat.size;
let outputPath: string | undefined;
let backupPath: string | undefined;

if (apply) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  outputPath = `${storePath}.${process.pid}.tmp`;
  backupPath = `${storePath}.${stamp}.bak`;
}

try {
  const stats = await compactAmazonMessagesStoreFile(storePath, outputPath);
  if (apply && outputPath && backupPath) {
    copyFileSync(storePath, backupPath);
    JSON.parse(readFileSync(outputPath, "utf8"));
    chmodSync(outputPath, originalStat.mode);
    chownSync(outputPath, originalStat.uid, originalStat.gid);
    renameSync(outputPath, storePath);
  }
  const projectedSize = beforeSize - stats.bytesBefore + stats.bytesAfter;
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    storePath,
    backupPath,
    beforeBytes: beforeSize,
    projectedBytes: projectedSize,
    savedBytes: beforeSize - projectedSize,
    ...stats,
  }, null, 2));
} catch (error) {
  if (outputPath) {
    try { unlinkSync(outputPath); } catch {}
  }
  throw error;
}
