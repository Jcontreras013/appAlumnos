import type { ActivityInput, AttendanceInput, ScoresInput } from "@escolar/shared";

/*
 * Bandeja de salida del cuaderno: lo que el maestro registra se guarda primero en el dispositivo
 * (IndexedDB) y se envía al servidor cuando hay internet. Todas las operaciones son idempotentes
 * (los ids de actividad los genera el dispositivo y las notas/asistencia se sobrescriben), así que
 * reenviar algo que ya llegó no duplica nada.
 */

export type SyncOp =
  | { kind: "activity.put"; input: ActivityInput }
  | { kind: "activity.delete"; id: string }
  | { kind: "scores.put"; input: ScoresInput }
  | { kind: "attendance.put"; input: AttendanceInput };

export interface OutboxRecord {
  seq?: number;
  /** Membresía (usuario + centro) con la que se registró: solo se envía con esa misma sesión. */
  owner: string;
  /** Un cambio posterior con la misma clave reemplaza al anterior, en su mismo lugar de la fila. */
  key: string;
  /** Página donde se ve el cambio: "notas:<clase>" o "asistencia:<sección>:<fecha>". */
  scope: string;
  /** Páginas guardadas sin internet que hay que refrescar cuando esto llegue al servidor. */
  pages: string[];
  op: SyncOp;
  rev: number;
  createdAt: number;
}

export interface FailedRecord {
  id?: number;
  owner: string;
  scope: string;
  op: SyncOp;
  message: string;
  at: number;
}

const DB_NAME = "escolar-cuaderno";
const OPS = "ops";
const FAILED = "failed";

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const ops = db.createObjectStore(OPS, { keyPath: "seq", autoIncrement: true });
      ops.createIndex("owner_key", ["owner", "key"], { unique: false });
      ops.createIndex("owner", "owner", { unique: false });
      const failed = db.createObjectStore(FAILED, { keyPath: "id", autoIncrement: true });
      failed.createIndex("owner", "owner", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export type NewRecord = Omit<OutboxRecord, "seq" | "rev" | "createdAt">;

/**
 * Agrega cambios a la bandeja. Si ya había uno pendiente con la misma clave, se reemplaza en su
 * lugar (así no se envían diez versiones de la misma nota y se respeta el orden: la actividad
 * siempre llega antes que sus notas). `dropPrefixes` descarta cambios pendientes que ya no tienen
 * sentido (las notas de una actividad que se borró).
 */
export async function enqueue(records: NewRecord[], dropPrefixes: string[] = []): Promise<void> {
  const db = await open();
  const tx = db.transaction(OPS, "readwrite");
  const store = tx.objectStore(OPS);
  const owner = records[0]?.owner;
  if (owner && dropPrefixes.length) {
    const all = await result(store.index("owner").getAll(owner) as IDBRequest<OutboxRecord[]>);
    for (const r of all) {
      if (r.seq !== undefined && dropPrefixes.some((p) => r.key.startsWith(p))) store.delete(r.seq);
    }
  }
  for (const record of records) {
    const existing = (await result(store.index("owner_key").get([record.owner, record.key]))) as
      | OutboxRecord
      | undefined;
    if (existing) {
      store.put({ ...existing, ...record, seq: existing.seq, rev: existing.rev + 1, createdAt: Date.now() });
    } else {
      store.add({ ...record, rev: 0, createdAt: Date.now() });
    }
  }
  await done(tx);
}

/** Cambios pendientes en el orden en que se hicieron. */
export async function pending(owner: string, scope?: string): Promise<OutboxRecord[]> {
  const db = await open();
  const all = (await result(
    db.transaction(OPS).objectStore(OPS).index("owner").getAll(owner),
  )) as OutboxRecord[];
  return all.filter((r) => !scope || r.scope === scope).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

/** Quita un cambio ya enviado, salvo que el maestro lo haya vuelto a modificar mientras viajaba. */
export async function settle(records: Array<Pick<OutboxRecord, "seq" | "rev">>): Promise<void> {
  const db = await open();
  const tx = db.transaction(OPS, "readwrite");
  const store = tx.objectStore(OPS);
  for (const { seq, rev } of records) {
    if (seq === undefined) continue;
    const current = (await result(store.get(seq))) as OutboxRecord | undefined;
    if (current && current.rev === rev) store.delete(seq);
  }
  await done(tx);
}

/** Cambios que el servidor rechazó (p. ej. una nota mayor al valor): se guardan para avisar. */
export async function reject(records: OutboxRecord[], message: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([OPS, FAILED], "readwrite");
  for (const r of records) {
    if (r.seq !== undefined) tx.objectStore(OPS).delete(r.seq);
    tx.objectStore(FAILED).add({ owner: r.owner, scope: r.scope, op: r.op, message, at: Date.now() });
  }
  await done(tx);
}

export async function failures(owner: string): Promise<FailedRecord[]> {
  const db = await open();
  return (await result(
    db.transaction(FAILED).objectStore(FAILED).index("owner").getAll(owner),
  )) as FailedRecord[];
}

export async function clearFailures(owner: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(FAILED, "readwrite");
  const store = tx.objectStore(FAILED);
  const keys = await result(store.index("owner").getAllKeys(owner));
  for (const key of keys) store.delete(key);
  await done(tx);
}
