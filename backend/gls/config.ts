import { readFileSync } from "node:fs";
import { join } from "node:path";

// Keep the credential within the GLS adapter, not shared env or /proc environ.
export function loadGlsEnvironment(env: Record<string, string>): Record<string, string> {
  const result = { ...env };
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GLS_") && value !== undefined) result[key] = value;
  }
  const credentialDirectory = env.CREDENTIALS_DIRECTORY || process.env.CREDENTIALS_DIRECTORY;
  if (credentialDirectory) {
    try {
      const uid = readFileSync(join(credentialDirectory, "gls-uid"), "utf8").trim();
      if (!uid || uid.length > 256 || /[\r\n]/.test(uid)) throw new Error("invalid");
      result.GLS_UID_CLIENTE = uid;
    } catch {
      throw new Error("No se pudo cargar la credencial GLS del servicio; revisa su configuración protegida.");
    }
  } else result.GLS_UID_CLIENTE = env.GLS_UID_CLIENTE || env.GLS_UID || "";
  return result;
}
