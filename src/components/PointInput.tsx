import { useState } from 'react'
import { searchPlaces, type Place } from '../lib/geocode'
import type { LonLat } from '../lib/geo'

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

/** One row of the route form: a place to search, tap on the map, or take from GPS. */
export function PointInput({ role, value, active, near, onActivate, onPick, onClear, onMyPosition }: Props) {
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = role === 'start' ? 'Start' : 'Ziel'

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    try {
      const found = await searchPlaces(query, near)
      setPlaces(found)
      if (!found.length) setError('Nichts gefunden. Anders schreiben oder auf die Karte tippen.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pick = (p: Place) => {
    onPick({ pos: p.pos, name: p.detail ? `${p.name}, ${p.detail.split(',')[0]}` : p.name })
    setPlaces([])
    setQuery('')
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
        <form className="point-form" onSubmit={search}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={onActivate}
            placeholder={`${label}: Ort eingeben oder Karte antippen`}
            aria-label={label}
          />
          <button type="submit" disabled={busy}>
            {busy ? '…' : 'Suchen'}
          </button>
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
