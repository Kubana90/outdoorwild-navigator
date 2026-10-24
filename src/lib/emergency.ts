// Forest rescue points (Rettungspunkte) and the emergency card.
// Rettungspunkte are signposted meeting points rescue control centres know
// by code (e.g. "MOS-123"). They come from OpenStreetMap
// (highway=emergency_access_point) via the Overpass API and are cached per
// route, so the card also works without signal once a route was planned.

import { bearing, compassWord, distance, type LonLat } from './geo'

export interface RescuePoint {
  ref: string
  pos: LonLat
  /** free-text location from OSM, if any */
  note?: string
}

export interface NearestRescue extends RescuePoint {
  distance: number
  bearing: number
}

const OVERPASS = 'https://overpass-api.de/api/interpreter'
const CACHE_PREFIX = 'owild-rescue2:'
const CACHE_DAYS = 7

/** [west, south, east, north] around a line, padded by `pad` degrees. */
export function bboxOf(coords: LonLat[], pad = 0.03): [number, number, number, number] {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [x, y] of coords) {
    w = Math.min(w, x)
    s = Math.min(s, y)
    e = Math.max(e, x)
    n = Math.max(n, y)
  }
  return [w - pad, s - pad, e + pad, n + pad]
}

const cacheKey = (b: number[]) => CACHE_PREFIX + b.map((v) => v.toFixed(2)).join(',')

export async function fetchRescuePoints(bbox: [number, number, number, number], signal?: AbortSignal): Promise<RescuePoint[]> {
  const key = cacheKey(bbox)
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null') as { t: number; points: RescuePoint[] } | null
    if (hit?.points && Date.now() - hit.t < CACHE_DAYS * 86400000) return hit.points
  } catch {
    // no storage: fetch every time
  }
  const [w, s, e, n] = bbox
  const query = `[out:json][timeout:25];node["highway"="emergency_access_point"](${s},${w},${n},${e});out;`
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }), signal })
  if (!res.ok) throw new Error('Rettungspunkte nicht erreichbar')
  const json = (await res.json()) as { elements: { lat: number; lon: number; tags?: Record<string, string> }[] }
  const points = json.elements
    .filter((el) => el.tags?.ref)
    .map((el) => ({ ref: el.tags!.ref, pos: [el.lon, el.lat] as LonLat, note: el.tags!.description || el.tags!.name || undefined }))
  try {
    // an empty answer may be a gap in the data: ask again next time
    if (points.length) localStorage.setItem(key, JSON.stringify({ t: Date.now(), points }))
  } catch {
    // storage full: the in-memory list still works
  }
  return points
}

export function nearestRescue(pos: LonLat, points: RescuePoint[]): NearestRescue | null {
  let best: NearestRescue | null = null
  for (const p of points) {
    const d = distance(pos, p.pos)
    if (!best || d < best.distance) best = { ...p, distance: d, bearing: bearing(pos, p.pos) }
  }
  return best
}

/** Rescue points within `radius` metres of the route line (sampled). */
export function rescueAlongRoute(coords: LonLat[], points: RescuePoint[], radius = 1500): RescuePoint[] {
  const step = Math.max(1, Math.floor(coords.length / 200))
  return points.filter((p) => {
    for (let i = 0; i < coords.length; i += step) if (distance(coords[i], p.pos) <= radius) return true
    return false
  })
}

/** 49.53391° N, 9.20483° O */
export function formatDecimal(pos: LonLat): string {
  return `${pos[1].toFixed(5)}° N, ${pos[0].toFixed(5)}° O`
}

/** 49° 32′ 02″ N, 9° 12′ 17″ O — the format many control centres ask for. */
export function formatDms(pos: LonLat): string {
  const dms = (v: number) => {
    const d = Math.floor(v)
    const mFloat = (v - d) * 60
    const m = Math.floor(mFloat)
    const s = Math.round((mFloat - m) * 60)
    return s === 60 ? `${d}° ${String(m + 1).padStart(2, '0')}′ 00″` : `${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`
  }
  return `${dms(pos[1])} N, ${dms(pos[0])} O`
}

export const mapLink = (pos: LonLat) =>
  `https://www.openstreetmap.org/?mlat=${pos[1].toFixed(5)}&mlon=${pos[0].toFixed(5)}#map=17/${pos[1].toFixed(5)}/${pos[0].toFixed(5)}`

/** Text to send to a contact (not to 112, which takes calls only). */
export function emergencyMessage(pos: LonLat, accuracy: number | null, rescue: NearestRescue | null, activity: string): string {
  const lines = [
    `NOTFALL – ich brauche Hilfe (${activity}).`,
    `Standort: ${formatDecimal(pos)}${accuracy ? ` (±${Math.round(accuracy)} m)` : ''}`,
    `Karte: ${mapLink(pos)}`,
  ]
  if (rescue && rescue.distance < 5000) {
    lines.push(`Nächster Rettungspunkt: ${rescue.ref}, ${Math.round(rescue.distance)} m Richtung ${compassWord(rescue.bearing)}`)
  }
  lines.push('Bitte 112 anrufen und diese Angaben durchgeben.')
  return lines.join('\n')
}
