"use client";

import { libraryFileUrl } from "./library-urls";
import { precachePages } from "./offline/sw-client";

/*
 * Libros guardados para leer sin internet. Se guardan en el almacenamiento del navegador (Cache API),
 * en el mismo lugar que lee el service worker (public/sw.js): así el lector y los enlaces de descarga
 * los encuentran aunque no haya conexión. Al cerrar sesión, el service worker los borra.
 */

/** Debe coincidir con BOOKS en public/sw.js. */
export const BOOKS_CACHE = "escolar-biblioteca-v1";

const absolute = (id: string) => new URL(libraryFileUrl(id), location.origin).href;

const canStore = () => typeof caches !== "undefined";

/** Ids de los materiales guardados en este dispositivo. */
export async function savedLibraryIds(): Promise<Set<string>> {
  if (!canStore()) return new Set();
  try {
    const cache = await caches.open(BOOKS_CACHE);
    const keys = await cache.keys();
    return new Set(keys.map((r) => new URL(r.url).pathname.split("/").pop() ?? ""));
  } catch {
    return new Set();
  }
}

/** El libro guardado, si está en este dispositivo. */
export async function savedLibraryFile(id: string): Promise<ArrayBuffer | null> {
  if (!canStore()) return null;
  try {
    const saved = await (await caches.open(BOOKS_CACHE)).match(absolute(id));
    return saved ? await saved.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Baja el archivo completo y lo guarda (con el avance para la barra). También guarda la página del
 * lector y la de la biblioteca, para abrirlas sin internet.
 */
export async function saveLibraryFile(
  id: string,
  onProgress: (fraction: number) => void,
): Promise<SaveResult> {
  if (!canStore()) {
    return { ok: false, error: "Este navegador no puede guardar libros. Usa la app o Chrome actualizado." };
  }
  try {
    const res = await fetch(libraryFileUrl(id), { cache: "no-store" });
    if (!res.ok || !res.body) return { ok: false, error: "No se pudo bajar el libro. Intenta de nuevo." };
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (total) onProgress(loaded / total);
    }
    const headers = new Headers();
    for (const name of ["content-type", "content-disposition", "content-length"]) {
      const value = res.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("accept-ranges", "bytes");
    const cache = await caches.open(BOOKS_CACHE);
    await cache.put(absolute(id), new Response(new Blob(chunks), { status: 200, headers }));
    await precachePages([`/panel/biblioteca/${id}`, "/panel/biblioteca"]);
    return { ok: true };
  } catch (err) {
    const full = err instanceof DOMException && err.name === "QuotaExceededError";
    return {
      ok: false,
      error: full
        ? "No hay espacio en el teléfono para guardarlo. Quita otros libros guardados o libera espacio."
        : "No se pudo guardar. Revisa tu conexión e intenta de nuevo.",
    };
  }
}

/** Quita el libro de este dispositivo (sigue en la biblioteca). */
export async function removeSavedLibraryFile(id: string): Promise<void> {
  if (!canStore()) return;
  await (await caches.open(BOOKS_CACHE)).delete(absolute(id)).catch(() => false);
}
