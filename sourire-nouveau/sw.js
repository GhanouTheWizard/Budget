const CACHE = "sourire-nouveau-v1";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
// On ne touche qu'aux caches de cette version d'essai, jamais à ceux de l'appli principale.
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("sourire-nouveau") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Réseau d'abord : la dernière version arrive dès qu'il y a du réseau. Hors ligne, on sert la copie gardée en cache.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-store" }).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return res; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
