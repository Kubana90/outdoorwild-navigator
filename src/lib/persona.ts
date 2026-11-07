// Who speaks the announcements. "Sachlich" says what to do; "Günther" says
// the same, first and complete, and then grumbles about it. Safety messages
// stay unmistakable in both.

import type { SpeechStyle } from './speech'

export type PersonaId = 'sachlich' | 'guenther'

export interface VoiceSettings {
  persona: PersonaId
  /** chosen device voice; null = default German voice */
  voiceId: string | null
}

export type NavEvent =
  | { type: 'start' }
  | { type: 'turnAhead'; metres: number; text: string }
  | { type: 'turnNow'; text: string }
  | { type: 'offTrack'; metres: number; direction: string; count: number }
  | { type: 'backOnTrack' }
  | { type: 'climb'; gain: number; metres: number }
  | { type: 'highlight'; metres: number; label: string; where: string; story?: string; history: boolean }
  | { type: 'detourOffer'; label: string; metres: number; side: string }
  | { type: 'detourComputed'; metres: number }
  | { type: 'dark' }
  | { type: 'turnaround'; back: string }
  | { type: 'gpsLost' }
  | { type: 'finished' }

export const PERSONAS: Record<PersonaId, { label: string; description: string; pitch: number; rate: number; moody: boolean }> = {
  sachlich: { label: 'Sachlich', description: 'Klare Ansagen, sonst nichts.', pitch: 1, rate: 1.05, moody: false },
  guenther: {
    label: 'Günther (genervt)',
    description: 'Sagt dir alles Wichtige – und was er davon hält. Tief, launisch, schnell beleidigt.',
    pitch: 0.72,
    rate: 1.0,
    moody: true,
  },
}

const KEY = 'owild-voice'

export function loadVoiceSettings(): VoiceSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as VoiceSettings | null
    if (s && s.persona in PERSONAS) return s
  } catch {
    // fall through to the default
  }
  return { persona: 'guenther', voiceId: null }
}

export function saveVoiceSettings(s: VoiceSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // private mode: the setting lasts this session
  }
}

/** Pitch and pace for one utterance; a moody persona varies a little each time. */
export function styleFor(s: VoiceSettings, random = Math.random): SpeechStyle {
  const p = PERSONAS[s.persona]
  const swing = p.moody ? (random() - 0.5) * 0.24 : 0
  return { voiceId: s.voiceId, pitch: p.pitch + swing / 2, rate: p.rate + swing }
}

const pick = <T,>(xs: T[], random: () => number) => xs[Math.floor(random() * xs.length) % xs.length]
const m = (metres: number) => `${Math.round(metres / 10) * 10} Metern`

function sachlich(e: NavEvent): string {
  switch (e.type) {
    case 'start':
      return 'Navigation gestartet.'
    case 'turnAhead':
      return `In ${m(e.metres)} ${e.text}`
    case 'turnNow':
      return e.text
    case 'offTrack':
      return `Du hast den Weg verlassen. Der Weg liegt ${Math.round(e.metres)} Meter Richtung ${e.direction}.`
    case 'backOnTrack':
      return 'Wieder auf dem Weg.'
    case 'climb':
      return `Gleich kommt ein Anstieg: ${Math.round(e.gain)} Höhenmeter auf ${Math.round(e.metres / 10) * 10} Metern.`
    case 'highlight':
      return `In ${Math.round(e.metres / 50) * 50} Metern: ${e.label}, ${e.where}.${e.story ? ` ${e.story}` : ''}`
    case 'detourOffer':
      return `Abstecher möglich: ${e.label}, ${Math.round(e.metres / 50) * 50} Meter ${e.side}. Tippe auf die Karte unten für den Weg dorthin.`
    case 'detourComputed':
      return `Rückweg berechnet: ${Math.round(e.metres / 10) * 10} Meter bis zum Pfad.`
    case 'dark':
      return 'Achtung, du erreichst das Ziel voraussichtlich erst bei Dunkelheit. Prüfe, ob du umkehren oder abkürzen solltest.'
    case 'turnaround':
      return `Achtung: Bis zum Ziel reicht das Tageslicht nicht mehr. Umkehren bringt dich um ${e.back} zurück zum Start.`
    case 'gpsLost':
      return 'GPS-Signal verloren. Die Anzeige wird nicht mehr aktualisiert.'
    case 'finished':
      return 'Ziel erreicht. Schöne Tour!'
  }
}

function guenther(e: NavEvent, random: () => number): string {
  switch (e.type) {
    case 'start':
      return pick(
        [
          'Na dann. Navigation läuft. Ich hoffe, du hast Snacks dabei. Für mich, meine ich.',
          'Los geht’s. Ich hab mir das nicht ausgesucht, nur damit das klar ist.',
          'Navigation gestartet. Wehe, du fragst nach fünf Minuten, wie weit es noch ist.',
          'So. Wald. Mal wieder. Dann fahr halt.',
        ],
        random,
      )
    case 'turnAhead':
      return `In ${m(e.metres)} ${e.text}. ${pick(
        [
          'Nur damit du nachher nicht sagst, ich hätte nichts gesagt.',
          'Ich sag’s jetzt einmal. Vielleicht zweimal.',
          'Merk dir das bitte. Ich hab heute schon genug geredet.',
          'Kein Stress. Doch, ein bisschen.',
          '',
        ],
        random,
      )}`.trim()
    case 'turnNow':
      return `${e.text}. ${pick(['Jetzt!', 'Jetzt. Ja, hier.', 'Genau hier. Nicht da drüben.', 'Jetzt, bevor ich es mir anders überlege.', 'Hier. Danke.'], random)}`
    case 'offTrack': {
      const info = `Der Weg liegt ${Math.round(e.metres)} Meter Richtung ${e.direction}.`
      const lines =
        e.count <= 1
          ? ['Ähm. Du hast den Weg verlassen.', 'Moment mal. Das ist nicht der Weg.', 'Na toll. Weg verlassen.']
          : e.count === 2
            ? ['Schon wieder vom Weg ab. Ich sag ja nichts.', 'Zweites Mal heute. Ich zähle mit.', 'Und wieder daneben. Machst du das extra?']
            : ['Ich gebe auf. Nein, Spaß. Aber fast.', 'Weißt du was? Ich bin nicht sauer. Nur enttäuscht.', 'Das ist jetzt das dritte Mal. Ich schreib’s ins Tagebuch.']
      return `${pick(lines, random)} ${info} ${pick(['Ich warte hier.', 'Ich rechne schon mal einen Rückweg.', 'Kein Problem. Für dich.', ''], random)}`.trim()
    }
    case 'backOnTrack':
      return pick(['Na also. Geht doch.', 'Wieder auf dem Weg. Ich hab nie an dir gezweifelt. Fast nie.', 'Endlich. Weiter geht’s.', 'Gut. Und jetzt bitte da bleiben.'], random)
    case 'climb':
      return `Gleich kommt ein Anstieg: ${Math.round(e.gain)} Höhenmeter auf ${Math.round(e.metres / 10) * 10} Metern. ${pick(
        ['Ich schieb nicht mit, nur dass du’s weißt.', 'Schalt schon mal runter. Ich meine dich, nicht das Rad.', 'Atmen nicht vergessen.', 'Selber schuld. Du wolltest es wild.'],
        random,
      )}`
    case 'highlight':
      return `In ${Math.round(e.metres / 50) * 50} Metern: ${e.label}, ${e.where}. ${
        e.history
          ? `${e.story ? `${e.story} ` : ''}${pick(['Alte Steine. Interessiert dich bestimmt.', 'Ja, ich hab auch Wikipedia gelesen.', 'Älter als ich. Und ich fühl mich schon alt.', 'Kannst ja mal gucken. Ich warte. Wie immer.'], random)}`
          : pick(['Schön, oder? Ich seh’s ja nicht.', 'Foto machen ist erlaubt. Anhalten auch. Ausnahmsweise.', 'Natur. Hast du ja gewollt.', ''], random)
      }`.trim()
    case 'detourOffer':
      return `Abstecher möglich: ${e.label}, ${Math.round(e.metres / 50) * 50} Meter ${e.side}. Unten auf die Karte tippen. ${pick(
        ['Musst du nicht. Aber dann frag mich nachher nicht, was du verpasst hast.', 'Ich würd’s machen. Hätte ich Beine.', 'Kostet ein paar Minuten. Hast du ja.'],
        random,
      )}`
    case 'detourComputed':
      return `Rückweg berechnet: ${Math.round(e.metres / 10) * 10} Meter bis zum Pfad. ${pick(['Bitte. Gern geschehen.', 'Das war Arbeit, nur so nebenbei.', 'Diesmal aber wirklich.'], random)}`
    case 'dark':
      return 'Jetzt mal im Ernst: Du kommst erst im Dunkeln am Ziel an. Umkehren oder abkürzen wäre schlau. Ich hab keine Taschenlampe.'
    case 'turnaround':
      return `Ernsthaft jetzt: Bis zum Ziel reicht das Tageslicht nicht mehr. Umkehren bringt dich um ${e.back} zurück zum Start. Kein Witz.`
    case 'gpsLost':
      return 'GPS-Signal weg. Ich seh gar nichts mehr. Ich bin ein Navi, kein Hellseher. Such dir freie Sicht zum Himmel.'
    case 'finished':
      return pick(
        ['Ziel erreicht. Endlich. Ich geh jetzt auf Standby.', 'Angekommen. War gar nicht so schlimm. Sag’s keinem.', 'Ziel erreicht. Gut gemacht. Wirklich. Ich meine das so.'],
        random,
      )
  }
}

/** The words for an event in the chosen persona's voice. */
export function phrase(persona: PersonaId, e: NavEvent, random = Math.random): string {
  return persona === 'guenther' ? guenther(e, random) : sachlich(e)
}
