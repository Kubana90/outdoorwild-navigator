// The home region's places and rescue points ship with the app
// (public/region-data.json), so they are there at the very first start and
// without signal. Fresher data from OpenStreetMap replaces them in the
// background once it arrives.

import { peekRescuePoints, seedRescuePoints, fetchRescuePoints, type RescuePoint } from './emergency'
import { withRetry } from './overpass'
import { fetchPois, peekPois, seedPois, type Poi } from './poi'
import { REGION, queryBbox } from './region'

export interface RegionData {
  /** generation time, ms */
  t: number
  pois: Poi[]
  rescue: RescuePoint[]
}

export const regionBbox = () => queryBbox([REGION.center])

/** Refresh from OpenStreetMap when the local copy is older than this. */
const REFRESH_DAYS = 7

async function bundled(): Promise<RegionData | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}region-data.json`)
    return res.ok ? ((await res.json()) as RegionData) : null
  } catch {
    return null
  }
}

/**
 * Calls `onData` right away with the best local copy (cache or bundled file),
 * and again after a background refresh when that copy is old.
 */
export async function loadRegion(onData: (d: { pois: Poi[]; rescue: RescuePoint[] }) => void, signal?: AbortSignal): Promise<void> {
  const bbox = regionBbox()
  let pois = peekPois(bbox)
  let rescue = peekRescuePoints(bbox)
  if (!pois || !rescue) {
    const b = await bundled()
    if (b) {
      if (!pois) {
        seedPois(bbox, b.pois, b.t)
        pois = { pois: b.pois, ageDays: (Date.now() - b.t) / 86400000 }
      }
      if (!rescue) {
        seedRescuePoints(bbox, b.rescue, b.t)
        rescue = { points: b.rescue, ageDays: (Date.now() - b.t) / 86400000 }
      }
    }
  }
  onData({ pois: pois?.pois ?? [], rescue: rescue?.points ?? [] })

  const stalePois = !pois || pois.ageDays > REFRESH_DAYS
  const staleRescue = !rescue || rescue.ageDays > REFRESH_DAYS
  if (!stalePois && !staleRescue) return
  const [freshPois, freshRescue] = await Promise.all([
    stalePois ? withRetry(() => fetchPois(bbox, signal, true), signal).catch(() => null) : Promise.resolve(null),
    staleRescue ? withRetry(() => fetchRescuePoints(bbox, signal, true), signal).catch(() => null) : Promise.resolve(null),
  ])
  if (freshPois || freshRescue) onData({ pois: freshPois ?? pois?.pois ?? [], rescue: freshRescue ?? rescue?.points ?? [] })
}
