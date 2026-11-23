// Service worker : réseau d'abord, cache en secours pour le hors-ligne.
// La page et le manifeste sont revalidés auprès du serveur à chaque ouverture (sinon le cache HTTP
// de GitHub Pages peut servir l'ancienne version pendant 10 min). Les fichiers de assets/ ont un nom
// unique par version : ils peuvent venir du cache. Les tuiles et les API passent directement par le réseau.
const CACHE = 'flane-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function fromNetwork(req, url) {
  if (url.pathname.includes('/assets/')) return fetch(req);
  const res = await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
  // Une page redirigée (/flane → /flane/) doit être renvoyée comme une redirection.
  return res.redirected ? Response.redirect(res.url, 302) : res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const res = sameOrigin ? await fromNetwork(req, url) : await fetch(req);
        if (res.ok && !res.redirected) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
        if (hit) return hit;
        throw err;
      }
    }),
  );
});
