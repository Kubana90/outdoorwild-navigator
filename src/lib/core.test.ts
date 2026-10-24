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

describe('detour and track', () => {
  it('aims the way back a little ahead on the route, never past its end', async () => {
    const { rejoinTarget } = await import('./nav')
    const r = lineRoute([{}, {}])
    expect(distance(rejoinTarget(r, 500), pointAt(r.coords, r.cum, 650))).toBeLessThan(2)
    expect(distance(rejoinTarget(r, r.length - 20), r.coords[r.coords.length - 1])).toBeLessThan(2)
  })

  it('writes a recorded track as GPX with timestamps', async () => {
    const { trackToGpx } = await import('./gpx')
    const gpx = trackToGpx(
      [
        { pos: [9.2, 49.5], time: Date.parse('2026-10-24T09:00:00Z'), accuracy: 5 },
        { pos: [9.201, 49.5], time: Date.parse('2026-10-24T09:00:10Z'), accuracy: 5 },
      ],
      'Runde <Test>',
    )
    expect(gpx).toContain('<name>Runde &lt;Test&gt;</name>')
    expect(gpx.match(/<trkpt /g)).toHaveLength(2)
    expect(gpx).toContain('<time>2026-10-24T09:00:10.000Z</time>')
  })
})

describe('turnaround', () => {
  it('advises turning back when going on would end after dark but going back would not', async () => {
    const { turnaroundCheck } = await import('./nav')
    const now = Date.parse('2026-10-24T15:00:00Z')
    const sunset = new Date('2026-10-24T16:30:00Z')
    // 3 m/s: back 5 km = 28 min, ahead 20 km = 1 h 51 min
    const t = turnaroundCheck(5000, 20000, 3, now, sunset, true)
    expect(t.advice).toBe('umkehren')
    // latest turn: (75 min − 27.8 min) / 2 ≈ 23.6 min from now
    expect((t.latestTurn!.getTime() - now) / 60000).toBeCloseTo(23.6, 0)
    expect(turnaroundCheck(5000, 4000, 3, now, sunset, true).advice).toBe('weiter')
    expect(turnaroundCheck(30000, 30000, 3, now, sunset, true).advice).toBe('beides-knapp')
  })
})

describe('weather', () => {
  const hours = 96
  const t0 = Date.parse('2026-10-22T00:00:00Z') / 1000
  const mk = (rainPerHour: number, soil: number) => ({
    time: Array.from({ length: hours }, (_, i) => t0 + i * 3600),
    precipitation: Array(hours).fill(rainPerHour),
    weatherCode: Array(hours).fill(3),
    gusts: Array(hours).fill(20),
    temperature: Array(hours).fill(10),
    soilMoisture: Array(hours).fill(soil),
  })
  const surfaces = { paved: 0.2, gravel: 0.2, ground: 0.5, grass: 0.1, rock: 0, unknown: 0 }
  const now = Date.parse('2026-10-24T10:00:00Z')

  it('rates wet soft ground as muddy and dry ground as grippy', async () => {
    const { mudIndex } = await import('./weather')
    expect(mudIndex(mk(0.5, 0.36), now, surfaces).label).toMatch(/matschig/)
    expect(mudIndex(mk(0, 0.15), now, surfaces).label).toBe('griffig')
    // asphalt only: no mud whatever the weather
    expect(mudIndex(mk(1, 0.4), now, { ...surfaces, paved: 1, gravel: 0, ground: 0, grass: 0 }).score).toBe(0)
  })

  it('picks a dry start time and flags storms', async () => {
    const { bestWindow, tourWarnings } = await import('./weather')
    const w = mk(0, 0.2)
    // rain 10–12 UTC, dry afterwards
    const i10 = (now / 1000 - t0) / 3600
    w.precipitation[i10] = 3
    w.precipitation[i10 + 1] = 3
    w.weatherCode[i10] = 95
    const best = bestWindow(w, now, 90, [9.2, 49.5])!
    expect(best.start.getTime()).toBeGreaterThanOrEqual(now + 2 * 3600000)
    expect(best.rain).toBe(0)
    expect(tourWarnings(w, now, 90).join(' ')).toMatch(/Gewitter/)
  })
})

describe('emergency', () => {
  it('finds the nearest rescue point and formats coordinates for the control centre', async () => {
    const { nearestRescue, formatDms, emergencyMessage } = await import('./emergency')
    const here: LonLat = [9.2048, 49.5339]
    const pts = [
      { ref: 'NOK-1', pos: destination(here, 90, 2000) },
      { ref: 'NOK-2', pos: destination(here, 0, 400) },
    ]
    const n = nearestRescue(here, pts)!
    expect(n.ref).toBe('NOK-2')
    expect(n.distance).toBeCloseTo(400, -1)
    expect(formatDms(here)).toBe('49° 32′ 02″ N, 9° 12′ 17″ O')
    const msg = emergencyMessage(here, 8, n, 'MTB')
    expect(msg).toContain('NOK-2')
    expect(msg).toContain('49.53390° N')
  })
})

describe('time budget', () => {
  it('turns hours into a length that the time estimate confirms', async () => {
    const { lengthForMinutes, estimateMinutes } = await import('./analysis')
    const len = lengthForMinutes('mtb', 120)
    expect(len).toBeGreaterThan(15000)
    expect(len).toBeLessThan(40000)
    const mix = { trail: 0.25, forest: 0.45, farm: 0.15, cycleway: 0.05, minor: 0.1, road: 0 }
    expect(estimateMinutes('mtb', mix, len, (len / 1000) * 18, (len / 1000) * 18)).toBeCloseTo(120, -1)
    expect(lengthForMinutes('hiking', 120)).toBeLessThan(lengthForMinutes('mtb', 120))
  })
})

describe('highlights', () => {
  it('places POIs on the route with distance and side', async () => {
    const { highlightsAlongRoute } = await import('./poi')
    const r = lineRoute([{}, {}]) // runs north
    const onRoute = pointAt(r.coords, r.cum, 800)
    const pois = [
      { kind: 'Aussichtspunkt' as const, name: 'Blick', pos: destination(onRoute, 90, 60) },
      { kind: 'Quelle' as const, name: null, pos: destination(pointAt(r.coords, r.cum, 300), 270, 40) },
      { kind: 'Gipfel' as const, name: 'Fern', pos: destination(onRoute, 90, 900) },
    ]
    const h = highlightsAlongRoute(r, pois)
    expect(h.map((x) => x.kind)).toEqual(['Quelle', 'Aussichtspunkt'])
    expect(h[0].side).toBe('links')
    expect(h[1].side).toBe('rechts')
    expect(h[1].along).toBeCloseTo(800, -1)
  })
})

describe('voice', () => {
  it('keeps only the place name', async () => {
    const { parseVoiceDestination } = await import('./voice')
    expect(parseVoiceDestination('Navigiere zum Katzenbuckel')).toBe('Katzenbuckel')
    expect(parseVoiceDestination('bring mich bitte nach Mudau.')).toBe('Mudau')
    expect(parseVoiceDestination('Ziel: Margarethenschlucht')).toBe('Margarethenschlucht')
    expect(parseVoiceDestination('Eberstadter Tropfsteinhöhle')).toBe('Eberstadter Tropfsteinhöhle')
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
