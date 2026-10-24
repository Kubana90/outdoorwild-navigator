// One door to the Overpass API: tries the main server, then a mirror, with
// a time limit per attempt. Public Overpass servers queue requests per
// client, so callers should ask for large areas rarely rather than small
// areas often.

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
const ATTEMPT_MS = 40000

export interface OverpassElement {
  lat: number
  lon: number
  tags?: Record<string, string>
}

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
