// Place search via Nominatim (OpenStreetMap). Only called when the user
// submits a search, which keeps us within the 1 request/second policy.

import type { LonLat } from './geo'
import { REGION } from './region'

export interface Place {
  name: string
  detail: string
  pos: LonLat
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
