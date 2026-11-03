/* =========================================================================
   Okur — Service Worker
   App Shell önbelleği (anında açılış + çevrimdışı), CDN modülleri için
   cache-first, kapak görselleri için sınırlı görüntü önbelleği.
   Firestore / Auth / Books API istekleri doğrudan ağa gider.
   ========================================================================= */
const VERSION = 'okur-v1.3.0';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const IMAGE_CACHE = 'okur-covers-v1';
const IMAGE_LIMIT = 220;

const SHELL = [
  '/',
  '/manifest.json',
  '/css/variables.css',
  '/css/liquid-glass.css',
  '/css/layout.css',
  '/css/animations.css',
  '/js/app.js',
  '/js/firebase-config.js',
  '/js/api-books.js',
  '/js/stats-engine.js',
  '/js/ui-components.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

const CDN_HOSTS = new Set(['www.gstatic.com', 'esm.sh']);
const IMAGE_HOSTS = /(^|\.)((wsrv\.nl)|(books\.google\.com)|(books\.googleusercontent\.com)|(covers\.openlibrary\.org)|(archive\.org))$/;

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('okur-v') && !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(navigationResponse(req));
      return;
    }
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // <img> kapakları (no-cors). Renk çıkarımı için yapılan CORS istekleri önbelleğe karışmaz.
  if (req.destination === 'image' && req.mode === 'no-cors' && IMAGE_HOSTS.test(url.hostname)) {
    event.respondWith(cacheFirst(req, IMAGE_CACHE, IMAGE_LIMIT));
  }
  // Diğer her şey (Firestore, Firebase Auth, Google Books API) ağdan gelir.
});

/** SPA gezinmesi: önce ağ, çevrimdışıysa önbellekteki uygulama kabuğu */
async function navigationResponse(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(req, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok && new URL(req.url).pathname === '/') cache.put('/', res.clone());
    return res;
  } catch {
    return (await cache.match('/')) || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req)
    .then(res => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

async function cacheFirst(req, cacheName, limit = 0) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      await cache.put(req, res.clone());
      if (limit) trim(cache, limit);
    }
    return res;
  } catch (err) {
    return cached || Response.error();
  }
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map(k => cache.delete(k)));
}
