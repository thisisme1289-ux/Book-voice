// Legible — Service Worker
// Caches the app shell + all CDN scripts so the app works fully offline.

const CACHE   = 'legible-v1';
const RUNTIME = 'legible-runtime-v1';

// Everything we want cached immediately on install
const PRECACHE = [
  './',                       // the HTML file itself
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js',
  'https://sdk.amazonaws.com/js/aws-sdk-2.1691.0.min.js',
  'https://checkout.razorpay.com/v1/checkout.js',
  // Google Fonts CSS (the actual font files get cached at runtime)
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
];

// Install: pre-cache everything we can
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Cache each resource individually so one failure doesn't block the rest
      await Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(e => console.warn('[SW] Failed to cache:', url, e))
        )
      );
      // Skip waiting so the new SW activates immediately
      self.skipWaiting();
    })
  );
});

// Listen for skip-waiting message from page
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== RUNTIME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: serve from cache, fall back to network, cache new responses
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Skip non-GET, chrome-extension, and data URLs
  if (event.request.method !== 'GET') return;
  if (url.startsWith('chrome-extension')) return;
  if (url.startsWith('data:')) return;

  // For API calls (server calls) — network only, don't cache
  if (url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;   // serve from cache instantly

      // Not in cache — fetch from network and cache the response
      return fetch(event.request).then(response => {
        // Only cache valid responses from safe origins
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        const clone = response.clone();
        caches.open(RUNTIME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Network failed and not in cache — return offline fallback for HTML
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./');
        }
        // For other resources, just fail gracefully
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
