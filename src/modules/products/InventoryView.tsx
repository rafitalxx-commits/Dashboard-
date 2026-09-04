import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  ClipboardList,
  MapPin,
  PackagePlus,
  Plus,
  Search,
  Users,
  ScanLine,
  Check,
  Camera,
  X,
  ImageOff,
  Minus,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  LockKeyhole,
} from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type {
  CatalogProduct,
  CatalogStore,
  InventoryScope,
  ProductInventory,
} from "../../services/odooTypes";

type Screen = "new" | "active" | "review" | "final" | "history";
type SavedScope = {
  productSelection?: InventoryScope["productSelection"];
  allowedLocationCodes?: string[];
};
const empty: CatalogStore = {
  products: [],
  sync: { status: "never", full: false, scanned: 0, changed: 0 },
};
const scopeKey = "products.inventory.createScope";
const labels: Record<Screen, string> = {
  new: "Nuevo inventario",
  active: "Inventarios en curso",
  review: "Pendientes de revisión",
  final: "Finalizados",
  history: "Historial",
};

export function InventoryView({
  screen,
  onNavigate,
}: {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogStore>(empty);
  const [inventories, setInventories] = useState<ProductInventory[]>([]);
  const [message, setMessage] = useState("");
  const [opened, setOpened] = useState<ProductInventory | null>(null);
  const load = async () => {
    try {
      const [nextCatalog, nextInventories] = await Promise.all([
        odooClient.getProductCatalog(),
        odooClient.getProductInventories(),
      ]);
      setCatalog(nextCatalog);
      setInventories(nextInventories);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo cargar Inventario",
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const shown = useMemo(
    () =>
      inventories.filter((item) =>
        screen === "active"
          ? item.status === "in_progress" || item.status === "draft"
          : screen === "review"
            ? item.status === "review"
            : screen === "final"
              ? item.status === "validated" || item.status === "finalized"
              : true,
      ),
    [inventories, screen],
  );
  const openedIndex = opened ? shown.findIndex((item) => item.id === opened.id) : -1;
  const closeInventory = (updated: ProductInventory) => {
    setOpened(null);
    setInventories((current) => current.map((item) => item.id === updated.id ? updated : item));
    if (updated.status === "review") onNavigate("review");
  };
  if (opened) return <>{message && <p className="products-message">{message}</p>}<InventorySession inventory={opened} catalog={catalog.products} onClose={closeInventory} onPrevious={openedIndex > 0 ? () => setOpened(shown[openedIndex - 1]) : undefined} onNext={openedIndex >= 0 && openedIndex < shown.length - 1 ? () => setOpened(shown[openedIndex + 1]) : undefined} readOnly={screen === "history"} returnLabel={labels[screen]} onMessage={setMessage} /></>;
  return (
    <section className="inventory-view">
      <header className="products-header">
        <div>
          <p className="eyebrow">PRODUCTOS · INVENTARIO</p>
          <h1>{labels[screen]}</h1>
          <p>
            El conteo y la revisión se guardan en Dashboard LAB. Odoo no se
            modifica aquí.
          </p>
        </div>
        {screen !== "new" && (
          <button className="primary-button" onClick={() => onNavigate("new")}>
            <Plus size={16} />
            Nuevo inventario
          </button>
        )}
      </header>
      <div className="inventory-tabs">
        {(Object.keys(labels) as Screen[]).map((item) => (
          <button
            className={screen === item ? "active" : ""}
            key={item}
            onClick={() => onNavigate(item)}
            type="button"
          >
            {labels[item]}
          </button>
        ))}
      </div>
      {message && <p className="products-message">{message}</p>}
      {screen === "new" ? (
        <InventoryCreate
          catalog={catalog.products}
          onCreated={(inventory) => {
            setInventories((current) => [inventory, ...current]);
            onNavigate("active");
          }}
          onMessage={setMessage}
        />
      ) : (
        <InventoryList
          inventories={shown}
          onOpen={setOpened}
          emptyLabel={
            screen === "active"
              ? "No hay inventarios en curso."
              : "No hay inventarios en esta sección."
          }
        />
      )}
    </section>
  );
}

function InventoryCreate({
  catalog,
  onCreated,
  onMessage,
}: {
  catalog: CatalogProduct[];
  onCreated: (inventory: ProductInventory) => void;
  onMessage: (message: string) => void;
}) {
  const [type, setType] = useState<InventoryScope["type"]>("general");
  const [name, setName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [locationCodes, setLocationCodes] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(scopeKey) || "null",
      ) as SavedScope | null;
      if (!saved) return;
      const selection = saved.productSelection;
      if (selection?.mode === "ids") {
        setType("products");
        setSelectedIds(selection.ids || []);
      } else if (selection?.mode === "filtered") {
        setType("products");
        setQuery(selection.query || "");
        setSupplier(selection.supplier || "");
      }
      if (saved.allowedLocationCodes?.length) {
        setType("locations");
        setLocationCodes(saved.allowedLocationCodes.join(", "));
      }
      sessionStorage.removeItem(scopeKey);
    } catch {
      /* Ignore invalid temporary selection. */
    }
  }, []);
  const suppliers = useMemo(
    () =>
      [
        ...new Set(catalog.flatMap((product) => product.supplierNames || [])),
      ].sort((a, b) => a.localeCompare(b, "es")),
    [catalog],
  );
  const matches = useMemo(
    () =>
      catalog
        .filter(
          (product) =>
            !query ||
            `${product.reference} ${product.name}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .slice(0, 20),
    [catalog, query],
  );
  const selectMatches = () =>
    setSelectedIds((current) => [
      ...new Set([...current, ...matches.map((product) => product.id)]),
    ]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    onMessage("");
    const locations = locationCodes
      .split(/[,\n]/)
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    const productSelection: InventoryScope["productSelection"] =
      type === "general"
        ? { mode: "all" }
        : type === "locations"
          ? { mode: "all" }
        : type === "supplier"
          ? { mode: "filtered", supplier }
          : selectedIds.length
            ? { mode: "ids", ids: selectedIds }
            : { mode: "filtered", query, supplier };
    const scope: InventoryScope = {
      type,
      productSelection,
      allowedLocationCodes: locations,
    };
    setSaving(true);
    try {
      onCreated(
        await odooClient.createProductInventory({
          name: name || `Inventario ${new Date().toLocaleDateString("es-ES")}`,
          scope,
        }),
      );
    } catch (error) {
      onMessage(
        error instanceof Error
          ? error.message
          : "No se pudo crear el inventario",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="inventory-create" onSubmit={submit}>
      <label>
        Nombre del inventario
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Inventario de agosto"
        />
      </label>
      <fieldset>
        <legend>Alcance</legend>
        <label>
          <input
            checked={type === "general"}
            name="inventory-type"
            onChange={() => setType("general")}
            type="radio"
          />
          General
        </label>
        <label>
          <input
            checked={type === "products"}
            name="inventory-type"
            onChange={() => setType("products")}
            type="radio"
          />
          Por producto / selección de Catálogo
        </label>
        <label>
          <input
            checked={type === "supplier"}
            name="inventory-type"
            onChange={() => setType("supplier")}
            type="radio"
          />
          Por proveedor
        </label>
        <label>
          <input
            checked={type === "locations"}
            name="inventory-type"
            onChange={() => setType("locations")}
            type="radio"
          />
          Por una o varias ubicaciones
        </label>
      </fieldset>
      {type === "supplier" && (
        <label>
          Proveedor
          <select
            required
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
          >
            <option value="">Selecciona proveedor</option>
            {suppliers.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      )}
      {type === "locations" && (
        <><label>
          Ubicación o ubicaciones a contar
          <textarea
            required
            value={locationCodes}
            onChange={(event) => setLocationCodes(event.target.value)}
            placeholder="B103"
          />
        </label><p className="inventory-help">Al crear, podrás contar cualquier producto, pero solo en estas ubicaciones. No necesitas seleccionar productos uno a uno.</p></>
      )}
      {type === "products" && (
        <section className="inventory-product-picker">
          <label>
            <Search size={15} />
            Buscar producto
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Referencia o nombre"
            />
          </label>
          <div className="inventory-picker-actions">
            <small>{selectedIds.length} productos seleccionados</small>
            <button onClick={selectMatches} type="button">Seleccionar visibles</button>
            {selectedIds.length > 0 && <button onClick={() => setSelectedIds([])} type="button">Limpiar</button>}
          </div>
          <div>
            {matches.map((product) => (
              <label key={product.id}>
                <input
                  checked={selectedIds.includes(product.id)}
                  onChange={() =>
                    setSelectedIds((current) =>
                      current.includes(product.id)
                        ? current.filter((id) => id !== product.id)
                        : [...current, product.id],
                    )
                  }
                  type="checkbox"
                />
                <strong>{product.reference || "Sin referencia"}</strong>
                <span>{product.name}</span>
              </label>
            ))}
          </div>
        </section>
      )}
      <button className="primary-button" disabled={saving} type="submit">
        <PackagePlus size={16} />
        {saving ? "Creando…" : "Crear inventario"}
      </button>
    </form>
  );
}

function InventoryList({
  inventories,
  emptyLabel,
  onOpen,
}: {
  inventories: ProductInventory[];
  emptyLabel: string;
  onOpen: (inventory: ProductInventory) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return inventories;
    return inventories.filter((inventory) => `${inventory.name} ${inventory.id} ${inventory.status}`.toLocaleLowerCase().includes(normalized));
  }, [inventories, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const formatDate = (value?: string) => value ? new Date(value).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "";
  const dates = (inventory: ProductInventory) => [inventory.startedAt && `Inicio: ${formatDate(inventory.startedAt)}`, inventory.finalizedAt ? `Final: ${formatDate(inventory.finalizedAt)}` : inventory.finishedAt ? `Conteo finalizado: ${formatDate(inventory.finishedAt)}` : undefined].filter(Boolean).join(" · ");
  return inventories.length ? (
    <>
      <div className="inventory-list-toolbar"><label><Search size={16}/><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar inventario" /></label><small>{filtered.length} inventarios</small></div>
      <div className="inventory-list">
      {visible.map((inventory) => (
        <button className="inventory-row" key={inventory.id} onClick={() => onOpen(inventory)} type="button">
          <div>
            <strong>{inventory.name}</strong>
            <span>
              {inventory.plannedProductIds.length} productos previstos ·{" "}
              {inventory.scope.allowedLocationCodes.length
                ? inventory.scope.allowedLocationCodes.join(", ")
                : "todas las ubicaciones"}
            </span>
            {dates(inventory) && <span className="inventory-row-dates">{dates(inventory)}</span>}
          </div>
          <small>
            {inventory.status === "draft"
              ? "Pendiente de iniciar"
              : inventory.status}
          </small>
        </button>
      ))}
      </div>
      <InventoryPagination page={safePage} pages={pages} onPage={setPage} />
    </>
  ) : (
    <div className="products-empty">
      <ClipboardList size={30} />
      <strong>{emptyLabel}</strong>
    </div>
  );
}

function InventoryPagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <nav className="inventory-pagination" aria-label="Paginación"><button disabled={page === 1} onClick={() => onPage(page - 1)} type="button"><ChevronLeft size={16}/> Anterior</button><span>Página {page} de {pages}</span><button disabled={page === pages} onClick={() => onPage(page + 1)} type="button">Siguiente <ChevronRight size={16}/></button></nav>;
}

function InventorySession({ inventory: initial, catalog, onClose, onPrevious, onNext, readOnly = false, returnLabel, onMessage }: { inventory: ProductInventory; catalog: CatalogProduct[]; onClose: (inventory: ProductInventory) => void; onPrevious?: () => void; onNext?: () => void; readOnly?: boolean; returnLabel: string; onMessage: (message: string) => void }) {
  const [inventory, setInventory] = useState(initial);
  const [operatorName, setOperatorName] = useState(initial.operator?.name || "");
  const [activeLocation, setActiveLocation] = useState("");
  const [scan, setScan] = useState("");
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [savingCount, setSavingCount] = useState(false);
  const [pendingListOpen, setPendingListOpen] = useState(false);
  const [countedListOpen, setCountedListOpen] = useState(true);
  const [pendingVisible, setPendingVisible] = useState(50);
  const [countedVisible, setCountedVisible] = useState(50);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationVisible, setLocationVisible] = useState(50);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [productImage, setProductImage] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastCameraCodeRef = useRef("");
  const detectorBusyRef = useRef(false);
  const operator = () => ({ id: inventory.operator?.id || `manual-${operatorName.trim().toLowerCase().replace(/\s+/g, "-")}`, code: inventory.operator?.code || "MANUAL", name: operatorName.trim() });
  const effectiveCounts = useMemo(() => {
    const byLine = new Map<string, ProductInventory["counts"][number]>();
    for (const count of inventory.counts) {
      const key = `${count.productId}:${count.locationCode}`;
      if (!byLine.has(key) || (byLine.get(key)?.revision || 1) <= (count.revision || 1)) byLine.set(key, count);
    }
    return [...byLine.values()];
  }, [inventory.counts]);
  const currentCount = (productId: number, locationCode: string) => effectiveCounts.find((item) => item.productId === productId && item.locationCode === locationCode);
  const navigation = <nav className="inventory-detail-nav" aria-label="Navegación de inventarios"><button onClick={() => onClose(inventory)} type="button"><ArrowLeft size={16}/> Volver a {returnLabel}</button><span>{onPrevious && <button aria-label="Inventario anterior" onClick={onPrevious} type="button"><ChevronLeft size={18}/></button>}{onNext && <button aria-label="Inventario siguiente" onClick={onNext} type="button"><ChevronRight size={18}/></button>}</span></nav>;
  const begin = async () => { if (!operatorName.trim()) return onMessage("Indica el operario antes de empezar"); void enableFeedback(); try { const updated = await odooClient.inventoryAction(inventory.id, "start", { operator: operator() }); setInventory(updated); } catch (error) { onMessage(error instanceof Error ? error.message : "No se pudo iniciar"); } };
  const closeCamera = () => {
    if (scanTimerRef.current !== null) window.clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    lastCameraCodeRef.current = "";
    setCameraOpen(false);
  };
  useEffect(() => () => closeCamera(), []);
  const playTone = (context: AudioContext, success: boolean) => {
    const notes = success ? [880, 1320] : [210, 145, 210];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * (success ? 0.12 : 0.16);
      oscillator.type = success ? "triangle" : "sawtooth";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(success ? 0.48 : 0.65, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + (success ? 0.25 : 0.15));
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + (success ? 0.26 : 0.16));
    });
  };
  const enableFeedback = async () => {
    try {
      const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) { setCameraMessage("Este navegador no permite avisos de sonido."); return; }
      const context = audioContextRef.current ?? new Audio();
      audioContextRef.current = context;
      await context.resume();
      if ("vibrate" in navigator) navigator.vibrate(80);
    } catch { /* Algunos navegadores solo permiten audio tras el primer toque. */ }
  };
  const feedback = (success: boolean) => {
    if ("vibrate" in navigator) navigator.vibrate(success ? 70 : [160, 80, 240]);
    try {
      const context = audioContextRef.current;
      if (context?.state === "running") playTone(context, success);
      else void enableFeedback();
    } catch { /* Vibración sigue disponible aunque el navegador bloquee audio. */ }
  };
  // `getUserMedia` resolves before React has mounted the conditional <video>.
  // Assigning the stream in a timeout was racy on mobile and resulted in a
  // black camera frame. Bind and play only once the video element exists.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraOpen || !video || !stream) return;
    video.srcObject = stream;
    void video.play().catch((error) => {
      setCameraMessage(error instanceof Error ? `No se pudo mostrar la cámara: ${error.message}` : "No se pudo mostrar la cámara");
    });
  }, [cameraOpen]);
  const resolve = (rawCode = scan) => {
    try {
      const code = String(rawCode || "").trim();
      if (!code) return;
      const normalized = code.toLocaleLowerCase();
      if (/^[A-Z]+\d+\d{2}$/.test(code.toUpperCase())) { const location = code.toUpperCase(); if (inventory.scope.allowedLocationCodes.length && !inventory.scope.allowedLocationCodes.includes(location)) { feedback(false); return onMessage("Ubicación fuera del alcance de este inventario"); } feedback(true); setActiveLocation(location); setScan(""); setLocationQuery(""); onMessage(`Ubicación activa: ${location}`); return; }
      // Odoo can return a reference or barcode as a number on older records.
      // Normalize every candidate before comparing so a manual SKU can never
      // break the React screen.
      const found = catalog.find((item) => [item.reference, item.barcode, item.id].some((value) => String(value ?? "").trim().toLocaleLowerCase() === normalized));
      if (!found) { feedback(false); return onMessage(`No se encontró el producto “${code}”`); }
      if (!activeLocation) { feedback(false); return onMessage("Primero escanea una ubicación"); }
      const zoneProducts = inventory.scope.plannedProductIdsByLocation?.[activeLocation];
      if (!inventory.plannedProductIds.includes(found.id) || (zoneProducts && !zoneProducts.includes(found.id))) { feedback(false); return onMessage("Producto fuera del alcance de esta ubicación"); }
      const current = currentCount(found.id, activeLocation);
      feedback(true); setProduct(found); setQuantity(current?.quantity ?? found.onHand ?? 0); setScan(""); setProductImage(""); closeCamera(); onMessage("");
    } catch (error) {
      setScan("");
      onMessage(error instanceof Error ? `No se pudo abrir el producto: ${error.message}` : "No se pudo abrir el producto");
    }
  };
  const openCamera = async () => {
    if (!("BarcodeDetector" in window)) { setCameraMessage("Este navegador no permite leer QR/EAN con cámara. Usa Chrome actualizado o el lector USB."); return; }
    try {
      const Detector = (window as any).BarcodeDetector;
      const desiredFormats = ["qr_code", "ean_13", "ean_8", "code_128", "code_39"];
      const supportedFormats = typeof Detector.getSupportedFormats === "function" ? await Detector.getSupportedFormats() : desiredFormats;
      const formats = desiredFormats.filter((format) => supportedFormats.includes(format));
      if (!formats.length) { setCameraMessage("Este móvil no ofrece lectura QR/EAN por cámara. Usa Chrome actualizado o el lector USB."); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = stream; setCameraOpen(true); setCameraMessage("");
      const detector = new Detector({ formats });
      scanTimerRef.current = window.setInterval(async () => { const video = videoRef.current; if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || detectorBusyRef.current) return; detectorBusyRef.current = true; try { const detected = await detector.detect(video); const code = detected[0]?.rawValue?.trim(); if (!code) { lastCameraCodeRef.current = ""; return; } if (code === lastCameraCodeRef.current) return; lastCameraCodeRef.current = code; resolve(code); } catch { /* The next frame retries automatically. */ } finally { detectorBusyRef.current = false; } }, 180);
    } catch (error) { setCameraMessage(error instanceof Error ? `No se pudo abrir la cámara: ${error.message}` : "No se pudo abrir la cámara"); closeCamera(); }
  };
  useEffect(() => { if (!product) return; let live = true; void odooClient.getProductCatalogDetail(product.id).then((detail) => { if (live) setProductImage(detail.image || ""); }).catch(() => { if (live) setProductImage(""); }); return () => { live = false; }; }, [product]);
  const accept = async () => {
    if (!product || !activeLocation) return;
    setSavingCount(true);
    try {
      const updated = await odooClient.saveInventoryCount(inventory.id, {
        productId: product.id,
        locationCode: activeLocation,
        quantity,
        operator: operator(),
      });
      setInventory(updated);
      setProduct(null);
      setQuantity(0);
      onMessage("Cantidad guardada.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSavingCount(false);
    }
  };
  const finish = async () => { try { const updated = await odooClient.inventoryAction(inventory.id, "review"); onClose(updated); } catch (error) { onMessage(error instanceof Error ? error.message : "No se pudo finalizar"); } };
  const rows = catalog.filter((item) => inventory.plannedProductIds.includes(item.id));
  const activeLocationProducts = rows.filter((item) => {
    const zoneProducts = inventory.scope.plannedProductIdsByLocation?.[activeLocation];
    const matchesZone = inventory.scope.type === "locations"
      ? (item.physicalLocations || []).some((code) => code.toUpperCase() === activeLocation)
      : !zoneProducts || zoneProducts.includes(item.id);
    return matchesZone;
  });
  const locationRows = activeLocationProducts.filter((item) => {
    const text = `${item.reference} ${item.name} ${item.barcode}`.toLowerCase();
    return !locationQuery || text.includes(locationQuery.toLowerCase());
  });
  const activeProductIndex = product
    ? activeLocationProducts.findIndex((item) => item.id === product.id)
    : -1;
  const manualMatches = locationRows.filter((item) => {
    const text = `${item.reference} ${item.name} ${item.barcode}`.toLocaleLowerCase();
    return text.includes(manualQuery.trim().toLocaleLowerCase());
  }).slice(0, 20);
  const openProduct = (item: CatalogProduct) => {
    const current = currentCount(item.id, activeLocation);
    setProduct(item);
    setQuantity(current?.quantity ?? item.onHand ?? 0);
    setProductImage("");
    closeCamera();
    onMessage("");
  };
  const openAdjacentProduct = (direction: -1 | 1) => {
    const savedQuantity = product && activeLocation
      ? currentCount(product.id, activeLocation)?.quantity ?? product.onHand ?? 0
      : quantity;
    if (quantity !== savedQuantity) {
      onMessage("Guarda o cancela la cantidad antes de cambiar de producto");
      return;
    }
    const next = activeLocationProducts[activeProductIndex + direction];
    if (next) openProduct(next);
  };
  const openPendingProduct = (item: CatalogProduct) => openProduct(item);
  const pendingRows = activeLocation
    ? activeLocationProducts.filter((item) => !effectiveCounts.some((count) => count.productId === item.id && count.locationCode === activeLocation))
    : rows.filter((item) => !effectiveCounts.some((count) => count.productId === item.id));
  const countedRows = [...effectiveCounts].sort(
    (left, right) => left.countedAt.localeCompare(right.countedAt),
  );
  const updateCount = async (productId: number, locationCode: string, nextQuantity: number) => {
    try {
      const updated = await odooClient.saveInventoryCount(inventory.id, {
        productId,
        locationCode,
        quantity: Math.max(0, Math.floor(nextQuantity || 0)),
        operator: operator(),
      });
      setInventory(updated);
      onMessage("Cantidad corregida");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "No se pudo corregir la cantidad");
    }
  };
  if (inventory.status === "draft") return <section className="inventory-session">{navigation}<header><p className="eyebrow">INVENTARIO EN CURSO</p><h1>{inventory.name}</h1><p>Identifica al operario una vez para toda la sesión.</p></header><label>Operario<input autoFocus value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="Nombre o código de operario" /></label><button className="primary-button" onClick={() => void begin()} type="button"><Users size={16} /> Empezar inventario</button></section>;
  if (readOnly || inventory.status === "review" || inventory.status === "validated" || inventory.status === "finalized") return <InventoryReview key={inventory.id} inventory={inventory} catalog={rows} onClose={onClose} onPrevious={onPrevious} onNext={onNext} readOnly={readOnly} returnLabel={returnLabel} onUpdate={setInventory} onMessage={onMessage} />;
  if (product) return <section className="inventory-product-count-screen">{navigation}<header><p className="eyebrow">CONTEO DE PRODUCTO</p><span className="inventory-location-chip"><MapPin size={15}/> {activeLocation}</span></header><nav className="inventory-product-navigation" aria-label="Navegación entre productos de la ubicación"><button aria-label="Producto anterior" disabled={savingCount || activeProductIndex <= 0} onClick={() => openAdjacentProduct(-1)} type="button"><ChevronLeft size={20}/> Anterior</button><span>{activeProductIndex + 1} de {activeLocationProducts.length}</span><button aria-label="Producto siguiente" disabled={savingCount || activeProductIndex < 0 || activeProductIndex >= activeLocationProducts.length - 1} onClick={() => openAdjacentProduct(1)} type="button">Siguiente <ChevronRight size={20}/></button></nav><article className="inventory-product-hero"><div className="inventory-product-photo">{productImage ? <img src={`data:image/png;base64,${productImage}`} alt={product.name}/> : <ImageOff size={36}/>}</div><div><strong>{product.name}</strong><small>{product.reference || product.barcode || "Sin referencia"}</small><p>Stock Odoo: <b>{product.onHand}</b></p></div></article><div className="inventory-quantity-card"><span>Cantidad física contada</span><div className="inventory-quantity"><button aria-label="Restar una unidad" disabled={savingCount} onClick={() => setQuantity((value) => Math.max(0, value - 1))} type="button"><Minus size={20}/></button><input aria-label="Cantidad física" disabled={savingCount} inputMode="numeric" min="0" onChange={(event) => setQuantity(Math.max(0, Math.floor(Number(event.target.value) || 0)))} type="number" value={quantity}/><button aria-label="Sumar una unidad" disabled={savingCount} onClick={() => setQuantity((value) => value + 1)} type="button">+</button></div></div><button className="primary-button inventory-save-next" disabled={savingCount} onClick={() => void accept()} type="button"><Check size={18}/> {savingCount ? "Guardando…" : "Guardar"}</button><button className="inventory-cancel-count" disabled={savingCount} onClick={() => setProduct(null)} type="button">Cancelar</button></section>;
  return (
    <section className="inventory-session">
      {navigation}
      <header><p className="eyebrow">INVENTARIO EN CURSO · {inventory.operator?.name}</p><h1>{activeLocation ? `Ubicación ${activeLocation}` : "Escanea una ubicación"}</h1>{activeLocation ? <p>{locationRows.length} productos previstos en esta ubicación</p> : <p>Empieza leyendo el QR de la ubicación.</p>}</header>
      <section className="inventory-camera-screen"><div className="inventory-camera-head"><strong>{activeLocation ? "Producto: cámara o búsqueda manual" : "Escanea o escribe la ubicación"}</strong><span><button aria-label="Abrir cámara" className="inventory-camera-open" onClick={() => void openCamera()} title="Buscar por QR o EAN con cámara" type="button"><Camera size={18}/><span>Abrir cámara</span></button>{activeLocation && <button onClick={() => { closeCamera(); setManualOpen((open) => !open); }} type="button"><Search size={18}/> Añadir manual</button>}</span></div>{cameraMessage && <p>{cameraMessage}</p>}<div className="inventory-scan"><ScanLine size={20}/><input value={scan} onFocus={() => void enableFeedback()} onChange={(event) => setScan(event.target.value)} onKeyDown={(event) => event.key === "Enter" && resolve()} placeholder={activeLocation ? "Pega o escribe referencia, SKU o EAN" : "Escribe código de ubicación"}/><button onClick={() => resolve()} type="button">Buscar</button></div></section>
      {cameraOpen && <section className="catalog-camera-search inventory-camera-search" aria-label="Buscar producto con cámara"><div><strong>{activeLocation ? "Apunta al QR o EAN del producto" : "Apunta al QR de la ubicación"}</strong><button aria-label="Cerrar cámara" onClick={closeCamera} type="button"><X size={18}/></button></div><video ref={videoRef} autoPlay playsInline muted onPointerDown={() => void enableFeedback()}/>{cameraMessage && <p>{cameraMessage}</p>}</section>}
      {activeLocation && manualOpen && <section className="inventory-manual-picker"><div><strong>Buscar producto para {activeLocation}</strong><button onClick={() => setManualOpen(false)} type="button"><X size={16}/> Cerrar</button></div><label><Search size={16}/><input autoFocus value={manualQuery} onChange={(event) => setManualQuery(event.target.value)} placeholder="Referencia, nombre o EAN" /></label><div>{manualQuery.trim() ? manualMatches.map((item) => <button key={item.id} onClick={() => { openProduct(item); setManualOpen(false); setManualQuery(""); }} type="button"><span><strong>{item.reference || "Sin referencia"}</strong><small>{item.name}</small></span><b>{item.barcode || "Seleccionar"}</b></button>) : <p>Escribe al menos una referencia, nombre o EAN.</p>}{manualQuery.trim() && !manualMatches.length && <p>No hay productos del alcance que coincidan.</p>}</div></section>}
      {activeLocation && !product && <section className="inventory-location-detail"><div className="inventory-location-toolbar"><label><Search size={16}/><input value={locationQuery} onChange={(event) => { setLocationQuery(event.target.value); setLocationVisible(50); }} placeholder="Buscar producto en esta ubicación"/></label><strong>{locationRows.length}</strong></div><div className="inventory-location-products">{locationRows.slice(0, locationVisible).map((item) => { const current = currentCount(item.id, activeLocation); return <button key={item.id} onClick={() => openProduct(item)} type="button"><span><strong>{item.reference || "Sin referencia"}</strong><small>{item.name}</small></span><b>{current ? `${current.quantity} contado` : "Contar"}</b></button>; })}</div>{locationVisible < locationRows.length && <button className="inventory-load-more" onClick={() => setLocationVisible((value) => value + 50)} type="button">Ver 50 más</button>}{!locationRows.length && <p className="products-empty">No hay productos previstos en esta ubicación.</p>}</section>}
      <div className="inventory-progress-lists">
        <details open={pendingListOpen} onToggle={(event) => setPendingListOpen(event.currentTarget.open)}>
          <summary>Productos pendientes por contar <strong>{pendingRows.length}</strong></summary>
          {pendingListOpen && <div>{pendingRows.length ? <>{pendingRows.slice(0, pendingVisible).map((item) => <button className="inventory-pending-product" key={item.id} onClick={() => openPendingProduct(item)} type="button"><span><strong>{item.reference || "Sin referencia"}</strong><small>{item.name}</small></span><b>Contar</b></button>)}{pendingVisible < pendingRows.length && <button className="inventory-load-more" onClick={() => setPendingVisible((value) => value + 50)} type="button">Ver 50 más</button>}</> : <p>Todos los productos previstos están contados.</p>}</div>}
        </details>
        <details open={countedListOpen} onToggle={(event) => setCountedListOpen(event.currentTarget.open)}>
          <summary>Productos ya contados · orden cronológico <strong>{countedRows.length}</strong></summary>
          {countedListOpen && <div>{countedRows.length ? <>{countedRows.slice(0, countedVisible).map((count) => { const item = catalog.find((candidate) => candidate.id === count.productId); return <p className="inventory-counted-line" key={`${count.productId}-${count.locationCode}-${count.revision}`}><span><strong>{item?.reference || "Sin referencia"}</strong>{item?.name || "Producto"} · {count.locationCode}<small>{new Date(count.countedAt).toLocaleString("es-ES")}</small></span><input aria-label={`Cantidad contada de ${item?.name || "producto"}`} defaultValue={count.quantity} min="0" onBlur={(event) => { const next = Math.max(0, Math.floor(Number(event.target.value) || 0)); if (next !== count.quantity) void updateCount(count.productId, count.locationCode, next); }} type="number" /></p>; })}{countedVisible < countedRows.length && <button className="inventory-load-more" onClick={() => setCountedVisible((value) => value + 50)} type="button">Ver 50 más</button>}</> : <p>Aún no hay productos contados.</p>}</div>}
        </details>
      </div>
      <button className="inventory-finish" onClick={() => void finish()} type="button">Finalizar conteo</button>
    </section>
  );
}

function InventoryReview({ inventory, catalog, onClose, onPrevious, onNext, readOnly = false, returnLabel, onUpdate, onMessage }: { inventory: ProductInventory; catalog: CatalogProduct[]; onClose: (inventory: ProductInventory) => void; onPrevious?: () => void; onNext?: () => void; readOnly?: boolean; returnLabel: string; onUpdate: (inventory: ProductInventory) => void; onMessage: (message: string) => void }) {
  const [actionOperator, setActionOperator] = useState(inventory.operator?.name || "");
  const [recountIds, setRecountIds] = useState<number[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [productPage, setProductPage] = useState(1);
  const actionOperatorRecord = () => ({ id: `manual-${actionOperator.trim().toLowerCase().replace(/\s+/g, "-")}`, code: "MANUAL", name: actionOperator.trim() });
  const effectiveCounts = useMemo(() => {
    const byLine = new Map<string, ProductInventory["counts"][number]>();
    for (const count of inventory.counts) {
      const key = `${count.productId}:${count.locationCode}`;
      if (!byLine.has(key) || (byLine.get(key)?.revision || 1) <= (count.revision || 1)) byLine.set(key, count);
    }
    return [...byLine.values()];
  }, [inventory.counts]);
  const entriesFor = (id: number) => effectiveCounts.filter((item) => item.productId === id);
  const totals = (id: number) => entriesFor(id).reduce((sum, item) => sum + item.quantity, 0);
  const counted = new Set(effectiveCounts.map((item) => item.productId)).size; const differences = catalog.filter((item) => totals(item.id) !== item.onHand).length;
  const filteredCatalog = useMemo(() => {
    const normalized = productQuery.trim().toLocaleLowerCase();
    if (!normalized) return catalog;
    return catalog.filter((item) => `${item.reference} ${item.name} ${item.barcode}`.toLocaleLowerCase().includes(normalized));
  }, [catalog, productQuery]);
  const productPages = Math.max(1, Math.ceil(filteredCatalog.length / 50));
  const safeProductPage = Math.min(productPage, productPages);
  const visibleProducts = filteredCatalog.slice((safeProductPage - 1) * 50, safeProductPage * 50);
  const validate = async () => { if (!actionOperator.trim()) return onMessage("Indica el operario que valida"); try { onUpdate(await odooClient.inventoryAction(inventory.id, "validate", { operator: actionOperatorRecord() })); } catch (error) { onMessage(error instanceof Error ? error.message : "No se pudo validar"); } };
  const sendToOdoo = async () => { if (!actionOperator.trim()) return onMessage("Indica el operario que envía a Odoo"); try { onClose(await odooClient.sendInventoryToOdoo(inventory.id, actionOperatorRecord())); } catch (error) { onMessage(error instanceof Error ? error.message : "No se pudo enviar a Odoo"); } };
  const startRecount = async () => { if (!recountIds.length) return onMessage("Selecciona al menos un producto para recontar"); try { onUpdate(await odooClient.startInventoryRecount(inventory.id, recountIds)); } catch (error) { onMessage(error instanceof Error ? error.message : "No se pudo abrir el reconteo"); } };
  const navigation = <nav className="inventory-detail-nav" aria-label="Navegación de inventarios"><button onClick={() => onClose(inventory)} type="button"><ArrowLeft size={16}/> Volver a {returnLabel}</button><span>{onPrevious && <button aria-label="Inventario anterior" onClick={onPrevious} type="button"><ChevronLeft size={18}/></button>}{onNext && <button aria-label="Inventario siguiente" onClick={onNext} type="button"><ChevronRight size={18}/></button>}</span></nav>;
  const isFinal = inventory.status === "finalized";
  return <section className="inventory-review">{navigation}<header><p className="eyebrow">{readOnly ? "HISTORIAL DE INVENTARIO" : isFinal ? "INVENTARIO FINALIZADO" : "REVISIÓN DEL INVENTARIO"}</p><h1>{inventory.name}</h1><p>{catalog.length} previstos · {counted} contados · {catalog.length - counted} pendientes · {differences} con diferencias</p></header>{readOnly ? <p className="inventory-locked-note"><LockKeyhole size={16}/> Consulta histórica: las cantidades no se pueden modificar desde esta vista.</p> : inventory.status === "review" && <p className="inventory-locked-note"><LockKeyhole size={16}/> Conteo bloqueado tras finalizar. Selecciona productos y abre un reconteo si necesitas corregirlos.</p>}{isFinal && <p className="inventory-odoo-status"><Check size={16}/> Enviado a Odoo {inventory.sentAt ? new Date(inventory.sentAt).toLocaleString("es-ES") : ""} · {inventory.odooResults?.filter((result) => result.changed).length || 0} diferencias aplicadas.</p>}<div className="inventory-review-toolbar"><label><Search size={16}/><input value={productQuery} onChange={(event) => { setProductQuery(event.target.value); setProductPage(1); }} placeholder="Buscar producto en este inventario" /></label><small>{filteredCatalog.length} productos</small></div><div className="table-scroll"><table><thead><tr>{inventory.status === "review" && !readOnly && <th>Recontar</th>}<th>Referencia</th><th>Producto</th><th>Ubicación/es</th><th>Stock Odoo</th><th>Contado</th><th>Diferencia</th><th>Operario</th></tr></thead><tbody>{visibleProducts.map((item) => { const entries = entriesFor(item.id); const total = totals(item.id); const selected = recountIds.includes(item.id); return <tr key={item.id}>{inventory.status === "review" && !readOnly && <td><input aria-label={`Seleccionar ${item.name} para reconteo`} checked={selected} onChange={() => setRecountIds((current) => selected ? current.filter((id) => id !== item.id) : [...current, item.id])} type="checkbox" /></td>}<td>{item.reference}</td><td>{item.name}</td><td>{entries.map((entry) => entry.locationCode).join(", ") || "Pendiente"}</td><td>{item.onHand}</td><td>{entries.length ? total : "—"}</td><td>{entries.length ? total - item.onHand : "—"}</td><td>{entries[0]?.operator.name || "—"}</td></tr>; })}</tbody></table></div><InventoryPagination page={safeProductPage} pages={productPages} onPage={setProductPage} />{!readOnly && inventory.status !== "finalized" && <div className="inventory-final-actions">{inventory.status === "review" ? <><button className="secondary-button" disabled={!recountIds.length} onClick={() => void startRecount()} type="button"><RotateCcw size={16}/> Abrir reconteo ({recountIds.length})</button><label>Operario que valida<input value={actionOperator} onChange={(event) => setActionOperator(event.target.value)} placeholder="Nombre o código"/></label><button className="primary-button" onClick={() => void validate()} type="button">Validar inventario</button></> : <><label>Operario que envía a Odoo<input value={actionOperator} onChange={(event) => setActionOperator(event.target.value)} placeholder="Nombre o código"/></label><button className="primary-button inventory-send-odoo" onClick={() => void sendToOdoo()} type="button">Finalizar y enviar a Odoo</button></>}<button className="secondary-button" onClick={() => onClose(inventory)} type="button">Volver</button></div>}</section>;
}
