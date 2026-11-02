// Offline-Cache: App-Dateien (network-first) und Kartenbilder (cache-first, begrenzt).
// YGOPRODeck bittet darum, Bilder nicht wiederholt direkt zu laden.
const APP_CACHE = 'kb-app-v1';
const IMG_CACHE = 'kb-img-v1';
const MAX_IMAGES = 2000;
let imagesSupportCors = true;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![APP_CACHE, IMG_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimImages() {
  const cache = await caches.open(IMG_CACHE);
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(req);
}

async function cacheFirst(request) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  // Nur CORS-Antworten cachen: opake Antworten belegen im Browser-Kontingent mehrere MB pro Bild.
  // Liefert der Bildserver kein CORS, bleibt es beim normalen HTTP-Cache des Browsers.
  if (!imagesSupportCors) return fetch(request);
  try {
    const res = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      cache.put(request.url, res.clone()).catch(() => {});
      if (Math.random() < 0.05) trimImages();
    }
    return res;
  } catch {
    imagesSupportCors = false;
    return fetch(request);
  }
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname === 'images.ygoprodeck.com') {
    event.respondWith(cacheFirst(request));
  } else if (url.origin === self.location.origin || url.hostname.endsWith('fonts.gstatic.com') || url.hostname.endsWith('fonts.googleapis.com')) {
    event.respondWith(networkFirst(request));
  }
});
