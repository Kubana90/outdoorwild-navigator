// Writes public/region-data.json (places and rescue points of the home region).
// Run with: REGION_DATA=1 npx vitest run src/lib/regiondata.build.test.ts
import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fetchRescuePoints } from './emergency'
import { withRetry } from './overpass'
import { fetchPois } from './poi'
import { regionBbox } from './regiondata'

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const run = env.REGION_DATA ? describe : describe.skip

run('region data', () => {
  it('fetches and writes public/region-data.json', async () => {
    const bbox = regionBbox()
    const pois = await withRetry(() => fetchPois(bbox, undefined, true), undefined, [60000, 120000, 180000])
    const rescue = await withRetry(() => fetchRescuePoints(bbox, undefined, true), undefined, [60000, 120000, 180000])
    // round coordinates to ~1 m to keep the file small
    const r = (v: number) => Math.round(v * 1e5) / 1e5
    const data = {
      t: Date.now(),
      pois: pois.map((p) => ({ ...p, pos: [r(p.pos[0]), r(p.pos[1])] })),
      rescue: rescue.map((p) => ({ ...p, pos: [r(p.pos[0]), r(p.pos[1])] })),
    }
    writeFileSync('public/region-data.json', JSON.stringify(data))
    console.log(`region-data.json: ${pois.length} Orte, ${rescue.length} Rettungspunkte`)
    expect(pois.length).toBeGreaterThan(500)
    expect(rescue.length).toBeGreaterThan(50)
  }, 900000)
})
