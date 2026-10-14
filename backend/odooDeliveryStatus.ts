const SENDCLOUD_READY_TO_VALIDATE_KEYWORDS = [
  "etiqueta creada",
  "ready_to_send",
  "driver_on_route",
  "shipment_on_route",
  "on_route",
  "enviado",
  "shipped",
  "expedie",
  "listo para recoger",
  "transito",
  "en ruta",
  "entregado",
];

const SENDCLOUD_NOT_READY_TO_VALIDATE_KEYWORDS = [
  "unshipped",
];

export function isSendcloudReadyToValidate(status?: string) {
  const deliveryStatus = normalizeDeliveryStatus(status);
  if (
    SENDCLOUD_NOT_READY_TO_VALIDATE_KEYWORDS.some((keyword) =>
      deliveryStatus.includes(keyword),
    )
  ) {
    return false;
  }
  return SENDCLOUD_READY_TO_VALIDATE_KEYWORDS.some((keyword) =>
    deliveryStatus.includes(keyword),
  );
}

export function normalizeDeliveryStatus(status?: string) {
  return (status ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export type DashboardLabelEvidence = {
  source?: string;
  shipmentCode?: string;
  tracking?: string;
  reissuedAt?: string;
};

// The carrier is descriptive metadata. Eligibility comes from the Dashboard
// expedition ledger and a usable shipment/tracking identity, not its name.
export function isRecordedDashboardLabel(label: DashboardLabelEvidence) {
  const source = (label.source ?? "").trim().toLowerCase();
  return (source === "expeditions-print" || source.endsWith("-label-created")) &&
    Boolean(label.shipmentCode?.trim()) &&
    !label.reissuedAt;
}

export function isRecordedDashboardShipment(label: DashboardLabelEvidence) {
  return isRecordedDashboardLabel(label);
}

export function isDashboardShipmentStatus(rawStatus?: string, shipmentCode?: string) {
  return rawStatus === "dashboard-shipment-recorded" && Boolean(shipmentCode?.trim());
}

// Preserve the separate legacy Sendcloud validation path. It does not have
// Dashboard ledger provenance, so extending its carrier list is not the
// carrier-independent solution for new Dashboard expeditions.
export function isLegacySendcloudDeliveryCarrier(value?: string) {
  const carrier = normalizeDeliveryStatus(value);
  return carrier === "mrw" || carrier === "dhl" || carrier === "genei" ||
    carrier === "correos express" || carrier === "global express internacional";
}

export function isDeliveryStatusEligible(rawStatus?: string, tracking?: string, carrier?: string, shipmentCode?: string) {
  return isDashboardShipmentStatus(rawStatus, shipmentCode) ||
    Boolean(tracking?.trim() && isLegacySendcloudDeliveryCarrier(carrier));
}
