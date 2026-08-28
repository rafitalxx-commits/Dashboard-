import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckSquare,
  MapPin,
  Printer,
  ScanLine,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { odooClient } from "../../services/odooClient";
import type { CatalogProduct } from "../../services/odooTypes";
import {
  getSavedQzLabelPrinter,
  printImageLabelWithQzTray,
} from "../expeditions/ExpeditionsView";

type Props = {
  products: CatalogProduct[];
  onBack: () => void;
  onChanged: () => void;
  preset?: "labels";
};
type UnmatchedEan = { code: string; location: string };
const locationPattern = /^[A-Z]+\d+\d{2}$/;
const scannerSettingsKey = "products.scanner.settings";
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] || char,
  );

export type PrintableProductLabel = Pick<
  CatalogProduct,
  "name" | "reference" | "barcode"
>;

export async function createProductLabelHtml(product: PrintableProductLabel) {
  const code = product.reference || product.barcode;
  if (!code)
    throw new Error("Indica una referencia, SKU o EAN para generar el QR");
  const qr = await QRCode.toString(code, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    width: 138,
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:57mm 33mm;margin:0}html,body{width:57mm;height:33mm;margin:0;padding:0;overflow:hidden;font-family:Arial,sans-serif}.label{box-sizing:border-box;width:57mm;height:33mm;padding:0 .2mm;display:grid;grid-template-columns:1fr 27mm;gap:.4mm;align-items:center;overflow:hidden}.copy,.qr{transform:translateY(1.5mm)}.name{font-size:8pt;font-weight:700;line-height:1.08;max-height:20mm;overflow:hidden}.ref{font-size:8pt;font-weight:700;line-height:1.1;margin-top:1.2mm;word-break:break-word}.qr{width:25mm;height:25mm;display:grid;place-items:center}.qr svg{width:25mm;height:25mm}</style></head><body><main class="label"><div class="copy"><div class="name">${escapeHtml(product.name)}</div><div class="ref">${escapeHtml(product.reference)}</div></div><div class="qr">${qr}</div></main></body></html>`;
  return html;
}

export async function createProductLabelImage(product: PrintableProductLabel) {
  const code = product.reference || product.barcode;
  if (!code)
    throw new Error("Indica una referencia, SKU o EAN para generar el QR");
  const width = 684;
  const height = 396; // 12 px/mm, exact 57 × 33 mm ratio
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la imagen de la etiqueta");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#000";
  const qrSize = 300;
  const qrX = width - qrSize - 6;
  const qrY = Math.round((height - qrSize) / 2) + 8;
  const image = new Image();
  image.src = await QRCode.toDataURL(code, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: qrSize,
  });
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo generar el QR"));
  });
  context.drawImage(image, qrX, qrY, qrSize, qrSize);
  const textX = 38; // 3.2 mm safe inset: some thermal drivers trim the first dots at the left edge.
  const leftWidth = qrX - textX - 8;
  const words = product.name.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  context.font = "bold 24px Arial";
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > leftWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  });
  if (line) lines.push(line);
  const visibleLines = lines.slice(0, 5);
  const blockHeight = visibleLines.length * 29 + 42;
  let y = Math.max(45, Math.round((height - blockHeight) / 2) + 12);
  visibleLines.forEach((text) => {
    context.fillText(text, textX, y);
    y += 29;
  });
  context.font = "bold 28px Arial";
  context.fillText(
    product.reference || product.barcode,
    textX,
    Math.min(height - 16, y + 20),
  );
  return canvas.toDataURL("image/png");
}

async function printProductLabel(product: CatalogProduct) {
  const image = await createProductLabelImage(product);
  await printImageLabelWithQzTray(
    image,
    `Producto ${product.reference || product.barcode}`,
    getSavedQzLabelPrinter(),
  );
}

export function ProductScannerView({ products, onChanged, preset }: Props) {
  const saved = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(scannerSettingsKey) || "{}");
    } catch {
      return {};
    }
  })() as { locate?: boolean; count?: boolean; print?: boolean };
  const [locate, setLocate] = useState(
    preset === "labels" ? false : (saved.locate ?? true),
  );
  const [count, setCount] = useState(
    preset === "labels" ? false : (saved.count ?? false),
  );
  const [print, setPrint] = useState(
    preset === "labels" ? true : (saved.print ?? false),
  );
  const [activeLocation, setActiveLocation] = useState("");
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<CatalogProduct | null>(null);
  const [quantity, setQuantity] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [unmatchedEan, setUnmatchedEan] = useState<UnmatchedEan | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const lastCameraCodeRef = useRef("");
  const activeLocationRef = useRef("");
  const audioContextRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    sessionStorage.setItem(
      scannerSettingsKey,
      JSON.stringify({ locate, count, print }),
    );
  }, [locate, count, print]);
  useEffect(() => {
    activeLocationRef.current = activeLocation;
  }, [activeLocation]);
  const playDetectedTone = (found = true) => {
    try {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const audio = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = audio;
      if (audio.state === "suspended") void audio.resume();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const duration = found ? 0.18 : 0.36;
      oscillator.type = found ? "sine" : "square";
      oscillator.frequency.value = found ? 940 : 180;
      oscillator.frequency.linearRampToValueAtTime(
        found ? 1320 : 120,
        audio.currentTime + duration * 0.7,
      );
      gain.gain.setValueAtTime(found ? 0.16 : 0.12, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audio.currentTime + duration,
      );
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + duration + 0.01);
      if ("vibrate" in navigator) navigator.vibrate(found ? 35 : [90, 45, 90]);
    } catch {
      /* Audio confirmation is optional. */
    }
  };
  const closeCamera = () => {
    if (scanTimerRef.current !== null)
      window.clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    processingRef.current = false;
    lastCameraCodeRef.current = "";
    setCameraOpen(false);
  };
  useEffect(() => () => closeCamera(), []);
  // getUserMedia resolves before React has mounted the conditional <video>.
  // Attaching it from a timeout races on mobile and leaves a black frame.
  // Bind the stream once the video exists and explicitly start inline playback.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraOpen || !video || !stream) return;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch((error) => {
      setMessage(
        error instanceof Error
          ? `No se pudo mostrar la cámara: ${error.message}`
          : "No se pudo mostrar la cámara",
      );
    });
  }, [cameraOpen]);
  const findProduct = (code: string) => {
    const normalized = code.trim().toLowerCase();
    const exact = products.find((product) =>
      [product.reference, product.barcode, String(product.id)]
        .filter(Boolean)
        .some((candidate) => candidate.toLowerCase() === normalized),
    );
    if (exact) return exact;
    // A code such as C201 is a valid shelf QR. Do not turn it into a product
    // merely because a longer manufacturer reference begins with that string.
    if (locationPattern.test(code.trim().toUpperCase())) return undefined;
    // Some manufacturer labels omit a variant suffix (e.g. 75150 → 75150-39).
    const referenceMatches = products.filter((product) =>
      product.reference.toLowerCase().startsWith(normalized),
    );
    return referenceMatches.length === 1 ? referenceMatches[0] : undefined;
  };
  const process = async (product: CatalogProduct, qty?: number) => {
    setBusy(true);
    try {
      let target = activeLocationRef.current;
      const locations = await odooClient.getProductLocations(product.id);
      if (count && !target)
        throw new Error("Para contar, activa primero una ubicación");
      if (locate && !target) throw new Error("Escanea primero la ubicación");
      if (target) {
        const existing = locations.find((item) => item.code === target);
        await odooClient.saveProductLocation({
          productId: product.id,
          code: target,
          quantity: count ? Number(qty) : (existing?.quantity ?? 0),
          preferred: existing?.preferred ?? !locations.length,
          replenishmentMin: existing?.replenishmentMin,
        });
        onChanged();
      }
      if (print) await printProductLabel(product);
      setMessage(
        `${product.reference || product.name}${print ? " · etiqueta enviada" : ""}`,
      );
      setPending(null);
      setQuantity("");
      setValue("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo registrar la lectura",
      );
    } finally {
      processingRef.current = false;
      setBusy(false);
    }
  };
  const confirmCount = () => {
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount < 0) {
      setMessage("Indica una cantidad entera igual o mayor que cero");
      return;
    }
    if (pending) void process(pending, amount);
  };
  const assignEan = async (product: CatalogProduct, barcode: string) => {
    setBusy(true);
    setAssignmentError("");
    try {
      await odooClient.updateProductBarcode(product.id, barcode);
      const target = activeLocationRef.current;
      if (target) {
        const locations = await odooClient.getProductLocations(product.id);
        const existing = locations.find((item) => item.code === target);
        await odooClient.saveProductLocation({
          productId: product.id,
          code: target,
          quantity: existing?.quantity ?? 0,
          preferred: existing?.preferred ?? !locations.length,
          replenishmentMin: existing?.replenishmentMin,
        });
      }
      onChanged();
      setUnmatchedEan(null);
      setAssignmentOpen(false);
      setMessage(
        `${barcode} asignado a ${product.reference || product.name}${target ? ` · ubicación ${target}` : ""}`,
      );
      playDetectedTone();
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "No se pudo asignar el EAN";
      setAssignmentError(detail);
      setMessage(detail);
      playDetectedTone(false);
    } finally {
      processingRef.current = false;
      setBusy(false);
    }
  };
  const resolveCode = (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code || busy || processingRef.current) return;
    processingRef.current = true;
    const product = findProduct(code);
    if (product) {
      setUnmatchedEan(null);
      playDetectedTone();
      if (count) {
        if (!activeLocationRef.current) {
          setMessage("Escanea primero la ubicación");
          processingRef.current = false;
          return;
        }
        setPending(product);
        setQuantity("");
        setValue("");
        setMessage("");
        return;
      }
      void process(product);
      return;
    }
    if (locate && locationPattern.test(code)) {
      activeLocationRef.current = code;
      setActiveLocation(code);
      setValue("");
      setUnmatchedEan(null);
      setMessage(`Ubicación activa: ${code}`);
      playDetectedTone();
      processingRef.current = false;
      return;
    }
    setUnmatchedEan({ code, location: activeLocationRef.current });
    setMessage(
      `No encontrado: «${code}». Código leído correctamente, pero no está en el catálogo importado.`,
    );
    playDetectedTone(false);
    processingRef.current = false;
  };
  const scan = (event: FormEvent) => {
    event.preventDefault();
    resolveCode(value);
  };
  const openCamera = async () => {
    if (!("BarcodeDetector" in window)) {
      setMessage(
        "Este navegador no permite leer QR/EAN con cámara. Usa Chrome actualizado o el lector USB.",
      );
      return;
    }
    try {
      const Detector = (window as any).BarcodeDetector;
      const desiredFormats = ["qr_code", "ean_13", "ean_8", "code_128", "code_39"];
      const supportedFormats =
        typeof Detector.getSupportedFormats === "function"
          ? await Detector.getSupportedFormats()
          : desiredFormats;
      const formats = desiredFormats.filter((format) => supportedFormats.includes(format));
      if (!formats.length) {
        setMessage("Este móvil no ofrece lectura QR/EAN por cámara. Usa Chrome actualizado o el lector USB.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      const detector = new Detector({ formats });
      scanTimerRef.current = window.setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
          return;
        try {
          const codes = await detector.detect(video);
          const code = codes[0]?.rawValue?.trim().toUpperCase();
          if (!code) {
            lastCameraCodeRef.current = "";
            return;
          }
          if (code === lastCameraCodeRef.current) return;
          lastCameraCodeRef.current = code;
          resolveCode(code);
        } catch {
          /* Retry next frame; camera startup can yield transient frames. */
        }
      }, 180);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `No se pudo abrir la cámara: ${error.message}`
          : "No se pudo abrir la cámara",
      );
      closeCamera();
    }
  };
  return (
    <section className="product-scanner">
      <header className="products-header">
        <div>
          <p className="eyebrow">PRODUCTOS · ESCÁNER</p>
          <h1>Escaneo operativo</h1>
          <p>Escanear QR/EAN o escribir SKU.</p>
        </div>
      </header>
      <div className="scanner-actions">
        <label>
          <input
            type="checkbox"
            checked={locate}
            onChange={(event) => setLocate(event.target.checked)}
          />
          <MapPin size={17} />
          Ubicar
        </label>
        <label>
          <input
            type="checkbox"
            checked={count}
            onChange={(event) => setCount(event.target.checked)}
          />
          <CheckSquare size={17} />
          Contar cantidad
        </label>
        <label>
          <input
            type="checkbox"
            checked={print}
            onChange={(event) => setPrint(event.target.checked)}
          />
          <Printer size={17} />
          Imprimir etiqueta
        </label>
      </div>
      {locate && (
        <p className="scanner-location">
          {activeLocation ? (
            <>
              Ubicación activa: <strong>{activeLocation}</strong>
            </>
          ) : (
            "Escanea el QR de ubicación para activarla."
          )}
        </p>
      )}
      <form className="scanner-input" onSubmit={scan}>
        <ScanLine size={24} />
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Escanear QR/EAN o escribir SKU"
        />
        <button className="primary-button" disabled={busy}>
          Procesar
        </button>
        <button
          className="secondary-button camera-button"
          type="button"
          onClick={() => void openCamera()}
        >
          <Camera size={18} />
          Cámara
        </button>
      </form>
      {cameraOpen && (
        <div className="scanner-camera">
          <div className="camera-head">
            <strong>Apunta al QR o EAN dentro del marco</strong>
            <button onClick={closeCamera} aria-label="Cerrar cámara">
              <X size={18} />
            </button>
          </div>
          <div className="camera-frame">
            <video ref={videoRef} autoPlay playsInline muted />
          </div>
        </div>
      )}
      {pending && (
        <form
          className="scanner-count"
          onSubmit={(event) => {
            event.preventDefault();
            confirmCount();
          }}
        >
          <strong>{pending.name}</strong>
          <span>{pending.reference || pending.barcode || "Producto"}</span>
          <label>
            Cantidad
            <input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              value={quantity}
              onChange={(event) =>
                setQuantity(event.target.value.replace(/[^0-9]/g, ""))
              }
              required
            />
          </label>
          <button className="primary-button" disabled={busy}>
            Guardar y seguir
          </button>
        </form>
      )}
      {message && <p className="scanner-message">{message}</p>}
      {unmatchedEan && (
        <button
          className="scanner-assign-ean"
          onClick={() => {
            setAssignmentError("");
            setAssignmentOpen(true);
          }}
          type="button"
        >
          Asignar este EAN a un producto
        </button>
      )}
      {assignmentOpen && unmatchedEan && (
        <EanAssignmentDialog
          code={unmatchedEan.code}
          error={assignmentError}
          location={unmatchedEan.location}
          onCancel={() => setAssignmentOpen(false)}
          onSave={assignEan}
          products={products}
          saving={busy}
        />
      )}
      <p className="scanner-hint">
        El lector queda listo para la siguiente lectura. Escanear otro código de
        ubicación cambia la ubicación activa.
      </p>
    </section>
  );
}

function EanAssignmentDialog({
  code,
  error,
  location,
  onCancel,
  onSave,
  products,
  saving,
}: {
  code: string;
  error: string;
  location: string;
  onCancel: () => void;
  onSave: (product: CatalogProduct, barcode: string) => Promise<void>;
  products: CatalogProduct[];
  saving: boolean;
}) {
  const [ean, setEan] = useState(code);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const matches = products
    .filter((product) =>
      `${product.reference} ${product.name} ${product.barcode}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .slice(0, 10);
  return (
    <div className="ean-dialog-backdrop" role="presentation">
      <section aria-modal="true" className="ean-dialog" role="dialog">
        <button
          aria-label="Cerrar"
          className="ean-dialog-close"
          onClick={onCancel}
          type="button"
        >
          <X size={18} />
        </button>
        <h2>Asignar EAN no encontrado</h2>
        <p>
          Se guardará en Odoo y Dashboard
          {location ? `; ubicación activa: ${location}` : ""}.
        </p>
        <label>
          EAN leído
          <input
            autoFocus
            onChange={(event) => setEan(event.target.value)}
            value={ean}
          />
        </label>
        <label>
          Buscar producto por referencia o nombre
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Referencia o nombre"
            value={query}
          />
        </label>
        <div className="ean-product-results">
          {matches.map((product) => (
            <button
              className={selected?.id === product.id ? "selected" : ""}
              key={product.id}
              onClick={() => setSelected(product)}
              type="button"
            >
              <strong>{product.reference || "Sin referencia"}</strong>
              <span>{product.name}</span>
            </button>
          ))}
        </div>
        {error && <p className="ean-dialog-error">{error}</p>}
        <button
          className="primary-button"
          disabled={!selected || !ean.trim() || saving}
          onClick={() => selected && void onSave(selected, ean.trim())}
          type="button"
        >
          {saving ? "Guardando…" : "Guardar EAN y ubicación"}
        </button>
      </section>
    </div>
  );
}
