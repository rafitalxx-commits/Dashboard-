// Confirmed service/time pairs. Shared by the rules catalog and SOAP builder.
export const glsServices = [
  { id: "96", horario: "18", label: "GLS Nacional · BusinessParcel · servicio 96 / horario 18" },
  { id: "74", horario: "3", label: "GLS Internacional · EuroBusinessParcel · servicio 74 / horario 3" },
] as const;

export function getGlsService(service: string) {
  return glsServices.find((item) => item.id === service);
}
