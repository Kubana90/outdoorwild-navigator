import { useEffect, useState } from 'react'
import { clock } from '../lib/nav'
import type { PlannedRoute } from '../lib/planner'
import { bestWindow, fetchWeather, mudIndex, tourWarnings, type Weather } from '../lib/weather'

const MUD_COLOR = { griffig: '#2e7d32', feucht: '#9e9d24', matschig: '#c77700', 'sehr matschig': '#8d4b14' }

/** Weather and ground check for a planned route, shown in the route details. */
export function WeatherPanel({ route }: { route: PlannedRoute }) {
  const [weather, setWeather] = useState<Weather | null>(null)
  const [error, setError] = useState<string | null>(null)
  const start = route.raw.coords[0]

  useEffect(() => {
    if (!start) return
    const ctrl = new AbortController()
    setWeather(null)
    setError(null)
    fetchWeather(start, ctrl.signal)
      .then(setWeather)
      .catch((e) => e.name !== 'AbortError' && setError('Wetter gerade nicht abrufbar (offline?).'))
    return () => ctrl.abort()
  }, [route.id])

  if (error) return <p className="muted weather">{error}</p>
  if (!weather) return <p className="muted weather">Wetter und Boden werden geprüft …</p>

  const now = Date.now()
  const mud = mudIndex(weather, now, route.analysis.surfaceShare)
  const warnings = tourWarnings(weather, now, route.analysis.durationMin)
  const best = bestWindow(weather, now, route.analysis.durationMin, start)
  const bestIsNow = best && best.start.getTime() - now < 30 * 60000

  return (
    <section className="weather">
      <h4>Wetter & Boden</h4>
      <div className="mud">
        <div className="mud-head">
          <b style={{ color: MUD_COLOR[mud.label] }}>Matsch-Index {mud.score}</b>
          <span>{mud.label}</span>
        </div>
        <div className="mud-bar">
          <span style={{ width: `${Math.max(4, mud.score)}%`, background: MUD_COLOR[mud.label] }} />
        </div>
        <p>{mud.text}</p>
      </div>
      {warnings.map((w) => (
        <p className="weather-warn" key={w}>
          ⚠ {w}
        </p>
      ))}
      <p className="weather-window">
        {best
          ? bestIsNow
            ? `Jetzt ist ein gutes Zeitfenster${best.rain > 0.2 ? ` (${best.rain.toFixed(1).replace('.', ',')} mm Regen erwartet)` : ' – trocken'}.`
            : `Bestes Zeitfenster heute: Start ${clock(best.start)}, zurück ${clock(best.end)}${best.rain > 0.2 ? `, ${best.rain.toFixed(1).replace('.', ',')} mm Regen` : ', trocken'}.`
          : 'Heute reicht das Tageslicht nicht mehr für die ganze Tour.'}
      </p>
      <p className="muted small">Wetter: Open-Meteo</p>
    </section>
  )
}
