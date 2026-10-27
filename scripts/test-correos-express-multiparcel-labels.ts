import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { extractCorreosExpressLabelValues, mergeCorreosExpressLabels } from "../backend/correosExpress/client.ts";

async function makeLabel(text: string) {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 100]);
  page.drawText(text, { x: 12, y: 50 });
  return Buffer.from(await document.save()).toString("base64");
}

const first = await makeLabel("Bulto 1 de 2");
const second = await makeLabel("Bulto 2 de 2");
const carrierResponse = {
  etiqueta: [
    { etiqueta1: Buffer.from(first).toString("base64") },
    { etiqueta1: Buffer.from(second).toString("base64") },
  ],
};
const labels = extractCorreosExpressLabelValues(carrierResponse.etiqueta, ["etiqueta1", "etiqueta2"]);
assert.equal(labels.length, 2, "se conservan las dos etiquetas recibidas del transportista");

const merged = await mergeCorreosExpressLabels(labels);
const mergedDocument = await PDFDocument.load(Buffer.from(merged, "base64"));
assert.equal(mergedDocument.getPageCount(), 2, "el PDF de impresión incluye una página por bulto");

const single = await mergeCorreosExpressLabels([first]);
const singleDocument = await PDFDocument.load(Buffer.from(single, "base64"));
assert.equal(singleDocument.getPageCount(), 1, "los envíos monobulto mantienen una sola etiqueta");

console.log("Correos Express multiparcel label tests passed");
