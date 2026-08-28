import zlib from "node:zlib";

export function shrinkPdfLabelBase64(base64: string, scale = 0.92) {
  const cleanBase64 = base64.replace(/^data:application\/pdf;base64,/, "").replace(/\s+/g, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  if (buffer.subarray(0, 5).toString("utf8") !== "%PDF-") return cleanBase64;
  const objectRanges = findPdfObjects(buffer);
  const pageObjectRange = objectRanges.find((object) =>
    /\/Type\s*\/Page\b/.test(buffer.subarray(object.start, object.end).toString("latin1")),
  );
  if (!pageObjectRange) return cleanBase64;
  const pageObjectSource = buffer.subarray(pageObjectRange.start, pageObjectRange.end).toString("latin1");
  const pageMatch = pageObjectSource.match(/(\d+)\s+0\s+obj\s*(<<[\s\S]*?>>)\s*endobj/);
  const mediaBox = pageObjectSource.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  const contentsMatch = pageMatch?.[2].match(/\/Contents\s+(\d+)\s+0\s+R/);
  const sizeMatch = buffer.toString("latin1").match(/trailer\s*<<[\s\S]*?\/Size\s+(\d+)/);
  const rootMatch = buffer.toString("latin1").match(/trailer\s*<<[\s\S]*?\/Root\s+(\d+\s+\d+\s+R)/);
  const infoMatch = buffer.toString("latin1").match(/trailer\s*<<[\s\S]*?\/Info\s+(\d+\s+\d+\s+R)/);
  if (!pageMatch || !mediaBox || !contentsMatch || !sizeMatch || !rootMatch) return cleanBase64;
  const originalContent = extractPdfStream(buffer, Number(contentsMatch[1]));
  if (!originalContent) return cleanBase64;
  const width = Number(mediaBox[1]);
  const height = Number(mediaBox[2]);
  const xOffset = (width * (1 - scale)) / 2;
  const yOffset = (height * (1 - scale)) / 2;
  const transformedContent = zlib.deflateSync(Buffer.concat([
    Buffer.from(`q\n${scale} 0 0 ${scale} ${xOffset} ${yOffset} cm\n`, "latin1"),
    originalContent,
    Buffer.from("\nQ\n", "latin1"),
  ]));
  const newContentObjectNumber = Math.max(Number(sizeMatch[1]), ...objectRanges.map((object) => object.number + 1));
  const pageObject = pageMatch[2].replace(/\/Contents\s+\d+\s+0\s+R/, `/Contents ${newContentObjectNumber} 0 R`);
  const newContentObject = Buffer.concat([
    Buffer.from(`${newContentObjectNumber} 0 obj\n<</Length ${transformedContent.length}/Filter/FlateDecode>>\nstream\n`, "latin1"),
    transformedContent,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
  ]);
  return rebuildPdf(buffer, objectRanges, new Map<number, Buffer>([
    [Number(pageMatch[1]), Buffer.from(`${pageMatch[1]} 0 obj\n${pageObject}\nendobj\n`, "latin1")],
    [newContentObjectNumber, newContentObject],
  ]), rootMatch[1], infoMatch?.[1]).toString("base64");
}

function rebuildPdf(
  buffer: Buffer,
  objectRanges: Array<{ number: number; start: number; end: number }>,
  replacements: Map<number, Buffer>,
  rootRef: string,
  infoRef?: string,
) {
  const offsets = new Map<number, number>();
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  for (const object of objectRanges) {
    const replacement = replacements.get(object.number);
    const objectBuffer = replacement || buffer.subarray(object.start, object.end);
    offsets.set(object.number, totalLength(parts));
    parts.push(objectBuffer, Buffer.from("\n", "latin1"));
    replacements.delete(object.number);
  }
  for (const [number, objectBuffer] of [...replacements.entries()].sort((left, right) => left[0] - right[0])) {
    offsets.set(number, totalLength(parts));
    parts.push(objectBuffer, Buffer.from("\n", "latin1"));
  }
  const xrefOffset = totalLength(parts);
  const size = Math.max(...offsets.keys()) + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber < size; objectNumber += 1) {
    const offset = offsets.get(objectNumber);
    xref += offset === undefined ? "0000000000 65535 f \n" : `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<</Size ${size}/Root ${rootRef}${infoRef ? `/Info ${infoRef}` : ""}>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

function extractPdfStream(buffer: Buffer, objectNumber: number) {
  const source = buffer.toString("latin1");
  const objectMatch = source.match(new RegExp(`${objectNumber} 0 obj[\\s\\S]*?stream\\r?\\n([\\s\\S]*?)\\r?\\nendstream[\\s\\S]*?endobj`));
  if (!objectMatch) return null;
  const streamStart = source.indexOf(objectMatch[1]);
  const stream = buffer.subarray(streamStart, streamStart + Buffer.byteLength(objectMatch[1], "latin1"));
  return /\/FlateDecode/.test(objectMatch[0]) ? zlib.inflateSync(stream) : stream;
}

function findPdfObjects(buffer: Buffer) {
  const source = buffer.toString("latin1");
  const objects: Array<{ number: number; start: number; end: number }> = [];
  for (const match of source.matchAll(/(\d+)\s+0\s+obj[\s\S]*?endobj/g)) {
    objects.push({
      number: Number(match[1]),
      start: match.index || 0,
      end: (match.index || 0) + Buffer.byteLength(match[0], "latin1"),
    });
  }
  return objects.sort((left, right) => left.number - right.number);
}

function totalLength(parts: Buffer[]) {
  return parts.reduce((total, part) => total + part.length, 0);
}
