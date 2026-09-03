import { useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Camera,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type {
  CatalogProduct,
  CatalogProductDetail,
  CatalogStore,
  InventoryScope,
  ProductLocation,
} from "../../services/odooTypes";
import {
  createProductLabelImage,
  ProductScannerView,
} from "./ProductScannerView";
import {
  getSavedQzLabelPrinter,
  printImageLabelWithQzTray,
} from "../expeditions/ExpeditionsView";

const empty: CatalogStore = {
  products: [],
  sync: { status: "never", full: false, scanned: 0, changed: 0 },
};
const fmt = (value: number, unit = "") =>
  `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value)}${unit ? ` ${unit}` : ""}`;

export function ProductsCatalogView({
  startScanner = false,
  scannerPreset,
  onSendToInventory,
}: {
  startScanner?: boolean;
  scannerPreset?: "labels";
  onSendToInventory?: (scope: InventoryScope) => void;
} = {}) {
  const [catalog, setCatalog] = useState<CatalogStore>(empty);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [supplier, setSupplier] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingLocations, setSyncingLocations] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const [detail, setDetail] = useState<CatalogProductDetail | null>(null);
  const [locations, setLocations] = useState<ProductLocation[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [images, setImages] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<{
    code: string;
    quantity: string;
    preferred: boolean;
    replenishmentMin: string;
    adjustOdoo: boolean;
  } | null>(null);
  const [transfer, setTransfer] = useState<{
    fromCode: string;
    toCode: string;
    quantity: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [printingLabel, setPrintingLabel] = useState(false);
  const [barcodeEditor, setBarcodeEditor] = useState<string | null>(null);
  const [scanner, setScanner] = useState(startScanner);
  const [cameraSearchOpen, setCameraSearchOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState<
    "ids" | "filtered" | "all"
  >("ids");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const load = async () => {
    setLoading(true);
    try {
      setCatalog(await odooClient.getProductCatalog());
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo cargar Productos",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const sync = async () => {
    setSyncing(true);
    setMessage("");
    try {
      setCatalog(
        await odooClient.syncProductCatalog(catalog.sync.status === "never"),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo sincronizar");
    } finally {
      setSyncing(false);
    }
  };
  const syncLocationMovements = async () => {
    setSyncingLocations(true);
    setMessage("");
    try {
      const result = await odooClient.syncProductLocationMovements();
      await load();
      const warning = result.warnings?.[0];
      setMessage(
        warning ||
          `Movimientos revisados: ${result.processed || 0}; aplicados: ${result.applied || 0}; ya procesados: ${result.skipped || 0}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron sincronizar los movimientos");
    } finally {
      setSyncingLocations(false);
    }
  };
  const suppliers = useMemo(
    () =>
      [...new Set(catalog.products.flatMap((p) => p.supplierNames || []))].sort(
        (a, b) => a.localeCompare(b, "es"),
      ),
    [catalog.products],
  );
  const rows = useMemo(
    () =>
      catalog.products.filter((p) => {
        const needle = query.trim().toLowerCase();
        if (
          needle &&
          ![p.name, p.reference, p.barcode].some((v) =>
            v.toLowerCase().includes(needle),
          )
        )
          return false;
        if (supplier && !(p.supplierNames || []).includes(supplier))
          return false;
        if (
          locationFilter &&
          !p.physicalLocations.includes(locationFilter.trim().toUpperCase())
        )
          return false;
        if (filter === "stock") return p.onHand > 0;
        if (filter === "empty") return p.onHand <= 0;
        if (filter === "mto") return p.mto;
        if (filter === "ean") return !p.barcode;
        if (filter === "location") return p.physicalLocations.length === 0;
        if (filter === "restock")
          return Boolean(p.locationSummary?.needsReplenishment);
        if (filter === "kit") return p.isKit;
        return true;
      }),
    [catalog.products, filter, locationFilter, query, supplier],
  );
  const withoutEan = catalog.products.filter((p) => !p.barcode).length;
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const selectedProducts =
    selectionMode === "all"
      ? catalog.products
      : selectionMode === "filtered"
        ? rows
        : catalog.products.filter((product) =>
            selectedIds.includes(product.id),
          );
  const isProductSelected = (id: number) =>
    selectionMode === "all" ||
    selectionMode === "filtered" ||
    selectedIds.includes(id);
  const selectionScope: InventoryScope = {
    type: locationFilter.trim()
      ? "locations"
      : selectionMode === "all"
        ? "general"
        : "products",
    productSelection:
      locationFilter.trim() && !query && !supplier && filter === "all"
        ? { mode: "all" }
        : selectionMode === "all"
          ? { mode: "all" }
          : selectionMode === "filtered"
            ? { mode: "filtered", query, supplier, filter }
            : { mode: "ids", ids: selectedIds },
    allowedLocationCodes: locationFilter.trim()
      ? [locationFilter.trim().toUpperCase()]
      : [],
  };
  const toggleProduct = (id: number) => {
    setSelectionMode("ids");
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };
  const selectPage = () => {
    setSelectionMode("ids");
    setSelectedIds((current) => {
      const pageIds = visibleRows.map((product) => product.id);
      return pageIds.every((id) => current.includes(id))
        ? current.filter((id) => !pageIds.includes(id))
        : [...new Set([...current, ...pageIds])];
    });
  };
  const downloadCsv = () => {
    const rowsCsv = [
      ["Referencia", "Producto", "EAN", "Stock Odoo"],
      ...selectedProducts.map((product) => [
        product.reference,
        product.name,
        product.barcode,
        String(product.onHand),
      ]),
    ]
      .map((row) =>
        row.map((value) => `"${value.replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([rowsCsv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "productos-seleccionados.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const printSelection = () => {
    // `noopener` makes window.open return null in several browsers, which was
    // the cause of the blank PDF/print window in LAB.
    const popup = window.open("", "_blank");
    if (!popup) {
      setMessage("El navegador ha bloqueado la ventana. Permite ventanas emergentes para guardar el PDF.");
      return;
    }
    const lines = selectedProducts
      .map(
        (product) =>
          `<tr><td>${escapePrintHtml(product.reference || "—")}</td><td>${escapePrintHtml(product.name)}</td><td>${escapePrintHtml(product.barcode || "—")}</td><td>${escapePrintHtml(String(product.onHand))}</td></tr>`,
      )
      .join("");
    popup.document.write(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Productos seleccionados</title><style>body{font:12px Arial;padding:16px;color:#172033}h1{font-size:18px}p{color:#475569}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left}th{background:#f1f5f9}</style></head><body><h1>Productos seleccionados</h1><p>${selectedProducts.length} productos · usa «Guardar como PDF» en el diálogo de impresión.</p><table><thead><tr><th>Referencia</th><th>Producto</th><th>EAN</th><th>Stock</th></tr></thead><tbody>${lines}</tbody></table></body></html>`,
    );
    popup.document.close();
    popup.focus();
    popup.print();
  };
  const sendSelectionToInventory = () => {
    if (!selectedProducts.length) return;
    // Persist the resolved ids, not only the current filter expression. This
    // keeps the exact selection when the inventory creation screen loads.
    const resolvedScope: InventoryScope = {
      ...selectionScope,
      productSelection: {
        mode: "ids",
        ids: selectedProducts.map((product) => product.id),
      },
    };
    sessionStorage.setItem(
      "products.inventory.createScope",
      JSON.stringify({
        productSelection: resolvedScope.productSelection,
        allowedLocationCodes: resolvedScope.allowedLocationCodes,
      }),
    );
    onSendToInventory?.(resolvedScope);
  };
  useEffect(() => setPage(1), [query, filter, supplier, locationFilter]);
  useEffect(() => {
    const missing = visibleRows.map((p) => p.id).filter((id) => !images[id]);
    if (missing.length)
      void odooClient
        .getProductCatalogImages(missing)
        .then((next) => setImages((current) => ({ ...current, ...next })))
        .catch(() => undefined);
  }, [page, query, filter, supplier, locationFilter, catalog.updatedAt]);
  const openDetail = async (product: CatalogProduct) => {
    setSelected(product);
    setDetail(null);
    setLocations([]);
    setEditor(null);
    setBarcodeEditor(null);
    setDetailLoading(true);
    try {
      const [nextDetail, nextLocations] = await Promise.all([
        odooClient.getProductCatalogDetail(product.id),
        odooClient.getProductLocations(product.id),
      ]);
      setDetail(nextDetail);
      setLocations(nextLocations);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo cargar el detalle",
      );
    } finally {
      setDetailLoading(false);
    }
  };
  const searchWithCamera = (code: string) => {
    const normalized = code.trim().toLowerCase();
    const matches = catalog.products.filter((product) =>
      [product.name, product.reference, product.barcode].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
    setQuery(code);
    setCameraSearchOpen(false);
    if (matches.length === 1) void openDetail(matches[0]);
  };
  const saveLocation = async () => {
    if (!selected || !editor) return;
    setSaving(true);
    try {
      const input = {
        productId: selected.id,
        code: editor.code,
        quantity: Number(editor.quantity),
        preferred: editor.preferred,
        replenishmentMin:
          editor.preferred && editor.replenishmentMin !== ""
            ? Number(editor.replenishmentMin)
            : undefined,
      };
      const next = editor.adjustOdoo
        ? await odooClient.adjustProductLocationAndOdoo(input)
        : await odooClient.saveProductLocation(input);
      setLocations(next);
      setEditor(null);
      await load();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo guardar la ubicación",
      );
    } finally {
      setSaving(false);
    }
  };
  const saveTransfer = async () => {
    if (!selected || !transfer) return;
    setSaving(true);
    try {
      const next = await odooClient.transferProductLocation(
        selected.id,
        transfer.fromCode,
        transfer.toCode,
        Number(transfer.quantity),
      );
      setLocations(next);
      setTransfer(null);
      await load();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo registrar la reposición",
      );
    } finally {
      setSaving(false);
    }
  };
  const removeLocation = async (code: string) => {
    if (!selected || !window.confirm(`¿Eliminar la ubicación ${code}?`)) return;
    setSaving(true);
    try {
      const next = await odooClient.removeProductLocation(selected.id, code);
      setLocations(next);
      if (editor?.code === code) setEditor(null);
      await load();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo eliminar la ubicación",
      );
    } finally {
      setSaving(false);
    }
  };
  const saveBarcode = async () => {
    if (!selected || barcodeEditor === null || !barcodeEditor.trim()) return;
    setSaving(true);
    try {
      const next = await odooClient.updateProductBarcode(
        selected.id,
        barcodeEditor.trim(),
      );
      setDetail((current) =>
        current
          ? { ...current, barcode: next.barcode || barcodeEditor.trim() }
          : current,
      );
      setSelected((current) =>
        current
          ? { ...current, barcode: next.barcode || barcodeEditor.trim() }
          : current,
      );
      setCatalog((current) => ({
        ...current,
        products: current.products.map((product) =>
          product.id === selected.id
            ? { ...product, barcode: next.barcode || barcodeEditor.trim() }
            : product,
        ),
      }));
      setBarcodeEditor(null);
      setMessage("EAN actualizado en Odoo y Dashboard");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo actualizar el EAN",
      );
    } finally {
      setSaving(false);
    }
  };
  const removeBarcode = async () => {
    if (!selected || !detail?.barcode) return;
    if (!window.confirm(`¿Eliminar el EAN ${detail.barcode} de ${detail.name}?`)) return;
    setSaving(true);
    try {
      await odooClient.updateProductBarcode(selected.id, "");
      setDetail((current) => (current ? { ...current, barcode: "" } : current));
      setSelected((current) => (current ? { ...current, barcode: "" } : current));
      setCatalog((current) => ({
        ...current,
        products: current.products.map((product) =>
          product.id === selected.id ? { ...product, barcode: "" } : product,
        ),
      }));
      setBarcodeEditor(null);
      setMessage("EAN eliminado en Odoo y Dashboard");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo eliminar el EAN");
    } finally {
      setSaving(false);
    }
  };
  const printLabel = async () => {
    if (!selected) return;
    setPrintingLabel(true);
    try {
      await printImageLabelWithQzTray(
        await createProductLabelImage(selected),
        `Producto ${selected.reference || selected.barcode}`,
        getSavedQzLabelPrinter(),
      );
      setMessage("Etiqueta enviada a la impresora seleccionada.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo imprimir la etiqueta",
      );
    } finally {
      setPrintingLabel(false);
    }
  };
  const totalLocated = locations.reduce((sum, item) => sum + item.quantity, 0);
  const selectedPreferred = locations.find((item) => item.preferred);
  if (scanner)
    return (
      <ProductScannerView
        products={catalog.products}
        onBack={() => setScanner(false)}
        onChanged={() => void load()}
        preset={scannerPreset}
      />
    );
  return (
    <section className="products-catalog">
      <header className="products-header">
        <div>
          <p className="eyebrow">PRODUCTOS · LAB</p>
          <h1>Catálogo e inventario</h1>
          <p>
            Datos de Odoo para <strong>ALM/Stock</strong>. Las cantidades por
            ubicación se gestionan en Dashboard.
          </p>
        </div>
        <div className="products-header-actions">
          <button className="secondary-button" onClick={() => setScanner(true)}>
            <ScanLine size={16} />
            Escáner
          </button>
          <button
            className="secondary-button"
            disabled={syncingLocations}
            onClick={() => void syncLocationMovements()}
            title="Aplica una sola vez las entradas y salidas nuevas de Odoo a las ubicaciones preferentes"
          >
            <RefreshCw size={16} className={syncingLocations ? "spin" : ""} />
            {syncingLocations ? "Sincronizando…" : "Movimientos Odoo"}
          </button>
          <button
            className="primary-button"
            disabled={syncing}
            onClick={() => void sync()}
          >
            <RefreshCw size={16} className={syncing ? "spin" : ""} />
            {catalog.sync.status === "never"
              ? "Importar productos"
              : "Actualizar Odoo"}
          </button>
        </div>
      </header>
      {message && <p className="products-message">{message}</p>}
      <div className="products-kpis">
        <Kpi
          label="Productos"
          value={fmt(catalog.products.length)}
          note={catalog.sync.message || "Pendiente de importar"}
        />
        <Kpi label="Sin EAN" value={fmt(withoutEan)} note="Revisión futura" />
        <Kpi
          label="Sin ubicación física"
          value={fmt(
            catalog.products.filter((p) => !p.physicalLocations.length).length,
          )}
          note="Dashboard"
        />
        <Kpi
          label="Kits / BOM"
          value={fmt(catalog.products.filter((p) => p.isKit).length)}
          note="Leídos desde Odoo"
        />
      </div>
      <div className="products-toolbar">
        <label>
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar referencia, EAN o nombre"
          />
          {query && (
            <button
              className="clear-search"
              aria-label="Borrar búsqueda"
              onClick={() => setQuery("")}
            >
              <X size={16} />
            </button>
          )}
          <button
            aria-label="Buscar con cámara"
            className="catalog-camera-button"
            onClick={() => setCameraSearchOpen(true)}
            title="Buscar por QR o EAN con cámara"
            type="button"
          >
            <Camera size={17} />
          </button>
        </label>
        <select className="supplier-filter" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {suppliers.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Todos los productos</option>
          <option value="stock">Con stock</option>
          <option value="empty">Sin stock</option>
          <option value="mto">Bajo pedido / MTO</option>
          <option value="ean">Sin EAN</option>
          <option value="location">Sin ubicación</option>
          <option value="restock">Reposición pendiente</option>
          <option value="kit">Kit / BOM</option>
        </select>
        <input
          aria-label="Filtrar por ubicación"
          onChange={(event) =>
            setLocationFilter(event.target.value.toUpperCase())
          }
          placeholder="Ubicación, ej. A101"
          value={locationFilter}
        />
      </div>
      {cameraSearchOpen && (
        <CatalogCameraSearch
          onClose={() => setCameraSearchOpen(false)}
          onDetected={searchWithCamera}
        />
      )}
      <div className="catalog-selection-actions">
        <span>
          {selectedProducts.length
            ? `${selectedProducts.length} seleccionados`
            : "Selecciona productos"}
        </span>
        <button onClick={selectPage} type="button">
          {visibleRows.length &&
          visibleRows.every((product) => selectedIds.includes(product.id)) &&
          selectionMode === "ids"
            ? "Quitar página"
            : "Página actual"}
        </button>
        <button
          className={selectionMode === "filtered" ? "active" : ""}
          onClick={() => setSelectionMode("filtered")}
          type="button"
        >
          Todos los resultados filtrados
        </button>
        <button
          className={selectionMode === "all" ? "active" : ""}
          onClick={() => setSelectionMode("all")}
          type="button"
        >
          Todo el catálogo
        </button>
        <button
          disabled={!selectedProducts.length}
          onClick={downloadCsv}
          type="button"
        >
          CSV
        </button>
        <button
          disabled={!selectedProducts.length}
          onClick={printSelection}
          type="button"
        >
          PDF
        </button>
        <button
          className="primary-button"
          disabled={!selectedProducts.length}
          onClick={sendSelectionToInventory}
          type="button"
        >
          Enviar a Inventario
        </button>
      </div>
      <div className="products-table-wrap">
        {loading ? (
          <div className="products-empty">Cargando catálogo…</div>
        ) : !catalog.products.length ? (
          <div className="products-empty">
            <Boxes size={30} />
            <strong>Aún no hay productos importados</strong>
            <span>
              Pulsa «Importar productos» para hacer la primera carga desde Odoo.
            </span>
          </div>
        ) : (
          <div className="products-grid" role="table">
            <div className="products-grid-head" role="row">
              <span>
                <input
                  aria-label="Seleccionar página actual"
                  checked={
                    visibleRows.length > 0 &&
                    visibleRows.every((product) => isProductSelected(product.id))
                  }
                  onChange={selectPage}
                  type="checkbox"
                />
              </span>
              <span>Producto</span>
              <span>Referencia</span>
              <span>A mano</span>
              <span>Reservado</span>
              <span>Por recibir</span>
              <span>Pronóstico</span>
              <span>Estado</span>
            </div>
            {visibleRows.map((p) => (
              <div
                className="products-grid-row"
                role="row"
                key={p.id}
                onClick={() => void openDetail(p)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void openDetail(p);
                }}
                tabIndex={0}
              >
                <span className="product-thumb">
                  <input
                    aria-label={`Seleccionar ${p.name}`}
                    checked={isProductSelected(p.id)}
                    onChange={() => toggleProduct(p.id)}
                    onClick={(event) => event.stopPropagation()}
                    type="checkbox"
                  />
                </span>
                <span className="product-name" title={p.name}>
                  {images[p.id] && (
                    <img
                      className="product-list-thumbnail"
                      src={images[p.id]}
                      alt=""
                    />
                  )}
                  {p.name}
                </span>
                <span title={p.reference}>{p.reference || "—"}</span>
                <span>{fmt(p.onHand, p.uom)}</span>
                <span>{fmt(p.reserved, p.uom)}</span>
                <span>{fmt(p.incoming, p.uom)}</span>
                <span>{fmt(p.forecast, p.uom)}</span>
                <span className="product-tags">
                  {p.mto && <i className="tag warn">Bajo pedido</i>}
                  {!p.barcode && <i className="tag">Sin EAN</i>}
                  {p.locationSummary?.needsReplenishment && (
                    <i className="tag danger">Reponer</i>
                  )}
                  {!p.physicalLocations.length && (
                    <i className="tag">Sin ubicación</i>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {catalog.products.length > 0 && (
        <footer className="products-foot">
          <span>
            {rows.length} resultados · página {page} de {pageCount}
          </span>
          <div className="product-pagination">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={page === pageCount}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <span>
            Última sincronización:{" "}
            {catalog.sync.lastFinishedAt
              ? new Date(catalog.sync.lastFinishedAt).toLocaleString("es-ES")
              : "—"}
          </span>
        </footer>
      )}
      {selected && (
        <aside className="product-drawer">
          <div className="drawer-head">
            <strong>Detalle de producto</strong>
            <button onClick={() => setSelected(null)}>
              <X size={18} />
            </button>
          </div>
          {detailLoading ? (
            <p>Cargando detalles…</p>
          ) : (
            detail && (
              <>
                <div className="drawer-product">
                  {detail.image ? (
                    <img src={`data:image/png;base64,${detail.image}`} alt="" />
                  ) : (
                    <Boxes />
                  )}
                  <div>
                    <strong>{detail.name}</strong>
                    <small>{detail.reference || "Sin referencia"}</small>
                    {barcodeEditor === null ? (
                      <div className="drawer-ean">
                        <small>{detail.barcode || "Sin EAN"}</small>
                        <button
                          aria-label="Editar EAN"
                          onClick={() => setBarcodeEditor(detail.barcode)}
                        >
                          <Pencil size={13} />
                        </button>
                        {detail.barcode ? (
                          <button
                            aria-label="Eliminar EAN"
                            disabled={saving}
                            onClick={() => void removeBarcode()}
                            title="Eliminar EAN"
                            type="button"
                          >
                            <Trash2 size={13} />
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="drawer-ean-editor">
                        <input
                          autoFocus
                          value={barcodeEditor}
                          onChange={(event) =>
                            setBarcodeEditor(event.target.value)
                          }
                          placeholder="EAN"
                        />
                        <button
                          className="drawer-action"
                          disabled={saving || !barcodeEditor.trim()}
                          onClick={() => void saveBarcode()}
                        >
                          {saving ? "Guardando…" : "Guardar"}
                        </button>
                        <button
                          className="drawer-link"
                          disabled={saving}
                          onClick={() => setBarcodeEditor(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="drawer-stats">
                  <span>
                    Stock Odoo
                    <strong>{fmt(selected.onHand, selected.uom)}</strong>
                  </span>
                  <span>
                    Total localizado
                    <strong>{fmt(totalLocated, selected.uom)}</strong>
                  </span>
                  <span>
                    Diferencia
                    <strong>
                      {fmt(totalLocated - selected.onHand, selected.uom)}
                    </strong>
                  </span>
                  <span>
                    Bajo pedido<strong>{selected.mto ? "Sí" : "No"}</strong>
                  </span>
                </div>
                <section className="drawer-section">
                  <div className="drawer-section-head">
                    <h3>
                      <MapPin size={15} /> Ubicaciones
                    </h3>
                    <button
                      className="drawer-action"
                      onClick={() =>
                        setEditor({
                          code: "",
                          quantity: "0",
                          preferred: !locations.length,
                          replenishmentMin: "",
                          adjustOdoo: false,
                        })
                      }
                    >
                      <Plus size={15} />
                      Añadir
                    </button>
                  </div>
                  {selectedPreferred && (
                    <p className="preferred-location">
                      Preferente: <strong>{selectedPreferred.code}</strong> ·{" "}
                      {fmt(selectedPreferred.quantity, selected.uom)}
                      {selectedPreferred.replenishmentMin !== undefined && (
                        <>
                          {" "}
                          · mínimo{" "}
                          {fmt(
                            selectedPreferred.replenishmentMin,
                            selected.uom,
                          )}
                        </>
                      )}
                    </p>
                  )}
                  {locations.length ? (
                    <ul className="location-list">
                      {locations.map((item) => (
                        <li key={item.code}>
                          <div>
                            <strong>{item.code}</strong>
                            {item.preferred && <small>Preferente</small>}
                          </div>
                          <span>{fmt(item.quantity, selected.uom)}</span>
                          <button
                            aria-label={`Editar ${item.code}`}
                            onClick={() =>
                              setEditor({
                                code: item.code,
                                quantity: String(item.quantity),
                                preferred: item.preferred,
                                replenishmentMin:
                                  item.replenishmentMin === undefined
                                    ? ""
                                    : String(item.replenishmentMin),
                                adjustOdoo: false,
                              })
                            }
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            aria-label={`Eliminar ${item.code}`}
                            disabled={saving}
                            onClick={() => void removeLocation(item.code)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Sin ubicaciones registradas.</p>
                  )}
                  {editor && (
                    <div className="location-editor">
                      <input
                        value={editor.code}
                        disabled={locations.some(
                          (item) => item.code === editor.code,
                        )}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            code: e.target.value.toUpperCase(),
                          })
                        }
                        placeholder="A101"
                      />
                      <input
                        value={editor.quantity}
                        inputMode="decimal"
                        onChange={(e) =>
                          setEditor({ ...editor, quantity: e.target.value })
                        }
                        placeholder="Cantidad"
                      />
                      <label>
                        <input
                          type="checkbox"
                          checked={editor.preferred}
                          onChange={(e) =>
                            setEditor({
                              ...editor,
                              preferred: e.target.checked,
                            })
                          }
                        />{" "}
                        Preferente
                      </label>
                      <label title="Solo úsalo al descubrir una diferencia real de existencias; los traslados entre baldas no cambian Odoo.">
                        <input
                          type="checkbox"
                          checked={editor.adjustOdoo}
                          onChange={(e) => setEditor({ ...editor, adjustOdoo: e.target.checked })}
                        />{" "}
                        Ajustar también el total en Odoo
                      </label>
                      {editor.preferred && (
                        <input
                          value={editor.replenishmentMin}
                          inputMode="decimal"
                          onChange={(e) =>
                            setEditor({
                              ...editor,
                              replenishmentMin: e.target.value,
                            })
                          }
                          placeholder="Mínimo reposición"
                        />
                      )}
                      <div>
                        <button
                          className="drawer-action"
                          disabled={saving}
                          onClick={() => void saveLocation()}
                        >
                          Guardar
                        </button>
                        <button
                          className="drawer-link"
                          onClick={() => setEditor(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  {locations.length > 1 && (
                    <>
                      <button
                        className="drawer-action"
                        onClick={() =>
                          setTransfer({
                            fromCode: locations[0].code,
                            toCode: locations[1].code,
                            quantity: "",
                          })
                        }
                      >
                        Mover entre ubicaciones
                      </button>
                      {transfer && (
                        <div className="location-editor">
                          <select
                            value={transfer.fromCode}
                            onChange={(e) =>
                              setTransfer({
                                ...transfer,
                                fromCode: e.target.value,
                              })
                            }
                          >
                            {locations.map((item) => (
                              <option key={item.code}>{item.code}</option>
                            ))}
                          </select>
                          <select
                            value={transfer.toCode}
                            onChange={(e) =>
                              setTransfer({
                                ...transfer,
                                toCode: e.target.value,
                              })
                            }
                          >
                            {locations.map((item) => (
                              <option key={item.code}>{item.code}</option>
                            ))}
                          </select>
                          <input
                            value={transfer.quantity}
                            inputMode="decimal"
                            onChange={(e) =>
                              setTransfer({
                                ...transfer,
                                quantity: e.target.value,
                              })
                            }
                            placeholder="Cantidad"
                          />
                          <div>
                            <button
                              className="drawer-action"
                              disabled={saving}
                              onClick={() => void saveTransfer()}
                            >
                              Registrar movimiento
                            </button>
                            <button
                              className="drawer-link"
                              onClick={() => setTransfer(null)}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </section>
                {detail.components.length > 0 && (
                  <section className="drawer-section">
                    <h3>Composición del kit</h3>
                    <ul className="kit-component-list">
                      {detail.components.map((component) => (
                        <li key={component.id}>
                          <div>
                            <strong>{component.reference || "Sin referencia"}</strong>
                            <span>{component.name}</span>
                          </div>
                          <small>{fmt(component.quantity, component.uom)} por kit</small>
                          <p>
                            {component.locations.length
                              ? component.locations
                                  .map((location) => `${location.code}${location.preferred ? " (preferente)" : ""}`)
                                  .join(" · ")
                              : "Sin ubicación"}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <section className="drawer-section">
                  <h3>Proveedores</h3>
                  {detail.suppliers.length ? (
                    <ul className="supplier-list">
                      {detail.suppliers.map((s, i) => (
                        <li key={`${s.name}-${i}`}>
                          <strong>{s.name}</strong>
                          <span>
                            {s.productCode ||
                              s.productName ||
                              "Referencia no indicada"}
                          </span>
                          <small>
                            Mínimo {s.minQty} · entrega {s.delay} días
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Sin proveedores configurados en Odoo.</p>
                  )}
                </section>
                <button
                  className="secondary-button"
                  disabled={printingLabel}
                  onClick={() => void printLabel()}
                >
                  {printingLabel ? "Imprimiendo…" : "Imprimir etiqueta"}
                </button>
              </>
            )
          )}
        </aside>
      )}
    </section>
  );
}

function CatalogCameraSearch({
  onClose,
  onDetected,
}: {
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastCodeRef = useRef("");
  const [message, setMessage] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  const stopCamera = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const close = () => {
    stopCamera();
    onClose();
  };

  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraReady || !video || !stream) return;
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
  }, [cameraReady]);

  useEffect(() => {
    const openCamera = async () => {
      if (!("BarcodeDetector" in window)) {
        setMessage("Este navegador no permite leer QR/EAN con cámara. Usa Chrome actualizado.");
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
          setMessage("Este móvil no ofrece lectura QR/EAN por cámara.");
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
        setCameraReady(true);
        const detector = new Detector({ formats });
        timerRef.current = window.setInterval(async () => {
          const currentVideo = videoRef.current;
          if (!currentVideo || currentVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          try {
            const code = (await detector.detect(currentVideo))[0]?.rawValue?.trim();
            if (!code) {
              lastCodeRef.current = "";
              return;
            }
            if (code === lastCodeRef.current) return;
            lastCodeRef.current = code;
            stopCamera();
            onDetected(code);
          } catch {
            /* The next frame retries automatically. */
          }
        }, 130);
      } catch (error) {
        stopCamera();
        setMessage(
          error instanceof Error
            ? `No se pudo abrir la cámara: ${error.message}`
            : "No se pudo abrir la cámara",
        );
      }
    };
    void openCamera();
  }, [onDetected]);

  return (
    <section className="catalog-camera-search" aria-label="Buscar producto con cámara">
      <div>
        <strong>Apunta al QR o EAN del producto</strong>
        <button aria-label="Cerrar cámara" onClick={close} type="button">
          <X size={18} />
        </button>
      </div>
      <video autoPlay muted playsInline ref={videoRef} />
      {message && <p>{message}</p>}
    </section>
  );
}

function escapePrintHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

function Kpi({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="products-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
