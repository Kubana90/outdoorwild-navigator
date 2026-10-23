import { useEffect, useMemo, useRef, useState } from 'react'
import { km, WAY_COLOR, WAY_LABEL } from '../lib/analysis'
import { bearing, compassWord, destination, pointAt, angleDiff } from '../lib/geo'
import { clock, Navigator, type Fix, type NavState } from '../lib/nav'
import type { PlannedRoute } from '../lib/planner'
import { isBikeActivity } from '../lib/profile'
import { ElevationChart } from './ElevationChart'

interface Props {
  route: PlannedRoute
  onFix: (fix: Fix | null) => void
  onExit: () => void
  headingUp: boolean
  onToggleHeadingUp: () => void
  follow: boolean
  onFollow: () => void
}

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

export function NavigationView({ route, onFix, onExit, headingUp, onToggleHeadingUp, follow, onFollow }: Props) {
  const navigator_ = useMemo(() => new Navigator(route.raw, route.analysis), [route])
  const [state, setState] = useState<NavState | null>(null)
  const [fix, setFix] = useState<Fix | null>(null)
  const [voice, setVoice] = useState(true)
  const [sim, setSim] = useState(false)
  const [simSpeed, setSimSpeed] = useState(5)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const compass = useCompass()
  const announced = useRef(new Set<string>())
  const wasOff = useRef(false)
  const deviate = useRef(0)
  const bike = isBikeActivity(route.options.activity)

  // keep the screen on while navigating
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => {
      lock?.release().catch(() => {})
    }
  }, [])

  // real GPS
  useEffect(() => {
    if (sim) return
    if (!('geolocation' in navigator)) {
      setGpsError('Dieses Gerät hat kein GPS. Nutze die Simulation.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGpsError(null)
        setFix({
          pos: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy,
          heading: p.coords.heading !== null && !Number.isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 1 ? p.coords.heading : null,
          speed: p.coords.speed,
          time: p.timestamp,
        })
      },
      (e) => setGpsError(e.code === 1 ? 'Standortzugriff verweigert. Erlaube ihn im Browser oder nutze die Simulation.' : 'Kein GPS-Signal.'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(id)
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

  // feed the navigator
  useEffect(() => {
    if (!fix) return
    const heading = fix.heading ?? compass
    const f = { ...fix, heading }
    onFix(f)
    const s = navigator_.update(f)
    if (import.meta.env.DEV) Object.assign(window, { __owildNav: { fix: f, state: s } })
    setState(s)
  }, [fix])

  useEffect(() => () => onFix(null), [])

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
      const far = bike ? 250 : 120
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
    if (state.finished && !a.has('done')) {
      a.add('done')
      vibrate([100, 60, 100, 60, 300])
      speak('Ziel erreicht. Schöne Tour!', voice)
    }
  }, [state])

  const heading = fix?.heading ?? compass
  // arrow rotation: relative to where the user looks (or north if unknown)
  const arrow = state ? (heading !== null ? angleDiff(heading, state.guideBearing) : state.guideBearing) : 0
  const daylightClass = state?.daylightBuffer == null ? '' : state.daylightBuffer < 0 ? 'bad' : state.daylightBuffer < 45 ? 'warn' : 'ok'

  return (
    <div className="nav">
      <div className={`nav-top ${state?.offTrack ? 'off' : ''}`}>
        {!state && <div className="nav-wait">{gpsError ?? 'Suche GPS-Signal …'}</div>}
        {state?.offTrack && (
          <div className="nav-hint">
            <div className="hint-arrow" style={{ transform: `rotate(${arrow}deg)` }}>
              ⬆
            </div>
            <div>
              <div className="hint-dist">{Math.round(state.guideDistance)} m</div>
              <div className="hint-text">Weg verlassen, zurück Richtung {compassWord(state.guideBearing)}</div>
            </div>
          </div>
        )}
        {state && !state.offTrack && state.nextHint && (
          <div className="nav-hint">
            <div className="hint-arrow" style={{ transform: `rotate(${Math.max(-150, Math.min(150, state.nextHint.angle))}deg)` }}>
              ⬆
            </div>
            <div>
              <div className="hint-dist">{state.nextHint.distance < 1000 ? `${Math.round(state.nextHint.distance / 10) * 10} m` : km(state.nextHint.distance)}</div>
              <div className="hint-text">{state.nextHint.text}</div>
            </div>
          </div>
        )}
        {state && !state.offTrack && !state.nextHint && <div className="nav-wait">{state.finished ? 'Ziel erreicht' : 'Dem Weg bis zum Ziel folgen'}</div>}
      </div>

      <div className="nav-side">
        <div className="compass" title="Pfad-Kompass: zeigt immer zum Weg">
          <div className="compass-rose" style={{ transform: `rotate(${heading !== null ? -heading : 0}deg)` }}>
            <span className="n">N</span>
          </div>
          <div className={`compass-needle ${state?.offTrack ? 'off' : ''}`} style={{ transform: `rotate(${arrow}deg)` }} />
          <div className="compass-label">{state ? state.guideText : 'Pfad-Kompass'}</div>
        </div>
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
          <button className={sim ? 'active' : ''} onClick={() => setSim((s) => !s)}>
            {sim ? '■ Simulation stoppen' : '▶ Tour simulieren'}
          </button>
          {sim && (
            <>
              <button onClick={() => setSimSpeed((s) => (s >= 20 ? 1 : s * 2))}>Tempo ×{simSpeed}</button>
              <button onClick={() => (deviate.current = 8)}>Vom Weg abweichen</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

