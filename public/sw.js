// OutdoorWild Navigator service worker.
// App files: network first, cache as fallback (works offline after one visit).
// Map tiles: cache first, so pre-loaded and already seen tiles work without signal.

const APP_CACHE = 'owild-app-v1'
const TILE_CACHE = 'owild-tiles-v1'
const TILE_HOSTS = ['tile.opentopomap.org', 'tile.waymarkedtrails.org', 'tiles.openfreemap.org']
const MAX_TILES = 4000

self.addEventListener('install', (e) => {
  // paths relative to the worker's scope, so it also works under /<repo>/
  const scope = self.registration.scope
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll([scope, `${scope}manifest.webmanifest`, `${scope}icon.svg`])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim())
})

async function trimTiles(cache) {
  const keys = await cache.keys()
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)))
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (TILE_HOSTS.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(req.url)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) {
          cache.put(req.url, res.clone())
          if (Math.random() < 0.02) trimTiles(cache)
        }
        return res
      }),
    )
    return
  }

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(APP_CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match(self.registration.scope) : Response.error())),
    )
  }
})
