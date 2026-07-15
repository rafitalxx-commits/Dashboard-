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
