import { useMemo } from "react";

function trackingPortalUrl(tracking: string, country: string, postalCode: string) {
  const query = new URLSearchParams({ tracking_number: tracking, country, postal_code: postalCode });
  return `https://todoelectrico.shipping-portal.com/tracking/?${query}`;
}

function isApprovedTrackingUrl(value: string) {
  try {
    const { hostname, protocol } = new URL(value);
    return protocol === "https:" && [
      "todoelectrico.shipping-portal.com",
      "tracking.sendcloud.sc",
      "www.mrw.es",
      "www.correosexpress.com",
      "www.correosexpress.es",
    ].includes(hostname);
  } catch {
    return false;
  }
}

export function PublicTrackingPage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const tracking = query.get("tracking_number")?.trim() || "";
  const country = (query.get("country") || "es").trim().toLowerCase();
  const postalCode = query.get("postal_code")?.trim() || "";
  const carrier = query.get("carrier")?.trim() || "Transportista pendiente";
  const status = query.get("status")?.trim() || "Etiqueta creada";
  const suppliedUrl = query.get("official_url")?.trim() || "";
  const officialUrl = isApprovedTrackingUrl(suppliedUrl) ? suppliedUrl : tracking && postalCode ? trackingPortalUrl(tracking, country, postalCode) : "";

  return <main style={{ minHeight: "100vh", background: "#f4f7fb", color: "#162235", fontFamily: "Inter, system-ui, sans-serif", padding: "24px 14px" }}>
    <section style={{ maxWidth: 860, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <strong style={{ color: "#1465c0", letterSpacing: ".03em" }}>TODOELECTRICO</strong><span style={{ color: "#64748b", fontSize: 14 }}>Seguimiento de envío</span>
      </header>
      {!tracking ? <article style={card}><h1 style={{ marginTop: 0 }}>Aún no hay seguimiento disponible</h1><p>Este envío no tiene un número de seguimiento asignado. Cuando lo tenga, esta misma página mostrará el estado del transportista.</p></article> : <>
        <article style={card}>
          <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>{carrier}</p>
          <h1 style={{ margin: "8px 0" }}>{officialUrl ? "Tu envío está en seguimiento" : status}</h1>
          <p style={{ margin: 0, fontFamily: "ui-monospace, monospace" }}>{tracking}</p>
          {officialUrl ? <a href={officialUrl} target="_blank" rel="noreferrer" style={button}>Abrir seguimiento oficial ↗</a> : <p style={{ color: "#64748b" }}>El transportista todavía no ha publicado eventos. Consulta este enlace más tarde.</p>}
        </article>
        {officialUrl ? <><article style={{ ...card, padding: 0, overflow: "hidden" }}>
          <iframe title="Seguimiento del envío" src={officialUrl} style={{ border: 0, width: "100%", minHeight: "720px", background: "#fff" }} />
        </article><p style={{ color: "#64748b", textAlign: "center", fontSize: 13 }}>Los hitos, fechas y estado proceden del transportista y se actualizan al consultar esta página.</p></> : null}
      </>}
    </section>
  </main>;
}

const card = { background: "#fff", borderRadius: 18, padding: 24, boxShadow: "0 8px 28px rgba(15, 23, 42, .08)", marginBottom: 16 };
const button = { display: "inline-block", marginTop: 18, borderRadius: 10, padding: "11px 15px", background: "#1465c0", color: "#fff", textDecoration: "none", fontWeight: 700 };
