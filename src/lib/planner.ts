// Finds several candidate routes so the user can pick one: alternatives
// for A→B, and round trips in different directions.

import { analyzeRoute, characterTags, describeRoute, type RouteAnalysis } from './analysis'
import { fetchRoute, type RawRoute } from './brouter'
import { bearing, destination, distance, type LonLat } from './geo'
import type { ProfileOptions } from './profile'

export interface PlannedRoute {
  id: string
  title: string
  raw: RawRoute
  analysis: RouteAnalysis
  description: string
  tags: string[]
  waypoints: LonLat[]
  options: ProfileOptions
}

export interface LoopRequest {
  start: LonLat
  /** target length in metres */
  length: number
  /** preferred direction in degrees, or null for "any" */
  direction: number | null
}

const DIRECTION_NAMES = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten']
const dirName = (deg: number) => DIRECTION_NAMES[Math.round((((deg % 360) + 360) % 360) / 45) % 8]

/** Roads and paths wind: a circle of radius r becomes ~1.3× longer. */
const WIND = 1.3

/** Waypoints for a loop that leaves `start` heading `dir`. */
export function loopWaypoints(start: LonLat, length: number, dir: number): LonLat[] {
  const r = length / (2 * Math.PI) / WIND
  const center = destination(start, dir, r)
  // start sits on the circle at angle dir+180 seen from the center
  return [90, 180, 270].map((a) => destination(center, dir + 180 + a, r))
}

function similar(a: RawRoute, b: RawRoute): boolean {
  if (Math.abs(a.length - b.length) / Math.max(a.length, b.length) > 0.03) return false
  // compare a handful of sample points
  const n = 8
  let close = 0
  for (let i = 1; i < n; i++) {
    const pa = a.coords[Math.floor((i / n) * (a.coords.length - 1))]
    const pb = b.coords[Math.floor((i / n) * (b.coords.length - 1))]
    if (distance(pa, pb) < 80) close++
  }
  return close >= n - 2
}

function build(raw: RawRoute, title: string, waypoints: LonLat[], options: ProfileOptions): PlannedRoute {
  const analysis = analyzeRoute(raw, options.activity)
  return {
    id: `${title}-${Math.round(raw.length)}-${Math.round(analysis.ascent)}`,
    title,
    raw,
    analysis,
    description: describeRoute(analysis, options.activity),
    tags: characterTags(analysis, options.activity),
    waypoints,
    options,
  }
}

function dedupe(routes: PlannedRoute[]): PlannedRoute[] {
  const out: PlannedRoute[] = []
  for (const r of routes) if (!out.some((o) => similar(o.raw, r.raw))) out.push(r)
  return out
}

/** Runs tasks with limited concurrency; failed ones are dropped, the first error is kept. */
async function settle<T>(tasks: (() => Promise<T>)[], concurrency = 2): Promise<{ ok: T[]; error: Error | null }> {
  const results: T[] = []
  let error: Error | null = null
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++
      try {
        results[i] = await tasks[i]()
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        error ??= e as Error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return { ok: results.filter(Boolean), error }
}

/** A→B (with optional vias): up to 3 alternatives at the chosen wildness plus a gentler one. */
export async function planPointToPoint(points: LonLat[], options: ProfileOptions, signal?: AbortSignal): Promise<PlannedRoute[]> {
  const gentle: ProfileOptions = { ...options, wildness: Math.max(0, options.wildness - 45) }
  const tasks: (() => Promise<PlannedRoute>)[] = [0, 1, 2].map(
    (alt) => async () => build(await fetchRoute(points, options, alt, signal), alt === 0 ? 'Hauptvorschlag' : `Alternative ${alt + 1}`, points, options),
  )
  if (options.wildness >= 30) {
    tasks.push(async () => build(await fetchRoute(points, gentle, 0, signal), 'Entspanntere Variante', points, gentle))
  }
  const { ok: found, error } = await settle(tasks)
  if (!found.length) throw error ?? new Error('Keine Route gefunden. Setze Start und Ziel näher an Wege.')
  return rank(dedupe(found))
}

/** Round trips: three directions (or three around the preferred one). */
export async function planLoops(req: LoopRequest, options: ProfileOptions, signal?: AbortSignal): Promise<PlannedRoute[]> {
  const base = req.direction ?? 0
  const dirs = req.direction === null ? [base, base + 120, base + 240] : [base - 35, base, base + 35]

  const one = async (dir: number) => {
    let wps = loopWaypoints(req.start, req.length, dir)
    let raw = await fetchRoute([req.start, ...wps, req.start], options, 0, signal)
    // one correction pass if the loop came out far too long or too short
    const ratio = raw.length / req.length
    if (ratio < 0.8 || ratio > 1.25) {
      wps = loopWaypoints(req.start, req.length / ratio, dir)
      raw = await fetchRoute([req.start, ...wps, req.start], options, 0, signal)
    }
    const heading = bearing(req.start, wps[1])
    return build(raw, `Runde Richtung ${dirName(heading)}`, [req.start, ...wps, req.start], options)
  }
  const { ok: found, error } = await settle(dirs.map((d) => () => one(d)))
  if (!found.length) throw error ?? new Error('Keine Rundtour gefunden. Versuche eine andere Länge oder einen anderen Startpunkt.')
  return rank(dedupe(found))
}

/** Wildest first; ties broken by shorter length. */
export function rank(routes: PlannedRoute[]): PlannedRoute[] {
  return [...routes].sort((a, b) => b.analysis.wildScore - a.analysis.wildScore || a.analysis.length - b.analysis.length)
}
