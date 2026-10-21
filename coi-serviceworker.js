// GitHub Pages cannot send the two headers that SharedArrayBuffer needs (Cross-Origin-Opener-Policy and
// Cross-Origin-Embedder-Policy). This service worker adds them to every response of the page, so the app runs from
// static hosting too. index.html registers it only when the page is not already isolated (serve.mjs sends the headers itself).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  // 'no-cache': ask the server whether a file changed (a cheap conditional request) so a new build is never held back by the browser's cache
  e.respondWith(fetch(r.mode === 'navigate' || r.cache === 'only-if-cached' ? r : new Request(r, { cache: 'no-cache' })).then(res => {
    if (res.status === 0) return res;
    const h = new Headers(res.headers);
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }).catch(() => fetch(r)));
});
