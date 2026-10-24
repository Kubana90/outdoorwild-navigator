import { useEffect, useMemo, useRef, useState } from 'react'
import { analyzeRoute, km, WAY_COLOR, WAY_LABEL } from '../lib/analysis'
import { fetchRoute, type RawRoute } from '../lib/brouter'
import { bearing, compassWord, destination, distance, pointAt, angleDiff, type LonLat } from '../lib/geo'
import { download, trackToGpx, type TrackPoint } from '../lib/gpx'
import { clock, Navigator, rejoinTarget, REROUTE_AFTER_MS, REROUTE_EVERY_MS, type Fix, type NavState } from '../lib/nav'
import type { PlannedRoute } from '../lib/planner'
import { isBikeActivity } from '../lib/profile'
import { ElevationChart } from './ElevationChart'
import { keepScreenOn, watchPosition } from '../lib/native'
import { nearestRescue, type RescuePoint } from '../lib/emergency'
import { highlightLabel, POI_ICON, type Highlight } from '../lib/poi'

interface Props {
  route: PlannedRoute
  rescuePoints: RescuePoint[]
  highlights: Highlight[]
  onSos: () => void
  onFix: (fix: Fix | null) => void
  onDetour: (line: LonLat[] | null) => void
  onExit: () => void
  headingUp: boolean
  onToggleHeadingUp: () => void
  follow: boolean
  onFollow: () => void
}

/** The computed way back onto the planned route. */
interface Detour {
  raw: RawRoute
  nav: Navigator
  state: NavState | null
}

const GPS_STALE_MS = 20000
const TRACK_KEY = 'owild-track'

function speak(text: string, enabled: boolean) {
  if (!enabled || !('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'de-DE'
  u.rate = 1.05
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

const vibrate = (pattern: number[]) => navigator.vibrate?.(pattern)

const span = (min: number) => (min >= 90 ? `${Math.round(min / 60)} h` : `${Math.round(min)} min`)

const metres = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : km(m))

/** Compass heading from the device, if it has one. */
function useCompass(): number | null {
  const [h, setH] = useState<number | null>(null)
  useEffect(() => {
    const onOri = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      if (typeof e.webkitCompassHeading === 'number') setH(e.webkitCompassHeading)
      else if (e.absolute && e.alpha !== null) setH((360 - e.alpha) % 360)
    }
    window.addEventListener('deviceorientationabsolute', onOri as EventListener)
    window.addEventListener('deviceorientation', onOri as EventListener)
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOri as EventListener)
      window.removeEventListener('deviceorientation', onOri as EventListener)
    }
  }, [])
  return h
}

/** Ticks every few seconds so the view notices a silent GPS. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

export function NavigationView({ route, rescuePoints, highlights, onSos, onFix, onDetour, onExit, headingUp, onToggleHeadingUp, follow, onFollow }: Props) {
  const navigator_ = useMemo(() => new Navigator(route.raw, route.analysis), [route])
  const [state, setState] = useState<NavState | null>(null)
  const [fix, setFix] = useState<Fix | null>(null)
  const [voice, setVoice] = useState(true)
  const [sim, setSim] = useState(false)
  const [simSpeed, setSimSpeed] = useState(5)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [detour, setDetour] = useState<Detour | null>(null)
  const [rerouting, setRerouting] = useState(false)
  const [trackLength, setTrackLength] = useState(0)
  const compass = useCompass()
  const now = useNow(5000)
  const announced = useRef(new Set<string>())
  const wasOff = useRef(false)
  const deviate = useRef(0)
  const offSince = useRef<number | null>(null)
  const rerouteAt = useRef(0)
  const rerouteAbort = useRef<AbortController | null>(null)
  const track = useRef<TrackPoint[]>([])
  const bike = isBikeActivity(route.options.activity)

  // keep the screen on while navigating
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    keepScreenOn(true)
    const request = () => navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {})
    request()
    // the lock is released when the app goes to the background: take it again
    const onVisible = () => document.visibilityState === 'visible' && request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
      keepScreenOn(false)
    }
  }, [])

  // real GPS (natively a background service, so it keeps going with the screen off)
  useEffect(() => {
    if (sim) return
    return watchPosition(
      (p) => {
        setGpsError(null)
        setFix(p)
      },
      (e) =>
        setGpsError(e === 'denied' ? 'Standortzugriff verweigert. Unter „⚙ Berechtigungen prüfen“ einschalten oder die Simulation nutzen.' : 'Kein GPS-Signal.'),
    )
  }, [sim])

  // simulation: move along the route at simSpeed × planned speed
  useEffect(() => {
    if (!sim) return
    const r = route.raw
    const planned = route.analysis.length / Math.max(1, route.analysis.durationMin * 60)
    let along = state?.along ?? 0
    const t = setInterval(() => {
      along = Math.min(r.length, along + planned * simSpeed)
      let pos = pointAt(r.coords, r.cum, along)
      const ahead = pointAt(r.coords, r.cum, along + 20)
      const brg = bearing(pos, ahead)
      if (deviate.current > 0) {
        deviate.current--
        pos = destination(pos, brg + 90, 60)
      }
      setFix({ pos, accuracy: 5, heading: brg, speed: planned * simSpeed, time: Date.now() })
    }, 1000)
    return () => clearInterval(t)
  }, [sim, simSpeed])

  // computes a way from the current position back onto the route
  const reroute = (f: Fix, along: number) => {
    rerouteAt.current = f.time
    rerouteAbort.current?.abort()
    const ctrl = new AbortController()
    rerouteAbort.current = ctrl
    setRerouting(true)
    fetchRoute([f.pos, rejoinTarget(route.raw, along)], route.options, 0, ctrl.signal)
      .then((raw) => {
        if (ctrl.signal.aborted || raw.length < 15) return
        setDetour({ raw, nav: new Navigator(raw, analyzeRoute(raw, route.options.activity)), state: null })
        onDetour(raw.coords)
        vibrate([80, 60, 80])
        speak(`Rückweg berechnet: ${metres(raw.length)} bis zum Pfad.`, voice)
      })
      .catch(() => {})
      .finally(() => !ctrl.signal.aborted && setRerouting(false))
  }

  // feed the navigator
  useEffect(() => {
    if (!fix) return
    const heading = fix.heading ?? compass
    const f = { ...fix, heading }
    onFix(f)
    const s = navigator_.update(f)
    if (import.meta.env.DEV) Object.assign(window, { __owildNav: { fix: f, state: s } })
    setState(s)

    // track recording: a point every few metres, saved so a reload keeps it
    const last = track.current[track.current.length - 1]
    if (!last || distance(last.pos, f.pos) >= 3) {
      track.current.push({ pos: f.pos, time: f.time, accuracy: f.accuracy })
      setTrackLength((len) => len + (last ? distance(last.pos, f.pos) : 0))
      if (track.current.length % 20 === 0) {
        try {
          localStorage.setItem(TRACK_KEY, JSON.stringify({ name: route.title, points: track.current }))
        } catch {
          // storage full: the in-memory track still works
        }
      }
    }

    // detour handling
    if (!s.offTrack) {
      offSince.current = null
      if (detour) {
        rerouteAbort.current?.abort()
        setDetour(null)
        onDetour(null)
      }
      return
    }
    offSince.current ??= f.time
    const mayReroute = f.time - rerouteAt.current >= REROUTE_EVERY_MS
    if (detour) {
      const ds = detour.nav.update(f)
      setDetour({ ...detour, state: ds })
      // strayed from the detour as well: compute a fresh one
      if (ds.offTrack && mayReroute) reroute(f, s.along)
    } else if (f.time - offSince.current >= REROUTE_AFTER_MS && s.guideDistance > 50 && mayReroute) {
      reroute(f, s.along)
    }
  }, [fix])

  useEffect(
    () => () => {
      onFix(null)
      onDetour(null)
      rerouteAbort.current?.abort()
    },
    [],
  )

  // announcements
  useEffect(() => {
    if (!state) return
    const a = announced.current
    if (state.offTrack && !wasOff.current) {
      vibrate([200, 100, 200, 100, 200])
      speak(`Du hast den Weg verlassen. Der Weg liegt ${Math.round(state.guideDistance)} Meter Richtung ${compassWord(state.guideBearing)}.`, voice)
    } else if (!state.offTrack && wasOff.current) {
      vibrate([80])
      speak('Wieder auf dem Weg.', voice)
    }
    wasOff.current = state.offTrack
    if (state.offTrack) return

    const h = state.nextHint
    if (h) {
      // faster riders hear the first call earlier: about 25 s before the turn
      const far = Math.max(bike ? 250 : 120, (fix?.speed ?? 0) * 25)
      const near = bike ? 40 : 20
      const left = h.angle < 0
      if (h.distance <= far && h.distance > near * 2 && !a.has(`f${h.index}`)) {
        a.add(`f${h.index}`)
        speak(`In ${Math.round(h.distance / 10) * 10} Metern ${h.text}`, voice)
      }
      if (h.distance <= near && !a.has(`n${h.index}`)) {
        a.add(`n${h.index}`)
        vibrate(h.command === 1 ? [60] : left ? [120, 80, 120] : [450])
        speak(h.text, voice)
      }
    }
    const c = state.nextClimb
    if (c && c.inMetres < 200 && c.inMetres > 0) {
      const key = `c${Math.round((state.along + c.inMetres) / 100)}`
      if (!a.has(key)) {
        a.add(key)
        speak(`Gleich kommt ein Anstieg: ${Math.round(c.gain)} Höhenmeter auf ${Math.round(c.length / 10) * 10} Metern.`, voice)
      }
    }
    if (state.daylightBuffer !== null && state.daylightBuffer < 15 && !a.has('dark')) {
      a.add('dark')
      speak('Achtung, du erreichst das Ziel voraussichtlich erst bei Dunkelheit. Prüfe, ob du umkehren oder abkürzen solltest.', voice)
    }
    const hl = highlights.find((x) => x.along > state.along && x.along - state.along <= 300)
    if (hl) {
      const key = `h${Math.round(hl.along)}`
      if (!a.has(key)) {
        a.add(key)
        const where = hl.side === 'am Weg' ? 'direkt am Weg' : hl.side
        speak(`In ${Math.round((hl.along - state.along) / 50) * 50} Metern: ${hl.kind}${hl.name ? ` ${hl.name}` : ''}, ${where}.`, voice)
      }
    }
    const t = state.turnaround
    if (t?.advice === 'umkehren' && !a.has('turn')) {
      a.add('turn')
      vibrate([300, 150, 300])
      speak(`Achtung: Bis zum Ziel reicht das Tageslicht nicht mehr. Umkehren bringt dich um ${clock(t.backArrival)} zurück zum Start.`, voice)
    }
    if (state.finished && !a.has('done')) {
      a.add('done')
      vibrate([100, 60, 100, 60, 300])
      speak('Ziel erreicht. Schöne Tour!', voice)
    }
  }, [state])

  // detour turn announcements
  useEffect(() => {
    const h = detour?.state?.nextHint
    if (!h || !state?.offTrack) return
    const near = bike ? 40 : 20
    if (h.distance <= near && !announced.current.has(`d${detour!.raw.length}-${h.index}`)) {
      announced.current.add(`d${detour!.raw.length}-${h.index}`)
      vibrate(h.angle < 0 ? [120, 80, 120] : [450])
      speak(h.text, voice)
    }
  }, [detour])

  // GPS gone quiet?
  const gpsStale = !sim && !!fix && now - fix.time > GPS_STALE_MS
  useEffect(() => {
    if (gpsStale && !announced.current.has('stale')) {
      announced.current.add('stale')
      vibrate([300])
      speak('GPS-Signal verloren. Die Anzeige wird nicht mehr aktualisiert.', voice)
    }
    if (!gpsStale) announced.current.delete('stale')
  }, [gpsStale])

  const saveTrack = () => {
    const name = `${route.title} ${new Date().toLocaleDateString('de-DE')}`
    download(`${name.replace(/\W+/g, '_')}_Track.gpx`, trackToGpx(track.current, name))
  }

  const heading = fix?.heading ?? compass
  // arrow rotation: relative to where the user looks (or north if unknown)
  const arrow = state ? (heading !== null ? angleDiff(heading, state.guideBearing) : state.guideBearing) : 0
  const daylightClass = state?.daylightBuffer == null ? '' : state.daylightBuffer < 0 ? 'bad' : state.daylightBuffer < 45 ? 'warn' : 'ok'
  const detourHint = state?.offTrack && detour?.state ? detour.state : null
  const rescueNear = fix ? nearestRescue(fix.pos, rescuePoints) : null
  const nextHighlight = state ? (highlights.find((x) => x.along > state.along - 30 && x.along - state.along <= 1500) ?? null) : null
  // a silent GPS outranks every instruction: the instruction would be stale too
  const topClass = gpsStale ? 'stale' : state?.offTrack ? (detourHint ? 'detour' : 'off') : ''

  return (
    <div className="nav">
      <div className={`nav-top ${topClass}`}>
        {!state && <div className="nav-wait">{gpsError ?? 'Suche GPS-Signal …'}</div>}
        {state && gpsStale && (
          <div className="nav-wait">Kein GPS-Signal seit {Math.round((now - fix!.time) / 1000)} s – freie Sicht zum Himmel suchen</div>
        )}
        {!gpsStale && detourHint && (
          <div className="nav-hint">
            <div
              className="hint-arrow"
              style={{ transform: `rotate(${detourHint.nextHint ? Math.max(-150, Math.min(150, detourHint.nextHint.angle)) : angleDiff(heading ?? 0, detourHint.guideBearing)}deg)` }}
            >
              ⬆
            </div>
            <div>
              <div className="hint-dist">{detourHint.nextHint ? metres(detourHint.nextHint.distance) : metres(detourHint.remaining)}</div>
              <div className="hint-text">
                Rückweg: {detourHint.nextHint ? detourHint.nextHint.text : 'dem Rückweg folgen'} · noch {metres(detourHint.remaining)} bis zum Pfad
              </div>
            </div>
          </div>
        )}
        {!gpsStale && state?.offTrack && !detourHint && (
          <div className="nav-hint">
            <div className="hint-arrow" style={{ transform: `rotate(${arrow}deg)` }}>
              ⬆
            </div>
            <div>
              <div className="hint-dist">{Math.round(state.guideDistance)} m</div>
              <div className="hint-text">
                Weg verlassen, zurück Richtung {compassWord(state.guideBearing)}
                {rerouting ? ' · Rückweg wird berechnet …' : ''}
              </div>
            </div>
          </div>
        )}
        {state && !state.offTrack && !gpsStale && state.nextHint && (
          <div className="nav-hint">
            <div className="hint-arrow" style={{ transform: `rotate(${Math.max(-150, Math.min(150, state.nextHint.angle))}deg)` }}>
              ⬆
            </div>
            <div>
              <div className="hint-dist">{metres(state.nextHint.distance)}</div>
              <div className="hint-text">{state.nextHint.text}</div>
            </div>
          </div>
        )}
        {state && !state.offTrack && !gpsStale && !state.nextHint && (
          <div className="nav-wait">{state.finished ? 'Ziel erreicht' : 'Dem Weg bis zum Ziel folgen'}</div>
        )}
      </div>

      <div className="nav-side">
        <div className="compass" title="Pfad-Kompass: zeigt immer zum Weg">
          <div className="compass-rose" style={{ transform: `rotate(${heading !== null ? -heading : 0}deg)` }}>
            <span className="n">N</span>
          </div>
          <div className={`compass-needle ${state?.offTrack ? 'off' : ''}`} style={{ transform: `rotate(${arrow}deg)` }} />
          <div className="compass-label">{state ? state.guideText : 'Pfad-Kompass'}</div>
        </div>
        <button className="round sos-btn" onClick={onSos} title="Notfall">
          SOS
        </button>
        <button className="round" onClick={onToggleHeadingUp} title="Karte in Blickrichtung drehen">
          {headingUp ? '⇧' : 'N'}
        </button>
        {!follow && (
          <button className="round" onClick={onFollow} title="Position verfolgen">
            ◎
          </button>
        )}
      </div>

      <div className="nav-bottom">
        {state && (
          <>
            <div className="ahead" aria-label="Wege auf den nächsten 1,5 km">
              {state.ahead.map((p, i) => (
                <span key={i} style={{ flexGrow: p.end - p.start, background: WAY_COLOR[p.kind] }} title={WAY_LABEL[p.kind]}>
                  {p.end - p.start > 300 ? WAY_LABEL[p.kind].split(' ')[0] : ''}
                </span>
              ))}
            </div>
            <div className="ahead-scale">
              <span>jetzt</span>
              <span className={fix && fix.accuracy > 30 ? 'warn' : ''}>
                {fix ? `GPS ±${Math.round(fix.accuracy)} m` : ''}
                {trackLength > 50 ? ` · Track ${km(trackLength)}` : ''}
              </span>
              <span>1,5 km voraus</span>
            </div>
            <div className="nav-stats">
              <div>
                <b>{km(state.remaining)}</b>
                <span>noch</span>
              </div>
              <div>
                <b>↑ {Math.round(state.remainingAscent)} m</b>
                <span>noch</span>
              </div>
              <div>
                <b>{state.eta ? clock(state.eta) : '–'}</b>
                <span>Ankunft</span>
              </div>
              <div className={daylightClass}>
                <b>{state.sunset ? clock(state.sunset) : '–'}</b>
                <span>
                  {state.daylightBuffer == null
                    ? 'Sonnenuntergang'
                    : state.daylightBuffer < 0
                      ? `${span(-state.daylightBuffer)} nach Dunkelheit`
                      : `${span(state.daylightBuffer)} Tageslicht-Puffer`}
                </span>
              </div>
            </div>
            {state.turnaround && (
              <div className={`turn turn-${state.turnaround.advice}`}>
                <div className="turn-row">
                  <span>
                    ▶ Weiter: <b>{km(state.turnaround.aheadDistance)}</b> · an {clock(state.turnaround.aheadArrival)}
                  </span>
                  <span>
                    ◀ Umkehren: <b>{km(state.turnaround.backDistance)}</b> · an {clock(state.turnaround.backArrival)}
                  </span>
                </div>
                <div className="turn-text">
                  {state.turnaround.text}
                  {state.turnaround.advice === 'weiter' && state.turnaround.latestTurn && state.turnaround.latestTurn.getTime() - now < 3 * 3600000
                    ? ` Wer zum Start zurück will: spätestens ${clock(state.turnaround.latestTurn)} umkehren.`
                    : ''}
                </div>
              </div>
            )}
            {nextHighlight && (
              <div className="poi-line">
                {POI_ICON[nextHighlight.kind]} {highlightLabel(nextHighlight)} in {metres(nextHighlight.along - state.along)}
                {nextHighlight.side !== 'am Weg' ? ` · ${nextHighlight.side}` : ''}
              </div>
            )}
            {rescueNear && (
              <button className="rescue-line" onClick={onSos}>
                🆘 Rettungspunkt <b>{rescueNear.ref}</b> · {rescueNear.distance < 1000 ? `${Math.round(rescueNear.distance)} m` : km(rescueNear.distance)}{' '}
                {compassWord(rescueNear.bearing)}
              </button>
            )}
            {state.nextClimb && (
              <div className="climb">
                ⛰ Anstieg in {km(state.nextClimb.inMetres)}: {Math.round(state.nextClimb.gain)} Hm auf {km(state.nextClimb.length)} (Ø{' '}
                {Math.round(state.nextClimb.grade)} %)
              </div>
            )}
            <ElevationChart route={route} marker={state.along} height={110} />
          </>
        )}
        <div className="nav-buttons">
          <button onClick={onExit}>✕ Beenden</button>
          <button onClick={() => setVoice((v) => !v)}>{voice ? '🔊 Ansagen an' : '🔇 Ansagen aus'}</button>
          {track.current.length > 2 && <button onClick={saveTrack}>⤓ Track als GPX</button>}
          <button className={sim ? 'active' : ''} onClick={() => setSim((s) => !s)}>
            {sim ? '■ Simulation stoppen' : '▶ Tour simulieren'}
          </button>
          {sim && (
            <>
              <button onClick={() => setSimSpeed((s) => (s >= 20 ? 1 : s * 2))}>Tempo ×{simSpeed}</button>
              <button onClick={() => (deviate.current = 25)}>Vom Weg abweichen</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
