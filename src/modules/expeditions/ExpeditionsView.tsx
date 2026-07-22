import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  PackageCheck,
  Printer,
  ScanLine,
  Settings2,
  Truck,
} from "lucide-react";
import "./expeditions.css";
import "./settingsDemo.css";
import { odooClient } from "../../services/odooClient";
import type { Order } from "../../services/odooTypes";

type Mode = "automatic" | "manual";
type Parcel = { id: number; weight: string; length: string; width: string; height: string };
type Shipment = { code: string; tracking: string; carrier: string; service: string; printedAt: string };
type GeneiQuote = { id_agencia: string | number; nombre_agencia: string; importe: number; importe_sin_iva?: number; iva?: number; servicio_horas?: string };
type DestinationDraft = { name: string; address: string; postalCode: string; town: string; country: string; phone: string; email: string };
type LabelDelivery = "download" | "inline-print" | "popup";

const automaticParcel: Parcel = { id: 1, weight: "1", length: "30", width: "20", height: "15" };
const emptyDestination: DestinationDraft = { name: "", address: "", postalCode: "", town: "", country: "", phone: "", email: "" };
const testOrder: Order = {
  id: "406-1883201-3960349", odooRef: "406-1883201-3960349", date: "", client: "Alouani aicha", channel: "Amazon · Prueba Genei", deliveryPrinted: false, total: 0, taxTotal: 0, status: "Prueba", invoiceStatus: "Sin factura", deliveryStatus: "Etiqueta real pendiente de abono", city: "Messina, Italia", shippingAddress: "Via vecchia comunale scala ritiro 5", shippingPhone: "+39 339 771 0152", shippingEmail: "wh0qf2x18wpvmgt@marketplace.amazon.it", shippingPostalCode: "98152", shippingCountryCode: "IT", items: [{ sku: "TEST-BOX", name: "Bulto de prueba", quantity: 1, price: 0, stock: 1 }],
};

const demoOrder = {
  reference: "AMZ-2026-1001",
  customer: "Sophie Martin",
  country: "Francia",
  countryCode: "FR",
  address: "18 Rue de la Paix, 75002 Paris",
  channel: "Amazon FBM",
  items: "2 productos · 1,35 kg estimados",
};

function normalizeReference(value?: string) {
  return normalizeScanReference(value).toUpperCase();
}

function normalizeScanReference(value?: string) {
  const compact = (value || "").trim().replace(/[‘’'`´]/g, "-").replace(/\s+/g, "");
  return /^\d{17}$/.test(compact)
    ? `${compact.slice(0, 3)}-${compact.slice(3, 10)}-${compact.slice(10)}`
    : compact;
}

function isSameOrderReference(reference: string, order: Order) {
  const normalized = normalizeReference(reference);
  return [order.odooRef, order.id, order.externalRef]
    .map(normalizeReference)
    .filter(Boolean)
    .includes(normalized);
}

function isPreparedOrderReference(reference: string, order: Order, preparedReference: string) {
  return (
    isSameOrderReference(reference, order) ||
    normalizeReference(reference) === normalizeReference(preparedReference)
  );
}

function getMissingDestinationFields(destination: DestinationDraft) {
  const labels: Array<[keyof DestinationDraft, string]> = [
    ["name", "nombre"],
    ["address", "direccion/calle"],
    ["postalCode", "CP"],
    ["town", "ciudad"],
    ["country", "pais"],
    ["phone", "telefono"],
    ["email", "email"],
  ];
  return labels.filter(([field]) => !destination[field].trim()).map(([, label]) => label);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function downloadPdfFromBackend(shipmentCode: string) {
  window.location.assign(`/api/genei/shipments/${encodeURIComponent(shipmentCode)}/label.pdf`);
}

function pdfBase64ToObjectUrl(base64: string) {
  const cleanBase64 = base64.replace(/^data:application\/pdf;base64,/, "");
  const bytes = Uint8Array.from(atob(cleanBase64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

function printPdfInCurrentTab(base64: string, shipmentCode: string) {
  return new Promise<void>((resolve, reject) => {
    const url = pdfBase64ToObjectUrl(base64);
    const frame = document.createElement("iframe");
    frame.title = `Etiqueta Genei ${shipmentCode}`;
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";
    frame.style.opacity = "0";
    frame.onload = () => {
      window.setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          window.setTimeout(() => {
            frame.remove();
            URL.revokeObjectURL(url);
          }, 60_000);
        }
      }, 350);
    };
    frame.onerror = () => {
      frame.remove();
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo preparar la etiqueta para imprimir"));
    };
    frame.src = url;
    document.body.appendChild(frame);
  });
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getGeneiShipmentCode(shipment?: Record<string, unknown> | null) {
  if (!shipment) return "";
  return String(
    shipment.reference ||
      shipment.shipmentCode ||
      shipment.codigo_envio ||
      shipment.codigoEnvio ||
      shipment.code ||
      "",
  );
}

async function findExistingGeneiShipment(order: Order) {
  const references = Array.from(
    new Set([order.externalRef, order.id, order.odooRef].map(normalizeScanReference).filter(Boolean)),
  );
  for (const reference of references) {
    const known = await fetch(`/api/genei/shipments/external/${encodeURIComponent(reference)}`)
      .then(async (response) => (response.ok ? response.json() : null))
      .catch(() => null) as { shipment?: Record<string, unknown> } | null;
    if (getGeneiShipmentCode(known?.shipment)) return known;
  }
  return null;
}

type ExpeditionsViewProps = {
  onRefreshOrders?: () => void;
};

export function ExpeditionsView({ onRefreshOrders }: ExpeditionsViewProps) {
  const [section, setSection] = useState<"operativa" | "rules" | "station" | "integrations">("operativa");
  const [mode, setMode] = useState<Mode>("automatic");
  const [scan, setScan] = useState("");
  const [orderFound, setOrderFound] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [quotes, setQuotes] = useState<GeneiQuote[]>([]);
  const [testShipmentCode, setTestShipmentCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [parcels, setParcels] = useState<Parcel[]>([
    automaticParcel,
  ]);
  const [selectedQuote, setSelectedQuote] = useState(0);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [existingShipmentCode, setExistingShipmentCode] = useState<string | null>(null);
  const [preparedReference, setPreparedReference] = useState("");
  const [labelReference, setLabelReference] = useState("");
  const [validateInOdooAfterLabel, setValidateInOdooAfterLabel] = useState(true);
  const [destinationDraft, setDestinationDraft] = useState<DestinationDraft>(emptyDestination);
  const [notice, setNotice] = useState("Listo para escanear un pedido.");
  const scannerBufferRef = useRef("");
  const scannerResetRef = useRef<number | null>(null);

  const totalWeight = useMemo(
    () => parcels.reduce((total, parcel) => total + Number(parcel.weight.replace(",", ".") || 0), 0),
    [parcels],
  );
  const missingDestinationFields = getMissingDestinationFields(destinationDraft);
  const destinationReady = missingDestinationFields.length === 0;

  const findOrder = async (value = scan) => {
    const reference = normalizeScanReference(value);
    if (!reference) return;
    if (orderFound && order && quotes.length > 0 && isPreparedOrderReference(reference, order, preparedReference)) {
      if (existingShipmentCode) {
        setScan("");
        setNotice(`Segundo escaneo confirmado. Esperando etiqueta Genei ${existingShipmentCode} para imprimir sin salir de Expediciones.`);
        await openLabel(existingShipmentCode, { delivery: "inline-print", print: true });
        if (validateInOdooAfterLabel) await validateLabelDeliveryInOdoo(existingShipmentCode);
        return;
      }
      if (!destinationReady) {
        setNotice(`Faltan datos de destino: ${missingDestinationFields.join(", ")}. Completa los campos antes de volver a escanear para generar la etiqueta.`);
        return;
      }
      setScan("");
      setNotice("Segundo escaneo confirmado. Generando etiqueta Genei e imprimiendo sin salir de Expediciones.");
      await createAndPayManualShipment({ skipConfirm: true, delivery: "inline-print", print: true });
      return;
    }
    setLoading(true); setOrderFound(false); setOrder(null); setQuotes([]); setShipment(null); setTestShipmentCode(null); setExistingShipmentCode(null); setPreparedReference(""); setLabelReference(""); setDestinationDraft(emptyDestination);
    try {
      const result = reference.toUpperCase() === testOrder.odooRef ? null : await odooClient.getOrderDetail(reference);
      const found = result?.order ?? (reference.toUpperCase() === testOrder.odooRef ? testOrder : null);
      if (!found) throw new Error("No se ha encontrado ese pedido en Odoo");
      const country = found.shippingCountryCode || "";
      const postalCode = found.shippingPostalCode || "";
      const town = found.city.split(",")[0]?.trim() || "";
      const draft = {
        name: found.client || "",
        address: found.shippingAddress || "",
        postalCode,
        town,
        country,
        phone: found.shippingPhone || "",
        email: found.shippingEmail || "",
      };
      setDestinationDraft(draft);
      if (!draft.name || !draft.country || !draft.postalCode || !draft.town || !draft.phone || !draft.email) {
        throw new Error("El pedido debe tener nombre, codigo postal, ciudad, pais, telefono y email antes de cotizar");
      }
      const quoteResponse = await fetch("/api/genei/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isWarehouse: false, isoCountryOrigin: "ES", isoCountryDestination: country, postalCodeOrigin: "03690", postalCodeDestination: postalCode, townOrigin: "San Vicente del Raspeig", townDestination: town, packages: parcels.map((parcel) => ({ weight: Number(parcel.weight.replace(",", ".")), height: Number(parcel.height), width: Number(parcel.width), length: Number(parcel.length), isBox: false })) }) });
      const quotePayload = await quoteResponse.json() as { quotes?: Array<GeneiQuote & { id?: string | number; agency?: string; base?: number; total?: number }>; message?: string };
      if (!quoteResponse.ok) throw new Error(quotePayload.message || "No se pudo cotizar con Genei");
      const available = (quotePayload.quotes || []).map((quote) => ({
        ...quote,
        id_agencia: quote.id_agencia ?? quote.id ?? "",
        nombre_agencia: quote.nombre_agencia ?? quote.agency ?? "Servicio Genei",
        importe: quote.importe ?? quote.total ?? 0,
        importe_sin_iva: quote.importe_sin_iva ?? quote.base,
      }));
      if (!available.length) throw new Error("Genei no ofrece servicios para este pedido con los bultos indicados");
      const fedexRequired = ["FR", "IT", "DE"].includes(country);
      const permitted = fedexRequired ? available.filter((quote) => /FEDEX|GLOBAL EXPRESS/.test(quote.nombre_agencia.toUpperCase())) : available;
      if (!permitted.length) throw new Error("La regla exige FedEx, pero Genei no lo ofrece para este pedido. Requiere revision manual.");
      const ordered = [...permitted].sort((left, right) => Number(left.importe) - Number(right.importe));
      setOrder(found); setQuotes(ordered); setSelectedQuote(0); setOrderFound(true); setPreparedReference(reference); setLabelReference(found.externalRef || found.id || found.odooRef); setScan("");
      const known = await findExistingGeneiShipment(found);
      const shipmentData = known?.shipment;
      const shipmentReference = getGeneiShipmentCode(shipmentData) || (found.odooRef === testOrder.odooRef ? "0DROIMAV" : "");
      if (shipmentReference) setExistingShipmentCode(shipmentReference);
      setNotice(shipmentReference ? `Pedido encontrado. Etiqueta Genei registrada: ${shipmentReference}. Escanea otra vez el mismo pedido para imprimirla.` : draft.address ? `Pedido encontrado. Regla aplicada: ${fedexRequired ? "FedEx / Global Express mas economico" : "servicio mas economico"}. Escanea otra vez el mismo pedido para confirmar la etiqueta.` : "Pedido encontrado y cotizado, pero falta la direccion/calle. Completala antes del segundo escaneo.");
    } catch (error) {
      if (reference.toUpperCase() === testOrder.odooRef) {
        setOrder(testOrder); setOrderFound(true); setPreparedReference(reference); setLabelReference(testOrder.externalRef || testOrder.id || testOrder.odooRef); setQuotes([]); setNotice(error instanceof Error ? `Pedido de pruebas encontrado, pero la cotización ha fallado: ${error.message}` : "Pedido de pruebas encontrado, pero no se pudo obtener la cotización.");
      } else setNotice(error instanceof Error ? error.message : "No se pudo preparar el pedido");
    }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const handleScannerInput = (event: KeyboardEvent) => {
      if (section !== "operativa" || loading || isEditableTarget(event.target)) return;
      if (event.key === "Enter") {
        const buffered = scannerBufferRef.current;
        scannerBufferRef.current = "";
        if (scannerResetRef.current) window.clearTimeout(scannerResetRef.current);
        scannerResetRef.current = null;
        if (buffered.length >= 4) {
          event.preventDefault();
          void findOrder(buffered);
        }
        return;
      }
      if (event.key.length !== 1) return;
      scannerBufferRef.current += event.key;
      if (scannerResetRef.current) window.clearTimeout(scannerResetRef.current);
      scannerResetRef.current = window.setTimeout(() => {
        scannerBufferRef.current = "";
        scannerResetRef.current = null;
      }, 250);
    };

    document.addEventListener("keydown", handleScannerInput);
    return () => {
      document.removeEventListener("keydown", handleScannerInput);
      if (scannerResetRef.current) window.clearTimeout(scannerResetRef.current);
    };
  });

  const createShipment = () => {
    if (!orderFound) return;
    const selected = quotes[selectedQuote];
    if (!selected) return;
    setShipment({
      code: "PENDIENTE",
      tracking: "Prueba sin pago",
      carrier: selected.nombre_agencia,
      service: "Pendiente de crear",
      printedAt: new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date()),
    });
    setNotice("La creacion real de prueba se habilitara tras confirmar los datos de Odoo.");
  };

  const createTestShipment = async () => {
    if (!order || !quotes[selectedQuote]) return;
    if (!destinationReady) {
      setNotice(`Faltan datos de destino: ${missingDestinationFields.join(", ")}. Completa los campos antes de crear la prueba.`);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/genei/shipments/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencyId: Number(quotes[selectedQuote].id_agencia), externalShippingCode: getShipmentExternalReference(), orderReference: order.odooRef, packagesArray: parcels.map((parcel) => ({ weight: Number(parcel.weight.replace(",", ".")), height: Number(parcel.height), width: Number(parcel.width), length: Number(parcel.length) })), destination: { postalCode: destinationDraft.postalCode, town: destinationDraft.town, name: destinationDraft.name, address: destinationDraft.address, isoCountry: destinationDraft.country, phone: destinationDraft.phone, email: destinationDraft.email } }) });
      const payload = await response.json() as { shipment?: { reference?: string }; message?: string };
      if (!response.ok || !payload.shipment?.reference) throw new Error(payload.message || "Genei no ha creado la prueba");
      setTestShipmentCode(payload.shipment.reference); setNotice(`Prueba creada en Genei (${payload.shipment.reference}) sin pagar. Puedes cancelarla.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo crear la prueba"); }
    finally { setLoading(false); }
  };

  const createAndPayManualShipment = async (options: { labelWindow?: Window | null; print?: boolean; skipConfirm?: boolean; delivery?: LabelDelivery } = {}) => {
    if (!order || !quotes[selectedQuote]) return;
    if (!destinationReady) {
      setNotice(`Faltan datos de destino: ${missingDestinationFields.join(", ")}. Completa los campos antes de generar la etiqueta.`);
      return;
    }
    const quote = quotes[selectedQuote];
    const total = Number(quote.importe).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
    if (!options.skipConfirm && !window.confirm(`Vas a generar y pagar una etiqueta real con ${quote.nombre_agencia} por ${total}. ¿Confirmas?`)) return;
    let labelWindow = options.labelWindow;
    setLoading(true);
    try {
      const shipmentResponse = await fetch("/api/genei/shipments/real", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencyId: Number(quote.id_agencia), externalShippingCode: getShipmentExternalReference(), orderReference: order.odooRef, packagesArray: parcels.map((parcel) => ({ weight: Number(parcel.weight.replace(",", ".")), height: Number(parcel.height), width: Number(parcel.width), length: Number(parcel.length) })), destination: { postalCode: destinationDraft.postalCode, town: destinationDraft.town, name: destinationDraft.name, address: destinationDraft.address, isoCountry: destinationDraft.country, phone: destinationDraft.phone, email: destinationDraft.email } }) });
      const shipmentText = await shipmentResponse.text();
      const shipmentPayload = (shipmentText ? JSON.parse(shipmentText) : {}) as { shipment?: Record<string, unknown> & { transactionId?: number }; message?: string };
      const createdCode = getGeneiShipmentCode(shipmentPayload.shipment);
      if (!shipmentResponse.ok || !createdCode || !shipmentPayload.shipment?.transactionId) {
        if (shipmentPayload.message?.toLowerCase().includes("externo ya corresponde")) {
          const known = await findExistingGeneiShipment(order);
          const existingCode = getGeneiShipmentCode(known?.shipment);
          if (existingCode) {
            setExistingShipmentCode(existingCode);
            setNotice(`Genei ya tenia el envio ${existingCode}. Esperando PDF para imprimir sin salir de Expediciones.`);
            await openLabel(existingCode, { delivery: options.delivery ?? "inline-print", print: options.print });
            if (validateInOdooAfterLabel) await validateLabelDeliveryInOdoo(existingCode);
            return;
          }
        }
        throw new Error(shipmentPayload.message || "Genei no ha creado la etiqueta");
      }
      const paymentResponse = await fetch(`/api/genei/payments/${shipmentPayload.shipment.transactionId}`, { method: "POST" });
      const paymentText = await paymentResponse.text();
      const paymentPayload = (paymentText ? JSON.parse(paymentText) : {}) as { message?: string };
      if (!paymentResponse.ok) throw new Error(paymentPayload.message || "Genei no ha podido cobrar la etiqueta");
      setExistingShipmentCode(createdCode);
      setNotice(`Etiqueta ${createdCode} generada y pagada. Preparando ${options.delivery === "download" ? "descarga" : "impresion"}.`);
      await openLabel(createdCode, {
        labelWindow,
        print: options.print,
        delivery: options.delivery ?? "download",
      });
      if (validateInOdooAfterLabel) await validateLabelDeliveryInOdoo(createdCode);
    } catch (error) {
      labelWindow?.close();
      setNotice(error instanceof Error ? error.message : "No se pudo generar la etiqueta");
    }
    finally { setLoading(false); }
  };

  const cancelTestShipment = async () => {
    if (!testShipmentCode) return;
    setLoading(true);
    try { const response = await fetch(`/api/genei/shipments/${encodeURIComponent(testShipmentCode)}`, { method: "DELETE" }); const payload = await response.json() as { message?: string }; if (!response.ok) throw new Error(payload.message || "No se pudo cancelar la prueba"); setNotice(`Prueba ${testShipmentCode} cancelada. No se ha realizado ningun pago.`); setTestShipmentCode(null); } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo cancelar la prueba"); } finally { setLoading(false); }
  };

  const resetShipmentFlow = () => {
    setOrderFound(false); setOrder(null); setQuotes([]); setShipment(null); setTestShipmentCode(null); setExistingShipmentCode(null); setPreparedReference(""); setLabelReference(""); setDestinationDraft(emptyDestination); setScan(""); setParcels([automaticParcel]); setSelectedQuote(0); setMode("automatic"); setNotice("Listo para escanear un nuevo pedido.");
  };

  const editInManual = () => {
    setMode("manual");
    setNotice("Modo manual activo. Revisa bultos, datos del destinatario y servicio; despues recotizaremos antes de crear el envio.");
  };

  const openLabel = async (
    shipmentCode: string,
    options: { labelWindow?: Window | null; print?: boolean; delivery?: LabelDelivery } = {},
  ) => {
    const fetchLabelBase64 = async (attempts = 10) => {
      let lastMessage = "Genei todavia no ha preparado el PDF de la etiqueta";
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        setNotice(`Esperando etiqueta Genei ${shipmentCode}. Intento ${attempt}/${attempts}.`);
        const response = await fetch(`/api/genei/shipments/${encodeURIComponent(shipmentCode)}/label`);
        const payload = await response.json() as { label?: unknown; message?: string };
        if (response.ok) {
          const label = payload.label;
          const base64 = typeof label === "string" ? label : label && typeof label === "object" ? String((label as Record<string, unknown>).base64 || (label as Record<string, unknown>).file || (label as Record<string, unknown>).label || "") : "";
          if (base64) return base64;
          lastMessage = "Genei no ha devuelto PDF todavia";
        } else {
          lastMessage = payload.message || lastMessage;
        }
        if (attempt < attempts) await wait(attempt < 4 ? 1500 : 3000);
      }
      throw new Error(`${lastMessage}. Si Genei lo deja atascado como pendiente, cancela ese envio en Genei desde la pantalla y vuelve a escanear para recrearlo.`);
    };

    const delivery = options.delivery ?? "download";
    const labelWindow = delivery === "popup" ? options.labelWindow ?? window.open("", "_blank") : null;
    if (delivery === "popup" && !labelWindow) {
      setNotice("El navegador ha bloqueado la apertura del PDF. Descarga la etiqueta desde el boton de descarga.");
      return;
    }
    if (labelWindow) labelWindow.document.title = "Cargando etiqueta Genei";
    try {
      const base64 = await fetchLabelBase64();
      if (delivery === "download") {
        downloadPdfFromBackend(shipmentCode);
        setNotice("Etiqueta lista en Genei. Descarga iniciada desde el backend.");
        return;
      }
      if (delivery === "inline-print") {
        await printPdfInCurrentTab(base64, shipmentCode);
        setNotice("Cuadro de impresion abierto sin salir de Expediciones.");
        return;
      }
      const url = pdfBase64ToObjectUrl(base64);
      if (!labelWindow) throw new Error("No se pudo abrir la ventana de etiqueta");
      labelWindow.document.open();
      labelWindow.document.write(`
        <!doctype html>
        <html lang="es">
          <head>
            <meta charset="utf-8" />
            <title>Etiqueta Genei ${escapeHtml(shipmentCode)}</title>
            <style>
              html, body { height: 100%; margin: 0; font-family: Arial, sans-serif; color: #111827; }
              body { display: grid; grid-template-rows: auto 1fr; background: #f8fafc; }
              header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #cbd5e1; background: #fff; }
              strong { font-size: 14px; }
              .actions { display: flex; gap: 8px; }
              button, a { border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; font-size: 13px; font-weight: 700; padding: 8px 10px; text-decoration: none; }
              a { background: #fff; color: #2563eb; }
              iframe { width: 100%; height: 100%; border: 0; background: #fff; }
              @media print {
                header { display: none; }
                body { display: block; background: #fff; }
                iframe { height: 100vh; }
              }
            </style>
          </head>
          <body>
            <header>
              <strong>Etiqueta Genei ${escapeHtml(shipmentCode)}</strong>
              <div class="actions">
                <button type="button" onclick="window.print()">Imprimir</button>
                <a href="${url}" target="_blank" rel="noreferrer">Abrir PDF</a>
              </div>
            </header>
            <iframe src="${url}" title="Etiqueta Genei"></iframe>
          </body>
        </html>
      `);
      labelWindow.document.close();
      labelWindow.focus();
      if (options.print) window.setTimeout(() => { labelWindow.focus(); labelWindow.print(); }, 1200);
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
      setNotice(options.print ? "Ventana de etiqueta abierta con visor PDF y boton de imprimir." : "Ventana de etiqueta abierta desde Genei. No se ha guardado ninguna copia en el equipo.");
    } catch (error) {
      if (labelWindow) labelWindow.document.body.innerHTML = `<p>${escapeHtml(error instanceof Error ? error.message : "No se pudo abrir el PDF")}</p>`;
      setNotice(error instanceof Error ? error.message : "No se pudo abrir el PDF");
    }
  };

  const openExistingLabel = async (
    delivery: LabelDelivery = "download",
    print = delivery === "inline-print" || delivery === "popup",
  ) => {
    if (!existingShipmentCode) return;
    setLoading(true);
    try {
      await openLabel(existingShipmentCode, { delivery, print });
      if (print && validateInOdooAfterLabel) {
        await validateLabelDeliveryInOdoo(existingShipmentCode);
      }
    }
    finally { setLoading(false); }
  };

  const cancelGeneiShipment = async () => {
    if (!existingShipmentCode || !window.confirm(`¿Cancelar en Genei la etiqueta ${existingShipmentCode}? Esta acción puede dejarla pendiente de abono.`)) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/genei/shipments/${encodeURIComponent(existingShipmentCode)}`, { method: "DELETE" });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message || "Genei no ha podido cancelar el envío");
      setNotice(payload.message || `Envío ${existingShipmentCode} cancelado en Genei.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo cancelar el envío"); }
    finally { setLoading(false); }
  };

  const unlinkGeneiShipment = async () => {
    if (!existingShipmentCode || !order || !window.confirm(`¿Desvincular la etiqueta ${existingShipmentCode} del pedido ${order.odooRef}? No cancela el envío en Genei.`)) return;
    setLoading(true);
    try {
      const detailsResponse = await fetch(`/api/genei/shipments/${encodeURIComponent(existingShipmentCode)}`);
      const details = await detailsResponse.json() as { shipment?: Record<string, unknown>; message?: string };
      const shipmentId = details.shipment && (details.shipment.id_envio || details.shipment.id || details.shipment.shipmentId);
      if (!detailsResponse.ok || !shipmentId) throw new Error(details.message || "No se ha podido identificar el envío en Genei para desvincularlo");
      const response = await fetch(`/api/genei/shipments/${encodeURIComponent(String(shipmentId))}/external/${encodeURIComponent(order.odooRef)}`, { method: "DELETE" });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message || "Genei no ha podido desvincular el pedido");
      setExistingShipmentCode(null);
      setNotice(payload.message || "Envío desvinculado del pedido. No se ha cancelado en Genei.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo desvincular el envío"); }
    finally { setLoading(false); }
  };

  const markAsShipped = async () => {
    if (!order || !existingShipmentCode || !window.confirm(`¿Dar por enviado el pedido ${order.odooRef}? Odoo validará la entrega y enviará el tracking mediante el conector del canal.`)) return;
    await validateLabelDeliveryInOdoo(existingShipmentCode);
  };

  const getShipmentExternalReference = () =>
    normalizeScanReference(labelReference) || order?.externalRef || order?.id || order?.odooRef || "";

  const validateLabelDeliveryInOdoo = async (shipmentCode: string) => {
    if (!order) return;
    setLoading(true);
    try {
      const result = await odooClient.validateOdooDeliveries([order.odooRef], {
        source: "genei-label",
        tracking: shipmentCode,
      });
      const incidentText = result.incidents?.length
        ? ` Incidencia: ${result.incidents[0].reason}`
        : "";
      setNotice(`Etiqueta ${shipmentCode} impresa. Odoo: ${result.validated ?? 0} entrega(s) validada(s).${incidentText}`);
      onRefreshOrders?.();
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo validar la entrega en Odoo"); }
    finally { setLoading(false); }
  };

  const updateParcel = (id: number, field: keyof Omit<Parcel, "id">, value: string) =>
    setParcels((current) => current.map((parcel) => (parcel.id === id ? { ...parcel, [field]: value } : parcel)));
  const updateDestination = (field: keyof DestinationDraft, value: string) =>
    setDestinationDraft((current) => ({ ...current, [field]: value }));

  return (
    <div className="expeditions-view">
      <section className="expeditions-hero">
        <div>
          <span className="expeditions-kicker">INTEGRACION GENEI · DOBLE ESCANEO</span>
          <h2>Expediciones</h2>
          <p>Primer escaneo: busca y cotiza. Segundo escaneo del mismo pedido: genera la etiqueta y abre la impresion sin salir de Expediciones.</p>
        </div>
        <div className="station-card">
          <Printer size={20} />
          <div><strong>Puesto Preparacion 1</strong><span>Zebra ZD421 · Etiqueta 100 × 150</span></div>
          <span className="station-ok">Conectada</span>
        </div>
      </section>

      <nav className="expeditions-subnav" aria-label="Secciones de Expediciones">
        <button className={section === "operativa" ? "active" : ""} onClick={() => setSection("operativa")} type="button"><ScanLine size={16} /> Operativa</button>
        <button className={section === "rules" ? "active" : ""} onClick={() => setSection("rules")} type="button"><Settings2 size={16} /> Reglas de envio</button>
        <button className={section === "station" ? "active" : ""} onClick={() => setSection("station")} type="button"><Printer size={16} /> Puesto e impresion</button>
        <button className={section === "integrations" ? "active" : ""} onClick={() => setSection("integrations")} type="button"><Truck size={16} /> Integraciones</button>
      </nav>

      {section === "operativa" ? <>
      <section className="expeditions-toolbar">
        <div className="mode-toggle" aria-label="Modo de expedicion">
          <button className={mode === "automatic" ? "active" : ""} onClick={() => { setMode("automatic"); setParcels([automaticParcel]); setSelectedQuote(0); }} type="button">Automatico</button>
          <button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")} type="button">Manual</button>
        </div>
        <span><Settings2 size={16} /> {mode === "automatic" ? "Escanea una vez para preparar y otra vez para generar la etiqueta." : "Puedes editar los bultos antes del segundo escaneo."}</span>
      </section>

      <section className="scan-panel">
        <div className="scan-icon"><ScanLine size={30} /></div>
        <div className="scan-copy"><strong>Escanear pedido</strong><span>{orderFound ? "Escanea el mismo pedido otra vez para generar la etiqueta" : "Referencia Odoo, Amazon o canal de ventas"}</span></div>
        <input autoFocus disabled={loading} onChange={(event) => setScan(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void findOrder(); }} placeholder="Referencia Odoo o Amazon" value={scan} />
        <button className="primary-action" disabled={loading} onClick={() => void findOrder()} type="button">{loading ? "Preparando..." : "Buscar pedido"}</button>
      </section>
      <p className={`expeditions-notice ${orderFound ? "success" : ""}`}>{orderFound ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}{notice}</p>

      {!orderFound ? (
        <section className="expeditions-empty"><PackageCheck size={38} /><h3>Esperando un escaneo</h3><p>Escanea una referencia real de Odoo o Amazon para cotizar en Genei.</p></section>
      ) : (
        <div className="expeditions-grid">
          <section className="expeditions-card order-card">
            <div className="card-heading"><div><span>Pedido encontrado</span><h3>{order?.odooRef}</h3></div><span className="status-chip">{order?.channel}</span></div>
            <dl><div><dt>Destinataria</dt><dd>{order?.client}</dd></div><div><dt>Destino</dt><dd>{order?.shippingAddress || "Falta direccion/calle"}</dd></div><div><dt>Contenido</dt><dd>{order?.items.length} lineas de pedido</dd></div></dl>
            <div className="destination-fields">
              <label>Nombre<input onChange={(event) => updateDestination("name", event.target.value)} value={destinationDraft.name} /></label>
              <label>Direccion<input className={!destinationDraft.address.trim() ? "missing" : ""} onChange={(event) => updateDestination("address", event.target.value)} placeholder="Calle y numero" value={destinationDraft.address} /></label>
              <label>CP<input onChange={(event) => updateDestination("postalCode", event.target.value)} value={destinationDraft.postalCode} /></label>
              <label>Ciudad<input onChange={(event) => updateDestination("town", event.target.value)} value={destinationDraft.town} /></label>
              <label>Pais ISO<input onChange={(event) => updateDestination("country", event.target.value.toUpperCase())} value={destinationDraft.country} /></label>
              <label>Telefono<input onChange={(event) => updateDestination("phone", event.target.value)} value={destinationDraft.phone} /></label>
              <label>Email<input onChange={(event) => updateDestination("email", event.target.value)} value={destinationDraft.email} /></label>
            </div>
            <div className="rule-applied"><Truck size={19} /><div><strong>Regla aplicada sobre servicios reales de Genei</strong><span>La opcion marcada es la mas economica permitida para el destino.</span></div></div>
          </section>

          <section className="expeditions-card quote-card">
            <div className="card-heading"><div><span>Servicios Genei</span><h3>Resultado de cotizacion</h3></div><span className="status-chip">En directo</span></div>
            <div className="quote-list">
              {quotes.map((quote, index) => { const total = Number(quote.importe); const base = Number(quote.importe_sin_iva ?? total / (1 + Number(quote.iva ?? 21) / 100)); return <label className={selectedQuote === index ? "quote selected" : "quote"} key={`${quote.id_agencia}-${index}`}><input checked={selectedQuote === index} disabled={mode === "automatic"} name="quote" onChange={() => setSelectedQuote(index)} type="radio" /><div><strong>{quote.nombre_agencia}</strong><span>{quote.servicio_horas ? `${quote.servicio_horas} h` : "Servicio disponible"}{mode === "automatic" && index === 0 ? " · Seleccionado por regla" : ""}</span><span>{base.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} + IVA</span></div><b>{total.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</b></label>; })}
            </div>
          </section>

          <section className="expeditions-card parcels-card">
            <div className="card-heading"><div><span>Bultos</span><h3>{parcels.length} {parcels.length === 1 ? "bulto" : "bultos"} · {totalWeight.toLocaleString("es-ES")} kg</h3></div>{mode === "manual" && <button className="text-button" onClick={() => setParcels((current) => [...current, { id: Date.now(), weight: "1", length: "30", width: "20", height: "15" }])} type="button">+ Anadir bulto</button>}</div>
            {parcels.map((parcel, index) => <div className="parcel-row" key={parcel.id}><strong>Bulto {index + 1}</strong>{(["weight", "length", "width", "height"] as const).map((field) => <label key={field}>{field === "weight" ? "kg" : field === "length" ? "largo" : field === "width" ? "ancho" : "alto"}<input disabled={mode === "automatic"} inputMode="decimal" onChange={(event) => updateParcel(parcel.id, field, event.target.value)} value={parcel[field]} /></label>)}{mode === "manual" && parcels.length > 1 && <button aria-label="Quitar bulto" className="remove-parcel" onClick={() => setParcels((current) => current.filter((item) => item.id !== parcel.id))} type="button">×</button>}</div>)}
          </section>

          <section className="expeditions-card action-card">
            <span>Ultimo paso</span><h3>{shipment ? "Envio creado" : "Crear e imprimir"}</h3>
            <label className="label-reference-field">
              Referencia etiqueta
              <input
                disabled={loading}
                onChange={(event) => setLabelReference(event.target.value)}
                placeholder="Amazon / Prestashop / referencia canal"
                value={labelReference}
              />
              <small>Se envia a Genei como referencia externa para localizar la etiqueta por pedido.</small>
            </label>
            <label className="odoo-auto-validate">
              <input
                checked={validateInOdooAfterLabel}
                disabled={loading}
                onChange={(event) => setValidateInOdooAfterLabel(event.target.checked)}
                type="checkbox"
              />
              Validar entrega en Odoo al imprimir etiqueta
            </label>
            {existingShipmentCode ? (
              <div className="shipment-success">
                <CheckCircle2 size={25} />
                <div>
                  <strong>Etiqueta Genei · {existingShipmentCode}</strong>
                  <span>Recuperacion directa desde Genei: no se guarda ningun PDF en el equipo.</span>
                  <div className="settings-demo-actions">
                    <button className="primary-action" disabled={loading} onClick={() => void openExistingLabel("inline-print", true)} type="button">Imprimir etiqueta</button>
                    <button className="secondary-action" disabled={loading} onClick={() => void openExistingLabel("download")} type="button">Descargar etiqueta</button>
                    <button className="secondary-action" disabled={loading} onClick={() => void openExistingLabel("popup", false)} type="button">Abrir PDF</button>
                    <button className="secondary-action" disabled={loading} onClick={() => void markAsShipped()} type="button">Dar por enviado</button>
                    <button className="secondary-action" disabled={loading} onClick={() => void cancelGeneiShipment()} type="button">Cancelar en Genei</button>
                    <button className="secondary-action" disabled={loading} onClick={() => void unlinkGeneiShipment()} type="button">Desvincular pedido</button>
                    <button className="secondary-action" disabled={loading} onClick={resetShipmentFlow} type="button">Nuevo escaneo</button>
                  </div>
                </div>
              </div>
            ) : testShipmentCode ? (
              <div className="shipment-success">
                <CheckCircle2 size={25} />
                <div>
                  <strong>Prueba Genei · {testShipmentCode}</strong>
                  <span>Envio pendiente de pago. No se ha generado ningun cargo.</span>
                  <div className="settings-demo-actions">
                    <button className="secondary-action" disabled={loading} onClick={() => void cancelTestShipment()} type="button">Cancelar prueba</button>
                    <button className="secondary-action" disabled={loading} onClick={resetShipmentFlow} type="button">Cancelar y nuevo escaneo</button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p>Falta el segundo escaneo del mismo pedido. Ese segundo escaneo generara y pagara la etiqueta, abrira la impresion y actualizara Odoo si esta marcado.</p>
                <button className="primary-action full" disabled={loading} onClick={() => void createAndPayManualShipment({ delivery: "inline-print", print: true })} type="button">Generar e imprimir etiqueta</button>
                <button className="secondary-action full" disabled={loading} onClick={() => void createAndPayManualShipment({ delivery: "download" })} type="button">Generar y descargar etiqueta</button>
                <button className="secondary-action full" onClick={editInManual} type="button">Editar antes del segundo escaneo</button>
                <button className="secondary-action full" disabled={loading} onClick={() => void createTestShipment()} type="button">Crear prueba sin pagar</button>
                <button className="secondary-action full" disabled={loading} onClick={resetShipmentFlow} type="button">Cancelar y nuevo escaneo</button>
              </>
            )}
          </section>
        </div>
      )}</> : <ExpeditionsSettingsDemo section={section} />}
    </div>
  );
}

function ExpeditionsSettingsDemo({ section }: { section: "rules" | "station" | "integrations" }) {
  if (section === "rules") return <section className="settings-demo"><div className="settings-demo-head"><div><span>REGLAS DE ENVIO</span><h3>Prioridad y seleccion automatica</h3><p>La primera regla activa que coincide decide que servicios puede elegir Genei.</p></div><button className="primary-action" type="button">+ Nueva regla</button></div><div className="rule-row"><b>1</b><div><strong>Francia, Italia y Alemania → FedEx mas barato</strong><span>Activa · paises FR, IT, DE · restringe a FedEx · selecciona menor coste</span></div><em>Regla base</em></div><div className="rule-row"><b>2</b><div><strong>Resto de destinos → servicio mas barato</strong><span>Activa · sin condiciones · elige el menor coste de Genei</span></div><em>Regla base</em></div><div className="settings-demo-note"><CircleAlert size={17} /> Cuando conectemos Genei, las reglas solo elegiran servicios que Genei haya devuelto.</div></section>;
  if (section === "station") return <section className="settings-demo"><div className="settings-demo-head"><div><span>PUESTO DE TRABAJO</span><h3>Preparacion 1</h3><p>Esta configuracion se guardara en cada ordenador, no por usuario.</p></div><span className="station-ok">Conectada</span></div><div className="station-settings"><label>Modo de trabajo<select defaultValue="automatic"><option value="automatic">Automatico</option><option value="manual">Manual</option></select></label><label>Impresora de etiquetas<select defaultValue="Zebra ZD421"><option>Zebra ZD421</option><option>Honeywell PC42t</option></select></label><label>Impresora de albaranes<select defaultValue="Microsoft Print to PDF"><option>Microsoft Print to PDF</option><option>HP Office</option></select></label><label>Perfil de caja por defecto<select defaultValue="Caja estandar S"><option>Caja estandar S · 30 × 20 × 15</option><option>Caja estandar M · 40 × 30 × 20</option></select></label></div><div className="settings-demo-actions"><button className="secondary-action" type="button">Imprimir prueba</button><button className="primary-action" type="button">Guardar configuracion</button></div></section>;
  return <section className="settings-demo"><div className="settings-demo-head"><div><span>INTEGRACIONES</span><h3>Credenciales y remitente</h3><p>Las claves se guardaran solo en el backend; nunca se mostraran al operario.</p></div><span className="demo-badge">Pendiente de conexion</span></div><div className="integration-grid"><article><h4>Genei API v2</h4><p>Usuario, contrasena/token, URL de webhook y remitente unico.</p><button className="secondary-action" type="button">Configurar Genei</button></article><article><h4>Odoo</h4><p>Ya conectado en el dashboard. Se anadira tracking, URL y estado de expedicion.</p><span className="integration-state">Conexion existente</span></article><article><h4>Agente de impresion</h4><p>Aplicacion Windows propia que recibe trabajos del dashboard e imprime ZPL/PDF sin dialogos.</p><button className="secondary-action" type="button">Comprobar agente</button></article></div><div className="settings-demo-note"><CircleAlert size={17} /> Esta demo no permite introducir secretos todavia. La pantalla real los enviara al backend protegido.</div></section>;
}
