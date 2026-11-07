import { useEffect, useRef, useState } from 'react'
import { PERSONAS, phrase, saveVoiceSettings, styleFor, type PersonaId, type VoiceSettings } from '../lib/persona'
import { germanVoices, say, type Voice } from '../lib/speech'

interface Props {
  value: VoiceSettings
  onChange: (s: VoiceSettings) => void
}

const SAMPLE = [
  { type: 'start' as const },
  { type: 'turnAhead' as const, metres: 200, text: 'Rechts abbiegen auf Pfad / Trail (Erde / Waldboden)' },
  { type: 'offTrack' as const, metres: 60, direction: 'Norden', count: 2 },
  { type: 'climb' as const, gain: 85, metres: 900 },
]

/** Who speaks and in which voice, with a sample to listen to. */
export function VoicePicker({ value, onChange }: Props) {
  const [voices, setVoices] = useState<Voice[] | null>(null)
  // a ref, not state: quick taps must each get the next sample
  const sample = useRef(0)

  useEffect(() => {
    germanVoices()
      .then(setVoices)
      .catch(() => setVoices([]))
  }, [])

  const update = (patch: Partial<VoiceSettings>) => {
    const next = { ...value, ...patch }
    saveVoiceSettings(next)
    onChange(next)
  }

  const listen = () => {
    const e = SAMPLE[sample.current++ % SAMPLE.length]
    say(phrase(value.persona, e), styleFor(value))
  }

  return (
    <section className="voice-picker">
      <h2>Navigationsstimme</h2>
      <div className="seg">
        {(Object.keys(PERSONAS) as PersonaId[]).map((id) => (
          <button key={id} className={value.persona === id ? 'on' : ''} onClick={() => update({ persona: id })}>
            {id === 'guenther' ? '😤 ' : '🗣 '}
            {PERSONAS[id].label}
          </button>
        ))}
      </div>
      <p className="muted small">{PERSONAS[value.persona].description}</p>
      <label className="field inline">
        <span>Stimme</span>
        <select value={value.voiceId ?? ''} onChange={(e) => update({ voiceId: e.target.value || null })} disabled={!voices?.length}>
          <option value="">Standard</option>
          {voices?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.male ? '♂ ' : ''}
              {v.name}
            </option>
          ))}
        </select>
      </label>
      {voices && voices.length > 0 && !voices.some((v) => v.male) && (
        <p className="muted small">Dein Gerät hat keine erkennbar männliche deutsche Stimme. Günther klingt dann über die tiefere Tonlage trotzdem grummelig.</p>
      )}
      {voices && voices.length === 0 && <p className="muted small">Keine deutsche Stimme gefunden. Ansagen nutzen die Standardstimme des Geräts.</p>}
      <button onClick={listen}>▶ Probe hören</button>
    </section>
  )
}
