// Home region of the app: Neckar-Odenwald-Kreis, Baden-Württemberg.

import type { LonLat } from './geo'

export const REGION = {
  name: 'Neckar-Odenwald-Kreis',
  center: [9.27, 49.47] as LonLat,
  zoom: 10,
  /** [west, south, east, north] from OSM boundary relation 62626 */
  bbox: [8.94, 49.27, 9.6, 49.66] as [number, number, number, number],
}

/** Start points to tap instead of searching. */
export const REGION_PLACES: { name: string; pos: LonLat; note: string }[] = [
  { name: 'Mosbach', pos: [9.146, 49.352], note: 'Neckartal, Elzbachtal' },
  { name: 'Neckargerach', pos: [9.0708, 49.4003], note: 'Margarethenschlucht' },
  { name: 'Zwingenberg', pos: [9.043, 49.4158], note: 'Wolfsschlucht, Neckarsteig' },
  { name: 'Waldbrunn', pos: [9.0793, 49.4543], note: 'Katzenbuckel, höchster Gipfel' },
  { name: 'Mudau', pos: [9.2048, 49.5339], note: 'Hoher Odenwald' },
  { name: 'Buchen', pos: [9.3251, 49.5219], note: 'Eberstadter Tropfsteinhöhle' },
  { name: 'Walldürn', pos: [9.3667, 49.5833], note: 'Limes, Marsbachtal' },
  { name: 'Hardheim', pos: [9.4745, 49.6082], note: 'Erftal' },
  { name: 'Adelsheim', pos: [9.3903, 49.4053], note: 'Seckachtal' },
  { name: 'Osterburken', pos: [9.4274, 49.4305], note: 'Kirnautal, Römerkastell' },
]

export const inRegion = (p: LonLat) =>
  p[0] >= REGION.bbox[0] - 0.15 && p[0] <= REGION.bbox[2] + 0.15 && p[1] >= REGION.bbox[1] - 0.1 && p[1] <= REGION.bbox[3] + 0.1
