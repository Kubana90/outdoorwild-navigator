import { describe, expect, it } from 'vitest'
import { km } from './analysis'
import { planLoops, planPointToPoint } from './planner'
import type { Segment } from './brouter'

const live = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE ? describe : describe.skip

function roadMetres(segments: Segment[]) {
  const out: Record<string, number> = {}
  for (const s of segments) {
    const hw = s.tags.highway ?? '?'
    if (/^(motorway|trunk|primary|secondary|tertiary|unclassified)/.test(hw)) out[hw] = (out[hw] ?? 0) + (s.end - s.start)
  }
  return out
}

live('road share of suggestions', () => {
  it('Mudau loop and Mosbach→Neckargerach at wildness 70', async () => {
    const opts = { activity: 'mtb' as const, wildness: 70, maxDifficulty: 2, twoMetreRule: true }
    const loops = await planLoops({ start: [9.2048, 49.5339], length: 25000, direction: null }, opts)
    for (const r of loops) console.log('LOOP', r.title, km(r.analysis.length), 'wild', r.analysis.wildScore, JSON.stringify(roadMetres(r.raw.segments)))
    const ab = await planPointToPoint([[9.146, 49.352], [9.0708, 49.4003]], opts)
    for (const r of ab) console.log('AB', r.title, km(r.analysis.length), 'wild', r.analysis.wildScore, JSON.stringify(roadMetres(r.raw.segments)))
    const far = await planPointToPoint([[9.146, 49.352], [9.3251, 49.5219]], opts)
    for (const r of far) console.log('FAR', r.title, km(r.analysis.length), 'wild', r.analysis.wildScore, JSON.stringify(roadMetres(r.raw.segments)))
    expect(loops.length + ab.length).toBeGreaterThan(0)
  }, 300000)
})
