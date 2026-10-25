// Short stories for places: the Wikipedia summary (text, picture, link) of a
// castle, fort or monument, cached 30 days so it's there without signal.
// Texts are CC BY-SA; the sheet that shows them names Wikipedia and links back.

export interface WikiSummary {
  title: string
  description: string | null
  extract: string
  image: string | null
  url: string
}

const CACHE_PREFIX = 'owild-wiki:'
const CACHE_DAYS = 30

/** "de:Burg Eberbach" → { lang: "de", title: "Burg Eberbach" } */
export function parseWikipediaTag(tag: string): { lang: string; title: string } | null {
  const m = /^([a-z]{2,3}):(.+)$/.exec(tag.trim())
  if (!m) return null
  return { lang: m[1], title: m[2].replace(/_/g, ' ') }
}

function cached(key: string): WikiSummary | null | undefined {
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) ?? 'null') as { t: number; s: WikiSummary | null } | null
    if (hit && Date.now() - hit.t < CACHE_DAYS * 86400000) return hit.s
  } catch {
    // no storage
  }
  return undefined
}

function store(key: string, s: WikiSummary | null) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), s }))
  } catch {
    // storage full: shown anyway, just not kept
  }
}

async function titleFromWikidata(id: string, signal?: AbortSignal): Promise<{ lang: string; title: string } | null> {
  const params = new URLSearchParams({ action: 'wbgetentities', ids: id, props: 'sitelinks', sitefilter: 'dewiki|enwiki', format: 'json', origin: '*' })
  const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { signal })
  if (!res.ok) return null
  const json = (await res.json()) as { entities?: Record<string, { sitelinks?: Record<string, { title: string }> }> }
  const links = json.entities?.[id]?.sitelinks ?? {}
  if (links.dewiki) return { lang: 'de', title: links.dewiki.title }
  if (links.enwiki) return { lang: 'en', title: links.enwiki.title }
  return null
}

/** The summary for a place, or null when it has no article. */
export async function fetchWikiSummary(wikipedia: string | undefined, wikidata: string | undefined, signal?: AbortSignal): Promise<WikiSummary | null> {
  const key = wikipedia ?? wikidata
  if (!key) return null
  const hit = cached(key)
  if (hit !== undefined) return hit
  const ref = (wikipedia && parseWikipediaTag(wikipedia)) || (wikidata ? await titleFromWikidata(wikidata, signal) : null)
  if (!ref) {
    store(key, null)
    return null
  }
  const res = await fetch(`https://${ref.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(ref.title.replace(/ /g, '_'))}`, { signal })
  if (!res.ok) {
    if (res.status === 404) store(key, null)
    return null
  }
  const d = (await res.json()) as {
    title: string
    description?: string
    extract?: string
    thumbnail?: { source: string }
    content_urls?: { mobile?: { page: string }; desktop?: { page: string } }
  }
  const summary: WikiSummary = {
    title: d.title,
    description: d.description ?? null,
    extract: d.extract ?? '',
    image: d.thumbnail?.source ?? null,
    url: d.content_urls?.mobile?.page ?? d.content_urls?.desktop?.page ?? `https://${ref.lang}.wikipedia.org/wiki/${encodeURIComponent(ref.title)}`,
  }
  store(key, summary)
  return summary
}

/** First one or two sentences, for a spoken announcement. */
export function shortStory(extract: string, maxChars = 220): string {
  const sentences = extract.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [extract]
  let out = ''
  for (const s of sentences) {
    if ((out + s).length > maxChars && out) break
    out += s
  }
  return out.trim()
}
