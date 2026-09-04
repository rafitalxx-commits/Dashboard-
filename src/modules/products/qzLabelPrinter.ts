type QzTrayApi = {
  configs: { create: (printerName: string, options?: Record<string, unknown>) => unknown };
  print: (config: unknown, data: unknown[]) => Promise<void>;
  printers?: { find: () => Promise<string[]> };
  websocket: { connect: (options?: Record<string, unknown>) => Promise<void>; isActive: () => boolean };
};

declare global {
  interface Window {
    qz?: QzTrayApi;
  }
}

const printerStorageKey = "expeditions.labelPrinter";
let scriptPromise: Promise<void> | null = null;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function loadQzTray() {
  if (window.qz) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.getElementById("qz-tray-script") as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("No se pudo cargar QZ Tray")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.id = "qz-tray-script";
      script.src = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar QZ Tray"));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

async function connectQzTray() {
  await loadQzTray();
  const qz = window.qz;
  if (!qz) throw new Error("QZ Tray no está disponible en este navegador");
  if (!qz.websocket.isActive()) {
    await withTimeout(
      qz.websocket.connect({ delay: 1, host: ["localhost", "127.0.0.1", "localhost.qz.io"], retries: 1 }),
      5_000,
      "QZ Tray no responde",
    );
  }
  return qz;
}

export function getSavedQzLabelPrinter() {
  const value = localStorage.getItem(printerStorageKey) || "";
  return value.startsWith("qz:") ? value.slice(3) : value;
}

export function saveQzLabelPrinter(printerName: string) {
  if (printerName.trim()) localStorage.setItem(printerStorageKey, `qz:${printerName.trim()}`);
  else localStorage.removeItem(printerStorageKey);
}

export async function probeQzLabelPrinters() {
  const qz = await connectQzTray();
  if (!qz.printers?.find) return [];
  const printers = await withTimeout(qz.printers.find(), 10_000, "QZ no ha devuelto las impresoras");
  return Array.from(new Set(printers.map((printer) => printer.trim()).filter(Boolean))).sort();
}

export async function printHtmlLabelWithQzTray(html: string, jobName: string, printerName: string) {
  if (!printerName) throw new Error("Selecciona una impresora local");
  const qz = await connectQzTray();
  const config = qz.configs.create(printerName, {
    jobName,
    bounds: { x: 0, y: 0, width: 57, height: 33 },
    margins: 0,
    orientation: "portrait",
    scaleContent: false,
    size: { width: 57, height: 33, custom: true },
    units: "mm",
  });
  await withTimeout(qz.print(config, [{ type: "html", format: "plain", data: html }]), 25_000, "QZ no confirmó la impresión");
}

export async function printImageLabelWithQzTray(dataUrl: string, jobName: string, printerName: string) {
  if (!printerName) throw new Error("Selecciona una impresora local");
  const qz = await connectQzTray();
  const config = qz.configs.create(printerName, {
    jobName,
    bounds: { x: 0, y: 0, width: 57, height: 33 },
    margins: 0,
    orientation: "portrait",
    scaleContent: true,
    size: { width: 57, height: 33, custom: true },
    units: "mm",
  });
  await withTimeout(
    qz.print(config, [{ type: "pixel", format: "image", flavor: "base64", data: dataUrl.replace(/^data:image\/(?:png|jpeg);base64,/, "") }]),
    25_000,
    "QZ no confirmó la impresión",
  );
}
