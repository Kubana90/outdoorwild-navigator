import { useEffect, useState } from 'react'
import { km } from '../lib/analysis'
import { compassWord, bearing, distance, type LonLat } from '../lib/geo'
import { POI_ICON, type Highlight, type Poi } from '../lib/poi'
import { fetchWikiSummary, type WikiSummary } from '../lib/wiki'

interface Props {
  poi: Poi | Highlight
  /** where you are now (navigation) or the chosen start (planning) */
  from: LonLat | null
  /** distance along the current route to where you stand, while navigating */
  along: number | null
  onClose: () => void
  /** planning: make it the destination */
  onSetDestination?: () => void
  /** navigating: go there and back onto the route */
  onDetour?: () => Promise<void>
}

const isHighlight = (p: Poi | Highlight): p is Highlight => 'along' in p

/** Everything about one place: what it is, where, and its story. */
export function PoiSheet({ poi, from, along, onClose, onSetDestination, onDetour }: Props) {
  const [wiki, setWiki] = useState<WikiSummary | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!poi.wikipedia && !poi.wikidata) {
      setWiki(null)
      return
    }
    const ctrl = new AbortController()
    setWiki(undefined)
    fetchWikiSummary(poi.wikipedia, poi.wikidata, ctrl.signal)
      .then(setWiki)
      .catch(() => setWiki(null))
    return () => ctrl.abort()
  }, [poi.wikipedia, poi.wikidata])

  const h = isHighlight(poi) ? poi : null
  const ahead = h && along !== null ? h.along - along : null
  const direct = from ? distance(from, poi.pos) : null

  const detour = async () => {
    if (!onDetour) return
    setBusy(true)
    setError(null)
    try {
      await onDetour()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sos-backdrop" onClick={onClose}>
      <section className="sos poi-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={poi.name ?? poi.kind}>
        <header>
          <div className="poi-head">
            <span className="poi-icon">{POI_ICON[poi.kind]}</span>
            <div>
              <h2>{poi.name ?? poi.kind}</h2>
              <span className="muted">
                {poi.kind}
                {wiki?.description ? ` · ${wiki.description}` : ''}
                {poi.ele ? ` · ${Math.round(poi.ele)} m` : ''}
              </span>
            </div>
          </div>
          <button className="link" onClick={onClose}>
            Schließen
          </button>
        </header>

        <div className="poi-where">
          {h && ahead !== null && ahead > 0 && <span>In {km(ahead)} entlang der Route</span>}
          {h && ahead !== null && ahead <= 0 && <span>Schon passiert</span>}
          {h && along === null && <span>Bei km {(h.along / 1000).toFixed(1).replace('.', ',')} der Route</span>}
          {h && <span>{h.side === 'am Weg' ? 'direkt am Weg' : `${Math.round(h.offset)} m ${h.side} abseits`}</span>}
          {direct !== null && from && (
            <span>
              Luftlinie {direct < 1000 ? `${Math.round(direct)} m` : km(direct)} Richtung {compassWord(bearing(from, poi.pos))}
            </span>
          )}
        </div>

        {wiki === undefined && <p className="muted">Geschichte wird geladen …</p>}
        {wiki && (
          <article className="poi-story">
            {wiki.image && <img src={wiki.image} alt={wiki.title} loading="lazy" />}
            <p>{wiki.extract}</p>
            <a href={wiki.url} target="_blank" rel="noreferrer">
              Mehr bei Wikipedia
            </a>
            <span className="muted small"> · Text: Wikipedia, CC BY-SA</span>
          </article>
        )}
        {wiki === null && <p className="muted">Zu diesem Ort gibt es keinen Wikipedia-Artikel. Eingetragen in OpenStreetMap.</p>}

        {onDetour && (h === null || ahead === null || ahead > -200) && (
          <button className="primary big" onClick={detour} disabled={busy}>
            {busy ? 'Abstecher wird berechnet …' : `▶ Abstecher dorthin, dann zurück auf die Route`}
          </button>
        )}
        {onSetDestination && (
          <button className="primary big" onClick={onSetDestination}>
            Als Ziel setzen
          </button>
        )}
        {error && <div className="error">{error}</div>}
      </section>
    </div>
  )
}
