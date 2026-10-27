import { copyFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const [storePath, documentId, amountText] = process.argv.slice(2);
const amount = Number(amountText);
if (!storePath || !documentId || !Number.isFinite(amount) || amount === 0) {
  throw new Error("Uso: node apply-invoice-rounding-adjustment.mjs <store> <document-id> <importe>");
}

const store = JSON.parse(readFileSync(storePath, "utf8"));
const doc = store.documents?.find((item) => item.driveFileId === documentId);
if (!doc?.extracted?.lines) throw new Error("Documento o líneas no encontrados");
if (doc.odooDraftMoveId) throw new Error("El documento ya tiene borrador Odoo; no se modifica");
if (doc.extracted.lines.some((line) => line.reference === "REDONDEO")) {
  throw new Error("El ajuste de redondeo ya existe");
}

copyFileSync(storePath, `${storePath}.${documentId}.before-rounding.bak`);
doc.extracted.lines.push({
  description: "Ajuste de redondeo",
  reference: "REDONDEO",
  quantity: 1,
  priceUnit: amount,
  discount: 0,
  taxNames: ["21% IVA soportado (bienes corrientes)"],
  taxId: 4,
  taxAmount: null,
  accountId: 358,
  accountName: "600000 · Compras de mercaderías",
  total: amount,
  sourcePurchaseOrder: null,
  confidence: 100,
});
doc.notes = `${doc.notes ? `${doc.notes}; ` : ""}Ajuste de redondeo ${amount.toFixed(2)} EUR`.slice(0, 400);
const temporaryPath = `${storePath}.${process.pid}.tmp`;
writeFileSync(temporaryPath, JSON.stringify(store), "utf8");
renameSync(temporaryPath, storePath);
console.log(JSON.stringify({ documentId, amount, backup: `${storePath}.${documentId}.before-rounding.bak` }));
