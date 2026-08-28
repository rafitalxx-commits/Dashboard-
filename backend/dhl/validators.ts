import type { DhlShipmentInput } from "./types.ts";
export function validateDhlShipment(input: DhlShipmentInput) {
  const issues: string[] = [];
  const check = (value: string, max: number, label: string) => { if (!String(value || "").trim()) issues.push(`${label} es obligatorio`); else if (String(value).length > max) issues.push(`${label} supera los ${max} caracteres permitidos por DHL`); };
  check(input.reference, 35, "Referencia"); check(input.destination.name, 40, "Nombre del destinatario"); check(input.destination.address, 80, "Dirección"); check(input.destination.town, 20, "Población"); check(input.destination.postalCode, 9, "Código postal"); check(input.destination.email, 50, "Email");
  if (!/^[A-Za-z]{2}$/.test(input.destination.countryCode || "")) issues.push("País debe ser un código ISO de 2 caracteres");
  if (!input.packages.length || input.packages.length > 999) issues.push("Número de bultos debe estar entre 1 y 999");
  if (input.packages.some((parcel) => !Number.isFinite(parcel.weight) || parcel.weight <= 0)) issues.push("Peso es obligatorio y debe ser mayor que cero");
  if (input.customs?.required && input.customs.missing?.length) issues.push(`DHL requiere documentación aduanera: ${input.customs.missing.join(", ")}`);
  if (issues.length) throw new Error(`DHL no puede generar la etiqueta: ${issues.join(". ")}.`);
}
