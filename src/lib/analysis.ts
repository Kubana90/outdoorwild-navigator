// Turns a raw route into the numbers and words a rider or hiker cares
// about: how wild it is, what's underfoot, how hard, how long.

import type { RawRoute, Segment } from './brouter'
import type { Activity } from './profile'
import { isBikeActivity } from './profile'

export type WayKind = 'trail' | 'forest' | 'farm' | 'cycleway' | 'minor' | 'road'
export type SurfaceKind = 'paved' | 'gravel' | 'ground' | 'grass' | 'rock' | 'unknown'

export const WAY_LABEL: Record<WayKind, string> = {
  trail: 'Pfad / Trail',
  forest: 'Wald- & Feldweg',
  farm: 'Wirtschaftsweg (befestigt)',
  cycleway: 'Radweg',
  minor: 'Nebenstraße',
  road: 'Straße',
}

export const WAY_COLOR: Record<WayKind, string> = {
  trail: '#2e7d32',
  forest: '#7cb342',
  farm: '#c0a062',
  cycleway: '#4f8fc0',
  minor: '#9e9e9e',
  road: '#d84343',
}

export const SURFACE_LABEL: Record<SurfaceKind, string> = {
  paved: 'Asphalt / Pflaster',
  gravel: 'Schotter',
  ground: 'Erde / Waldboden',
  grass: 'Gras',
  rock: 'Fels',
  unknown: 'unbekannt',
}

/** How "wild" one metre of each way kind counts, 0..1 */
const WILD_WEIGHT: Record<WayKind, number> = {
  trail: 1,
  forest: 0.75,
  farm: 0.35,
  cycleway: 0.2,
  minor: 0.1,
  road: 0,
}

export function wayKind(tags: Record<string, string>): WayKind {
  const hw = tags.highway ?? ''
  const paved = /^(asphalt|paved|concrete|paving_stones|sett|cobblestone)/.test(tags.surface ?? '')
  if (/^(motorway|trunk|primary|secondary|tertiary)/.test(hw)) return 'road'
  if (/^(unclassified|residential|living_street|service|pedestrian|road)$/.test(hw)) return 'minor'
  if (hw === 'cycleway') return 'cycleway'
  if (hw === 'track') {
    if (tags.tracktype === 'grade1' || paved) return 'farm'
    if (tags.tracktype === 'grade4' || tags.tracktype === 'grade5') return 'trail'
    return 'forest'
  }
  if (/^(path|footway|bridleway|steps)$/.test(hw)) return paved ? 'cycleway' : 'trail'
  return 'minor'
}

/** A narrow path without bicycle permission: off limits for bikes under the BW 2-metre rule. */
export function narrowWithoutBikePermit(tags: Record<string, string>): boolean {
  if (!/^(path|footway|bridleway)$/.test(tags.highway ?? '')) return false
  if (/^(asphalt|paved|concrete|paving_stones|sett)/.test(tags.surface ?? '')) return false
  if (/^(yes|designated|permissive|mtb)$/.test(tags.bicycle ?? '')) return false
  return !Object.keys(tags).some((k) => k.startsWith('route_bicycle_'))
}

export function surfaceKind(tags: Record<string, string>): SurfaceKind {
  const s = tags.surface ?? ''
  if (/^(asphalt|paved|concrete|paving_stones|sett|cobblestone|wood|metal|grass_paver)/.test(s)) return 'paved'
  if (/^(gravel|fine_gravel|compacted|pebblestone|unpaved)/.test(s)) return 'gravel'
  if (/^(ground|dirt|earth|mud|sand|clay|soil)/.test(s)) return 'ground'
  if (s === 'grass') return 'grass'
  if (/^(rock|stone)/.test(s)) return 'rock'
  // educated guesses from the way type
  if (tags.highway === 'track') return tags.tracktype === 'grade1' ? 'paved' : tags.tracktype === 'grade2' ? 'gravel' : 'ground'
  if (tags.highway === 'path' || tags.highway === 'bridleway') return 'ground'
  if (/^(primary|secondary|tertiary|unclassified|residential|cycleway)/.test(tags.highway ?? '')) return 'paved'
  return 'unknown'
}

export interface ClimbInfo {
  start: number
  end: number
  gain: number
  avgGrade: number
}

export interface RouteAnalysis {
  length: number
  ascent: number
  descent: number
  minEle: number
  maxEle: number
  /** 0..100 */
  wildScore: number
  wayShare: Record<WayKind, number>
  surfaceShare: Record<SurfaceKind, number>
  /** metres on asphalt roads with traffic (minor + road) */
  roadMetres: number
  forestShare: number
  longestTrail: number
  steepestGrade: number
  longestClimb: ClimbInfo | null
  /** highest mtb:scale or SAC level seen, 0 when untagged */
  maxDifficultyTag: string | null
  /** metres on narrow paths without bicycle permission (bike activities only) */
  narrowNoBikeMetres: number
  difficulty: 'leicht' | 'mittel' | 'schwer'
  durationMin: number
  smoothedEle: number[]
}

const emptyWay = (): Record<WayKind, number> => ({ trail: 0, forest: 0, farm: 0, cycleway: 0, minor: 0, road: 0 })
const emptySurface = (): Record<SurfaceKind, number> => ({ paved: 0, gravel: 0, ground: 0, grass: 0, rock: 0, unknown: 0 })

/** Moving average over a distance window, robust against SRTM noise. */
export function smoothElevation(ele: number[], cum: number[], window = 100): number[] {
  const n = ele.length
  const out = new Array<number>(n)
  let lo = 0
  let hi = 0
  let sum = 0
  let cnt = 0
  for (let i = 0; i < n; i++) {
    while (hi < n && cum[hi] - cum[i] <= window / 2) {
      if (Number.isFinite(ele[hi])) {
        sum += ele[hi]
        cnt++
      }
      hi++
    }
    while (cum[i] - cum[lo] > window / 2) {
      if (Number.isFinite(ele[lo])) {
        sum -= ele[lo]
        cnt--
      }
      lo++
    }
    out[i] = cnt > 0 ? sum / cnt : (out[i - 1] ?? 0)
  }
  return out
}

export function ascentDescent(ele: number[], threshold = 3): { up: number; down: number } {
  let up = 0
  let down = 0
  let ref = ele[0]
  for (const e of ele) {
    if (!Number.isFinite(e)) continue
    if (!Number.isFinite(ref)) ref = e
    const d = e - ref
    if (d >= threshold) {
      up += d
      ref = e
    } else if (d <= -threshold) {
      down -= d
      ref = e
    }
  }
  return { up, down }
}

/** Climbs: stretches where the smoothed profile keeps rising (dips < 10 m allowed). */
export function findClimbs(ele: number[], cum: number[], minGain = 25): ClimbInfo[] {
  const climbs: ClimbInfo[] = []
  let startI = 0
  let peakI = 0
  for (let i = 1; i < ele.length; i++) {
    if (ele[i] > ele[peakI]) peakI = i
    const dropped = ele[peakI] - ele[i] > 10
    if (dropped || i === ele.length - 1) {
      const gain = ele[peakI] - ele[startI]
      const dist = cum[peakI] - cum[startI]
      if (gain >= minGain && dist > 0) {
        climbs.push({ start: cum[startI], end: cum[peakI], gain, avgGrade: (gain / dist) * 100 })
      }
      startI = i
      peakI = i
    }
    if (ele[i] < ele[startI]) {
      startI = i
      peakI = i
    }
  }
  return climbs
}

function steepest(ele: number[], cum: number[], window = 200): number {
  let best = 0
  let j = 0
  for (let i = 0; i < ele.length; i++) {
    while (j < ele.length - 1 && cum[j] - cum[i] < window) j++
    const d = cum[j] - cum[i]
    if (d >= window * 0.8) best = Math.max(best, Math.abs(ele[j] - ele[i]) / d)
  }
  return best * 100
}

const SAC_LEVEL: Record<string, number> = {
  hiking: 1,
  'T1-hiking': 1,
  mountain_hiking: 2,
  demanding_mountain_hiking: 3,
  alpine_hiking: 4,
  demanding_alpine_hiking: 5,
  difficult_alpine_hiking: 6,
}

/** Planned speed in km/h on flat ground for a way kind. */
const SPEED: Record<Activity, Record<WayKind, number>> = {
  mtb: { trail: 9, forest: 14, farm: 17, cycleway: 18, minor: 19, road: 21 },
  gravel: { trail: 8, forest: 17, farm: 20, cycleway: 21, minor: 22, road: 24 },
  hiking: { trail: 3.8, forest: 4.3, farm: 4.5, cycleway: 4.5, minor: 4.5, road: 4.5 },
  trailrun: { trail: 8, forest: 9.5, farm: 10, cycleway: 10, minor: 10, road: 10 },
}

export function estimateMinutes(activity: Activity, wayShare: Record<WayKind, number>, length: number, up: number, down: number): number {
  let hours = 0
  for (const k of Object.keys(wayShare) as WayKind[]) hours += (wayShare[k] * length) / 1000 / SPEED[activity][k]
  if (isBikeActivity(activity)) {
    // ~ 1 min per 10 Hm (MTB) / 12 Hm (gravel) on top of the flat time
    hours += up / (activity === 'mtb' ? 600 : 720)
    return hours * 60
  }
  // DIN 33466 style: combine horizontal and vertical time
  const vUp = activity === 'trailrun' ? 700 : 300
  const vDown = activity === 'trailrun' ? 1000 : 500
  const v = up / vUp + down / vDown
  return (Math.max(hours, v) + Math.min(hours, v) / 2) * 60
}

export function segmentAt(segments: Segment[], along: number): Segment | undefined {
  let lo = 0
  let hi = segments.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const s = segments[mid]
    if (along < s.start) hi = mid - 1
    else if (along >= s.end) lo = mid + 1
    else return s
  }
  return segments[segments.length - 1]
}

export function analyzeRoute(route: RawRoute, activity: Activity): RouteAnalysis {
  const { length, segments, cum } = route
  const wayShare = emptyWay()
  const surfaceShare = emptySurface()
  let forest = 0
  let longestTrail = 0
  let trailRun = 0
  let maxMtb = -1
  let maxSac = 0
  let narrowNoBike = 0
  const bikeAct = isBikeActivity(activity)

  for (const s of segments) {
    const d = s.end - s.start
    const k = wayKind(s.tags)
    wayShare[k] += d
    surfaceShare[surfaceKind(s.tags)] += d
    if (Number(s.tags.estimated_forest_class ?? 0) >= 3) forest += d
    if (k === 'trail' || k === 'forest') {
      trailRun += d
      longestTrail = Math.max(longestTrail, trailRun)
    } else trailRun = 0
    if (bikeAct && narrowWithoutBikePermit(s.tags)) narrowNoBike += d
    const mtb = s.tags['mtb:scale']
    if (mtb) maxMtb = Math.max(maxMtb, parseInt(mtb, 10))
    const sac = SAC_LEVEL[s.tags.sac_scale ?? '']
    if (sac) maxSac = Math.max(maxSac, sac)
  }

  const total = Object.values(wayShare).reduce((a, b) => a + b, 0) || 1
  let wild = 0
  for (const k of Object.keys(wayShare) as WayKind[]) {
    wild += (wayShare[k] / total) * WILD_WEIGHT[k]
    wayShare[k] /= total
  }
  const sTotal = Object.values(surfaceShare).reduce((a, b) => a + b, 0) || 1
  for (const k of Object.keys(surfaceShare) as SurfaceKind[]) surfaceShare[k] /= sTotal
  const forestShare = forest / total
  const wildScore = Math.round(Math.min(1, wild * 0.85 + forestShare * 0.15) * 100)

  const hasEle = route.ele.some(Number.isFinite)
  const smoothedEle = hasEle ? smoothElevation(route.ele, cum) : route.ele.map(() => 0)
  const { up, down } = hasEle ? ascentDescent(smoothedEle) : { up: 0, down: 0 }
  const climbs = hasEle ? findClimbs(smoothedEle, cum) : []
  const longestClimb = climbs.reduce<ClimbInfo | null>((best, c) => (!best || c.gain > best.gain ? c : best), null)
  const steepestGrade = hasEle ? steepest(smoothedEle, cum) : 0

  const bike = isBikeActivity(activity)
  const maxDifficultyTag = bike ? (maxMtb >= 0 ? `S${maxMtb}` : null) : maxSac ? `T${maxSac}` : null
  const hmPerKm = length > 0 ? up / (length / 1000) : 0
  let points = 0
  if (hmPerKm > 15) points++
  if (hmPerKm > 30) points++
  if (steepestGrade > 15) points++
  if ((bike && maxMtb >= 2) || (!bike && maxSac >= 3)) points++
  if (length > (bike ? 50000 : 20000)) points++
  const difficulty = points >= 3 ? 'schwer' : points >= 1 ? 'mittel' : 'leicht'

  return {
    length,
    ascent: up,
    descent: down,
    minEle: hasEle ? Math.min(...smoothedEle) : 0,
    maxEle: hasEle ? Math.max(...smoothedEle) : 0,
    wildScore,
    wayShare,
    surfaceShare,
    roadMetres: (wayShare.minor + wayShare.road) * length,
    forestShare,
    longestTrail,
    steepestGrade,
    longestClimb,
    maxDifficultyTag,
    narrowNoBikeMetres: narrowNoBike * (length / total),
    difficulty,
    durationMin: estimateMinutes(activity, wayShare, length, up, down),
    smoothedEle,
  }
}

// ---------- words ----------

export const km = (m: number) => (m >= 10000 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1).replace('.', ',')} km`)
export const pct = (x: number) => `${Math.round(x * 100)} %`
export const duration = (min: number) => {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h} h ${m.toString().padStart(2, '0')} min` : `${m} min`
}

export function wildLabel(score: number): string {
  if (score >= 80) return 'Wildnis pur'
  if (score >= 60) return 'Sehr naturnah'
  if (score >= 40) return 'Naturnah'
  if (score >= 20) return 'Gemischt'
  return 'Überwiegend Straße'
}

/** Short character tags for a route card. */
export function characterTags(a: RouteAnalysis, activity: Activity): string[] {
  const tags: string[] = []
  if (a.wayShare.trail >= 0.35) tags.push(isBikeActivity(activity) ? 'Trail-reich' : 'Pfad-reich')
  if (a.forestShare >= 0.5) tags.push('Waldreich')
  if (a.roadMetres < 300) tags.push('Fast autofrei')
  if (a.length > 0 && a.ascent / (a.length / 1000) > 25) tags.push('Knackig')
  else if (a.length > 0 && a.ascent / (a.length / 1000) < 8) tags.push('Flach')
  if (a.surfaceShare.paved > 0.5) tags.push('Viel Asphalt')
  if (a.longestTrail > 3000) tags.push('Lange Naturpassage')
  return tags
}

/** A few plain German sentences describing the route. */
export function describeRoute(a: RouteAnalysis, activity: Activity): string {
  const bike = isBikeActivity(activity)
  const s: string[] = []
  const natural = a.wayShare.trail + a.wayShare.forest
  s.push(
    `${wildLabel(a.wildScore)}: ${pct(natural)} der Strecke verlaufen auf Pfaden und Wald- oder Feldwegen` +
      (a.wayShare.trail > 0.05 ? `, davon ${pct(a.wayShare.trail)} auf schmalen Pfaden.` : '.'),
  )
  if (a.roadMetres < 100) s.push('Straßen mit Verkehr werden praktisch nicht berührt.')
  else if (a.roadMetres < a.length * 0.15) s.push(`Auf Straßen bist du nur ${km(a.roadMetres)} unterwegs.`)
  else s.push(`Etwa ${km(a.roadMetres)} führen über Straßen.`)

  const surfaces = (Object.entries(a.surfaceShare) as [SurfaceKind, number][])
    .filter(([k, v]) => k !== 'unknown' && v > 0.12)
    .sort((x, y) => y[1] - x[1])
    .map(([k]) => SURFACE_LABEL[k])
  if (surfaces.length) s.push(`Untergrund überwiegend ${surfaces.slice(0, 2).join(' und ')}.`)

  if (a.forestShare > 0.3) s.push(`Rund ${pct(a.forestShare)} führen durch Wald.`)
  if (a.longestTrail > 1500) s.push(`Längste Naturpassage am Stück: ${km(a.longestTrail)}.`)
  if (a.longestClimb)
    s.push(
      `Größter Anstieg: ${Math.round(a.longestClimb.gain)} Hm auf ${km(a.longestClimb.end - a.longestClimb.start)} ` +
        `(Ø ${Math.round(a.longestClimb.avgGrade)} %), ` +
        (a.longestClimb.start < 300 ? 'direkt ab Start.' : `beginnt nach ${km(a.longestClimb.start)}.`),
    )
  if (a.steepestGrade > 12) s.push(`Steilstes Stück etwa ${Math.round(a.steepestGrade)} %${bike ? ', eventuell schieben' : ''}.`)
  if (bike && a.narrowNoBikeMetres > 50)
    s.push(`Hinweis: ${km(a.narrowNoBikeMetres)} schmale Pfade ohne Radfreigabe – in Baden-Württemberg gilt im Wald die 2-Meter-Regel, dort bitte schieben.`)
  if (a.maxDifficultyTag) s.push(`Schwierigste markierte Stelle: ${a.maxDifficultyTag}${bike ? ' (MTB-Skala)' : ' (SAC-Skala)'}.`)
  return s.join(' ')
}
