// Cliente Google Drive SOLO LECTURA para la bandeja documental (Fase 2).
// Renueva el access token por API con el refresh_token persistido (patron gog-rtk),
// sin depender del keyring de gog. Nunca escribe, renombra ni borra en Drive.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type DriveFileMeta = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  parents: string[];
  webViewLink: string | null;
};

type TokensFile = { refresh_token?: string; access_token?: string; scope?: string };
type ClientSecretFile = { web?: { client_id?: string; client_secret?: string; token_uri?: string } };

export class DriveClient {
  private folderId: string;
  private account: string;
  private tokensPath: string;
  private clientSecretPath: string;
  private accessToken: string | null = null;

  constructor(env: Record<string, string | undefined>) {
    this.folderId = env.SUPPLIER_INVOICES_DRIVE_FOLDER_ID ?? "";
    this.account = env.SUPPLIER_INVOICES_DRIVE_ACCOUNT ?? "";
    this.tokensPath = env.SUPPLIER_INVOICES_DRIVE_TOKENS_PATH ?? "/root/.openclaw/secrets/gog-tokens.json";
    this.clientSecretPath = env.SUPPLIER_INVOICES_DRIVE_CLIENT_SECRET_PATH ?? "/root/.openclaw/secrets/gog-client-secret.json";
  }

  isConfigured(): boolean {
    return Boolean(this.folderId && existsSync(this.tokensPath) && existsSync(this.clientSecretPath));
  }

  configError(): string | null {
    if (!this.folderId) return "Falta SUPPLIER_INVOICES_DRIVE_FOLDER_ID";
    if (!existsSync(this.tokensPath)) return `No existe el fichero de tokens: ${this.tokensPath}`;
    if (!existsSync(this.clientSecretPath)) return `No existe el client secret: ${this.clientSecretPath}`;
    return null;
  }

  private async refreshAccessToken(): Promise<string> {
    const tokens = JSON.parse(readFileSync(this.tokensPath, "utf8")) as TokensFile;
    const secret = JSON.parse(readFileSync(this.clientSecretPath, "utf8")) as ClientSecretFile;
    const web = secret.web ?? {};
    const refreshToken = tokens.refresh_token;
    if (!refreshToken || !web.client_id || !web.client_secret) {
      throw new Error("Credenciales Drive incompletas (refresh_token o client secret ausente)");
    }
    const tokenUri = web.token_uri ?? "https://oauth2.googleapis.com/token";
    const response = await fetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: web.client_id,
        client_secret: web.client_secret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const json = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!response.ok || !json.access_token) {
      throw new Error(`Drive OAuth: ${json.error ?? response.status} ${json.error_description ?? ""}`);
    }
    this.accessToken = json.access_token;
    return json.access_token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.accessToken) await this.refreshAccessToken();
    const doFetch = async (token: string): Promise<Response> =>
      fetch(`https://www.googleapis.com/drive/v3${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
      });
    let response = await doFetch(this.accessToken!);
    if (response.status === 401 && this.accessToken) {
      // Token expirado: renovar una vez y reintentar.
      await this.refreshAccessToken();
      response = await doFetch(this.accessToken!);
    }
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      throw new Error(`Drive API ${response.status}: ${text}`);
    }
    return (await response.json()) as T;
  }

  async listFiles(): Promise<DriveFileMeta[]> {
    const query = encodeURIComponent(`'${this.folderId}' in parents and trashed = false`);
    const url = `/files?q=${query}&fields=files(id,name,mimeType,size,modifiedTime,parents,webViewLink)&pageSize=500&includeItemsFromAllDrives=true&supportsAllDrives=true&orderBy=modifiedTime desc`;
    const data = await this.request<{ files?: DriveFileMeta[] }>(url);
    return (data.files ?? []).filter((f) => f.mimeType === "application/pdf" || /pdf$/i.test(f.name));
  }

  async download(fileId: string, cacheDir: string): Promise<string> {
    // Devuelve la ruta local del PDF (lectura unica de Drive; bytes cacheados en el LAB).
    mkdirSync(cacheDir, { recursive: true });
    const target = join(cacheDir, `${fileId}.pdf`);
    if (existsSync(target)) return target;
    if (!this.accessToken) await this.refreshAccessToken();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${this.accessToken!}` },
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 200);
      throw new Error(`Descarga Drive ${response.status}: ${text}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(target, bytes);
    return target;
  }

  getAccount(): string {
    return this.account;
  }
}