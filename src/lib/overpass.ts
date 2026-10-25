// One door to the Overpass API: tries the main server, then a mirror, with
// a time limit per attempt. Public Overpass servers queue requests per
// client, so callers should ask for large areas rarely rather than small
// areas often.

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
const ATTEMPT_MS = 75000

export interface OverpassElement {
  type?: 'node' | 'way' | 'relation'
  lat?: number
  lon?: number
  /** ways and relations with `out center` */
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/** Position of a node, or the centre of a way/relation. */
export const elementPos = (el: OverpassElement): [number, number] | null =>
  el.lat !== undefined && el.lon !== undefined ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : null

export async function overpass(query: string, signal?: AbortSignal): Promise<OverpassElement[]> {
  let lastError: Error = new Error('Overpass nicht erreichbar')
  for (const url of MIRRORS) {
    const timeout = AbortSignal.timeout(ATTEMPT_MS)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: combined })
      if (res.ok) {
        const json = (await res.json()) as { elements: OverpassElement[] }
        return json.elements
      }
      lastError = new Error(`Overpass ${res.status}`)
    } catch (e) {
      if (signal?.aborted) throw e
      lastError = e as Error
    }
  }
  throw lastError
}

/**
 * Runs `task` again after 10 s, 30 s and 90 s while it fails, so a busy
 * Overpass server delays the places instead of hiding them until restart.
 */
export async function withRetry<T>(task: () => Promise<T>, signal?: AbortSignal, waits = [10000, 30000, 90000]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (e) {
      if (signal?.aborted || attempt >= waits.length) throw e
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, waits[attempt])
        signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    }
  }
}
