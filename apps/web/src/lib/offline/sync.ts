import { useSyncExternalStore } from "react";
import { newId } from "./ids";
import {
  clearFailures,
  enqueue,
  type FailedRecord,
  failures,
  type NewRecord,
  type OutboxRecord,
  pending,
  reject,
  type SyncOp,
  settle,
} from "./outbox";
import { refreshCachedPages } from "./sw-client";

/*
 * Envío de la bandeja de salida. Se intenta al registrar un cambio, al volver la conexión, al
 * volver a la pestaña y cada 20 segundos mientras queden cambios. Los cambios seguidos de la misma
 * actividad (o de la misma lista de asistencia) viajan juntos en una sola petición.
 */

export type SyncStatus = "listo" | "enviando" | "sin-conexion" | "sesion" | "error";

export interface SyncSnapshot {
  pending: number;
  status: SyncStatus;
  failed: FailedRecord[];
  /** Cambia cada vez que llegan cambios al servidor (las páginas lo usan para refrescarse). */
  syncedAt: number;
}

export interface SyncResult {
  ok: boolean;
  /** Si es false, el problema es pasajero (servidor caído) y el cambio se reintenta. */
  retry?: boolean;
  message?: string;
}

const SYNC_URL = "/panel/cuaderno/sync";
const BATCH = 40;
const MAX_ENTRIES = 200;

let owner: string | null = null;
let snapshot: SyncSnapshot = { pending: 0, status: "listo", failed: [], syncedAt: 0 };
const listeners = new Set<() => void>();
let flushing = false;
let again = false;
let installed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function set(next: Partial<SyncSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

/*
 * Diario en localStorage: IndexedDB es asíncrono y, si la página se cierra o recarga justo después de
 * escribir la última nota, esa escritura se puede perder. localStorage se escribe al instante, así
 * que cada cambio se anota ahí primero y se borra cuando ya quedó en IndexedDB. Al abrir de nuevo,
 * lo que haya quedado en el diario se pasa a la bandeja (pasarlo dos veces no duplica nada).
 */
const JOURNAL = "escolar-cuaderno-diario";
interface JournalEntry {
  id: string;
  records: NewRecord[];
  drop: string[];
}

function readJournal(): JournalEntry[] {
  try {
    return JSON.parse(localStorage.getItem(JOURNAL) ?? "[]") as JournalEntry[];
  } catch {
    return [];
  }
}

function writeJournal(entries: JournalEntry[]) {
  try {
    if (entries.length) localStorage.setItem(JOURNAL, JSON.stringify(entries));
    else localStorage.removeItem(JOURNAL);
  } catch {
    // Sin localStorage (modo privado lleno): queda solo IndexedDB.
  }
}

const forget = (id: string) => writeJournal(readJournal().filter((e) => e.id !== id));

let replaying: Promise<void> | null = null;
function replayJournal(): Promise<void> {
  replaying ??= (async () => {
    for (const entry of readJournal()) {
      await enqueue(entry.records, entry.drop);
      forget(entry.id);
    }
  })().finally(() => {
    replaying = null;
  });
  return replaying;
}

async function recount() {
  if (!owner) return;
  await replayJournal();
  const [ops, failed] = await Promise.all([pending(owner), failures(owner)]);
  set({ pending: ops.length, failed });
}

/** Arranca la sincronización para la sesión actual. Se puede llamar varias veces (panel y cuaderno). */
export function startSync(currentOwner: string) {
  if (owner === currentOwner && installed) return;
  owner = currentOwner;
  if (!installed && typeof window !== "undefined") {
    installed = true;
    window.addEventListener("online", () => void flush());
    window.addEventListener("offline", () => set({ status: "sin-conexion" }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void flush();
    });
    setInterval(() => {
      if (snapshot.pending > 0) void flush();
    }, 20_000);
  }
  void recount().then(flush);
}

/** Guarda cambios en el dispositivo y programa el envío. */
export async function record(
  me: string,
  records: Omit<NewRecord, "owner" | "pages">[],
  dropPrefixes: string[] = [],
) {
  startSync(me);
  const pages = currentPages();
  const entry: JournalEntry = {
    id: newId(),
    records: records.map((r) => ({ ...r, owner: me, pages })),
    drop: dropPrefixes,
  };
  // Primero al diario (al instante, antes de cualquier await) y luego a la bandeja.
  writeJournal([...readJournal(), entry]);
  await enqueue(entry.records, entry.drop);
  forget(entry.id);
  await recount();
  if (timer) clearTimeout(timer);
  // Un respiro para juntar varias notas seguidas en una sola petición.
  timer = setTimeout(() => void flush(), 600);
}

export async function pendingFor(me: string, scope: string): Promise<OutboxRecord[]> {
  await replayJournal();
  return pending(me, scope);
}

/** Páginas que muestran un cambio hecho aquí (se refrescan en el dispositivo al sincronizar). */
function currentPages(): string[] {
  const { pathname, search } = window.location;
  return [...new Set([pathname + search, pathname, "/panel/cuaderno"])];
}

export async function dismissFailures() {
  if (owner) await clearFailures(owner);
  await recount();
}

interface Group {
  op: SyncOp;
  records: OutboxRecord[];
}

/** Junta cambios seguidos de la misma actividad o de la misma lista de asistencia. */
export function groupRecords(records: OutboxRecord[]): Group[] {
  const groups: Group[] = [];
  for (const r of records) {
    const last = groups.at(-1);
    if (last && r.op.kind === "scores.put" && last.op.kind === "scores.put") {
      if (
        last.op.input.activityId === r.op.input.activityId &&
        last.op.input.entries.length + r.op.input.entries.length <= MAX_ENTRIES
      ) {
        const merged = new Map(last.op.input.entries.map((e) => [e.studentId, e]));
        for (const e of r.op.input.entries) merged.set(e.studentId, e);
        last.op = { kind: "scores.put", input: { ...last.op.input, entries: [...merged.values()] } };
        last.records.push(r);
        continue;
      }
    }
    if (last && r.op.kind === "attendance.put" && last.op.kind === "attendance.put") {
      const a = last.op.input;
      const b = r.op.input;
      if (
        a.sectionId === b.sectionId &&
        a.date === b.date &&
        a.entries.length + b.entries.length <= MAX_ENTRIES
      ) {
        const merged = new Map(a.entries.map((e) => [e.studentId, e]));
        for (const e of b.entries) merged.set(e.studentId, e);
        last.op = { kind: "attendance.put", input: { ...a, entries: [...merged.values()] } };
        last.records.push(r);
        continue;
      }
    }
    groups.push({ op: r.op, records: [r] });
  }
  return groups;
}

export async function flush(): Promise<void> {
  if (!owner) return;
  if (flushing) {
    again = true;
    return;
  }
  flushing = true;
  const me = owner;
  const synced = new Set<string>();
  try {
    await replayJournal();
    for (;;) {
      if (!navigator.onLine) {
        set({ status: "sin-conexion" });
        break;
      }
      const records = (await pending(me)).slice(0, BATCH);
      if (records.length === 0) {
        set({ status: "listo" });
        break;
      }
      const groups = groupRecords(records);
      set({ status: "enviando" });

      let response: Response;
      try {
        response = await fetch(SYNC_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ops: groups.map((g) => g.op) }),
          // Si la sesión venció, el panel redirige al login: eso no es una respuesta del servidor.
          redirect: "manual",
          cache: "no-store",
        });
      } catch {
        set({ status: "sin-conexion" });
        break;
      }
      if (response.type === "opaqueredirect" || response.status === 401) {
        set({ status: "sesion" });
        break;
      }
      if (!response.ok) {
        set({ status: "error" });
        break;
      }
      const { results } = (await response.json()) as { results: SyncResult[] };
      let stopped = results.length < groups.length;
      for (const [i, res] of results.entries()) {
        const group = groups[i];
        if (!group) break;
        if (res.ok) {
          await settle(group.records);
          for (const r of group.records) for (const page of r.pages) synced.add(page);
        } else if (res.retry) {
          stopped = true;
          break;
        } else {
          await reject(group.records, res.message ?? "El servidor rechazó el cambio");
        }
      }
      await recount();
      if (stopped) {
        set({ status: "error" });
        break;
      }
    }
  } finally {
    flushing = false;
    if (synced.size) {
      set({ syncedAt: Date.now() });
      // Las copias para usar sin internet se actualizan con lo que ya quedó en el servidor.
      refreshCachedPages([...synced]);
    }
    if (again) {
      again = false;
      void flush();
    }
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const serverSnapshot: SyncSnapshot = { pending: 0, status: "listo", failed: [], syncedAt: 0 };

export function useSync(): SyncSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => serverSnapshot,
  );
}
