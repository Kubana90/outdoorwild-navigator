import { useEffect, useState } from 'react'
import { fixHint, markSetupDone, PERMISSIONS, readStatus, requestAll, type PermissionKey, type PermissionStatus } from '../lib/permissions'

const LABEL: Record<PermissionStatus, string> = {
  granted: '✓ aktiv',
  denied: '✕ abgelehnt',
  prompt: 'noch offen',
  unsupported: '– nicht nötig',
}

interface Props {
  onClose: () => void
}

/** First-run setup: one tap asks every permission the app needs. */
export function Onboarding({ onClose }: Props) {
  const [status, setStatus] = useState<Partial<Record<PermissionKey, PermissionStatus>>>({})
  const [asking, setAsking] = useState<PermissionKey | 'start' | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    Promise.all(PERMISSIONS.map(async (p) => [p.key, await readStatus(p.key)] as const)).then((pairs) => setStatus(Object.fromEntries(pairs)))
  }, [])

  const askAll = async () => {
    setAsking('start')
    await requestAll((key, s) => {
      setStatus((cur) => ({ ...cur, [key]: s }))
      setAsking(key)
    })
    setAsking(null)
    setDone(true)
    markSetupDone()
  }

  const finish = () => {
    markSetupDone()
    onClose()
  }

  const locationOk = status.location === 'granted'
  const anyDenied = PERMISSIONS.some((p) => status[p.key] === 'denied')

  return (
    <div className="sos-backdrop onboarding-backdrop">
      <section className="sos onboarding" role="dialog" aria-label="Einrichtung">
        <header>
          <h2>Einrichtung</h2>
          <button className="link" onClick={finish}>
            Später
          </button>
        </header>
        <p>
          Damit Navigation, Pfad-Kompass, Sprachbefehl und Offline-Karten funktionieren, braucht die App ein paar Freigaben. Tippe auf <b>Alles erlauben</b> und
          bestätige die folgenden Fragen deines Handys mit <b>„Erlauben“</b> – beim Standort bitte <b>„Genau“</b>.
        </p>

        <ul className="perm-list">
          {PERMISSIONS.map((p) => {
            const s = status[p.key] ?? 'prompt'
            return (
              <li key={p.key} className={`perm perm-${s} ${asking === p.key ? 'asking' : ''}`}>
                <div>
                  <b>
                    {p.title}
                    {p.required ? ' *' : ''}
                  </b>
                  <span>{p.why}</span>
                  {s === 'denied' && <span className="perm-fix">{fixHint(p.key)}</span>}
                </div>
                <span className="perm-state">{LABEL[s]}</span>
              </li>
            )
          })}
        </ul>
        <p className="muted small">* nötig für die Navigation. Die anderen machen die App komfortabler.</p>

        {!done ? (
          <button className="primary big" onClick={askAll} disabled={asking !== null}>
            {asking ? 'Frage nach … bitte bestätigen' : 'Alles erlauben'}
          </button>
        ) : (
          <>
            <p className={locationOk ? 'perm-ok' : 'perm-bad'}>
              {locationOk
                ? anyDenied
                  ? 'Navigation ist startklar. Einzelne Extras sind aus – oben steht, wie du sie später einschaltest.'
                  : 'Alles eingerichtet. Viel Spaß draußen!'
                : 'Ohne Standort kann die App nicht navigieren. Bitte wie oben beschrieben einschalten.'}
            </p>
            <button className="primary big" onClick={finish}>
              Los geht's
            </button>
          </>
        )}
      </section>
    </div>
  )
}
