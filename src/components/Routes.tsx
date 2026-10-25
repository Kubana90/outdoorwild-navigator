import { duration, km, pct, SURFACE_LABEL, WAY_COLOR, WAY_LABEL, wildLabel, type SurfaceKind, type WayKind } from '../lib/analysis'
import { clock, latestStart } from '../lib/nav'
import type { PlannedRoute } from '../lib/planner'
import { ElevationChart } from './ElevationChart'
import { WeatherPanel } from './WeatherPanel'
import { detourCandidates, highlightLabel, onTheWay, POI_ICON, type Highlight } from '../lib/poi'

export function WildRing({ score, size = 46 }: { score: number; size?: number }) {
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  const color = score >= 70 ? '#2e7d32' : score >= 45 ? '#7cb342' : score >= 25 ? '#f9a825' : '#d84343'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring" aria-label={`Wildnis-Score ${score}`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        className="ring-fg"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" className="ring-text">
        {score}
      </text>
    </svg>
  )
}

export function WayBar({ share }: { share: Record<WayKind, number> }) {
  return (
    <div className="waybar" aria-label="Wegearten">
      {(Object.keys(share) as WayKind[])
        .filter((k) => share[k] > 0.005)
        .map((k) => (
          <span key={k} style={{ flexGrow: share[k], background: WAY_COLOR[k] }} title={`${WAY_LABEL[k]}: ${pct(share[k])}`} />
        ))}
    </div>
  )
}

interface CardProps {
  route: PlannedRoute
  rank: number
  selected: boolean
  onSelect: () => void
}

export function RouteCard({ route, rank, selected, onSelect }: CardProps) {
  const a = route.analysis
  return (
    <button className={`card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <WildRing score={a.wildScore} />
      <div className="card-body">
        <div className="card-title">
          {rank === 0 && <span className="badge">Wildeste</span>}
          {route.title}
        </div>
        <div className="card-stats">
          {km(a.length)} · ↑ {Math.round(a.ascent)} Hm · {duration(a.durationMin)} · {a.difficulty}
        </div>
        <WayBar share={a.wayShare} />
        <div className="chips">
          {route.tags.map((t) => (
            <span className={`chip ${t.startsWith('⚠') ? 'warn' : ''}`} key={t}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </button>
  )
}

function HighlightRow({ h, onHover, onOpen }: { h: Highlight; onHover: (along: number | null) => void; onOpen: (h: Highlight) => void }) {
  return (
    <li className={`hl-${h.category}`} onMouseEnter={() => onHover(h.along)} onMouseLeave={() => onHover(null)} onClick={() => onOpen(h)}>
      <span className="hl-km">km {(h.along / 1000).toFixed(1).replace('.', ',')}</span>
      <span className="hl-icon">{POI_ICON[h.kind]}</span>
      <span className="hl-text">
        {highlightLabel(h)}
        <small>
          {h.side === 'am Weg' ? 'direkt am Weg' : `${h.side}, ${Math.round(h.offset)} m abseits`}
          {h.wikipedia || h.wikidata ? ' · mit Geschichte' : ''}
        </small>
      </span>
      <span className="hl-more">›</span>
    </li>
  )
}

interface DetailProps {
  route: PlannedRoute
  onHover: (along: number | null) => void
  onNavigate: () => void
  onGpx: () => void
  onSave: () => void
  onOffline: () => void
  offlineProgress: string | null
  /** rescue points near the route, null while loading */
  rescueCount: number | null
  /** places along the route, null while loading */
  highlights: Highlight[] | null
  onPoiOpen: (h: Highlight) => void
}

export function RouteDetails({ route, onHover, onNavigate, onGpx, onSave, onOffline, offlineProgress, rescueCount, highlights, onPoiOpen }: DetailProps) {
  const a = route.analysis
  const start = route.raw.coords[0]
  const latest = start ? latestStart(start, a.durationMin) : null
  const now = new Date()
  const surfaces = (Object.entries(a.surfaceShare) as [SurfaceKind, number][]).filter(([, v]) => v > 0.01).sort((x, y) => y[1] - x[1])
  const ways = (Object.entries(a.wayShare) as [WayKind, number][]).filter(([, v]) => v > 0.01).sort((x, y) => y[1] - x[1])

  return (
    <section className="details">
      <h3>
        {route.title} <span className="muted">· {wildLabel(a.wildScore)}</span>
      </h3>
      <p className="desc">{route.description}</p>

      <div className="stats-grid">
        <div>
          <b>{km(a.length)}</b>
          <span>Strecke</span>
        </div>
        <div>
          <b>↑ {Math.round(a.ascent)} m</b>
          <span>Aufstieg</span>
        </div>
        <div>
          <b>↓ {Math.round(a.descent)} m</b>
          <span>Abstieg</span>
        </div>
        <div>
          <b>{duration(a.durationMin)}</b>
          <span>geschätzt</span>
        </div>
        <div>
          <b>{Math.round(a.maxEle)} m</b>
          <span>höchster Punkt</span>
        </div>
        <div>
          <b>{a.difficulty}</b>
          <span>Schwierigkeit{a.maxDifficultyTag ? ` (${a.maxDifficultyTag})` : ''}</span>
        </div>
      </div>

      <ElevationChart route={route} onHover={onHover} />

      <div className="split">
        <div>
          <h4>Wegearten</h4>
          {ways.map(([k, v]) => (
            <div className="row" key={k}>
              <i style={{ background: WAY_COLOR[k] }} />
              <span>{WAY_LABEL[k]}</span>
              <b>{pct(v)}</b>
            </div>
          ))}
        </div>
        <div>
          <h4>Untergrund</h4>
          {surfaces.map(([k, v]) => (
            <div className="row" key={k}>
              <span>{SURFACE_LABEL[k]}</span>
              <b>{pct(v)}</b>
            </div>
          ))}
        </div>
      </div>

      {highlights && highlights.length > 0 && (
        <section className="highlights">
          {onTheWay(highlights).length > 0 && (
            <>
              <h4>Am Weg</h4>
              <ul>
                {onTheWay(highlights).map((h, i) => (
                  <HighlightRow key={`w${i}`} h={h} onHover={onHover} onOpen={onPoiOpen} />
                ))}
              </ul>
            </>
          )}
          {detourCandidates(highlights).length > 0 && (
            <>
              <h4>Abstecher lohnen sich</h4>
              <ul>
                {detourCandidates(highlights).map((h, i) => (
                  <HighlightRow key={`d${i}`} h={h} onHover={onHover} onOpen={onPoiOpen} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {highlights && highlights.length === 0 && <p className="muted small">Keine besonderen Orte direkt an dieser Route eingetragen.</p>}

      <WeatherPanel route={route} />

      {rescueCount !== null && (
        <p className="muted small">
          🆘 {rescueCount ? `${rescueCount} Rettungspunkte entlang der Route (rote Kreuze auf der Karte).` : 'Keine Rettungspunkte entlang der Route eingetragen.'}
        </p>
      )}

      {latest && (
        <p className={`daylight ${latest < now ? 'warn' : ''}`}>
          {latest < now
            ? `Achtung: Wer jetzt startet, kommt heute voraussichtlich erst nach Sonnenuntergang an.`
            : `Spätester Start heute für Ankunft 30 min vor Sonnenuntergang: ${clock(latest)} Uhr.`}
        </p>
      )}

      <div className="actions">
        <button className="primary" onClick={onNavigate}>
          ▶ Navigation starten
        </button>
        <button onClick={onSave}>☆ Merken</button>
        <button onClick={onGpx}>⤓ GPX</button>
        <button onClick={onOffline} disabled={!!offlineProgress && !offlineProgress.startsWith('✓')}>
          {offlineProgress ?? '⬇ Offline speichern'}
        </button>
      </div>
    </section>
  )
}
