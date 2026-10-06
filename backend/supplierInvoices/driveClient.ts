// Cliente Google Drive para la bandeja documental (Fase 2) + mini navegador (Fase 2.4).
// Renueva el access token por API con el refresh_token persistido (patron gog-rtk),
// sin depender del keyring de gog. Escritura MINIMA y explicita: crear carpetas y
// mover PDFs solo cuando el usuario lo pulsa en el navegador; nunca borra nada.

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
  private archiveFolderId: string;
  private account: string;
  private tokensPath: string;
  private clientSecretPath: string;
  private accessToken: string | null = null;

  constructor(env: Record<string, string | undefined>) {
    this.folderId = env.SUPPLIER_INVOICES_DRIVE_FOLDER_ID ?? "";
    this.archiveFolderId = env.SUPPLIER_INVOICES_DRIVE_ARCHIVE_FOLDER_ID ?? "";
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
    const files: DriveFileMeta[] = [];
    let pageToken: string | undefined;
    do {
      const token = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
      const url = `/files?q=${query}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)&pageSize=500&includeItemsFromAllDrives=true&supportsAllDrives=true&orderBy=modifiedTime desc${token}`;
      const data = await this.request<{ files?: DriveFileMeta[]; nextPageToken?: string }>(url);
      files.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return files.filter((f) => f.mimeType === "application/pdf" || /\.pdf$/i.test(f.name));
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

  /** Streamea el PDF desde Drive directo al response HTTP (passthrough, sin cachear en disco). */
  async streamPdf(fileId: string, response: any): Promise<void> {
    if (!this.accessToken) await this.refreshAccessToken();
    const doFetch = (token: string) =>
      fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    let driveRes = await doFetch(this.accessToken!);
    if (driveRes.status === 401 && this.accessToken) {
      // Token expirado: renovar una vez y reintentar.
      await this.refreshAccessToken();
      driveRes = await doFetch(this.accessToken!);
    }
    if (!driveRes.ok) {
      const text = (await driveRes.text()).slice(0, 200);
      if (response.writableEnded) return;
      response.statusCode = driveRes.status === 404 ? 404 : 502;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ message: driveRes.status === 404 ? "Archivo no encontrado en Drive" : `Error Drive ${driveRes.status}: ${text}` }));
      return;
    }
    if (response.writableEnded) return;
    response.statusCode = 200;
    response.setHeader("Content-Type", driveRes.headers.get("content-type") ?? "application/pdf");
    const len = driveRes.headers.get("content-length");
    if (len) response.setHeader("Content-Length", len);
    response.setHeader("Cache-Control", "no-store");
    if (driveRes.body && typeof driveRes.body.pipe === "function") {
      driveRes.body.pipe(response);
    } else {
      const buf = Buffer.from(await driveRes.arrayBuffer());
      response.end(buf);
    }
  }

  // ===== Fase 2.4: mini navegador de carpetas =====

  /** Subcarpetas de una carpeta (orden natural, es). */
  async listFolders(parentId?: string): Promise<DriveFileMeta[]> {
    const parent = parentId || this.folderId;
    if (!parent) throw new Error("Falta SUPPLIER_INVOICES_DRIVE_FOLDER_ID");
    const query = encodeURIComponent(`'${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const folders: DriveFileMeta[] = [];
    let pageToken: string | undefined;
    do {
      const token = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
      const url = `/files?q=${query}&fields=nextPageToken,files(id,name,mimeType,parents)&pageSize=200&includeItemsFromAllDrives=true&supportsAllDrives=true&orderBy=name${token}`;
      const data = await this.request<{ files?: DriveFileMeta[]; nextPageToken?: string }>(url);
      folders.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return folders.sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
  }

  getArchiveFolderId(): string {
    if (!this.archiveFolderId) throw new Error("Falta SUPPLIER_INVOICES_DRIVE_ARCHIVE_FOLDER_ID");
    return this.archiveFolderId;
  }

  /** Devuelve la ruta comprobada por Drive; nunca acepta una ruta escrita por el navegador. */
  async archivePath(folderId: string): Promise<string> {
    const root = this.getArchiveFolderId();
    const names: string[] = [];
    const visited = new Set<string>();
    let current = folderId;
    for (let depth = 0; depth < 30; depth++) {
      if (current === root) return `/FACTURAS${names.length ? `/${names.reverse().join("/")}` : ""}`;
      if (!current || visited.has(current)) break;
      visited.add(current);
      const meta = await this.request<{ id?: string; name?: string; mimeType?: string; parents?: string[]; trashed?: boolean }>(
        `/files/${encodeURIComponent(current)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true`,
      );
      if (meta.trashed || meta.mimeType !== "application/vnd.google-apps.folder" || !meta.parents?.length) break;
      names.push(meta.name ?? "Carpeta");
      current = meta.parents[0];
    }
    throw new Error("El destino no pertenece a la carpeta FACTURAS");
  }

  /** Crea la carpeta si no existe (idempotente) y devuelve su id. */
  async ensureFolder(name: string, parentId: string): Promise<{ id: string; name: string; created: boolean }> {
    const existing = await this.listFolders(parentId);
    const hit = existing.find((f) => f.name === name);
    if (hit) return { id: hit.id, name: hit.name, created: false };
    const data = await this.request<{ id: string; name: string }>(`/files?fields=id,name&supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
    });
    return { id: data.id, name: data.name ?? name, created: true };
  }

  /** Mueve un archivo a otra carpeta (lo quita de la actual). */
  async moveFile(fileId: string, newParentId: string): Promise<void> {
    const meta = await this.request<{ parents?: string[] }>(`/files/${fileId}?fields=parents&supportsAllDrives=true`);
    const previousParents = (meta.parents ?? []).join(",");
    const qs = new URLSearchParams({ addParents: newParentId, fields: "id,parents", supportsAllDrives: "true" });
    if (previousParents) qs.set("removeParents", previousParents);
    const moved = await this.request<{ parents?: string[] }>(`/files/${encodeURIComponent(fileId)}?${qs.toString()}`, { method: "PATCH" });
    if (!moved.parents?.includes(newParentId)) throw new Error("Drive no confirmó la carpeta de destino");
  }

  getRootFolderId(): string {
    return this.folderId;
  }

  getAccount(): string {
    return this.account;
  }
}
