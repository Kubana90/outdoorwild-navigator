// Calls the real BRouter server. Run with: LIVE=1 npx vitest run src/lib/live.test.ts
import { describe, expect, it } from 'vitest'
import { km } from './analysis'
import { planLoops, planPointToPoint } from './planner'

const live = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE ? describe : describe.skip

live('live routing (brouter.de)', () => {
  it('finds several A→B routes, wilder ones with higher wildness', async () => {
    // Mosbach → Neckargerach (Neckar-Odenwald-Kreis)
    const pts: [number, number][] = [
      [9.146, 49.352],
      [9.0708, 49.4003],
    ]
    const wild = await planPointToPoint(pts, { activity: 'mtb', wildness: 90, maxDifficulty: 2 })
    const tame = await planPointToPoint(pts, { activity: 'mtb', wildness: 10, maxDifficulty: 2 })
    for (const r of wild) console.log('wild', r.title, km(r.analysis.length), r.analysis.wildScore, r.tags.join(','), '\n ', r.description)
    console.log('tame', tame[0].title, km(tame[0].analysis.length), tame[0].analysis.wildScore)
    expect(wild.length).toBeGreaterThanOrEqual(2)
    expect(wild.length).toBeGreaterThanOrEqual(2)
    expect(wild[0].analysis.wildScore).toBeGreaterThan(tame[tame.length - 1].analysis.wildScore)
  }, 120000)

  it('builds hiking round trips close to the requested length', async () => {
    // Waldbrunn, near the Katzenbuckel
    const loops = await planLoops({ start: [9.0793, 49.4543], length: 12000, direction: null }, { activity: 'hiking', wildness: 80, maxDifficulty: 3 })
    for (const r of loops) console.log(r.title, km(r.analysis.length), r.analysis.wildScore, Math.round(r.analysis.ascent), '\n ', r.description)
    expect(loops.length).toBeGreaterThanOrEqual(2)
    for (const r of loops) {
      expect(r.analysis.length).toBeGreaterThan(8000)
      expect(r.analysis.length).toBeLessThan(17000)
    }
  }, 180000)

  it('the BW 2-metre rule keeps bikes off narrow paths without permission', async () => {
    const req = { start: [9.2048, 49.5339] as [number, number], length: 25000, direction: 0 }
    const base = { activity: 'mtb' as const, wildness: 90, maxDifficulty: 2 }
    const free = await planLoops(req, { ...base, twoMetreRule: false })
    const legal = await planLoops(req, { ...base, twoMetreRule: true })
    const narrow = (rs: typeof free) => Math.min(...rs.map((r) => r.analysis.narrowNoBikeMetres))
    console.log('narrow paths without permission: free', Math.round(narrow(free)), 'm, legal', Math.round(narrow(legal)), 'm')
    for (const r of legal) console.log(r.title, km(r.analysis.length), r.analysis.wildScore, '\n ', r.description)
    expect(narrow(legal)).toBeLessThan(narrow(free) + 1)
  }, 240000)
})
