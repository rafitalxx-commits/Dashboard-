import type { GlsShipmentInput } from "./types.ts";
import { getGlsService } from "./services.ts";

export function validateGlsShipment(input: GlsShipmentInput, env: Record<string, string>) {
  const issues: string[] = [];
  if (!input || typeof input !== "object") throw new Error("GLS requiere los datos del envío");
  const check = (value: string, max: number, label: string) => {
    if (!String(value || "").trim()) issues.push(`${label} es obligatorio`);
    else if (String(value).length > max) issues.push(`${label} supera ${max} caracteres`);
  };
  check(input.reference, 50, "Referencia");
  check(input.service, 8, "Código de servicio GLS");
  if (!getGlsService(input.service)) issues.push("Selecciona un servicio GLS disponible en las reglas de transporte");
  check(input.destination?.name, 50, "Nombre del destinatario");
  check(input.destination?.address, 100, "Dirección");
  check(input.destination?.town, 50, "Población");
  check(input.destination?.postalCode, 12, "Código postal");
  check(input.destination?.countryCode, 2, "País");
  check(input.destination?.phone, 30, "Teléfono");
  check(input.destination?.email, 100, "Email");
  if (!/^[A-Za-z]{2}$/.test(input.destination?.countryCode || "")) issues.push("País debe ser un código ISO de 2 letras");
  if (!Array.isArray(input.packages) || input.packages.length < 1 || input.packages.length > 20) issues.push("Número de bultos debe estar entre 1 y 20");
  if (Array.isArray(input.packages) && input.packages.some((parcel) => !Number.isFinite(parcel.weight) || parcel.weight <= 0)) issues.push("Peso de cada bulto debe ser mayor que cero");
  if (input.cashOnDelivery !== undefined && (!Number.isFinite(input.cashOnDelivery) || input.cashOnDelivery < 0)) issues.push("Reembolso debe ser cero o mayor");
  if (env.GLS_LAB_MOCK === "false") {
    for (const [key, label] of [["GLS_UID_CLIENTE", "UID de cliente GLS"], ["GLS_REMIT_NAME", "Remitente GLS"], ["GLS_REMIT_ADDRESS", "Dirección del remitente"], ["GLS_REMIT_TOWN", "Población del remitente"], ["GLS_REMIT_POSTAL_CODE", "CP del remitente"]]) {
      if (!env[key]) issues.push(`${label} no está configurado`);
    }
  }
  if (issues.length) throw new Error(`GLS no puede generar la etiqueta: ${issues.join(". ")}.`);
}
