// Cutting and joining routes, so a detour to a castle can be spliced into
// the route you're on: here → castle → back onto the route → rest of it.

import { analyzeRoute, characterTags, describeRoute } from './analysis'
import { fetchRoute, type RawRoute } from './brouter'
import { cumulative, pointAt, type LonLat } from './geo'
import type { PlannedRoute } from './planner'
import type { Poi } from './poi'

/** The part of a route from `fromAlong` metres to its end. */
export function sliceRoute(r: RawRoute, fromAlong: number): RawRoute {
  const from = Math.max(0, Math.min(fromAlong, r.length))
  let i = r.cum.findIndex((c) => c > from)
  if (i < 0) i = r.coords.length - 1
  const start = pointAt(r.coords, r.cum, from)
  const coords: LonLat[] = [start, ...r.coords.slice(i)]
  const prevEle = r.ele[Math.max(0, i - 1)]
  const ele = [prevEle, ...r.ele.slice(i)]
  const cum = cumulative(coords)
  const length = cum[cum.length - 1] ?? 0
  const shift = from
  const segments = r.segments
    .filter((s) => s.end > from)
    .map((s) => ({ ...s, start: Math.max(0, s.start - shift), end: s.end - shift }))
  const hints = r.hints
    .filter((h) => h.index >= i)
    .map((h) => {
      const index = h.index - i + 1
      return { ...h, index, along: cum[Math.min(index, cum.length - 1)] }
    })
  return { coords, ele, cum, length, segments, hints }
}

/** `a` followed by `b`; `b` should start where `a` ends. */
export function joinRoutes(a: RawRoute, b: RawRoute): RawRoute {
  const coords = [...a.coords, ...b.coords.slice(1)]
  const ele = [...a.ele, ...b.ele.slice(1)]
  const cum = cumulative(coords)
  const length = cum[cum.length - 1] ?? 0
  const offset = a.coords.length - 1
  const aLen = a.cum[a.cum.length - 1] ?? 0
  const segments = [...a.segments, ...b.segments.map((s) => ({ ...s, start: s.start + aLen, end: s.end + aLen }))]
  const hints = [
    ...a.hints,
    ...b.hints.map((h) => {
      const index = h.index + offset
      return { ...h, index, along: cum[Math.min(index, cum.length - 1)] }
    }),
  ]
  return { coords, ele, cum, length, segments, hints }
}

/**
 * New route: from where you are to the place, back onto the original route a
 * little past the point nearest to it, then the rest of the original route.
 */
export async function planDetour(
  route: PlannedRoute,
  from: LonLat,
  fromAlong: number,
  poi: Poi & { along: number },
  signal?: AbortSignal,
): Promise<PlannedRoute> {
  const rejoinAlong = Math.min(route.raw.length, Math.max(fromAlong, poi.along) + 150)
  const rejoin = pointAt(route.raw.coords, route.raw.cum, rejoinAlong)
  const toPlace = await fetchRoute([from, poi.pos, rejoin], route.options, 0, signal)
  const raw = rejoinAlong >= route.raw.length - 5 ? toPlace : joinRoutes(toPlace, sliceRoute(route.raw, rejoinAlong))
  const analysis = analyzeRoute(raw, route.options.activity)
  const name = poi.name ?? poi.kind
  return {
    ...route,
    id: `${route.id}+${name}-${Math.round(raw.length)}`,
    title: `${route.title} + Abstecher ${name}`,
    raw,
    analysis,
    description: describeRoute(analysis, route.options.activity),
    tags: characterTags(analysis, route.options.activity),
    waypoints: [from, poi.pos, rejoin, route.waypoints[route.waypoints.length - 1]],
  }
}
