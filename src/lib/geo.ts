// Small geodesy helpers. Coordinates are [lon, lat] like GeoJSON.

export type LonLat = [number, number]

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function distance(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1])
  const dLon = rad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial bearing from a to b in degrees, 0 = north, clockwise. */
export function bearing(a: LonLat, b: LonLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]))
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
    Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** Point reached from `p` going `dist` metres in direction `brg` degrees. */
export function destination(p: LonLat, brg: number, dist: number): LonLat {
  const d = dist / R
  const t = rad(brg)
  const lat1 = rad(p[1])
  const lon1 = rad(p[0])
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t))
  const lon2 =
    lon1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return [((deg(lon2) + 540) % 360) - 180, deg(lat2)]
}

/** Cumulative distance in metres at every vertex of a line. */
export function cumulative(line: LonLat[]): number[] {
  const out = new Array<number>(line.length)
  let sum = 0
  for (let i = 0; i < line.length; i++) {
    if (i > 0) sum += distance(line[i - 1], line[i])
    out[i] = sum
  }
  return out
}

export interface Snap {
  /** index of the segment start vertex */
  index: number
  /** 0..1 position along that segment */
  t: number
  point: LonLat
  /** distance from the query point to the line, metres */
  offset: number
  /** distance along the line from its start, metres */
  along: number
}

/**
 * Nearest point on a polyline. Uses a local equirectangular projection,
 * which is accurate enough for the few hundred metres that matter here.
 * `from`/`to` limit the searched vertex range (for progress tracking).
 */
export function snapToLine(p: LonLat, line: LonLat[], cum: number[], from = 0, to = line.length - 1): Snap {
  const kx = Math.cos(rad(p[1])) * 111320
  const ky = 110540
  let best: Snap = { index: 0, t: 0, point: line[0], offset: Infinity, along: 0 }
  const lo = Math.max(0, from)
  const hi = Math.min(line.length - 1, to)
  for (let i = lo; i < hi; i++) {
    const a = line[i]
    const b = line[i + 1]
    const ax = (a[0] - p[0]) * kx
    const ay = (a[1] - p[1]) * ky
    const bx = (b[0] - p[0]) * kx
    const by = (b[1] - p[1]) * ky
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
    const cx = ax + t * dx
    const cy = ay + t * dy
    const off = Math.hypot(cx, cy)
    if (off < best.offset) {
      best = {
        index: i,
        t,
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        offset: off,
        along: cum[i] + (cum[i + 1] - cum[i]) * t,
      }
    }
  }
  if (hi === lo) best = { index: lo, t: 0, point: line[lo], offset: distance(p, line[lo]), along: cum[lo] }
  return best
}

/** Point at a given distance along the line. */
export function pointAt(line: LonLat[], cum: number[], along: number): LonLat {
  if (along <= 0) return line[0]
  const last = line.length - 1
  if (along >= cum[last]) return line[last]
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= along) lo = mid
    else hi = mid
  }
  const seg = cum[hi] - cum[lo]
  const t = seg === 0 ? 0 : (along - cum[lo]) / seg
  return [line[lo][0] + (line[hi][0] - line[lo][0]) * t, line[lo][1] + (line[hi][1] - line[lo][1]) * t]
}

const DIRS = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten']
export const compassWord = (brg: number) => DIRS[Math.round((((brg % 360) + 360) % 360) / 45) % 8]

/** Signed smallest difference b - a in degrees, -180..180. */
export const angleDiff = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180
