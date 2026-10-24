// Weather and ground check from Open-Meteo (free, no key): rain of the last
// 48 h and top-soil moisture tell how muddy the route's natural surfaces are;
// the forecast finds the best start time today and flags storms and gusts.

import * as SunCalc from 'suncalc'
import type { SurfaceKind } from './analysis'
import type { LonLat } from './geo'

export interface Weather {
  /** unix seconds per hour */
  time: number[]
  precipitation: number[]
  weatherCode: number[]
  gusts: number[]
  temperature: number[]
  soilMoisture: number[]
}

export async function fetchWeather(pos: LonLat, signal?: AbortSignal): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: pos[1].toFixed(3),
    longitude: pos[0].toFixed(3),
    hourly: 'precipitation,weather_code,wind_gusts_10m,temperature_2m,soil_moisture_0_to_1cm',
    past_days: '2',
    forecast_days: '2',
    timeformat: 'unixtime',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal })
  if (!res.ok) throw new Error('Wetterdaten nicht erreichbar')
  const h = ((await res.json()) as { hourly: Record<string, number[]> }).hourly
  return {
    time: h.time,
    precipitation: h.precipitation.map((v) => v ?? 0),
    weatherCode: h.weather_code.map((v) => v ?? 0),
    gusts: h.wind_gusts_10m.map((v) => v ?? 0),
    temperature: h.temperature_2m.map((v) => v ?? 10),
    soilMoisture: h.soil_moisture_0_to_1cm.map((v) => v ?? 0.25),
  }
}

/** Index of the hour containing `t` (ms). */
export function hourIndex(w: Weather, t: number): number {
  const s = t / 1000
  let i = 0
  while (i < w.time.length - 1 && w.time[i + 1] <= s) i++
  return i
}

export interface MudInfo {
  /** 0..100 */
  score: number
  label: 'griffig' | 'feucht' | 'matschig' | 'sehr matschig'
  rain48: number
  softShare: number
  text: string
}

/**
 * How muddy the route probably is: wet ground (top-soil moisture, or the
 * last 48 h of rain) × the share of soft natural surfaces on the route.
 */
export function mudIndex(w: Weather, now: number, surfaces: Record<SurfaceKind, number>): MudInfo {
  const i = hourIndex(w, now)
  const rain48 = w.precipitation.slice(Math.max(0, i - 47), i + 1).reduce((a, b) => a + b, 0)
  const sm = w.soilMoisture[i]
  const soilWet = Math.min(1, Math.max(0, (sm - 0.18) / 0.2))
  const rainWet = Math.min(1, rain48 / 20)
  const wet = Math.max(soilWet, rainWet * 0.85)
  const softShare = Math.min(1, surfaces.ground + surfaces.grass + 0.2 * surfaces.gravel + 0.4 * surfaces.unknown)
  const score = Math.round(100 * wet * Math.min(1, softShare * 1.3))
  const label = score < 20 ? 'griffig' : score < 45 ? 'feucht' : score < 70 ? 'matschig' : 'sehr matschig'
  const rain = rain48 < 0.5 ? 'Kaum Regen in den letzten 48 h' : `${rain48.toFixed(rain48 < 10 ? 1 : 0).replace('.', ',')} mm Regen in den letzten 48 h`
  const soft = `${Math.round(softShare * 100)} % weicher Naturboden auf der Route`
  const advice =
    label === 'griffig'
      ? 'Wege sollten griffig sein.'
      : label === 'feucht'
        ? 'Wurzeln und Steine können rutschig sein.'
        : label === 'matschig'
          ? 'Mit Matsch und rutschigen Abfahrten rechnen.'
          : 'Sehr rutschig – Trails schonen und eher Schotterwege wählen.'
  return { score, label, rain48, softShare, text: `${rain}, ${soft}. ${advice}` }
}

export interface WindowInfo {
  start: Date
  end: Date
  rain: number
  maxGust: number
  thunder: boolean
  minTemp: number
}

const isThunder = (code: number) => code >= 95

function windowAt(w: Weather, startMs: number, durationMin: number): WindowInfo {
  const endMs = startMs + durationMin * 60000
  const a = hourIndex(w, startMs)
  const b = Math.max(a, hourIndex(w, endMs - 1))
  let rain = 0
  let maxGust = 0
  let thunder = false
  let minTemp = Infinity
  for (let i = a; i <= b; i++) {
    rain += w.precipitation[i]
    maxGust = Math.max(maxGust, w.gusts[i])
    thunder ||= isThunder(w.weatherCode[i])
    minTemp = Math.min(minTemp, w.temperature[i])
  }
  return { start: new Date(startMs), end: new Date(endMs), rain, maxGust, thunder, minTemp }
}

/** Badness of a window: storms rule it out, then rain, then strong gusts. */
const windowCost = (x: WindowInfo) => (x.thunder ? 1000 : 0) + x.rain * 10 + Math.max(0, x.maxGust - 45)

/**
 * Best start time today between now and the last start that still ends
 * before sunset; null when the daylight is already too short.
 */
export function bestWindow(w: Weather, now: number, durationMin: number, pos: LonLat): WindowInfo | null {
  const sunset = SunCalc.getTimes(new Date(now), pos[1], pos[0]).sunset?.getTime()
  if (!sunset || !Number.isFinite(sunset)) return null
  const latest = sunset - durationMin * 60000
  if (latest < now) return null
  let best: WindowInfo | null = null
  // the first slot is "now", then every full hour
  const slots = [now]
  for (let t = Math.ceil(now / 3600000) * 3600000; t <= latest; t += 3600000) slots.push(t)
  for (const t of slots) {
    const x = windowAt(w, t, durationMin)
    if (!best || windowCost(x) < windowCost(best) - 0.5) best = x
  }
  return best
}

/** Warnings for a tour starting now. */
export function tourWarnings(w: Weather, now: number, durationMin: number): string[] {
  const x = windowAt(w, now, durationMin)
  const out: string[] = []
  if (x.thunder) out.push('Gewitter vorhergesagt – im Wald und auf Kuppen gefährlich.')
  if (x.maxGust >= 60) out.push(`Sturmböen bis ${Math.round(x.maxGust)} km/h – Astbruchgefahr im Wald.`)
  else if (x.maxGust >= 45) out.push(`Böen bis ${Math.round(x.maxGust)} km/h – auf herabfallende Äste achten.`)
  if (x.rain >= 5) out.push(`${Math.round(x.rain)} mm Regen während der Tour erwartet.`)
  if (x.minTemp <= 1) out.push('Frost möglich – Glätte auf Holz, Wurzeln und Steinen.')
  return out
}
