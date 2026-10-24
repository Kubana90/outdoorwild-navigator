// Voice input for places: "Navigiere zum Katzenbuckel" → "Katzenbuckel".

import { isNative, nativeListen, platform } from './native'

type Recognition = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  abort(): void
}

const ctor = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// The Android WebView has no SpeechRecognition, so the Android app uses the
// phone's recogniser through a plugin. That plugin has no iOS package for
// Capacitor 8, so the iPhone app uses the WebView's recogniser when it has one.
const useNativePlugin = () => isNative() && platform() === 'android'
export const voiceSupported = () => typeof window !== 'undefined' && (useNativePlugin() || ctor() !== null)

const FILLERS = [
  /^(bitte\s+)?(navigiere|navigier|führe|fuehre|bring|bringe|fahre|fahr|lotse|lotsen)\s+(mich\s+)?(bitte\s+)?(zum|zur|nach|zu|in den|in die|ins|an den|an die|auf den|auf die)\s+/i,
  /^(ziel|start|startpunkt|zielpunkt)\s*(ist|:)?\s*/i,
  /^(zum|zur|nach|zu|in den|in die|ins)\s+/i,
  /\s*(bitte|navigieren|los)\.?$/i,
]

/** Strips the command words so only the place is left. */
export function parseVoiceDestination(text: string): string {
  let t = text.trim()
  for (const f of FILLERS) t = t.replace(f, '').trim()
  return t.replace(/[.!?]+$/, '').trim()
}

/** One utterance, resolved as text; rejects with 'nicht verstanden' or 'kein Mikrofon'. */
export function listenOnce(lang = 'de-DE'): Promise<string> {
  if (useNativePlugin()) return nativeListen(lang)
  return new Promise((resolve, reject) => {
    const R = ctor()
    if (!R) return reject(new Error('kein Mikrofon'))
    const r = new R()
    r.lang = lang
    r.interimResults = false
    r.maxAlternatives = 1
    let done = false
    r.onresult = (e) => {
      done = true
      resolve(e.results[0][0].transcript)
    }
    r.onerror = (e) => {
      done = true
      reject(new Error(e.error === 'not-allowed' ? 'Mikrofon nicht erlaubt' : 'nicht verstanden'))
    }
    r.onend = () => !done && reject(new Error('nicht verstanden'))
    r.start()
  })
}
