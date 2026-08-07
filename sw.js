/* wadpixel service worker — OPTIONAL. Drop this file at the site root next to
   index.html and add the registration snippet (see README-offline.md).

   Why network-first for the page:
   the obvious cache-first worker is the one that bites. wadpixel's whole deploy
   check is "open the menu, read BUILD_ID" — a cache-first worker serves the old
   index.html forever and makes every deploy look like it silently failed. So the
   page is always fetched from the network when the network is there, and the
   cache is only the fallback for a plane / lift / dead signal.

   The two cdnjs libraries are the opposite case: pinned versions, immutable
   bytes, verified by SRI. Those are cached forever on first use, which is what
   finally makes GIF and ZIP export work offline. */

const CACHE = 'wadpixel-v1';
const PAGE  = './';

const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js',
  'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js'
];

self.addEventListener('install', e => {
  /* only the shell is precached; the libraries land on first export.
     cache:'reload' matters here — without it the precache can be filled from
     the browser's own HTTP cache, so the copy kept for offline use is the one
     that was already stale at install time. */
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.add(new Request(PAGE, {cache:'reload'})))
      .then(()=>self.skipWaiting())
  );
});

/* The page shows an "update ready" bar and offers a reload. This worker calls
   skipWaiting() above, so it normally never parks in "waiting" and the bar's
   button only has to reload. The handler is here so the two halves still agree
   if that ever changes — a worker that does wait can be told to take over, and
   the page reloads on the controllerchange that follows. */
self.addEventListener('message', e => {
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);

  // never touch the API — a cached gallery or a cached share response is worse
  // than an honest network error
  if(url.pathname.startsWith('/api/')) return;

  // pinned, immutable, SRI-checked: cache-first is safe and is the whole point
  if(LIBS.includes(url.href)){
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        // opaque responses (no CORS) are useless to cache — skip them
        if(res && res.ok && res.type !== 'opaque'){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // the app shell: network wins whenever it answers, so a fresh deploy is
  // picked up on the very next load and BUILD_ID tells the truth
  if(req.mode === 'navigate' || url.origin === self.location.origin){
    e.respondWith(
      fetch(req)
        .then(res => {
          if(res && res.ok && res.type === 'basic'){
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match(PAGE)))
    );
  }
});
