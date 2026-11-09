/*
 * Comunicación con el service worker (public/sw.js), que guarda las páginas del cuaderno para
 * abrirlas sin internet.
 */

export const OFFLINE_PREFIX = "/panel/cuaderno";

export const isOfflinePage = (path: string) =>
  (path === OFFLINE_PREFIX || path.startsWith(`${OFFLINE_PREFIX}/`)) && !path.endsWith("/sync");

type Message =
  | { type: "precache"; urls: string[] }
  | { type: "refresh"; urls: string[] }
  | { type: "assets"; urls: string[] }
  | { type: "clear" };

async function post(message: Message): Promise<unknown> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const worker = registration?.active;
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => resolve(null), 60_000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      resolve(event.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

export async function registerServiceWorker(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  // En desarrollo no: guardaría versiones viejas del código mientras se edita.
  if (process.env.NODE_ENV !== "production") return false;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    // La página que se cargó antes de que existiera el service worker también queda guardada.
    const assets = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((url) => new URL(url).pathname.startsWith("/_next/static/"));
    await post({ type: "assets", urls: assets });
    if (isOfflinePage(location.pathname)) await post({ type: "precache", urls: [location.href] });
    return true;
  } catch {
    return false;
  }
}

/** Guarda páginas (y su código) para poder abrirlas sin internet. Devuelve cuántas quedaron. */
export async function precachePages(urls: string[]): Promise<number | null> {
  const reply = (await post({ type: "precache", urls })) as { cached?: number } | null;
  return reply?.cached ?? null;
}

/** Vuelve a descargar las páginas guardadas, para que la copia sin internet tenga lo último. */
export function refreshCachedPages(urls: string[]) {
  void post({ type: "refresh", urls: urls.map((u) => new URL(u, location.origin).href) });
}

/** Borra las páginas guardadas (al salir o en la pantalla de inicio de sesión). */
export function clearCachedPages() {
  void post({ type: "clear" });
}
