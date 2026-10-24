import { useEffect, useRef, useState } from 'react'
import { MapView, TOPO_TILES, flyTo, overlayTiles, type BaseMap, type MapPoint, type Overlay } from './components/MapView'
import { NavigationView } from './components/NavigationView'
import { PointInput, type RoutePoint } from './components/PointInput'
import { RouteCard, RouteDetails } from './components/Routes'
import { analyzeRoute, characterTags, describeRoute, km } from './lib/analysis'
import { reverseGeocode } from './lib/geocode'
import type { LonLat } from './lib/geo'
import { download, fromGpx, toGpx } from './lib/gpx'
import { primeSpeech, requestCompassPermission } from './lib/device'
import type { Fix } from './lib/nav'
import { deleteSaved, loadSaved, prefetchCorridor, saveRoute, type SavedRoute } from './lib/offline'
import { planLoops, planPointToPoint, type PlannedRoute } from './lib/planner'
import { isBikeActivity, type Activity } from './lib/profile'
import { REGION, REGION_PLACES } from './lib/region'

const ACTIVITIES: { id: Activity; label: string; icon: string }[] = [
  { id: 'mtb', label: 'MTB', icon: '🚵' },
  { id: 'gravel', label: 'Gravel', icon: '🚴' },
  { id: 'hiking', label: 'Wandern', icon: '🥾' },
  { id: 'trailrun', label: 'Trailrun', icon: '🏃' },
]

const DIRECTIONS: { label: string; deg: number | null }[] = [
  { label: 'egal', deg: null },
  { label: 'N', deg: 0 },
  { label: 'O', deg: 90 },
  { label: 'S', deg: 180 },
  { label: 'W', deg: 270 },
]

const WILD_WORDS = ['entspannt', 'naturnah', 'wild', 'sehr wild', 'abgelegen']

type Mode = 'loop' | 'ab'
type Target = 'start' | 'end' | 'via'

function currentPosition(): Promise<LonLat> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Dieses Gerät hat kein GPS.'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      (e) => reject(new Error(e.code === 1 ? 'Standortzugriff verweigert. Erlaube ihn in den Einstellungen.' : 'Standort nicht verfügbar. Freie Sicht zum Himmel suchen.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
    )
  })
}

export default function App() {
  const [activity, setActivity] = useState<Activity>('mtb')
  const [wildness, setWildness] = useState(70)
  const [mtbMax, setMtbMax] = useState(2)
  const [sacMax, setSacMax] = useState(3)
  const [twoMetreRule, setTwoMetreRule] = useState(true)
  const [mode, setMode] = useState<Mode>('loop')
  const [start, setStart] = useState<RoutePoint | null>(null)
  const [end, setEnd] = useState<RoutePoint | null>(null)
  const [vias, setVias] = useState<LonLat[]>([])
  /** which point the next map tap sets */
  const [target, setTarget] = useState<Target>('start')
  const [loopKm, setLoopKm] = useState(25)
  const [direction, setDirection] = useState<number | null>(null)

  const [candidates, setCandidates] = useState<PlannedRoute[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fitKey, setFitKey] = useState('')
  const [loading, setLoading] = useState<null | 'search' | 'navigate'>(null)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const [base, setBase] = useState<BaseMap>('topo')
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [hoverAlong, setHoverAlong] = useState<number | null>(null)

  const [saved, setSaved] = useState<SavedRoute[]>(() => loadSaved())
  const [offline, setOffline] = useState<string | null>(null)

  const [navRoute, setNavRoute] = useState<PlannedRoute | null>(null)
  const [fix, setFix] = useState<Fix | null>(null)
  const [detour, setDetour] = useState<LonLat[] | null>(null)
  const [follow, setFollow] = useState(true)
  const [headingUp, setHeadingUp] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(true)

  const bike = isBikeActivity(activity)
  const selected = candidates.find((c) => c.id === selectedId) ?? null
  const options = { activity, wildness, maxDifficulty: bike ? mtbMax : sacMax, twoMetreRule: bike && twoMetreRule }

  useEffect(() => {
    if (candidates.length) setStale(true)
  }, [activity, wildness, mtbMax, sacMax, twoMetreRule, loopKm, direction])

  useEffect(() => {
    setLoopKm((k) => (bike ? Math.max(k, 15) : Math.min(k, 15)))
  }, [bike])

  const points: MapPoint[] = [
    ...(start ? [{ pos: start.pos, role: 'start' as const }] : []),
    ...(mode === 'ab' ? vias.map((v) => ({ pos: v, role: 'via' as const })) : []),
    ...(mode === 'ab' && end ? [{ pos: end.pos, role: 'end' as const }] : []),
  ]

  /** Sets a point from the map with a provisional name, then looks the name up. */
  const setPointFromMap = (role: 'start' | 'end', pos: LonLat) => {
    const set = role === 'start' ? setStart : setEnd
    set({ pos, name: 'Punkt auf der Karte' })
    reverseGeocode(pos).then((name) => set((cur) => (cur && cur.pos === pos ? { pos, name } : cur)))
    setStale(candidates.length > 0)
  }

  const onMapClick = (pos: LonLat) => {
    if (navRoute) {
      setFollow(false)
      return
    }
    if (mode === 'loop') {
      setPointFromMap('start', pos)
      return
    }
    if (target === 'start' || !start) {
      setPointFromMap('start', pos)
      setTarget(end ? 'via' : 'end')
    } else if (target === 'end' || !end) {
      setPointFromMap('end', pos)
      setTarget('via')
    } else {
      setVias((v) => [...v, pos])
      setStale(candidates.length > 0)
    }
  }

  const useMyPosition = async () => {
    try {
      const pos = await currentPosition()
      setStart({ pos, name: 'Mein Standort' })
      setTarget(end ? 'via' : 'end')
      flyTo(pos)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const pickPlace = (role: 'start' | 'end', p: RoutePoint) => {
    if (role === 'start') {
      setStart(p)
      setTarget(mode === 'ab' && !end ? 'end' : 'via')
    } else {
      setEnd(p)
      setTarget('via')
    }
    setStale(candidates.length > 0)
    flyTo(p.pos)
  }

  /** Region chips fill the point the user is working on. */
  const pickRegionPlace = (p: (typeof REGION_PLACES)[number]) => {
    const role = mode === 'ab' && start && (target === 'end' || !end) ? 'end' : 'start'
    pickPlace(role, { pos: p.pos, name: p.name })
  }

  const findRoutes = async () => {
    if (!start || (mode === 'ab' && !end)) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setLoading('search')
    setError(null)
    try {
      const found =
        mode === 'loop'
          ? await planLoops({ start: start.pos, length: loopKm * 1000, direction }, options, ctrl.signal)
          : await planPointToPoint([start.pos, ...vias, end!.pos], options, ctrl.signal)
      setCandidates(found)
      setSelectedId(found[0]?.id ?? null)
      setFitKey(String(Date.now()))
      setStale(false)
      setOffline(null)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    } finally {
      setLoading(null)
    }
  }

  const startNavigation = async (route: PlannedRoute) => {
    // both need a tap on iPhones; the tap is the button that called us
    primeSpeech()
    await requestCompassPermission()
    setNavRoute(route)
    setFollow(true)
  }

  /** Plan from here (or the chosen start) to the destination and guide right away. */
  const navigateToDestination = async () => {
    if (!end) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setLoading('navigate')
    setError(null)
    primeSpeech()
    try {
      let from = start
      if (!from) {
        const pos = await currentPosition()
        from = { pos, name: 'Mein Standort' }
        setStart(from)
      }
      const found = await planPointToPoint([from.pos, ...vias, end.pos], options, ctrl.signal)
      setCandidates(found)
      setSelectedId(found[0].id)
      setFitKey(String(Date.now()))
      setStale(false)
      await startNavigation(found[0])
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    } finally {
      setLoading(null)
    }
  }

  const clearPoints = () => {
    setStart(null)
    setEnd(null)
    setVias([])
    setTarget('start')
    setCandidates([])
    setSelectedId(null)
  }

  const importGpx = async (file: File) => {
    try {
      const raw = fromGpx(await file.text())
      const analysis = analyzeRoute(raw, activity)
      const r: PlannedRoute = {
        id: `gpx-${file.name}-${Math.round(raw.length)}`,
        title: file.name.replace(/\.gpx$/i, ''),
        raw,
        analysis,
        description: `Importierter Track (${km(raw.length)}). Wegearten sind für importierte Tracks nicht bekannt.`,
        tags: characterTags(analysis, activity).filter((t) => t === 'Knackig' || t === 'Flach'),
        waypoints: [raw.coords[0], raw.coords[raw.coords.length - 1]],
        options: { activity, wildness, maxDifficulty: 2 },
      }
      setCandidates([r])
      setSelectedId(r.id)
      setFitKey(String(Date.now()))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const saveOffline = async (r: PlannedRoute) => {
    setSaved(saveRoute(r))
    const templates = [TOPO_TILES[0], ...(overlay !== 'none' ? [overlayTiles(overlay)] : [])]
    try {
      const total = await prefetchCorridor(r.raw.coords, templates, (d, t) => setOffline(`${Math.round((d / t) * 100)} % geladen`))
      setOffline(`✓ offline (${total} Kacheln)`)
    } catch {
      setOffline('Offline-Speicher nicht verfügbar')
    }
  }

  const loadSavedRoute = (s: SavedRoute) => {
    // re-derive the text in case the analysis code changed since saving
    const r = { ...s.route, description: describeRoute(s.route.analysis, s.route.options.activity) }
    setCandidates([r])
    setSelectedId(r.id)
    setFitKey(String(Date.now()))
  }

  const canSearch = !!start && (mode === 'loop' || !!end)

  return (
    <div className={`app ${navRoute ? 'navigating' : ''} ${sheetOpen ? '' : 'sheet-closed'}`}>
      <MapView
        base={base}
        overlay={overlay}
        points={navRoute ? [] : points}
        candidates={navRoute ? [navRoute] : candidates}
        selectedId={navRoute ? navRoute.id : selectedId}
        hoverAlong={hoverAlong}
        user={fix ? { pos: fix.pos, heading: fix.heading, accuracy: fix.accuracy } : null}
        follow={!!navRoute && follow}
        headingUp={headingUp}
        fitKey={fitKey}
        onMapClick={onMapClick}
        onSelect={setSelectedId}
        detour={detour}
        onUserPan={() => setFollow(false)}
      />

      <div className="layers">
        <select value={base} onChange={(e) => setBase(e.target.value as BaseMap)} aria-label="Kartenstil">
          <option value="topo">Topo-Karte</option>
          <option value="vector">Vektor-Karte</option>
        </select>
        <select value={overlay} onChange={(e) => setOverlay(e.target.value as Overlay)} aria-label="Wege-Overlay">
          <option value="none">ohne Overlay</option>
          <option value="hiking">Wanderwege</option>
          <option value="mtb">MTB-Routen</option>
        </select>
      </div>

      {navRoute && (
        <NavigationView
          route={navRoute}
          onFix={setFix}
          onDetour={setDetour}
          onExit={() => {
            setNavRoute(null)
            setFix(null)
            setDetour(null)
          }}
          headingUp={headingUp}
          onToggleHeadingUp={() => setHeadingUp((h) => !h)}
          follow={follow}
          onFollow={() => setFollow(true)}
        />
      )}

      {!navRoute && (
        <aside className="panel">
          <button className="sheet-handle" onClick={() => setSheetOpen((o) => !o)} aria-label="Panel ein- oder ausklappen">
            <span />
          </button>
          <header className="brand">
            <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
              <rect width="64" height="64" rx="14" fill="#1f3d2b" />
              <path d="M32 10 14 44h11l-6 10h26l-6-10h11z" fill="#8fd18b" />
            </svg>
            <div>
              <h1>OutdoorWild Navigator</h1>
              <p>Wilde Wege im Odenwald & Neckartal</p>
            </div>
          </header>

          <div className="seg activities">
            {ACTIVITIES.map((a) => (
              <button key={a.id} className={activity === a.id ? 'on' : ''} onClick={() => setActivity(a.id)}>
                <span>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>

          <div className="seg modes">
            <button className={mode === 'loop' ? 'on' : ''} onClick={() => setMode('loop')}>
              ⟳ Rundtour
            </button>
            <button
              className={mode === 'ab' ? 'on' : ''}
              onClick={() => {
                setMode('ab')
                setTarget(start ? 'end' : 'start')
              }}
            >
              → Zum Ziel
            </button>
          </div>

          <div className="points">
            <PointInput
              role="start"
              value={start}
              active={mode === 'loop' || target === 'start'}
              near={end?.pos}
              onActivate={() => setTarget('start')}
              onPick={(p) => pickPlace('start', p)}
              onClear={() => {
                setStart(null)
                setTarget('start')
              }}
              onMyPosition={useMyPosition}
            />
            {mode === 'ab' && (
              <PointInput
                role="end"
                value={end}
                active={target === 'end'}
                near={start?.pos}
                onActivate={() => setTarget('end')}
                onPick={(p) => pickPlace('end', p)}
                onClear={() => {
                  setEnd(null)
                  setTarget('end')
                }}
              />
            )}
            {mode === 'ab' && !start && <div className="hint">Ohne Start wird ab deinem aktuellen Standort navigiert.</div>}
            {mode === 'ab' && start && end && (
              <div className="hint">
                {vias.length ? `${vias.length} Zwischenpunkt(e) gesetzt. ` : ''}Tippe auf die Karte, um Zwischenpunkte hinzuzufügen.
              </div>
            )}
            {(start || end || vias.length > 0) && (
              <button className="link" onClick={clearPoints}>
                Alle Punkte löschen
              </button>
            )}
          </div>

          <div className="region">
            <div className="region-head">
              Orte im {REGION.name}
              <button className="link" onClick={() => flyTo(REGION.center)}>
                Region zeigen
              </button>
            </div>
            <div className="chips">
              {REGION_PLACES.map((p) => (
                <button key={p.name} className="chip-btn" title={p.note} onClick={() => pickRegionPlace(p)}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <div className="field-head">
              <span>Wildnis-Regler</span>
              <b>
                {wildness} · {WILD_WORDS[Math.min(4, Math.floor(wildness / 20.01))]}
              </b>
            </div>
            <input type="range" min={0} max={100} step={5} value={wildness} onChange={(e) => setWildness(Number(e.target.value))} className="wild-range" />
            <div className="range-ends">
              <span>Forstwege & Radwege</span>
              <span>schmale Pfade, weit weg</span>
            </div>
          </label>

          {activity === 'mtb' && (
            <label className="field inline">
              <span>Maximale Trail-Schwierigkeit</span>
              <select value={mtbMax} onChange={(e) => setMtbMax(Number(e.target.value))}>
                {[0, 1, 2, 3, 4].map((s) => (
                  <option key={s} value={s}>
                    S{s}
                    {s === 0 ? ' (leicht)' : s === 2 ? ' (anspruchsvoll)' : s >= 3 ? ' (schwer)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {bike && (
            <label className="check">
              <input type="checkbox" checked={twoMetreRule} onChange={(e) => setTwoMetreRule(e.target.checked)} />
              <span>
                2-Meter-Regel Baden-Württemberg beachten
                <small>Schmale Waldpfade nur, wenn sie für Räder freigegeben sind</small>
              </span>
            </label>
          )}
          {!bike && (
            <label className="field inline">
              <span>Maximale Wegschwierigkeit</span>
              <select value={sacMax} onChange={(e) => setSacMax(Number(e.target.value))}>
                <option value={1}>T1 Wandern</option>
                <option value={2}>T2 Bergwandern</option>
                <option value={3}>T3 anspruchsvoll</option>
                <option value={4}>T4 Alpinwandern</option>
              </select>
            </label>
          )}

          {mode === 'loop' && (
            <>
              <label className="field">
                <div className="field-head">
                  <span>Länge der Runde</span>
                  <b>{loopKm} km</b>
                </div>
                <input type="range" min={bike ? 10 : 3} max={bike ? 100 : 40} step={1} value={loopKm} onChange={(e) => setLoopKm(Number(e.target.value))} />
              </label>
              <div className="field inline">
                <span>Richtung</span>
                <div className="seg small">
                  {DIRECTIONS.map((d) => (
                    <button key={d.label} className={direction === d.deg ? 'on' : ''} onClick={() => setDirection(d.deg)}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <button className="primary big" disabled={!canSearch || !!loading} onClick={findRoutes}>
                {loading ? 'Suche wilde Wege …' : stale ? '↻ Neu suchen' : 'Rundtouren finden'}
              </button>
            </>
          )}

          {mode === 'ab' && (
            <div className="go-row">
              <button className="primary big" disabled={!end || !!loading} onClick={navigateToDestination}>
                {loading === 'navigate' ? 'Route wird berechnet …' : '▶ Zum Ziel navigieren'}
              </button>
              <button className="big" disabled={!canSearch || !!loading} onClick={findRoutes}>
                {loading === 'search' ? 'Suche …' : stale ? '↻ Varianten neu suchen' : 'Varianten vergleichen'}
              </button>
            </div>
          )}
          {error && <div className="error">{error}</div>}

          {candidates.length > 0 && (
            <section className="results">
              <h2>
                {candidates.length} {candidates.length === 1 ? 'Route' : 'Routen'} gefunden <span className="muted">· wähle eine aus</span>
              </h2>
              {candidates.map((c, i) => (
                <RouteCard key={c.id} route={c} rank={candidates.length > 1 ? i : -1} selected={c.id === selectedId} onSelect={() => setSelectedId(c.id)} />
              ))}
            </section>
          )}

          {selected && (
            <RouteDetails
              route={selected}
              onHover={setHoverAlong}
              onNavigate={() => startNavigation(selected)}
              onGpx={() => download(`${selected.title.replace(/\W+/g, '_')}.gpx`, toGpx(selected.raw, selected.title, selected.description))}
              onSave={() => setSaved(saveRoute(selected))}
              onOffline={() => saveOffline(selected)}
              offlineProgress={offline}
            />
          )}

          <section className="saved">
            <h2>Gemerkte Touren</h2>
            {saved.length === 0 && <p className="muted">Noch keine. Merke dir eine Route mit „☆ Merken“.</p>}
            {saved.map((s) => (
              <div className="saved-row" key={s.route.id}>
                <button className="link" onClick={() => loadSavedRoute(s)}>
                  {s.route.title} · {km(s.route.analysis.length)} · Wildnis {s.route.analysis.wildScore}
                </button>
                <button className="link danger" onClick={() => setSaved(deleteSaved(s.route.id))} aria-label="Entfernen">
                  ✕
                </button>
              </div>
            ))}
            <label className="link file">
              ⤒ GPX-Datei öffnen
              <input type="file" accept=".gpx,application/gpx+xml" onChange={(e) => e.target.files?.[0] && importGpx(e.target.files[0])} hidden />
            </label>
          </section>

          <footer className="legal">
            Routen: <a href="https://brouter.de">BRouter</a> · Daten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>.
            Wegeregeln vor Ort (z. B. Naturschutzgebiete, 2-m-Regel in Baden-Württemberg) gehen immer vor. Kein Ersatz für einen Notruf: 112.
          </footer>
        </aside>
      )}
    </div>
  )
}
