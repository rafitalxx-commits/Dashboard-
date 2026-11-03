import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";

export const AMAZON_MESSAGE_CONTENT_MAX_CHARS = 50_000;

const MIME_TECHNICAL_LINE = /^(?:--[-=_A-Za-z0-9]+|content-(?:type|transfer-encoding|disposition|id|location):|mime-version:)/i;
const BASE64_LINE = /^[A-Za-z0-9+/_-]+={0,2}$/;

export type AmazonContentCompaction = {
  content: string;
  removedMimeLines: number;
  removedEncodedLines: number;
  truncatedChars: number;
};

export function compactAmazonMessageContent(
  content: string,
  maxChars = AMAZON_MESSAGE_CONTENT_MAX_CHARS,
): AmazonContentCompaction {
  let removedMimeLines = 0;
  let removedEncodedLines = 0;
  const kept: string[] = [];

  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (MIME_TECHNICAL_LINE.test(trimmed)) {
      removedMimeLines += 1;
      continue;
    }
    if (
      trimmed.length >= 60 &&
      trimmed.length % 4 === 0 &&
      BASE64_LINE.test(trimmed)
    ) {
      removedEncodedLines += 1;
      continue;
    }
    kept.push(line);
  }

  const cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const marker = "\n\n[Contenido técnico truncado]";
  const truncatedChars = Math.max(0, cleaned.length - maxChars);
  const compacted = truncatedChars
    ? `${cleaned.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`
    : cleaned;

  return {
    content: compacted,
    removedMimeLines,
    removedEncodedLines,
    truncatedChars,
  };
}

export type AmazonStoreCompactionStats = {
  contentFields: number;
  changedFields: number;
  bytesBefore: number;
  bytesAfter: number;
  removedMimeLines: number;
  removedEncodedLines: number;
  truncatedChars: number;
};

export async function compactAmazonMessagesStoreFile(
  inputPath: string,
  outputPath?: string,
): Promise<AmazonStoreCompactionStats> {
  const stats: AmazonStoreCompactionStats = {
    contentFields: 0,
    changedFields: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    removedMimeLines: 0,
    removedEncodedLines: 0,
    truncatedChars: 0,
  };
  const reader = createInterface({
    input: createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const writer = outputPath
    ? createWriteStream(outputPath, { encoding: "utf8", mode: 0o600 })
    : undefined;
  let inMessages = false;

  for await (const line of reader) {
    let outputLine = line;
    if (/^  "messages": \[$/.test(line)) {
      inMessages = true;
    } else if (inMessages && /^  \],?$/.test(line)) {
      inMessages = false;
    } else if (inMessages) {
      const match = line.match(/^(\s*)"content": (".*")(,?)$/);
      if (match) {
        const original = JSON.parse(match[2]) as string;
        const result = compactAmazonMessageContent(original);
        stats.contentFields += 1;
        stats.bytesBefore += Buffer.byteLength(original);
        stats.bytesAfter += Buffer.byteLength(result.content);
        stats.removedMimeLines += result.removedMimeLines;
        stats.removedEncodedLines += result.removedEncodedLines;
        stats.truncatedChars += result.truncatedChars;
        if (result.content !== original) {
          stats.changedFields += 1;
          outputLine = `${match[1]}"content": ${JSON.stringify(result.content)}${match[3]}`;
        }
      }
    }

    if (writer && !writer.write(`${outputLine}\n`)) await once(writer, "drain");
  }

  if (writer) {
    writer.end();
    await once(writer, "close");
  }
  return stats;
}
