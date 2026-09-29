// Recipe Box service worker: installable app + offline reading in the kitchen.
// - App shell and static assets: cache first, refreshed in the background.
// - Recipe/plan/shopping GET requests: network first, cached copy when offline.
// - Recipe photos: cache first (their URLs change whenever the photo changes).
const VERSION = "rb-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) {
    if (url.hostname.endsWith("fonts.gstatic.com") || url.hostname.endsWith("fonts.googleapis.com")) event.respondWith(cacheFirst(request));
    return;
  }
  const p = url.pathname;
  if (p === "/mcp" || p.startsWith("/oauth") || p.startsWith("/.well-known") || p === "/authorize" || p === "/api/session") return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(new Request("/", { credentials: "same-origin" })).catch(() => caches.match("/")));
    return;
  }
  if (p.startsWith("/img/")) return event.respondWith(cacheFirst(request));
  if (p.startsWith("/api/")) return event.respondWith(networkFirst(request));
  if (p.startsWith("/assets/") || p.startsWith("/icons/")) return event.respondWith(cacheFirst(request));
});
