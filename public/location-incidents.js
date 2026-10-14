// Small independent status surface. It leaves the currently deployed Dashboard bundle untouched.
(() => {
  const root = document.getElementById("root");
  if (!root) return;
  const banner = document.createElement("section");
  banner.id = "location-movement-incidents";
  banner.setAttribute("role", "alert");
  banner.setAttribute("aria-live", "polite");
  banner.hidden = true;
  banner.style.cssText = "margin:12px 20px;padding:14px 16px;border:1px solid #f59e0b;border-radius:12px;background:#fffbeb;color:#78350f;font:14px/1.5 system-ui,sans-serif";
  root.before(banner);

  const refresh = async () => {
    try {
      const response = await fetch("/api/odoo/products/locations/incidents", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) { banner.hidden = true; return; }
      const payload = await response.json();
      const incidents = Array.isArray(payload.incidents) ? payload.incidents : [];
      banner.replaceChildren();
      if (!incidents.length) { banner.hidden = true; return; }
      const title = document.createElement("strong");
      title.textContent = `${incidents.length} movimiento${incidents.length === 1 ? "" : "s"} de Odoo pendiente${incidents.length === 1 ? "" : "s"} de ajustar en Dashboard`;
      banner.append(title);
      const help = document.createElement("p");
      help.textContent = "Revisa la ubicación preferente del producto. El movimiento se reintentará automáticamente; no descuentes stock a mano sin conciliarlo.";
      help.style.margin = "5px 0 8px";
      banner.append(help);
      const list = document.createElement("ul");
      list.style.margin = "0";
      list.style.paddingLeft = "20px";
      for (const incident of incidents) {
        const item = document.createElement("li");
        const amount = Number(incident.quantity);
        const quantity = Number.isFinite(amount) ? amount.toLocaleString("es-ES") : "?";
        const product = incident.reference || incident.name || `Producto ${incident.productId}`;
        item.textContent = `${product} · movimiento ${incident.id} · ${quantity} ud. · ${incident.reason === "missing_preferred" ? "sin ubicación preferente; stock no descontado" : "cantidad inválida; stock no ajustado"}`;
        list.append(item);
      }
      banner.append(list);
      banner.hidden = false;
    } catch {
      banner.hidden = true;
    }
  };
  void refresh();
  window.setInterval(() => { void refresh(); }, 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
})();
