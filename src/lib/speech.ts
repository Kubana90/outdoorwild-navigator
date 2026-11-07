// Speaking announcements: the browser's speechSynthesis on the web, the
// phone's own text-to-speech in the native app (the Android WebView has no
// speechSynthesis). The chosen voice, pitch and pace come from the settings.

import { isNative } from './native'

export interface Voice {
  /** stable id: the voice name (web) or its index in the phone's list (native) */
  id: string
  name: string
  lang: string
  /** best guess from the name; phones rarely say */
  male: boolean
}

export interface SpeechStyle {
  /** null = system default voice for German */
  voiceId: string | null
  /** 0.5 … 2, 1 = normal */
  pitch: number
  /** 0.5 … 2, 1 = normal */
  rate: number
}

// Names that are male voices on Windows, macOS/iOS, Android and Chrome.
const MALE = /stefan|conrad|markus|hans|yannick|klaus|killian|kasper|florian|jonas|bernd|ralf|thomas|daniel|male|männl|mann|\bherr\b|de-de-x-(deb|deg|nfh)|#male|de-de-standard-(b|d|e)|de-de-wavenet-(b|d|e)|de-de-neural2-(b|d)/i

export const guessMale = (name: string) => MALE.test(name)

/** German voices on this device, male guesses first. */
export async function germanVoices(): Promise<Voice[]> {
  let list: Voice[] = []
  if (isNative()) {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech')
    const { voices } = await TextToSpeech.getSupportedVoices()
    list = voices.map((v, i) => ({ id: String(i), name: v.name || v.voiceURI, lang: v.lang, male: guessMale(`${v.name} ${v.voiceURI}`) }))
  } else if ('speechSynthesis' in window) {
    const read = () => speechSynthesis.getVoices()
    let vs = read()
    if (!vs.length) {
      // Chrome fills the list asynchronously
      await new Promise<void>((resolve) => {
        const done = () => resolve()
        speechSynthesis.addEventListener('voiceschanged', done, { once: true })
        setTimeout(done, 1500)
      })
      vs = read()
    }
    list = vs.map((v) => ({ id: v.name, name: v.name, lang: v.lang, male: guessMale(v.name) }))
  }
  return list
    .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('de'))
    .sort((a, b) => Number(b.male) - Number(a.male) || a.name.localeCompare(b.name))
}

let webVoices: SpeechSynthesisVoice[] | null = null

/** Speaks `text`, cutting off whatever is still being said. */
export async function say(text: string, style: SpeechStyle): Promise<void> {
  if (isNative()) {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech')
    await TextToSpeech.stop().catch(() => {})
    await TextToSpeech.speak({
      text,
      lang: 'de-DE',
      pitch: style.pitch,
      rate: style.rate,
      ...(style.voiceId !== null ? { voice: Number(style.voiceId) } : {}),
    }).catch(() => {})
    return
  }
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'de-DE'
  u.pitch = style.pitch
  u.rate = style.rate
  if (style.voiceId) {
    webVoices ??= speechSynthesis.getVoices()
    const v = webVoices.find((x) => x.name === style.voiceId) ?? speechSynthesis.getVoices().find((x) => x.name === style.voiceId)
    if (v) u.voice = v
  }
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}
