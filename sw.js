/**
 * Legible — Service Worker v6
 *
 * WHAT THIS SW DOES
 * -----------------
 * 1. Pre-caches the app shell (HTML + heavy CDN scripts) on install so
 *    the reader opens instantly on repeat visits, even offline.
 * 2. Cache-first for static assets, network-with-cache-fallback for the rest.
 * 3. Never caches API calls, TTS fetches, or payment scripts.
 * 4. Protects against opaque-response Cache Storage bloat.
 * 5. Cleans stale caches on activation.
 * 6. Supports SKIP_WAITING + GET_CACHE_INFO messages from main thread.
 *
 * BACKGROUND AUDIO
 * ----------------
 * The SW does not play audio. Background audio on Android Chrome is kept
 * alive in the main thread via:
 *   - A single <audio> element as the sole audio output node
 *   - An inaudible 20 Hz AudioContext oscillator for OS audio focus
 *   - The Media Session API for lock-screen / BT headset controls
 * The SW's role: make the page load fast and survive offline so the OS
 * never kills the tab due to a failed navigation.
 */

const SHELL_VER   = 'legible-shell-v6';
const RUNTIME_VER = 'legible-runtime-v6';
const MAX_RUNTIME = 120;

const SHELL_URLS = [
  './',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js',
  // NOTE: sdk.amazonaws.com is intentionally excluded — AWS SDK CDN does not
  // send CORS headers, so cache.add() fails with a CORS error. The script is
  // still loaded normally via the <script> tag in the HTML; it just won't be
  // precached for offline. All other assets cover the critical app shell.
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
];

const NO_CACHE_HOSTS = [
  'responsivevoice.org',
  'razorpay.com',
];

const NO_CACHE_PATHS = ['/api/', '/getvoice'];

function shouldSkipCache(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome-extension:') return true;
    if (NO_CACHE_HOSTS.some(h => u.hostname.includes(h))) return true;
    if (NO_CACHE_PATHS.some(p => u.pathname.startsWith(p))) return true;
    // Never cache AWS Polly endpoints
    if (u.hostname.startsWith('polly.') && u.hostname.endsWith('.amazonaws.com')) return true;
    return false;
  } catch { return true; }
}

function isCacheable(res) {
  if (!res) return false;
  if (res.status !== 200) return false;
  if (res.type === 'opaque') return false; // unknown status, can be huge
  if (res.type === 'error') return false;
  return true;
}

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_VER).then(async cache => {
      const results = await Promise.allSettled(
        SHELL_URLS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Precache miss:', url, err.message)
          )
        )
      );
      const ok = results.filter(r => r.status === 'fulfilled').length;
      console.log('[SW] Install: cached', ok + '/' + results.length, 'shell assets');
    }).then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('legible-') && k !== SHELL_VER && k !== RUNTIME_VER)
          .map(k => { console.log('[SW] Deleting stale cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Message ──────────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_CACHE_INFO') {
    Promise.all([
      caches.open(SHELL_VER).then(c => c.keys()).then(k => k.length),
      caches.open(RUNTIME_VER).then(c => c.keys()).then(k => k.length),
    ]).then(([shell, runtime]) =>
      event.source?.postMessage({ type: 'CACHE_INFO', shell, runtime })
    );
  }
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (shouldSkipCache(event.request.url)) return;
  event.respondWith(handleFetch(event.request));
});

async function handleFetch(req) {
  // Shell cache: always fresh from install
  const shellHit = await caches.match(req, { cacheName: SHELL_VER });
  if (shellHit) return shellHit;

  // Runtime cache: may be stale, use as fallback
  const runtimeHit = await caches.match(req, { cacheName: RUNTIME_VER });

  try {
    const netRes = await fetch(req);
    if (isCacheable(netRes)) {
      const clone = netRes.clone();
      caches.open(RUNTIME_VER).then(async cache => {
        await cache.put(req, clone);
        const keys = await cache.keys();
        if (keys.length > MAX_RUNTIME) {
          const excess = Math.ceil(keys.length * 0.1);
          await Promise.all(keys.slice(0, excess).map(k => cache.delete(k)));
        }
      }).catch(() => {});
    }
    return netRes;
  } catch {
    if (runtimeHit) return runtimeHit;
    const accept = req.headers.get('accept') || '';
    if (accept.includes('text/html')) {
      const fallback = await caches.match('./', { cacheName: SHELL_VER });
      if (fallback) return fallback;
    }
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
