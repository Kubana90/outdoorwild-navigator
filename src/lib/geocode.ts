// Place search via Nominatim (OpenStreetMap). Only called when the user
// submits a search, which keeps us within the 1 request/second policy.

import type { LonLat } from './geo'
import { REGION } from './region'

export interface Place {
  name: string
  detail: string
  pos: LonLat
}

/** Short name for a tapped map position, e.g. "Waldweg, Mudau". Falls back to coordinates. */
export async function reverseGeocode(pos: LonLat): Promise<string> {
  const fallback = `${pos[1].toFixed(4)}, ${pos[0].toFixed(4)}`
  try {
    const params = new URLSearchParams({ lat: String(pos[1]), lon: String(pos[0]), format: 'jsonv2', zoom: '16', 'accept-language': 'de' })
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`)
    if (!res.ok) return fallback
    const r = (await res.json()) as { name?: string; address?: Record<string, string> }
    const a = r.address ?? {}
    const place = a.village || a.town || a.city || a.hamlet || a.municipality || ''
    const spot = r.name || a.road || a.natural || a.leisure || ''
    const text = [spot, place].filter(Boolean).join(', ')
    return text || fallback
  } catch {
    return fallback
  }
}

export async function searchPlaces(query: string, near?: LonLat): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6', 'accept-language': 'de' })
  // prefer results near the chosen start, else inside the home region
  const [w, so, e, n] = near ? [near[0] - 0.6, near[1] - 0.4, near[0] + 0.6, near[1] + 0.4] : REGION.bbox
  params.set('viewbox', `${w},${n},${e},${so}`)
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
  if (!res.ok) throw new Error('Ortssuche nicht erreichbar')
  const json = (await res.json()) as { name: string; display_name: string; lon: string; lat: string }[]
  return json.map((r) => ({
    name: r.name || r.display_name.split(',')[0],
    detail: r.display_name.split(',').slice(1, 3).join(',').trim(),
    pos: [Number(r.lon), Number(r.lat)],
  }))
}
