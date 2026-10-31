// UniHR Hand-Rolled Service Worker
const CACHE_NAME = 'unihr-v1';

// Precache ONLY: /offline page, manifest, icons
const PRECACHE_ASSETS = [
  '/offline',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: precache offline assets and skipWaiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete old cache versions and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: Strategy dispatcher
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Same-origin checks
  if (url.origin !== self.location.origin) {
    return;
  }

  // RULE 1: NEVER cache /api/* (always network, direct pass through)
  if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
    return;
  }

  // RULE 2: Documents (navigation / HTML) -> Network-first, fallback to cache then /offline
  const isDocument =
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    (request.headers.get('accept') && request.headers.get('accept').includes('text/html'));

  if (isDocument) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }
        const offlineFallback = await caches.match('/offline');
        if (offlineFallback) {
          return offlineFallback;
        }
        return new Response("You're offline — reconnect to use UniHR", {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
    );
    return;
  }

  // RULE 3: Static assets (/_next/static, /icons, manifest) -> Cache-first with revalidate
  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon.ico';

  if (isStatic) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Network failed, nothing to revalidate
          });

        return cachedResponse || networkFetch;
      })
    );
    return;
  }

  // Default: pass through to network
});

