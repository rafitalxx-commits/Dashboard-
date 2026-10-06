import assert from "node:assert/strict";
import { DriveClient } from "../backend/supplierInvoices/driveClient.ts";

const root = "archive-root";
const client = new DriveClient({
  SUPPLIER_INVOICES_DRIVE_FOLDER_ID: "inbox-root",
  SUPPLIER_INVOICES_DRIVE_ARCHIVE_FOLDER_ID: root,
});
const calls: string[] = [];
(client as any).request = async (path: string, init?: RequestInit) => {
  calls.push(`${init?.method ?? "GET"} ${path}`);
  if (path.includes("/files/folder-year?")) return { name: "AÑO 2026", mimeType: "application/vnd.google-apps.folder", parents: ["folder-supplier"] };
  if (path.includes("/files/folder-supplier?")) return { name: "INMAEL", mimeType: "application/vnd.google-apps.folder", parents: [root] };
  if (path.includes("/files/outside?")) return { name: "Ajena", mimeType: "application/vnd.google-apps.folder", parents: ["elsewhere"] };
  if (path.includes("/files/elsewhere?")) return { name: "Otra raíz", mimeType: "application/vnd.google-apps.folder", parents: [] };
  if (path.includes("/files/inbox-root?")) return { name: "SIN REVISAR", mimeType: "application/vnd.google-apps.folder", parents: ["other"] };
  if (path.includes("/files/other?")) return { name: "Otra bandeja", mimeType: "application/vnd.google-apps.folder", parents: [] };
  if (path.includes("pageToken=page2")) return { files: [{ id: "second", name: "Z" }] };
  if (path.includes("/files?q=")) return { files: [{ id: "first", name: "A" }], nextPageToken: "page2" };
  if (path.includes("/files/pdf?fields=parents")) return { parents: ["inbox-root"] };
  if (path.includes("/files/pdf?") && init?.method === "PATCH") return { parents: ["folder-year"] };
  throw new Error(`Unexpected Drive request: ${path}`);
};

assert.equal(await client.archivePath(root), "/FACTURAS");
assert.equal(await client.archivePath("folder-year"), "/FACTURAS/INMAEL/AÑO 2026");
await assert.rejects(client.archivePath("outside"), /no pertenece/);
await assert.rejects(client.archivePath("inbox-root"), /no pertenece/);
assert.equal((await client.listFolders(root)).length, 2, "pagina todas las carpetas");
await client.moveFile("pdf", "folder-year");
assert.ok(calls.some((call) => call.includes("addParents=folder-year") && call.includes("removeParents=inbox-root")));
console.log("Drive archive boundary, pagination and move confirmation OK");
