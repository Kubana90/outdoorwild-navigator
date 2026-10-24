// The permissions the app needs, asked one after another from a single tap.
// Browsers and phones never let an app grant these itself: each one shows a
// system dialog the person confirms. What we can do is ask at the right
// moment, in the right order, and show what is on and how to fix a "no".

import { isNative, openAppSettings, platform } from './native'

export type PermissionKey = 'location' | 'compass' | 'microphone' | 'notifications' | 'storage'
export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported'

export interface PermissionInfo {
  key: PermissionKey
  title: string
  why: string
  required: boolean
}

const ALL: PermissionInfo[] = [
  { key: 'location', title: 'Standort (genau)', why: 'Navigation, eigener Standort als Start, SOS-Koordinaten', required: true },
  {
    key: 'notifications',
    title: 'Benachrichtigungen',
    why: 'Navigation läuft bei ausgeschaltetem Bildschirm weiter und zeigt das als Hinweis an',
    required: false,
  },
  { key: 'compass', title: 'Kompass / Bewegung', why: 'Pfad-Kompass und Karte in Blickrichtung', required: false },
  { key: 'microphone', title: 'Mikrofon', why: 'Ziel per Sprache ansagen („Navigiere zum Katzenbuckel“)', required: false },
  { key: 'storage', title: 'Dauerhafter Speicher', why: 'Offline-Karten und gemerkte Touren werden nicht automatisch gelöscht', required: false },
]

/** What this platform needs: notifications only natively, storage only in the browser. */
export const PERMISSIONS: PermissionInfo[] = ALL.filter((p) => (isNative() ? p.key !== 'storage' : p.key !== 'notifications'))

const nativeState = (s: string): PermissionStatus => (s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'prompt')

async function readNative(key: PermissionKey): Promise<PermissionStatus | null> {
  switch (key) {
    case 'location': {
      const { Geolocation } = await import('@capacitor/geolocation')
      return nativeState((await Geolocation.checkPermissions()).location)
    }
    case 'notifications': {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      return nativeState((await LocalNotifications.checkPermissions()).display)
    }
    case 'microphone': {
      // the speech plugin exists only on Android; iOS asks through the WebView
      if (platform() !== 'android') return null
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
      return nativeState((await SpeechRecognition.checkPermissions()).speechRecognition)
    }
    case 'compass':
      // Android: no permission; iOS WebView: same request as in Safari
      return platform() === 'android' ? 'granted' : null
    default:
      return 'unsupported'
  }
}

async function requestNative(key: PermissionKey): Promise<PermissionStatus | null> {
  switch (key) {
    case 'location': {
      const { Geolocation } = await import('@capacitor/geolocation')
      return nativeState((await Geolocation.requestPermissions({ permissions: ['location'] })).location)
    }
    case 'notifications': {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      return nativeState((await LocalNotifications.requestPermissions()).display)
    }
    case 'microphone': {
      if (platform() !== 'android') return null
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
      return nativeState((await SpeechRecognition.requestPermissions()).speechRecognition)
    }
    case 'compass':
      return platform() === 'android' ? 'granted' : null
    default:
      return 'unsupported'
  }
}

const DONE_KEY = 'owild-setup-done'

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

type OrientationCtor = { requestPermission?: () => Promise<'granted' | 'denied'> }
const compassNeedsPermission = () => typeof (window.DeviceOrientationEvent as unknown as OrientationCtor | undefined)?.requestPermission === 'function'

async function queryState(name: string): Promise<PermissionStatus | null> {
  try {
    const s = await navigator.permissions.query({ name: name as PermissionName })
    return s.state as PermissionStatus
  } catch {
    return null
  }
}

/** Current state without asking anything. */
export async function readStatus(key: PermissionKey): Promise<PermissionStatus> {
  if (isNative()) {
    const s = await readNative(key).catch(() => null)
    if (s) return s
  }
  switch (key) {
    case 'notifications':
      return 'unsupported'
    case 'location':
      if (!('geolocation' in navigator)) return 'unsupported'
      return (await queryState('geolocation')) ?? 'prompt'
    case 'compass':
      if (!('DeviceOrientationEvent' in window)) return 'unsupported'
      // Android: works without asking; iOS: unknown until asked
      return compassNeedsPermission() ? (localStorage.getItem('owild-compass') as PermissionStatus | null) ?? 'prompt' : 'granted'
    case 'microphone': {
      const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
      if (!w.SpeechRecognition && !w.webkitSpeechRecognition) return 'unsupported'
      return (await queryState('microphone')) ?? 'prompt'
    }
    case 'storage':
      if (!navigator.storage?.persisted) return 'unsupported'
      return (await navigator.storage.persisted()) ? 'granted' : 'prompt'
  }
}

/** Asks for one permission; resolves with the result, never throws. */
export async function request(key: PermissionKey): Promise<PermissionStatus> {
  // the compass takes the web path everywhere: on iOS it must start inside the tap
  if (isNative() && key !== 'compass') {
    const s = await requestNative(key).catch(() => 'denied' as PermissionStatus)
    if (s) return s
  }
  try {
    switch (key) {
      case 'notifications':
        return 'unsupported'
      case 'compass': {
        if (!compassNeedsPermission()) return 'granted'
        const D = window.DeviceOrientationEvent as unknown as OrientationCtor
        try {
          const r = await D.requestPermission!()
          localStorage.setItem('owild-compass', r)
          return r
        } catch {
          // thrown (not answered) when the call didn't come from a real tap
          return 'prompt'
        }
      }
      case 'location':
        return await new Promise<PermissionStatus>((resolve) =>
          navigator.geolocation.getCurrentPosition(
            () => resolve('granted'),
            (e) => resolve(e.code === 1 ? 'denied' : 'granted'),
            { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 },
          ),
        )
      case 'microphone': {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())
        return 'granted'
      }
      case 'storage':
        // the browser decides this by itself (installed, used often), nobody said no
        return (await navigator.storage.persist()) ? 'granted' : 'prompt'
    }
  } catch {
    return 'denied'
  }
}

/**
 * Asks for everything still open, in an order that works on every phone:
 * the iOS compass first, because it only accepts a call made directly
 * from the tap; the others may follow after awaits.
 */
export async function requestAll(onEach: (key: PermissionKey, status: PermissionStatus) => void): Promise<void> {
  // started before any await, so iOS still counts it as part of the tap
  const compass = request('compass')
  onEach('compass', await compass)
  const order: PermissionKey[] = ['location', 'notifications', 'microphone', 'storage'].filter((k) =>
    PERMISSIONS.some((p) => p.key === k),
  ) as PermissionKey[]
  for (const key of order) {
    const before = await readStatus(key).catch(() => 'prompt' as PermissionStatus)
    if (before === 'granted' || before === 'unsupported') {
      onEach(key, before)
      continue
    }
    onEach(key, await request(key))
  }
}

/** Where to switch a denied permission back on, for this phone. */
export function fixHint(key: PermissionKey): string {
  if (key === 'storage') return 'Wird vom Browser automatisch gewährt, sobald die App installiert und öfter genutzt wird.'
  if (isNative())
    return platform() === 'ios'
      ? 'Unten auf „App-Einstellungen öffnen“ tippen und die Berechtigung dort einschalten.'
      : 'Unten auf „App-Einstellungen öffnen“ tippen → Berechtigungen → erlauben (Standort: „Nur während der Nutzung“ und „Genauen Standort verwenden“).'
  if (isIos()) {
    if (key === 'location') return 'iPhone: Einstellungen → Datenschutz → Ortungsdienste → Safari-Websites → „Beim Verwenden“ und „Genauer Standort“ an.'
    if (key === 'compass') return 'iPhone: App schließen und neu öffnen, dann erneut „Alles erlauben“ tippen.'
    return 'iPhone: Einstellungen → Safari → Mikrofon → „Erlauben“.'
  }
  return 'Android: App lange antippen → App-Info → Berechtigungen, oder in Chrome: Schloss-Symbol neben der Adresse → Berechtigungen → erlauben.'
}

export { openAppSettings }

export const setupDone = () => {
  try {
    return localStorage.getItem(DONE_KEY) === '1'
  } catch {
    return true
  }
}

export const markSetupDone = () => {
  try {
    localStorage.setItem(DONE_KEY, '1')
  } catch {
    // private mode: the setup shows again next time, which is harmless
  }
}
