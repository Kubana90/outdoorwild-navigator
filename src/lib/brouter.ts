// Client for the public BRouter server (https://brouter.de).
// Uploads our generated wildness profile once per setting and requests routes.

import { cumulative, type LonLat } from './geo'
import { generateProfile, type ProfileOptions } from './profile'

// A self-hosted BRouter (e.g. in Docker) can be set via VITE_BROUTER_URL.
export const BROUTER_URL: string = (import.meta.env?.VITE_BROUTER_URL as string | undefined) ?? 'https://brouter.de/brouter'

const BUSY = /retry later|too many|503|429/i
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    })
  })

export interface Segment {
  /** distance along the route where this way starts / ends, metres */
  start: number
  end: number
  tags: Record<string, string>
}

export interface Hint {
  /** vertex index in coords */
  index: number
  along: number
  command: number
  exits: number
  angle: number
}

export interface RawRoute {
  coords: LonLat[]
  ele: number[]
  cum: number[]
  length: number
  segments: Segment[]
  hints: Hint[]
}

const profileIds = new Map<string, string>()

const profileKey = (o: ProfileOptions) => `${o.activity}:${Math.round(o.wildness)}:${o.maxDifficulty}:${o.twoMetreRule ? 1 : 0}`

async function uploadProfile(opts: ProfileOptions, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${BROUTER_URL}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: generateProfile(opts),
    signal,
  })
  const json = (await res.json()) as { profileid?: string; error?: string }
  if (!json.profileid || json.error) throw new Error(`Profil-Fehler: ${json.error ?? res.status}`)
  return json.profileid
}

async function profileId(opts: ProfileOptions, signal?: AbortSignal, fresh = false): Promise<string> {
  const key = profileKey(opts)
  const cached = profileIds.get(key)
  if (cached && !fresh) return cached
  const id = await uploadProfile(opts, signal)
  profileIds.set(key, id)
  return id
}

export function parseTags(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of s.split(' ')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

interface GeoJsonResponse {
  features: {
    geometry: { coordinates: number[][] }
    properties: {
      'track-length': string
      messages?: string[][]
      voicehints?: number[][]
    }
  }[]
}

export function parseRoute(json: GeoJsonResponse): RawRoute {
  const f = json.features[0]
  const coords = f.geometry.coordinates.map((c) => [c[0], c[1]] as LonLat)
  const ele = f.geometry.coordinates.map((c) => c[2] ?? NaN)
  const cum = cumulative(coords)
  const length = cum[cum.length - 1] ?? 0

  // messages: header row, then one row per way change; "Distance" is the
  // length covered since the previous row, "WayTags" the way just travelled.
  const segments: Segment[] = []
  const rows = f.properties.messages ?? []
  if (rows.length > 1) {
    const head = rows[0]
    const iDist = head.indexOf('Distance')
    const iTags = head.indexOf('WayTags')
    let pos = 0
    for (const row of rows.slice(1)) {
      const d = Number(row[iDist]) || 0
      segments.push({ start: pos, end: pos + d, tags: parseTags(row[iTags] ?? '') })
      pos += d
    }
    // rescale to our own geometry length so "along" values line up
    if (pos > 0) {
      const k = length / pos
      for (const s of segments) {
        s.start *= k
        s.end *= k
      }
    }
  }

  const hints: Hint[] = (f.properties.voicehints ?? []).map((h) => ({
    index: h[0],
    along: cum[Math.min(h[0], cum.length - 1)] ?? 0,
    command: h[1],
    exits: h[2],
    angle: h[4],
  }))

  return { coords, ele, cum, length, segments, hints }
}

export async function fetchRoute(
  points: LonLat[],
  opts: ProfileOptions,
  alternative = 0,
  signal?: AbortSignal,
): Promise<RawRoute> {
  const lonlats = points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|')
  const attempt = async (fresh: boolean) => {
    const id = await profileId(opts, signal, fresh)
    const url = `${BROUTER_URL}?lonlats=${lonlats}&profile=${id}&alternativeidx=${alternative}&format=geojson&timode=2`
    const res = await fetch(url, { signal })
    const text = await res.text()
    return { ok: res.ok && text.startsWith('{'), text }
  }
  let r = await attempt(false)
  // custom profiles expire on the server after a while: upload again once
  if (!r.ok && /profile/i.test(r.text)) r = await attempt(true)
  // the public server throttles bursts: back off and try again
  for (let wait = 1500; !r.ok && BUSY.test(r.text) && wait <= 12000; wait *= 2) {
    await sleep(wait, signal)
    r = await attempt(false)
  }
  if (!r.ok) throw new Error(humanError(r.text))
  return parseRoute(JSON.parse(r.text) as GeoJsonResponse)
}

function humanError(text: string): string {
  if (/not found|no track|target island|from-position not mapped|to-position not mapped/i.test(text))
    return 'Für diese Punkte wurde kein erlaubter Weg gefunden. Setze die Punkte näher an einen Weg.'
  if (BUSY.test(text)) return 'Der Routing-Server ist gerade ausgelastet. Bitte in einer Minute noch einmal versuchen.'
  if (/operation killed|timeout/i.test(text)) return 'Die Route ist zu lang für den Server. Versuche eine kürzere Strecke.'
  return `Routing fehlgeschlagen: ${text.slice(0, 160)}`
}
