import { useState } from 'react'
import { searchPlaces, type Place } from '../lib/geocode'
import type { LonLat } from '../lib/geo'
import { listenOnce, parseVoiceDestination, voiceSupported } from '../lib/voice'

export interface RoutePoint {
  pos: LonLat
  name: string
}

interface Props {
  role: 'start' | 'end'
  value: RoutePoint | null
  /** map taps currently set this point */
  active: boolean
  near?: LonLat
  onActivate: () => void
  onPick: (p: RoutePoint) => void
  onClear: () => void
  onMyPosition?: () => void
}

const placeName = (p: Place) => (p.detail ? `${p.name}, ${p.detail.split(',')[0]}` : p.name)

/** One row of the route form: a place to search, say, tap on the map, or take from GPS. */
export function PointInput({ role, value, active, near, onActivate, onPick, onClear, onMyPosition }: Props) {
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = role === 'start' ? 'Start' : 'Ziel'

  const pick = (p: Place) => {
    onPick({ pos: p.pos, name: placeName(p) })
    setPlaces([])
    setQuery('')
  }

  /** Searches; with `autoPick` (voice) the best hit is taken right away. */
  const runSearch = async (q: string, autoPick = false) => {
    if (!q.trim()) return
    setBusy(true)
    setError(null)
    try {
      const found = await searchPlaces(q, near)
      if (!found.length) setError(`„${q}“ nicht gefunden. Anders schreiben oder auf die Karte tippen.`)
      else if (autoPick) pick(found[0])
      else setPlaces(found)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const speak = async () => {
    onActivate()
    setListening(true)
    setError(null)
    try {
      const heard = await listenOnce()
      const place = parseVoiceDestination(heard)
      setQuery(place)
      await runSearch(place, true)
    } catch (err) {
      setError(`Sprache: ${(err as Error).message}. Noch einmal versuchen oder tippen.`)
    } finally {
      setListening(false)
    }
  }

  return (
    <div className={`point ${active ? 'active' : ''} ${value ? 'set' : ''}`} onClick={onActivate}>
      <i className={`dot ${role}`} />
      {value ? (
        <div className="point-value">
          <span className="point-label">{label}</span>
          <b>{value.name}</b>
          <button
            className="link"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            aria-label={`${label} löschen`}
          >
            ✕
          </button>
        </div>
      ) : (
        <form
          className="point-form"
          onSubmit={(e) => {
            e.preventDefault()
            runSearch(query)
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={onActivate}
            placeholder={listening ? 'Ich höre … z. B. „Katzenbuckel“' : `${label}: Ort eingeben oder Karte antippen`}
            aria-label={label}
          />
          <button type="submit" disabled={busy || listening}>
            {busy ? '…' : 'Suchen'}
          </button>
          {voiceSupported() && (
            <button type="button" className={listening ? 'active' : ''} title={`${label} ansagen`} onClick={speak} disabled={listening}>
              🎤
            </button>
          )}
          {onMyPosition && (
            <button type="button" title="Meinen Standort nehmen" onClick={onMyPosition}>
              ◎
            </button>
          )}
        </form>
      )}
      {error && <div className="hint">{error}</div>}
      {places.length > 0 && (
        <ul className="places">
          {places.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => pick(p)}>
                <b>{p.name}</b> <span className="muted">{p.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
