import { useEffect, useState } from 'react'
import { emergencyMessage, formatDecimal, formatDms, nearestRescue, type RescuePoint } from '../lib/emergency'
import { compassWord, type LonLat } from '../lib/geo'
import { km } from '../lib/analysis'

interface Props {
  /** live position while navigating; otherwise the sheet asks the GPS itself */
  pos: LonLat | null
  accuracy: number | null
  rescuePoints: RescuePoint[]
  activityLabel: string
  onClose: () => void
}

/** Everything a rescue call needs, readable at a glance. */
export function EmergencySheet({ pos, accuracy, rescuePoints, activityLabel, onClose }: Props) {
  const [own, setOwn] = useState<{ pos: LonLat; accuracy: number } | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [shared, setShared] = useState<string | null>(null)

  useEffect(() => {
    if (pos || !('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (p) => setOwn({ pos: [p.coords.longitude, p.coords.latitude], accuracy: p.coords.accuracy }),
      () => setGpsError('Kein Standort – Umgebung beschreiben (Ort, Weg, Auffälliges).'),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [pos])

  const here = pos ?? own?.pos ?? null
  const acc = pos ? accuracy : (own?.accuracy ?? null)
  const rescue = here ? nearestRescue(here, rescuePoints) : null
  const useful = rescue && rescue.distance < 5000 ? rescue : null

  const share = async () => {
    if (!here) return
    const text = emergencyMessage(here, acc, useful, activityLabel)
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Notfall – mein Standort', text })
        setShared('Geteilt.')
      } else {
        await navigator.clipboard.writeText(text)
        setShared('Text kopiert – in SMS oder Messenger einfügen.')
      }
    } catch {
      // the share sheet was closed: nothing to report
    }
  }

  return (
    <div className="sos-backdrop" onClick={onClose}>
      <section className="sos" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Notfall">
        <header>
          <h2>Notfall</h2>
          <button className="link" onClick={onClose}>
            Schließen
          </button>
        </header>

        <a className="sos-call" href="tel:112">
          📞 112 anrufen
        </a>

        <div className="sos-block">
          <span className="sos-label">Das sagst du der Leitstelle</span>
          {here ? (
            <>
              <b className="sos-big">{formatDms(here)}</b>
              <span>{formatDecimal(here)}</span>
              {acc !== null && <span className={acc > 30 ? 'warn' : 'muted'}>Genauigkeit ±{Math.round(acc)} m</span>}
            </>
          ) : (
            <span>{gpsError ?? 'Standort wird ermittelt …'}</span>
          )}
        </div>

        <div className="sos-block">
          <span className="sos-label">Nächster Rettungspunkt</span>
          {useful ? (
            <>
              <b className="sos-big">{useful.ref}</b>
              <span>
                {useful.distance < 1000 ? `${Math.round(useful.distance)} m` : km(useful.distance)} Richtung {compassWord(useful.bearing)}
                {useful.note ? ` · ${useful.note}` : ''}
              </span>
              <span className="muted">Code der Leitstelle nennen – dort wartet der Rettungsdienst.</span>
            </>
          ) : (
            <span className="muted">
              {rescuePoints.length ? 'Keiner im Umkreis von 5 km eingetragen.' : 'Keine Rettungspunkte geladen.'} Die Koordinaten oben reichen der Leitstelle.
            </span>
          )}
        </div>

        <button className="primary big" disabled={!here} onClick={share}>
          Standort an Kontakt senden
        </button>
        {shared && <p className="muted">{shared}</p>}
        <p className="sos-note">
          Notruf 112 funktioniert auch ohne SIM und in fremden Netzen. Eine SMS an 112 geht nur nach Registrierung (nora-App) – deshalb geht der Text oben an
          einen Kontakt.
        </p>
      </section>
    </div>
  )
}
