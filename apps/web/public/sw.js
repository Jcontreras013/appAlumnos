/*
 * Service worker de Plataforma Escolar: permite abrir el cuaderno del maestro sin internet.
 *
 * - Páginas del cuaderno (/panel/cuaderno…): primero la red; si no hay conexión, la última copia.
 * - Código y estilos (/_next/static/…): se guardan la primera vez (sus nombres cambian en cada versión).
 * - Logo del centro: la copia guardada mientras llega la nueva.
 * Todo lo demás pasa directo a la red. Los cambios que el maestro hace sin internet no pasan por
 * aquí: se guardan en IndexedDB y la página los envía al volver la conexión.
 */
const VERSION = "v1";
const PAGES = `escolar-paginas-${VERSION}`;
const ASSETS = `escolar-recursos-${VERSION}`;
const OFFLINE_PREFIX = "/panel/cuaderno";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("escolar-") && k !== PAGES && k !== ASSETS)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

const isOfflinePage = (url) =>
  url.origin === self.location.origin &&
  (url.pathname === OFFLINE_PREFIX || url.pathname.startsWith(`${OFFLINE_PREFIX}/`)) &&
  !url.pathname.endsWith("/sync");

const isStatic = (url) => url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
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

function offlinePage() {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100dvh;margin:0;padding:1rem}main{max-width:28rem;background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;padding:1.5rem}a{color:#086f57;font-weight:600}</style></head>
<body><main><h1 style="font-size:1.25rem;margin:0 0 .5rem">Sin conexión</h1>
<p>Esta página no está guardada en el dispositivo. El cuaderno del maestro sí funciona sin internet si lo abriste antes con conexión.</p>
<p><a href="${OFFLINE_PREFIX}">Ir a Mi cuaderno</a></p></main></body></html>`;
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
        await caches.delete(PAGES);
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
