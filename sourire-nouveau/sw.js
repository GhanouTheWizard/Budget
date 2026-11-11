// ancienne version d'essai : le service worker se retire tout seul
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("sourire-nouveau")).map(k=>caches.delete(k)))).then(()=>self.registration.unregister())));
