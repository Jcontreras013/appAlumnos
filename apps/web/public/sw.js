/*
 * Service worker de Plataforma Escolar: permite abrir el cuaderno del maestro y los libros de la
 * biblioteca sin internet.
 *
 * - Páginas del cuaderno (/panel/cuaderno…) y de la biblioteca: primero la red; sin conexión, la
 *   última copia.
 * - Libros que se guardaron para leer sin internet (/panel/biblioteca/archivo/…): siempre la copia
 *   guardada (el archivo de un material no cambia nunca); se borran al cerrar sesión.
 * - Código y estilos (/_next/static/…) y el lector de PDF (/pdfjs/<versión>/…): se guardan la primera
 *   vez (sus nombres cambian en cada versión).
 * - Logo del centro: la copia guardada mientras llega la nueva.
 * Todo lo demás pasa directo a la red. Los cambios que el maestro hace sin internet no pasan por
 * aquí: se guardan en IndexedDB y la página los envía al volver la conexión.
 *
 * También muestra los avisos de mensajes (Web Push) y, al tocarlos, abre la conversación.
 */
const VERSION = "v1";
const PAGES = `escolar-paginas-${VERSION}`;
const ASSETS = `escolar-recursos-${VERSION}`;
/** Debe coincidir con BOOKS_CACHE en src/lib/library-offline.ts. */
const BOOKS = "escolar-biblioteca-v1";
const OFFLINE_PREFIX = "/panel/cuaderno";
const LIBRARY_PREFIX = "/panel/biblioteca";
const LIBRARY_FILES = "/panel/biblioteca/archivo/";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("escolar-") && k !== PAGES && k !== ASSETS && k !== BOOKS)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

const under = (url, prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
const isLibraryFile = (url) => url.origin === self.location.origin && url.pathname.startsWith(LIBRARY_FILES);

const isOfflinePage = (url) =>
  url.origin === self.location.origin &&
  ((under(url, OFFLINE_PREFIX) && !url.pathname.endsWith("/sync")) ||
    (under(url, LIBRARY_PREFIX) && !isLibraryFile(url)));

const isStatic = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pdfjs/"));
const isLogo = (url) => url.origin === self.location.origin && url.pathname.startsWith("/panel/logo");

/** Clave de la página guardada: la dirección sin parámetros internos de Next. */
function pageKey(href) {
  const url = new URL(href);
  url.searchParams.delete("_rsc");
  url.hash = "";
  return url.href;
}

const isGoodPage = (res) =>
  res?.ok &&
  !res.redirected &&
  res.type === "basic" &&
  (res.headers.get("content-type") || "").includes("text/html");

/** Guarda una página y, de paso, el código que necesita para funcionar sin internet. */
async function savePage(key, response) {
  const cache = await caches.open(PAGES);
  await cache.put(key, response.clone());
  const html = await response.text();
  const urls = new Set();
  for (const match of html.matchAll(/\/_next\/static\/[^"'\\\s<>)]+/g)) urls.add(match[0]);
  await cacheAssets([...urls]);
}

async function cacheAssets(urls) {
  const cache = await caches.open(ASSETS);
  await Promise.all(
    urls.slice(0, 300).map(async (u) => {
      const url = new URL(u, self.location.origin);
      if (!isStatic(url) || (await cache.match(url.href))) return;
      try {
        const res = await fetch(url.href);
        if (res.ok) await cache.put(url.href, res);
      } catch {
        // Sin conexión: se intentará en la próxima visita.
      }
    }),
  );
}

async function fetchPage(href) {
  const res = await fetch(href, { credentials: "same-origin", headers: { accept: "text/html" } });
  if (isGoodPage(res)) {
    await savePage(pageKey(href), res);
    return true;
  }
  return false;
}

/** Un tramo (`Range: bytes=a-b`) de un libro guardado, como lo entregaría el servidor. */
async function withRange(saved, range) {
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return saved;
  const blob = await saved.blob();
  const size = blob.size;
  let start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  let end = match[1] === "" || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  start = Math.max(0, start);
  end = Math.max(start, end);
  const headers = new Headers(saved.headers);
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(blob.slice(start, end + 1), { status: 206, headers });
}

function offlinePage() {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100dvh;margin:0;padding:1rem}main{max-width:28rem;background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;padding:1.5rem}a{color:#086f57;font-weight:600}</style></head>
<body><main><h1 style="font-size:1.25rem;margin:0 0 .5rem">Sin conexión</h1>
<p>Esta página no está guardada en el dispositivo. El cuaderno del maestro y los libros que guardaste en la biblioteca sí funcionan sin internet si los abriste antes con conexión.</p>
<p><a href="${OFFLINE_PREFIX}">Ir a Mi cuaderno</a> · <a href="${LIBRARY_PREFIX}">Ir a la biblioteca</a></p></main></body></html>`;
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const cached = await cache.match(request.url);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok) await cache.put(request.url, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (isLibraryFile(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(BOOKS);
        const saved = await cache.match(url.origin + url.pathname);
        if (!saved) return fetch(request);
        return withRange(saved, request.headers.get("range"));
      })(),
    );
    return;
  }

  if (isLogo(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const cached = await cache.match(request.url);
        const network = fetch(request)
          .then(async (res) => {
            if (res.ok && !res.redirected) await cache.put(request.url, res.clone());
            return res;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(network);
          return cached;
        }
        return (await network) || new Response("", { status: 504 });
      })(),
    );
    return;
  }

  if (request.mode !== "navigate") return;

  if (isOfflinePage(url)) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (isGoodPage(res)) event.waitUntil(savePage(pageKey(request.url), res.clone()));
          return res;
        } catch {
          const cache = await caches.open(PAGES);
          return (await cache.match(pageKey(request.url), { ignoreVary: true })) || offlinePage();
        }
      })(),
    );
    return;
  }

  // Otras páginas del panel: si no hay conexión, avisar en vez de mostrar el error del navegador.
  if (url.origin === self.location.origin && url.pathname.startsWith("/panel")) {
    event.respondWith(fetch(request).catch(() => offlinePage()));
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const reply = (value) => event.ports[0]?.postMessage(value);
  event.waitUntil(
    (async () => {
      if (data.type === "clear") {
        // Al cerrar sesión: ni las páginas ni los libros guardados quedan en el dispositivo.
        await caches.delete(PAGES);
        await caches.delete(BOOKS);
        return reply({ ok: true });
      }
      if (data.type === "assets") {
        await cacheAssets(Array.isArray(data.urls) ? data.urls : []);
        return reply({ ok: true });
      }
      if (data.type === "precache" || data.type === "refresh") {
        const cache = await caches.open(PAGES);
        let cached = 0;
        for (const href of Array.isArray(data.urls) ? data.urls.slice(0, 60) : []) {
          let url;
          try {
            url = new URL(href, self.location.origin);
          } catch {
            continue;
          }
          if (!isOfflinePage(url)) continue;
          const existing = await cache.match(pageKey(url.href), { ignoreVary: true });
          // precache: solo lo que falta. refresh: solo lo que ya estaba guardado.
          if (data.type === "precache" && existing) {
            cached++;
            continue;
          }
          if (data.type === "refresh" && !existing) continue;
          try {
            if (await fetchPage(url.href)) cached++;
          } catch {
            // Sin conexión.
          }
        }
        return reply({ cached });
      }
      return reply(null);
    })(),
  );
});

// ───────────────────────────── Avisos de mensajes ─────────────────────────────

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Un aviso que no se entiende igual se muestra, sin detalle.
  }
  const title = typeof data.title === "string" && data.title ? data.title : "CONECTA";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" && data.tag ? data.tag : "conecta",
      renotify: true,
      data: { url: typeof data.url === "string" ? data.url : "/panel/mensajes" },
    }),
  );
});

/** Solo direcciones del propio panel: un aviso nunca lleva a otro sitio. */
function panelUrl(path) {
  try {
    const url = new URL(path, self.location.origin);
    if (url.origin === self.location.origin && url.pathname.startsWith("/panel")) return url.href;
  } catch {
    // Dirección inválida: se abre la lista de mensajes.
  }
  return new URL("/panel/mensajes", self.location.origin).href;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = panelUrl(event.notification.data?.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ("navigate" in open) await open.navigate(target).catch(() => self.clients.openWindow(target));
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
