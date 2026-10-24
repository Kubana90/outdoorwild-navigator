// Natural and cultural highlights next to a route: viewpoints, peaks,
// springs, shelters, ruins … from OpenStreetMap via Overpass, cached a week.

import type { RawRoute } from './brouter'
import { snapToLine, type LonLat } from './geo'
import { overpass } from './overpass'

export type PoiKind =
  | 'Aussichtspunkt'
  | 'Aussichtsturm'
  | 'Gipfel'
  | 'Quelle'
  | 'Wasserfall'
  | 'Höhle'
  | 'Felsen'
  | 'Schutzhütte'
  | 'Trinkwasser'
  | 'Burg'
  | 'Ruine'
  | 'Bodendenkmal'
  | 'Naturdenkmal'

export interface Poi {
  kind: PoiKind
  name: string | null
  pos: LonLat
  /** metres above sea level, when OSM knows it */
  ele?: number
}

/** A POI placed on a route. */
export interface Highlight extends Poi {
  along: number
  offset: number
  side: 'links' | 'rechts' | 'am Weg'
}

export const POI_ICON: Record<PoiKind, string> = {
  Aussichtspunkt: '👁',
  Aussichtsturm: '🗼',
  Gipfel: '⛰',
  Quelle: '💧',
  Wasserfall: '🌊',
  Höhle: '🕳',
  Felsen: '🪨',
  Schutzhütte: '🛖',
  Trinkwasser: '🚰',
  Burg: '🏰',
  Ruine: '🏚',
  Bodendenkmal: '🏺',
  Naturdenkmal: '🌳',
}

const CACHE_PREFIX = 'owild-poi:'
const CACHE_DAYS = 7

function classify(t: Record<string, string>): PoiKind | null {
  if (t.tourism === 'viewpoint') return 'Aussichtspunkt'
  if (t.man_made === 'tower') return 'Aussichtsturm'
  if (t.natural === 'peak') return 'Gipfel'
  if (t.natural === 'spring') return 'Quelle'
  if (t.natural === 'waterfall' || t.waterway === 'waterfall') return 'Wasserfall'
  if (t.natural === 'cave_entrance') return 'Höhle'
  if (t.natural === 'rock' || t.natural === 'stone' || t.natural === 'cliff') return 'Felsen'
  if (t.amenity === 'shelter') return 'Schutzhütte'
  if (t.amenity === 'drinking_water') return 'Trinkwasser'
  if (t.historic === 'castle') return 'Burg'
  if (t.historic === 'ruins') return 'Ruine'
  if (t.historic === 'archaeological_site') return t.name ? 'Bodendenkmal' : null
  if (t.natural === 'tree') return 'Naturdenkmal'
  return null
}

export async function fetchPois(bbox: [number, number, number, number], signal?: AbortSignal): Promise<Poi[]> {
  const key = CACHE_PREFIX + bbox.map((v) => v.toFixed(2)).join(',')
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null') as { t: number; pois: Poi[] } | null
    if (hit?.pois && Date.now() - hit.t < CACHE_DAYS * 86400000) return hit.pois
  } catch {
    // no storage: fetch every time
  }
  const [w, s, e, n] = bbox
  const b = `(${s},${w},${n},${e})`
  const query = `[out:json][timeout:30];(
node["tourism"="viewpoint"]${b};
node["natural"~"^(spring|peak|cave_entrance|rock|cliff|stone|waterfall)$"]${b};
node["waterway"="waterfall"]${b};
node["amenity"~"^(shelter|drinking_water)$"]${b};
node["historic"~"^(ruins|castle|archaeological_site)$"]${b};
node["man_made"="tower"]["tower:type"="observation"]${b};
node["natural"="tree"]["denotation"="natural_monument"]${b};
);out body;`
  const elements = await overpass(query, signal)
  const pois: Poi[] = []
  for (const el of elements) {
    const t = el.tags ?? {}
    const kind = classify(t)
    if (!kind) continue
    // a shelter is only worth a word if it's a hut in the woods, not a bus stop
    if (kind === 'Schutzhütte' && t.shelter_type === 'public_transport') continue
    const ele = t.ele ? Number(t.ele.replace(',', '.')) : NaN
    pois.push({ kind, name: t.name || null, pos: [el.lon, el.lat], ...(Number.isFinite(ele) ? { ele } : {}) })
  }
  try {
    if (pois.length) localStorage.setItem(key, JSON.stringify({ t: Date.now(), pois }))
  } catch {
    // storage full: the in-memory list still works
  }
  return pois
}

/** POIs within `maxOffset` metres of the route, in route order, with the side they're on. */
export function highlightsAlongRoute(route: RawRoute, pois: Poi[], maxOffset = 120): Highlight[] {
  const out: Highlight[] = []
  const { coords, cum } = route
  if (coords.length < 2) return out
  for (const p of pois) {
    const s = snapToLine(p.pos, coords, cum)
    if (s.offset > maxOffset) continue
    const a = coords[s.index]
    const b = coords[Math.min(s.index + 1, coords.length - 1)]
    const kx = Math.cos((a[1] * Math.PI) / 180)
    const dx = (b[0] - a[0]) * kx
    const dy = b[1] - a[1]
    const vx = (p.pos[0] - s.point[0]) * kx
    const vy = p.pos[1] - s.point[1]
    const cross = dx * vy - dy * vx
    const side = s.offset < 25 ? 'am Weg' : cross > 0 ? 'links' : 'rechts'
    out.push({ ...p, along: s.along, offset: s.offset, side })
  }
  out.sort((x, y) => x.along - y.along)
  // the same spot often has a peak and a viewpoint node: keep the first
  return out.filter((h, i) => !out.slice(0, i).some((o) => Math.abs(o.along - h.along) < 60 && (o.name ?? o.kind) === (h.name ?? h.kind)))
}

export const highlightLabel = (h: Poi) => `${h.kind}${h.name ? ` „${h.name}“` : ''}${h.ele ? ` (${Math.round(h.ele)} m)` : ''}`
