import { describe, expect, it } from 'vitest'
import { analyzeRoute, ascentDescent, describeRoute, estimateMinutes, wayKind } from './analysis'
import type { RawRoute } from './brouter'
import { parseRoute } from './brouter'
import { bearing, cumulative, destination, distance, pointAt, snapToLine, type LonLat } from './geo'
import { aheadPieces, commandText, hintText, Navigator, nextClimb, usefulHints } from './nav'
import { loopWaypoints, rank } from './planner'
import { forbiddenDifficulty, generateProfile } from './profile'

/** A straight 2 km line north from Freiburg with given way tags per km. */
function lineRoute(tagsPerKm: Record<string, string>[], climb = 0): RawRoute {
  const start: LonLat = [7.85, 47.99]
  const coords: LonLat[] = []
  const ele: number[] = []
  const total = tagsPerKm.length * 1000
  for (let d = 0; d <= total; d += 20) {
    coords.push(destination(start, 0, d))
    ele.push(300 + (climb * d) / total)
  }
  const cum = cumulative(coords)
  const length = cum[cum.length - 1]
  const segments = tagsPerKm.map((tags, i) => ({ start: (i * length) / tagsPerKm.length, end: ((i + 1) * length) / tagsPerKm.length, tags }))
  return { coords, ele, cum, length, segments, hints: [] }
}

describe('geo', () => {
  it('measures distance and bearing', () => {
    const a: LonLat = [7.85, 47.99]
    const b = destination(a, 90, 1000)
    expect(distance(a, b)).toBeCloseTo(1000, 0)
    expect(bearing(a, b)).toBeCloseTo(90, 0)
  })

  it('snaps a point to the line and reports offset and progress', () => {
    const r = lineRoute([{}, {}])
    const onLine = pointAt(r.coords, r.cum, 700)
    const beside = destination(onLine, 90, 50)
    const s = snapToLine(beside, r.coords, r.cum)
    expect(s.offset).toBeCloseTo(50, -1)
    expect(s.along).toBeCloseTo(700, -1)
  })
})

describe('analysis', () => {
  it('classifies way types', () => {
    expect(wayKind({ highway: 'path', surface: 'ground' })).toBe('trail')
    expect(wayKind({ highway: 'track', tracktype: 'grade2' })).toBe('forest')
    expect(wayKind({ highway: 'track', tracktype: 'grade1' })).toBe('farm')
    expect(wayKind({ highway: 'secondary' })).toBe('road')
    expect(wayKind({ highway: 'path', surface: 'asphalt' })).toBe('cycleway')
  })

  it('scores a trail route wilder than a road route', () => {
    const wild = analyzeRoute(lineRoute([{ highway: 'path' }, { highway: 'track', tracktype: 'grade3' }]), 'mtb')
    const tame = analyzeRoute(lineRoute([{ highway: 'tertiary' }, { highway: 'residential' }]), 'mtb')
    expect(wild.wildScore).toBeGreaterThan(70)
    expect(tame.wildScore).toBeLessThan(15)
    expect(tame.roadMetres).toBeGreaterThan(1900)
    expect(describeRoute(wild, 'mtb')).toMatch(/Pfaden/)
  })

  it('counts ascent and ignores noise below the threshold', () => {
    expect(ascentDescent([100, 101, 100, 101, 100]).up).toBe(0)
    expect(ascentDescent([100, 110, 105, 120]).up).toBe(25)
  })

  it('estimates hiking time with the DIN rule', () => {
    // 8 km flat at ~4.3 km/h ≈ 1 h 52 min, plus a little for 300 Hm
    const t = estimateMinutes('hiking', { trail: 0, forest: 1, farm: 0, cycleway: 0, minor: 0, road: 0 }, 8000, 300, 300)
    expect(t).toBeGreaterThan(120)
    expect(t).toBeLessThan(200)
  })
})

describe('profile', () => {
  it('forbids difficulties above the limit', () => {
    expect(forbiddenDifficulty('mtb', 2)).toBe('mtb:scale=3|4|5|6')
    expect(forbiddenDifficulty('gravel', 4)).toContain('mtb:scale=2')
    expect(forbiddenDifficulty('hiking', 3)).toBe('sac_scale=alpine_hiking|demanding_alpine_hiking|difficult_alpine_hiking')
  })

  it('makes roads more expensive as wildness rises', () => {
    const cost = (p: string) => Number(/primary_link\|secondary\|secondary_link\|tertiary\|tertiary_link then (\S+)/.exec(p)![1])
    const tame = generateProfile({ activity: 'mtb', wildness: 0, maxDifficulty: 2 })
    const wild = generateProfile({ activity: 'mtb', wildness: 100, maxDifficulty: 2 })
    expect(cost(wild)).toBeGreaterThan(cost(tame) * 5)
    expect(wild).toContain('validForBikes')
    expect(generateProfile({ activity: 'hiking', wildness: 50, maxDifficulty: 3 })).toContain('validForFoot')
  })
})

describe('planner', () => {
  it('places loop waypoints around the start at a sensible distance', () => {
    const start: LonLat = [7.85, 47.99]
    const wps = loopWaypoints(start, 20000, 0)
    expect(wps).toHaveLength(3)
    // the far point is roughly the diameter away, to the north
    const far = wps[1]
    expect(distance(start, far)).toBeGreaterThan(4000)
    expect(distance(start, far)).toBeLessThan(5500)
    expect(far[1]).toBeGreaterThan(start[1])
  })

  it('ranks the wildest route first', () => {
    const mk = (score: number, length: number) => ({ analysis: { wildScore: score, length } }) as never
    const out = rank([mk(40, 1000), mk(80, 2000), mk(80, 1500)]) as unknown as { analysis: { wildScore: number; length: number } }[]
    expect(out.map((r) => [r.analysis.wildScore, r.analysis.length])).toEqual([[80, 1500], [80, 2000], [40, 1000]])
  })
})

describe('navigation', () => {
  const r = lineRoute([{ highway: 'track', tracktype: 'grade2' }, { highway: 'path', surface: 'ground', name: 'Wurzelpfad' }], 120)
  r.hints = [{ index: 50, along: r.cum[50], command: 5, exits: 0, angle: 80 }]
  const a = analyzeRoute(r, 'mtb')

  it('describes a turn with the way you turn onto', () => {
    expect(hintText(r, r.hints[0])).toBe('Rechts abbiegen auf Pfad / Trail „Wurzelpfad“ (Erde / Waldboden)')
    expect(commandText(13, 2, 0)).toBe('Im Kreisverkehr 2. Ausfahrt')
    expect(commandText(99, 0, -60)).toBe('Links abbiegen')
  })

  it('drops "continue" hints unless the way type changes', () => {
    const copy = { ...r, hints: [{ index: 10, along: r.cum[10], command: 1, exits: 0, angle: 0 }, r.hints[0]] }
    expect(usefulHints(copy)).toHaveLength(1)
  })

  it('tracks progress, next hint and what lies ahead', () => {
    const nav = new Navigator(r, a)
    const pos = pointAt(r.coords, r.cum, 400)
    const s = nav.update({ pos, accuracy: 5, heading: 0, speed: 3, time: Date.parse('2026-06-21T10:00:00Z') })
    expect(s.offTrack).toBe(false)
    expect(s.along).toBeCloseTo(400, -1)
    expect(s.nextHint?.distance).toBeCloseTo(r.cum[50] - 400, -1)
    expect(s.ahead.map((p) => p.kind)).toEqual(['forest', 'trail'])
    expect(Math.min(s.guideBearing, 360 - s.guideBearing)).toBeLessThan(5) // north
    expect(s.daylightBuffer).not.toBeNull()
  })

  it('flags off-track after two fixes and points back to the way', () => {
    const nav = new Navigator(r, a)
    const on = pointAt(r.coords, r.cum, 800)
    const off = destination(on, 90, 120)
    const t = Date.parse('2026-06-21T10:00:00Z')
    nav.update({ pos: off, accuracy: 5, heading: null, speed: null, time: t })
    const s = nav.update({ pos: off, accuracy: 5, heading: null, speed: null, time: t + 1000 })
    expect(s.offTrack).toBe(true)
    expect(s.guideBearing).toBeGreaterThan(260)
    expect(s.guideBearing).toBeLessThan(280)
    expect(s.guideDistance).toBeCloseTo(120, -1)
  })

  it('finds the next climb ahead', () => {
    const steep = lineRoute([{ highway: 'path' }], 0)
    const ele = steep.ele.map((_, i) => (steep.cum[i] > 500 ? 300 + (steep.cum[i] - 500) * 0.1 : 300))
    const c = nextClimb(ele, steep.cum, 100)
    expect(c).not.toBeNull()
    expect(c!.inMetres).toBeCloseTo(400, -2)
    expect(c!.grade).toBeCloseTo(10, 0)
  })

  it('merges equal way kinds in the ahead strip', () => {
    const rr = lineRoute([{ highway: 'path' }, { highway: 'path' }])
    expect(aheadPieces(rr, 0, 1500)).toHaveLength(1)
  })
})

describe('brouter parsing', () => {
  it('reads coordinates, way segments and voice hints', () => {
    const json = {
      features: [
        {
          geometry: { coordinates: [[7.85, 47.99, 300], [7.851, 47.99, 302], [7.852, 47.99, 305]] },
          properties: {
            'track-length': '150',
            messages: [
              ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost', 'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy'],
              ['7851000', '47990000', '302', '75', '0', '0', '0', '0', '0', 'highway=track tracktype=grade2', '', '0', '0'],
              ['7852000', '47990000', '305', '75', '0', '0', '0', '0', '0', 'highway=path surface=ground', '', '0', '0'],
            ],
            voicehints: [[1, 5, 0, 75, 90]],
          },
        },
      ],
    }
    const r = parseRoute(json)
    expect(r.coords).toHaveLength(3)
    expect(r.segments[1].tags).toEqual({ highway: 'path', surface: 'ground' })
    expect(r.segments[1].end).toBeCloseTo(r.length, 3)
    expect(r.hints[0]).toMatchObject({ index: 1, command: 5, angle: 90 })
  })
})
