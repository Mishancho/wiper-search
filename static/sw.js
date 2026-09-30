// Keep the offline shell current when a new release is installed.
const CACHE_NAME = 'wiper-search-v2';
const shellPaths = [
  '/',
  '/brake-pads',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(shellPaths))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names
        .filter(name => name.startsWith('wiper-search-') && name !== CACHE_NAME)
        .map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Search requests always use the live server snapshot.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !shellPaths.includes(url.pathname)) return;

  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw new Error('Offline shell unavailable');
    })
  );
});
