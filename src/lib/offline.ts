// Offline support: saved routes in localStorage, and pre-loading the map
// tiles along a route into the service worker's tile cache.

import type { PlannedRoute } from './planner'
import type { LonLat } from './geo'

export const TILE_CACHE = 'owild-tiles-v1'
const SAVED_KEY = 'owild-saved-routes'

export interface SavedRoute {
  savedAt: number
  route: PlannedRoute
}

export function loadSaved(): SavedRoute[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as SavedRoute[]
  } catch {
    return []
  }
}

export function saveRoute(route: PlannedRoute): SavedRoute[] {
  const list = loadSaved().filter((s) => s.route.id !== route.id)
  list.unshift({ savedAt: Date.now(), route })
  const trimmed = list.slice(0, 20)
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(trimmed))
  } catch {
    // storage full: keep fewer routes
    localStorage.setItem(SAVED_KEY, JSON.stringify(trimmed.slice(0, 5)))
  }
  return trimmed
}

export function deleteSaved(id: string): SavedRoute[] {
  const list = loadSaved().filter((s) => s.route.id !== id)
  localStorage.setItem(SAVED_KEY, JSON.stringify(list))
  return list
}

const tileXY = (p: LonLat, z: number): [number, number] => {
  const n = 2 ** z
  const x = Math.floor(((p[0] + 180) / 360) * n)
  const lat = (p[1] * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n)
  return [x, y]
}

/** Tiles touched by the route (plus one ring of neighbours) for the given zooms. */
export function corridorTiles(coords: LonLat[], zooms: number[]): string[] {
  const set = new Set<string>()
  for (const z of zooms) {
    for (const p of coords) {
      const [x, y] = tileXY(p, z)
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) set.add(`${z}/${x + dx}/${y + dy}`)
    }
  }
  return [...set]
}

/**
 * Downloads the tiles along a route politely (2 at a time) into the cache.
 * `templates` are URL templates with {z}/{x}/{y}.
 */
export async function prefetchCorridor(
  coords: LonLat[],
  templates: string[],
  onProgress: (done: number, total: number) => void,
  maxTiles = 600,
): Promise<number> {
  const tiles = corridorTiles(coords, [12, 13, 14, 15]).slice(0, maxTiles)
  const urls = templates.flatMap((t) => tiles.map((k) => {
    const [z, x, y] = k.split('/')
    return t.replace('{z}', z).replace('{x}', x).replace('{y}', y)
  }))
  const cache = await caches.open(TILE_CACHE)
  let done = 0
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++]
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { mode: 'cors' })
          if (res.ok) await cache.put(url, res)
        }
      } catch {
        // skip tiles that fail, the rest is still useful
      }
      onProgress(++done, urls.length)
    }
  }
  await Promise.all([worker(), worker()])
  return urls.length
}
