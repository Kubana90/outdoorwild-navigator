// Places worth seeing along a route: history (castles, ruins, Roman forts,
// monasteries, burial mounds …), nature (viewpoints, peaks, springs, caves)
// and places to rest (huts, drinking water). From OpenStreetMap via
// Overpass; castles and forts mapped as areas count by their centre.
// Cached a week.

import type { RawRoute } from './brouter'
import { snapToLine, type LonLat } from './geo'
import { elementPos, overpass } from './overpass'

export type PoiKind =
  // history
  | 'Burg'
  | 'Burgruine'
  | 'Schloss'
  | 'Ruine'
  | 'Römerkastell'
  | 'Bodendenkmal'
  | 'Grabhügel'
  | 'Kloster'
  | 'Kirche'
  | 'Turm'
  | 'Stadttor'
  | 'Historische Brücke'
  | 'Bergwerk'
  | 'Denkmal'
  | 'Grenzstein'
  | 'Historischer Ort'
  // nature
  | 'Aussichtspunkt'
  | 'Aussichtsturm'
  | 'Gipfel'
  | 'Quelle'
  | 'Wasserfall'
  | 'Höhle'
  | 'Felsen'
  | 'Naturdenkmal'
  // rest
  | 'Schutzhütte'
  | 'Trinkwasser'

export type PoiCategory = 'history' | 'nature' | 'rest'

export interface Poi {
  kind: PoiKind
  category: PoiCategory
  name: string | null
  pos: LonLat
  /** metres above sea level, when OSM knows it */
  ele?: number
  /** OSM wikipedia tag, e.g. "de:Minneburg" */
  wikipedia?: string
  /** OSM wikidata id, e.g. "Q1938620" */
  wikidata?: string
  /** 1 = small, 3 = landmark worth a detour */
  importance: 1 | 2 | 3
}

/** A POI placed relative to a route. */
export interface Highlight extends Poi {
  along: number
  offset: number
  side: 'links' | 'rechts' | 'am Weg'
}

export const POI_ICON: Record<PoiKind, string> = {
  Burg: '🏰',
  Burgruine: '🏰',
  Schloss: '🏯',
  Ruine: '🏚',
  Römerkastell: '🏛',
  Bodendenkmal: '🏺',
  Grabhügel: '⛰',
  Kloster: '⛪',
  Kirche: '⛪',
  Turm: '🗼',
  Stadttor: '🚪',
  'Historische Brücke': '🌉',
  Bergwerk: '⛏',
  Denkmal: '🗿',
  Grenzstein: '🪧',
  'Historischer Ort': '📜',
  Aussichtspunkt: '👁',
  Aussichtsturm: '🗼',
  Gipfel: '⛰',
  Quelle: '💧',
  Wasserfall: '🌊',
  Höhle: '🕳',
  Felsen: '🪨',
  Naturdenkmal: '🌳',
  Schutzhütte: '🛖',
  Trinkwasser: '🚰',
}

export const CATEGORY_COLOR: Record<PoiCategory, string> = {
  history: '#8e3b1f',
  nature: '#00897b',
  rest: '#5d6d7e',
}

const CACHE_PREFIX = 'owild-poi4:'
const CACHE_DAYS = 7

type Classified = { kind: PoiKind; category: PoiCategory } | null

/** Decides what an OSM object is, or null when it isn't worth showing. */
export function classify(t: Record<string, string>): Classified {
  const named = !!t.name
  const wiki = !!(t.wikipedia || t.wikidata)
  const h = t.historic
  // squares and streets named after a castle are not the castle
  if (named && /(platz|stra(ss|ß)e|gasse|weg)$/i.test(t.name)) return null
  if (h) {
    const H = (kind: PoiKind): Classified => ({ kind, category: 'history' })
    if (h === 'castle') {
      if (t.castle_type === 'stately' || t.castle_type === 'manor' || t.castle_type === 'palace' || /schlo(ss|ß)/i.test(t.name ?? '')) return H('Schloss')
      if (t.castle_type === 'castrum' || /kastell/i.test(t.name ?? '')) return H('Römerkastell')
      if (t.ruins === 'yes' || /ruine/i.test(t.name ?? '')) return H('Burgruine')
      return H('Burg')
    }
    if (h === 'fort') return H(/kastell/i.test(t.name ?? '') ? 'Römerkastell' : 'Burg')
    if (h === 'ruins') return H(/burg/i.test(t.name ?? '') ? 'Burgruine' : 'Ruine')
    if (h === 'archaeological_site') {
      if (t.site_type === 'castrum' || /kastell|limes/i.test(t.name ?? '')) return H('Römerkastell')
      if (t.site_type === 'tumulus' || /hügelgr|grabhügel/i.test(t.name ?? '')) return H('Grabhügel')
      return named ? H('Bodendenkmal') : null
    }
    if (h === 'tomb') return named ? H(t.tomb === 'tumulus' || /hügel/i.test(t.name ?? '') ? 'Grabhügel' : 'Denkmal') : null
    if (h === 'monastery') return H('Kloster')
    if (h === 'church' || h === 'chapel') return named ? H('Kirche') : null
    if (h === 'tower') return named ? H('Turm') : null
    if (h === 'city_gate') return H('Stadttor')
    if (h === 'bridge' || h === 'aqueduct') return named ? H('Historische Brücke') : null
    if (h === 'mine' || h === 'mine_shaft' || h === 'adit') return H('Bergwerk')
    if (h === 'boundary_stone') return wiki ? H('Grenzstein') : null
    // plaques and small memorials are everywhere; only named ones with an article
    if (h === 'memorial' || h === 'monument') return wiki && named ? H('Denkmal') : null
    if (h === 'manor') return H('Schloss')
    if (h === 'yes') return named ? H('Historischer Ort') : null
    return null
  }
  const N = (kind: PoiKind): Classified => ({ kind, category: 'nature' })
  if (t.tourism === 'viewpoint') return N('Aussichtspunkt')
  if (t.man_made === 'tower') return N('Aussichtsturm')
  if (t.natural === 'peak') return N('Gipfel')
  if (t.natural === 'spring') return N('Quelle')
  if (t.natural === 'waterfall' || t.waterway === 'waterfall') return N('Wasserfall')
  if (t.natural === 'cave_entrance') return N('Höhle')
  if (t.natural === 'rock' || t.natural === 'stone' || t.natural === 'cliff') return N('Felsen')
  if (t.natural === 'tree') return N('Naturdenkmal')
  // a shelter is only worth a word if it's a hut in the woods, not a bus stop
  if (t.amenity === 'shelter') return t.shelter_type === 'public_transport' ? null : { kind: 'Schutzhütte', category: 'rest' }
  if (t.amenity === 'drinking_water') return { kind: 'Trinkwasser', category: 'rest' }
  return null
}

const LANDMARKS: PoiKind[] = ['Burg', 'Burgruine', 'Schloss', 'Römerkastell', 'Kloster', 'Wasserfall', 'Höhle', 'Aussichtsturm']
/** worth a detour when they have an article */
const NOTABLE: PoiKind[] = ['Ruine', 'Bodendenkmal', 'Grabhügel', 'Stadttor', 'Turm', 'Historische Brücke', 'Bergwerk']

export function importanceOf(kind: PoiKind, t: Record<string, string>): 1 | 2 | 3 {
  const wiki = !!(t.wikipedia || t.wikidata)
  if (LANDMARKS.includes(kind) && t.name) return 3
  if (NOTABLE.includes(kind) && wiki) return 3
  if (t.name || wiki || kind === 'Aussichtspunkt' || kind === 'Ruine') return 2
  return 1
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
  const query = `[out:json][timeout:60];(
node["tourism"="viewpoint"]${b};
node["natural"~"^(spring|peak|cave_entrance|rock|cliff|stone|waterfall)$"]${b};
node["waterway"="waterfall"]${b};
node["amenity"~"^(shelter|drinking_water)$"]${b};
node["man_made"="tower"]["tower:type"="observation"]${b};
node["natural"="tree"]["denotation"="natural_monument"]${b};
nwr["historic"~"^(castle|ruins|archaeological_site|fort|tower|city_gate|monastery|manor|mine|mine_shaft|adit|church|chapel|bridge|aqueduct|tomb)$"]${b};
nwr["historic"~"^(memorial|monument|boundary_stone)$"]["wikipedia"]${b};
nwr["historic"~"^(memorial|monument|boundary_stone)$"]["wikidata"]${b};
nwr["historic"="yes"]["name"]${b};
);out center tags;`
  const elements = await overpass(query, signal)
  const pois: Poi[] = []
  for (const el of elements) {
    const t = el.tags ?? {}
    const c = classify(t)
    const pos = elementPos(el)
    if (!c || !pos) continue
    const ele = t.ele ? Number(t.ele.replace(',', '.')) : NaN
    pois.push({
      ...c,
      name: t.name || null,
      pos,
      importance: importanceOf(c.kind, t),
      ...(Number.isFinite(ele) ? { ele } : {}),
      ...(t.wikipedia ? { wikipedia: t.wikipedia } : {}),
      ...(t.wikidata ? { wikidata: t.wikidata } : {}),
    })
  }
  const unique = dedupePois(pois)
  try {
    if (unique.length) localStorage.setItem(key, JSON.stringify({ t: Date.now(), pois: unique }))
  } catch {
    // storage full: the in-memory list still works
  }
  return unique
}

/**
 * A castle is often in OSM several times (the area, a node, its keep).
 * Keep one per name within 300 m, preferring the one with an article.
 */
export function dedupePois(pois: Poi[]): Poi[] {
  const out: Poi[] = []
  const sorted = [...pois].sort((a, b) => b.importance - a.importance || Number(!!b.wikipedia) - Number(!!a.wikipedia) || Number(!!b.name) - Number(!!a.name))
  for (const p of sorted) {
    const dup = out.some((o) => {
      if (Math.abs(o.pos[1] - p.pos[1]) > 0.003 || Math.abs(o.pos[0] - p.pos[0]) > 0.0045) return false
      if (o.wikipedia && o.wikipedia === p.wikipedia) return true
      if (!!o.name && o.name === p.name) return true
      // an unnamed part (keep, wall, "Burg") right next to a named place of the same kind
      return !p.name && !!o.name && o.category === p.category && Math.abs(o.pos[1] - p.pos[1]) < 0.0014 && Math.abs(o.pos[0] - p.pos[0]) < 0.002
    })
    if (!dup) out.push(p)
  }
  return out
}

function sideOf(route: RawRoute, p: Poi, index: number, point: LonLat, offset: number): Highlight['side'] {
  const { coords } = route
  const a = coords[index]
  const b = coords[Math.min(index + 1, coords.length - 1)]
  const kx = Math.cos((a[1] * Math.PI) / 180)
  const cross = (b[0] - a[0]) * kx * (p.pos[1] - point[1]) - (b[1] - a[1]) * ((p.pos[0] - point[0]) * kx)
  return offset < 25 ? 'am Weg' : cross > 0 ? 'links' : 'rechts'
}

/**
 * POIs near the route, in route order. Places right on the way count up to
 * `maxOffset`; history landmarks count further out, as possible detours.
 */
export function highlightsAlongRoute(route: RawRoute, pois: Poi[], maxOffset = 120, detourOffset = 800): Highlight[] {
  const out: Highlight[] = []
  const { coords, cum } = route
  if (coords.length < 2) return out
  for (const p of pois) {
    const limit = p.category === 'history' && p.importance >= 2 ? detourOffset : maxOffset
    const s = snapToLine(p.pos, coords, cum)
    if (s.offset > limit) continue
    out.push({ ...p, along: s.along, offset: s.offset, side: sideOf(route, p, s.index, s.point, s.offset) })
  }
  out.sort((x, y) => x.along - y.along)
  // the same spot often has a peak and a viewpoint node: keep the first
  return out.filter((h, i) => !out.slice(0, i).some((o) => Math.abs(o.along - h.along) < 60 && (o.name ?? o.kind) === (h.name ?? h.kind)))
}

/** Highlights right on the way (no detour needed). */
export const onTheWay = (hs: Highlight[], max = 120) => hs.filter((h) => h.offset <= max)
/** History landmarks a short walk or ride off the way. */
export const detourCandidates = (hs: Highlight[], min = 120) => hs.filter((h) => h.offset > min && h.category === 'history')

export const highlightLabel = (h: Poi) => `${h.kind}${h.name ? ` „${h.name}“` : ''}${h.ele ? ` (${Math.round(h.ele)} m)` : ''}`
