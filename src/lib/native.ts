// Platform layer: the same calls work in the browser (web app) and in the
// native Android/iOS app built with Capacitor. Natively, GPS runs as a
// foreground service so navigation keeps going with the screen off, speech
// uses the phone's recogniser, and permissions use the system dialogs.

import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'
import type { LonLat } from './geo'

export const isNative = () => Capacitor.isNativePlatform()
export const platform = () => Capacitor.getPlatform() as 'web' | 'android' | 'ios'

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

export interface PositionUpdate {
  pos: LonLat
  accuracy: number
  /** degrees, null when standing still or unknown */
  heading: number | null
  /** m/s */
  speed: number | null
  time: number
}

export type PositionError = 'denied' | 'unavailable'

/**
 * Watches the position until the returned function is called. Natively it
 * keeps running in the background and shows a notification while it does.
 */
export function watchPosition(onPos: (p: PositionUpdate) => void, onError: (e: PositionError) => void): () => void {
  if (isNative()) {
    let id: string | null = null
    let stopped = false
    BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'OutdoorWild navigiert',
        backgroundMessage: 'Die Route wird auch bei ausgeschaltetem Bildschirm verfolgt.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 2,
      },
      (loc, err) => {
        if (err) return onError(err.code === 'NOT_AUTHORIZED' ? 'denied' : 'unavailable')
        if (!loc) return
        const moving = (loc.speed ?? 0) > 1
        onPos({
          pos: [loc.longitude, loc.latitude],
          accuracy: loc.accuracy,
          heading: moving && loc.bearing !== null && !Number.isNaN(loc.bearing) ? loc.bearing : null,
          speed: loc.speed,
          time: loc.time ?? Date.now(),
        })
      },
    ).then((w) => {
      if (stopped) BackgroundGeolocation.removeWatcher({ id: w })
      else id = w
    })
    return () => {
      stopped = true
      if (id) BackgroundGeolocation.removeWatcher({ id })
    }
  }

  if (!('geolocation' in navigator)) {
    onError('unavailable')
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    (p) =>
      onPos({
        pos: [p.coords.longitude, p.coords.latitude],
        accuracy: p.coords.accuracy,
        heading: p.coords.heading !== null && !Number.isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 1 ? p.coords.heading : null,
        speed: p.coords.speed,
        time: p.timestamp,
      }),
    (e) => onError(e.code === 1 ? 'denied' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}

/** One position fix (start point, SOS). */
export async function currentPosition(): Promise<PositionUpdate> {
  if (isNative()) {
    const { Geolocation } = await import('@capacitor/geolocation')
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 })
    return {
      pos: [p.coords.longitude, p.coords.latitude],
      accuracy: p.coords.accuracy,
      heading: p.coords.heading ?? null,
      speed: p.coords.speed ?? null,
      time: p.timestamp,
    }
  }
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Dieses Gerät hat kein GPS.'))
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          pos: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy,
          heading: p.coords.heading,
          speed: p.coords.speed,
          time: p.timestamp,
        }),
      (e) => reject(new Error(e.code === 1 ? 'Standortzugriff verweigert. Erlaube ihn in den Einstellungen.' : 'Standort nicht verfügbar. Freie Sicht zum Himmel suchen.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
    )
  })
}

/** Keeps the screen on while navigating. */
export async function keepScreenOn(on: boolean): Promise<void> {
  if (isNative()) {
    const { KeepAwake } = await import('@capacitor-community/keep-awake')
    await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {})
  }
}

/** Native speech recognition; null when the phone has none. */
export async function nativeListen(lang = 'de-DE'): Promise<string> {
  const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
  const { available } = await SpeechRecognition.available()
  if (!available) throw new Error('kein Mikrofon')
  const perm = await SpeechRecognition.requestPermissions()
  if (perm.speechRecognition !== 'granted') throw new Error('Mikrofon nicht erlaubt')
  const res = await SpeechRecognition.start({ language: lang, maxResults: 1, partialResults: false, popup: platform() === 'android', prompt: 'Wohin soll es gehen?' })
  const text = res.matches?.[0]
  if (!text) throw new Error('nicht verstanden')
  return text
}

/** Opens the app's system settings page (to switch a refused permission on). */
export async function openAppSettings(): Promise<void> {
  if (isNative()) await BackgroundGeolocation.openSettings()
}
