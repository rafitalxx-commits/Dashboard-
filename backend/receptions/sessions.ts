import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ReceptionOperator = {
  id: string;
  code: string;
  name: string;
};

export type ReceptionSession = {
  receptionId: string;
  receptionRef: string;
  purchaseRef: string;
  operator: ReceptionOperator;
  status: "in_progress" | "completed";
  startedAt: string;
  updatedAt: string;
};

type ReceptionSessionStore = {
  version: 1;
  sessions: ReceptionSession[];
};

const emptyStore = (): ReceptionSessionStore => ({ version: 1, sessions: [] });

export function normalizeReceptionOperator(input: Partial<ReceptionOperator> | undefined) {
  const name = String(input?.name ?? "").trim();
  const code = String(input?.code ?? "").trim().toUpperCase();
  if (!name) throw new Error("Indica el operario antes de iniciar la recepción");
  const id = String(input?.id ?? "").trim()
    || `manual-${name.toLocaleLowerCase("es").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return { id, code: code || "MANUAL", name };
}

export function createReceptionSessions(options: { dataDir?: string } = {}) {
  const dataDir = options.dataDir ?? process.env.DASHBOARD_DATA_DIR ?? ".dashboard-data";
  const file = join(dataDir, "reception-sessions.json");
  const read = (): ReceptionSessionStore => {
    try {
      return existsSync(file)
        ? JSON.parse(readFileSync(file, "utf8")) as ReceptionSessionStore
        : emptyStore();
    } catch {
      return emptyStore();
    }
  };
  const write = (store: ReceptionSessionStore) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  };

  const list = () => read().sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const start = (input: {
    receptionId?: unknown;
    receptionRef?: unknown;
    purchaseRef?: unknown;
    operator?: Partial<ReceptionOperator>;
  }) => {
    const receptionId = String(input.receptionId ?? "").trim();
    const receptionRef = String(input.receptionRef ?? "").trim();
    const purchaseRef = String(input.purchaseRef ?? "").trim();
    if (!receptionId || !receptionRef) throw new Error("Recepción inválida");
    const store = read();
    const existing = store.sessions.find((session) => session.receptionId === receptionId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const session: ReceptionSession = {
      receptionId,
      receptionRef,
      purchaseRef,
      operator: normalizeReceptionOperator(input.operator),
      status: "in_progress",
      startedAt: now,
      updatedAt: now,
    };
    store.sessions.unshift(session);
    write(store);
    return session;
  };

  const complete = (receptionId: string) => {
    const store = read();
    const index = store.sessions.findIndex(
      (session) => session.receptionId === receptionId,
    );
    if (index < 0) throw new Error("Sesión de recepción no encontrada");
    const now = new Date().toISOString();
    store.sessions[index] = {
      ...store.sessions[index],
      status: "completed",
      updatedAt: now,
    };
    write(store);
    return store.sessions[index];
  };

  return { list, start, complete };
}
