const CACHE = 'finance-shell-v2';

// Store the page and every script and style it loads as soon as the app is
// installed, so it opens offline even if it was only visited once.
async function precacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch('/', { cache: 'reload' });
  if (!response.ok) return;
  const html = await response.clone().text();
  await cache.put('/', response);
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => !url.startsWith('/api/'));
  await Promise.all([...new Set(assets)].map((url) => cache.add(url).catch(() => {})));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const home = await cache.match('/') || await cache.match('/index.html');
        if (home) return home;
      }
      return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
