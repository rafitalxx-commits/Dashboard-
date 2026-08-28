import QRCode from "qrcode";

export type QrWorker = { code: string; name: string };

export function workerInitials(name: string) {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return initials || "OP";
}

export async function workerQrSvg(worker: QrWorker) {
  const svg = await QRCode.toString(worker.code, { type: "svg", margin: 3, errorCorrectionLevel: "H" });
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const size = Number(viewBox?.[1] || 35);
  const badgeSize = size * 0.22;
  const center = size / 2;
  const badge = `<rect x="${center - badgeSize / 2}" y="${center - badgeSize / 2}" width="${badgeSize}" height="${badgeSize}" rx="${size * 0.025}" fill="#ffffff"/><text x="${center}" y="${center + size * 0.055}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${size * 0.17}" font-weight="700" fill="#172033">${workerInitials(worker.name)}</text>`;
  return svg.replace(/\s(?:width|height)="[^"]*"/g, "").replace("<svg", '<svg width="40mm" height="40mm"').replace("</svg>", `${badge}</svg>`);
}

export async function workerQrDataUrl(worker: QrWorker) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await workerQrSvg(worker))}`;
}

export async function downloadWorkerQr(worker: QrWorker) {
  const link = document.createElement("a");
  link.href = await workerQrDataUrl(worker);
  link.download = `${worker.code}-${worker.name.replace(/[^a-z0-9]+/gi, "-") || "operario"}-40x40mm.svg`;
  link.click();
}
