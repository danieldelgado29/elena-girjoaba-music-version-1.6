"use strict";

/*
 * EGP MUSICOS — OFFLINE INMEDIATO
 *
 * Si la app ya está instalada/cacheada:
 * - abre desde caché inmediatamente;
 * - la red actualiza por detrás;
 * - una Wi‑Fi sin Internet jamás bloquea el arranque.
 */

const CACHE = "egp-musicos-ui24r-health-20260902-v1";

const CORE = [
  "./",
  "./?musicos_pwa=1",
  "./index.html",
  "./style.css?v=espacio-animacion-20260819-190549",
  "./app.js?v=lan-cache-fix-20260901-v2",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "../egp-photo-responsive.js?v=responsive-photos-20260824",
  "../canciones.json",
  "../configuracion.json"
];

const scopeUrl = path =>
  new URL(path, self.registration.scope).href;

async function fetchFresh(url) {
  try {
    const response = await fetch(
      new Request(url, { cache: "reload" })
    );

    if (
      !response ||
      !(response.ok || response.type === "opaque")
    ) {
      return null;
    }

    return response;
  } catch (_) {
    return null;
  }
}

async function preload(cache, relativeUrl) {
  const url = scopeUrl(relativeUrl);
  const response = await fetchFresh(url);

  if (!response) {
    throw new Error("No se pudo precargar: " + relativeUrl);
  }

  await cache.put(url, response.clone());
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    await Promise.all(
      CORE.map(url => preload(cache, url))
    );

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(
          key =>
            key.startsWith("egp-musicos-") &&
            key !== CACHE
        )
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

async function getCached(request, fallbackRelative = null) {
  /*
   * IMPORTANTE:
   * NO ignorar query strings.
   * app.js?v=NUEVO debe recibir exactamente esa versión,
   * nunca una copia anterior de app.js?v=VIEJO.
   */
  const direct = await caches.match(request);

  if (direct) return direct;

  if (fallbackRelative) {
    return (
      await caches.match(scopeUrl(fallbackRelative))
    ) || null;
  }

  return null;
}

async function refreshInBackground(request) {
  try {
    const response = await fetch(
      new Request(request, { cache: "no-store" })
    );

    if (
      response &&
      (response.ok || response.type === "opaque")
    ) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }

    return response;
  } catch (_) {
    return null;
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /*
   * Firebase, Local Core y Ui24R son conexiones aparte.
   * No pueden bloquear el shell local.
   */
  if (url.origin !== self.location.origin) return;

  /*
   * La actualización de red arranca por detrás.
   * Si hay caché, respondemos con ella sin esperar Internet.
   */
  const networkRefresh =
    refreshInBackground(request);

  event.waitUntil(
    networkRefresh.then(() => {}).catch(() => {})
  );

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const local =
        await getCached(request, "./index.html");

      if (local) return local;

      const online = await networkRefresh;
      if (online) return online;

      return (
        await getCached(
          scopeUrl("./index.html")
        )
      ) || Response.error();
    })());

    return;
  }

  event.respondWith((async () => {
    const local = await getCached(request);

    if (local) return local;

    const online = await networkRefresh;
    return online || Response.error();
  })());
});
