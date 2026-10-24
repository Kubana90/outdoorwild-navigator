// Navigation engine: given GPS fixes and the chosen route, works out
// progress, the next instruction, the "Pfad-Kompass" direction and what
// lies ahead (surface, climbs, daylight).

import * as SunCalc from 'suncalc'
import { segmentAt, surfaceKind, SURFACE_LABEL, wayKind, WAY_LABEL, type RouteAnalysis } from './analysis'
import type { Hint, RawRoute } from './brouter'
import { bearing, distance, pointAt, snapToLine, type LonLat } from './geo'

export const OFF_TRACK_METRES = 35

export interface Fix {
  pos: LonLat
  accuracy: number
  /** degrees, from GPS course or compass, null if unknown */
  heading: number | null
  /** m/s, null if unknown */
  speed: number | null
  time: number
}

export interface AheadPiece {
  start: number
  end: number
  kind: ReturnType<typeof wayKind>
}

export interface NavState {
  along: number
  offset: number
  offTrack: boolean
  snapped: LonLat
  remaining: number
  remainingAscent: number
  progress: number
  /** where the Pfad-Kompass points, degrees */
  guideBearing: number
  guideDistance: number
  guideText: string
  nextHint: (Hint & { distance: number; text: string }) | null
  /** way kinds of the next 1.5 km for the surface strip */
  ahead: AheadPiece[]
  nextClimb: { inMetres: number; length: number; gain: number; grade: number } | null
  eta: Date | null
  sunset: Date | null
  /** minutes of daylight left at arrival, negative = arriving after dark */
  daylightBuffer: number | null
  turnaround: Turnaround | null
  finished: boolean
}

export interface Turnaround {
  /** metres back to the start along the way you came */
  backDistance: number
  /** metres to the finish going on */
  aheadDistance: number
  backArrival: Date
  aheadArrival: Date
  /** latest clock time to turn round and still be back at the start before dark (null: no sunset today) */
  latestTurn: Date | null
  advice: 'weiter' | 'umkehren' | 'beides-knapp'
  text: string
}

/** Minutes before sunset that count as "too late". */
export const DAYLIGHT_MARGIN_MIN = 15

/**
 * Should you go on or turn back? Compares the way back along your own track
 * with the rest of the route, both against sunset. Turning back later costs
 * twice (you ride further out and the same distance back), so the latest
 * turn time is halfway between now and the moment the return alone would
 * just make it.
 */
export function turnaroundCheck(
  along: number,
  remaining: number,
  speed: number,
  now: number,
  sunset: Date | null,
  isLoop: boolean,
): Turnaround {
  const backArrival = new Date(now + (along / speed) * 1000)
  const aheadArrival = new Date(now + (remaining / speed) * 1000)
  const deadline = sunset ? sunset.getTime() - DAYLIGHT_MARGIN_MIN * 60000 : null
  // now + t + (along + v t) / v = deadline  →  t = (deadline - now - along / v) / 2
  const latestTurn = deadline !== null ? new Date(now + Math.max(0, (deadline - now - (along / speed) * 1000) / 2)) : null

  let advice: Turnaround['advice'] = 'weiter'
  if (deadline !== null && aheadArrival.getTime() > deadline) advice = backArrival.getTime() <= deadline ? 'umkehren' : 'beides-knapp'

  const goal = isLoop ? 'die Runde zu beenden' : 'das Ziel zu erreichen'
  const text =
    advice === 'umkehren'
      ? `Umkehren! Um ${goal}, reicht das Tageslicht nicht mehr – zurück zum Start schon.`
      : advice === 'beides-knapp'
        ? 'Es wird in jedem Fall dunkel – den kürzesten Weg nehmen und Licht bereithalten.'
        : along > remaining
          ? 'Weiterfahren ist kürzer als umkehren.'
          : 'Weiter auf der Route.'
  return { backDistance: along, aheadDistance: remaining, backArrival, aheadArrival, latestTurn, advice, text }
}

const COMMAND_TEXT: Record<number, string> = {
  1: 'Geradeaus weiter',
  2: 'Links abbiegen',
  3: 'Leicht links',
  4: 'Scharf links',
  5: 'Rechts abbiegen',
  6: 'Leicht rechts',
  7: 'Scharf rechts',
  8: 'Links halten',
  9: 'Rechts halten',
  10: 'Wenden',
  11: 'Wenden',
  15: 'Wenden',
}

/** BRouter command codes: 13/14 are roundabouts, the rest map to text. */
export function commandText(command: number, exits: number, angle: number): string {
  if (command === 13 || command === 14) return `Im Kreisverkehr ${exits}. Ausfahrt`
  const t = COMMAND_TEXT[command]
  if (t) return t
  if (angle < -120) return 'Scharf links'
  if (angle < -45) return 'Links abbiegen'
  if (angle < -15) return 'Leicht links'
  if (angle > 120) return 'Scharf rechts'
  if (angle > 45) return 'Rechts abbiegen'
  if (angle > 15) return 'Leicht rechts'
  return 'Geradeaus weiter'
}

/** Instruction including what kind of way you turn onto, e.g. "Rechts abbiegen auf Pfad (Erde)". */
export function hintText(route: RawRoute, hint: Hint): string {
  const seg = segmentAt(route.segments, hint.along + 5)
  const base = commandText(hint.command, hint.exits, hint.angle)
  if (!seg) return base
  const kind = WAY_LABEL[wayKind(seg.tags)]
  const surf = surfaceKind(seg.tags)
  const name = seg.tags.name ? ` „${seg.tags.name}“` : ''
  return `${base} auf ${kind}${name}${surf !== 'unknown' ? ` (${SURFACE_LABEL[surf]})` : ''}`
}

/** Hints worth announcing: drop "continue" hints unless the way kind changes there. */
export function usefulHints(route: RawRoute): Hint[] {
  return route.hints.filter((h) => {
    if (h.command !== 1) return true
    const before = segmentAt(route.segments, Math.max(0, h.along - 5))
    const after = segmentAt(route.segments, h.along + 5)
    return !!before && !!after && wayKind(before.tags) !== wayKind(after.tags)
  })
}

export function aheadPieces(route: RawRoute, along: number, span = 1500): AheadPiece[] {
  const out: AheadPiece[] = []
  for (const s of route.segments) {
    if (s.end <= along || s.start >= along + span) continue
    const piece = { start: Math.max(s.start, along) - along, end: Math.min(s.end, along + span) - along, kind: wayKind(s.tags) }
    const last = out[out.length - 1]
    if (last && last.kind === piece.kind) last.end = piece.end
    else out.push(piece)
  }
  return out
}

export function nextClimb(ele: number[], cum: number[], along: number, look = 3000): NavState['nextClimb'] {
  // find the first stretch ahead gaining >= 20 m within <= 800 m
  let i = cum.findIndex((c) => c >= along)
  if (i < 0) return null
  const end = cum.findIndex((c) => c > along + look)
  const stop = end < 0 ? cum.length - 1 : end
  for (; i < stop; i++) {
    let j = i
    let peak = i
    while (j < stop && cum[j] - cum[i] < 800) {
      j++
      if (ele[j] > ele[peak]) peak = j
      if (ele[peak] - ele[j] > 8) break
    }
    if (ele[peak] - ele[i] >= 20) {
      // the climb starts at its foot: the last point still level with i
      let foot = i
      for (let k = i; k < peak; k++) if (ele[k] - ele[i] < 2) foot = k
      const gain = ele[peak] - ele[foot]
      const length = cum[peak] - cum[foot]
      return { inMetres: Math.max(0, cum[foot] - along), length, gain, grade: (gain / Math.max(1, length)) * 100 }
    }
  }
  return null
}

function remainingAscent(ele: number[], cum: number[], along: number): number {
  let up = 0
  let ref = NaN
  for (let i = 0; i < ele.length; i++) {
    if (cum[i] < along) continue
    if (!Number.isFinite(ref)) ref = ele[i]
    const d = ele[i] - ref
    if (d >= 3) {
      up += d
      ref = ele[i]
    } else if (d <= -3) ref = ele[i]
  }
  return up
}

export class Navigator {
  private lastIndex = 0
  private offCount = 0
  private readonly hints: Hint[]
  private readonly plannedSpeed: number
  private speedSamples: number[] = []
  private readonly isLoop: boolean

  constructor(
    readonly route: RawRoute,
    readonly analysis: RouteAnalysis,
  ) {
    this.hints = usefulHints(route)
    this.plannedSpeed = analysis.length / Math.max(1, analysis.durationMin * 60)
    const c = route.coords
    this.isLoop = c.length > 1 && distance(c[0], c[c.length - 1]) < 300
  }

  update(fix: Fix): NavState {
    const r = this.route
    const last = r.coords.length - 1
    // search near the last known progress first, then everywhere
    let snap = snapToLine(fix.pos, r.coords, r.cum, this.lastIndex - 30, this.lastIndex + 400)
    if (snap.offset > 120) {
      const global = snapToLine(fix.pos, r.coords, r.cum)
      if (global.offset < snap.offset) snap = global
    }
    this.lastIndex = snap.index

    this.offCount = snap.offset > OFF_TRACK_METRES + Math.min(fix.accuracy, 30) ? this.offCount + 1 : 0
    const offTrack = this.offCount >= 2

    if (fix.speed !== null && fix.speed > 0.3) {
      this.speedSamples.push(fix.speed)
      if (this.speedSamples.length > 60) this.speedSamples.shift()
    }
    const observed = this.speedSamples.length >= 10 ? this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length : null
    // the planned speed already accounts for terrain, blend it with what we see
    const speed = observed ? 0.5 * observed + 0.5 * this.plannedSpeed : this.plannedSpeed

    const along = snap.along
    const remaining = Math.max(0, r.length - along)
    const finished = remaining < 25 && snap.index >= last - 2

    let guideTarget: LonLat
    let guideText: string
    if (offTrack) {
      guideTarget = snap.point
      guideText = 'Zurück zum Weg'
    } else {
      guideTarget = pointAt(r.coords, r.cum, along + 40)
      guideText = 'Dem Weg folgen'
    }

    const next = this.hints.find((h) => h.along > along + 3)
    const nextHint = next ? { ...next, distance: next.along - along, text: hintText(r, next) } : null

    const eta = new Date(fix.time + (remaining / speed) * 1000)
    const sunTimes = SunCalc.getTimes(new Date(fix.time), fix.pos[1], fix.pos[0])
    const sunset = sunTimes.sunset && Number.isFinite(sunTimes.sunset.getTime()) ? sunTimes.sunset : null
    const daylightBuffer = sunset ? (sunset.getTime() - eta.getTime()) / 60000 : null

    return {
      along,
      offset: snap.offset,
      offTrack,
      snapped: snap.point,
      remaining,
      remainingAscent: remainingAscent(this.analysis.smoothedEle, r.cum, along),
      progress: r.length > 0 ? along / r.length : 0,
      guideBearing: bearing(fix.pos, guideTarget),
      guideDistance: distance(fix.pos, guideTarget),
      guideText,
      nextHint,
      ahead: aheadPieces(r, along),
      nextClimb: nextClimb(this.analysis.smoothedEle, r.cum, along),
      eta,
      sunset,
      daylightBuffer,
      turnaround: along > 200 && !finished ? turnaroundCheck(along, remaining, speed, fix.time, sunset, this.isLoop) : null,
      finished,
    }
  }
}

/** Where a detour back onto the route aims: a little ahead of the nearest point, never behind. */
export function rejoinTarget(route: RawRoute, along: number, lead = 150): LonLat {
  return pointAt(route.coords, route.cum, Math.min(route.length, along + lead))
}

/** Seconds off the track before the app computes a way back. */
export const REROUTE_AFTER_MS = 8000
/** Minimum pause between two detour computations. */
export const REROUTE_EVERY_MS = 30000

/** Latest start time so that you arrive `margin` minutes before sunset. */
export function latestStart(pos: LonLat, durationMin: number, day = new Date(), margin = 30): Date | null {
  const t = SunCalc.getTimes(day, pos[1], pos[0]).sunset
  if (!t || !Number.isFinite(t.getTime())) return null
  return new Date(t.getTime() - (durationMin + margin) * 60000)
}

export const clock = (d: Date) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
