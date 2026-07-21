const CACHE = 'powerlens-v2'; // v2 : bump obligatoire suite à la refonte du thème (évite un cache clair-sur-sombre périmé)

// Assets à mettre en cache pour le shell offline
const PRECACHE = ['/', '/offline.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first : toujours essayer le réseau, fallback cache si offline
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Ne pas intercepter les appels API backend
  if (e.request.url.includes(':3000')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((cached) => {
          if (cached) return cached;
          // Navigation (changement de page) sans réseau ni cache : page hors-ligne dédiée.
          if (e.request.mode === 'navigate') return caches.match('/offline.html');
          return undefined;
        }),
      )
  );
});
