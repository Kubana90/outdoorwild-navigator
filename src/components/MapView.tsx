import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef } from 'react'
import { wayKind, WAY_COLOR } from '../lib/analysis'
import type { LonLat } from '../lib/geo'
import { pointAt } from '../lib/geo'
import type { PlannedRoute } from '../lib/planner'
import { REGION } from '../lib/region'

// Vite pre-bundles maplibre, which breaks its own worker lookup: point it at the file.
maplibregl.setWorkerUrl(workerUrl)

export type BaseMap = 'topo' | 'vector'
export type Overlay = 'none' | 'hiking' | 'mtb'

export const TOPO_TILES = ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`)
export const overlayTiles = (o: Exclude<Overlay, 'none'>) => `https://tile.waymarkedtrails.org/${o}/{z}/{x}/{y}.png`

const TOPO_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    topo: {
      type: 'raster',
      tiles: TOPO_TILES,
      tileSize: 256,
      maxzoom: 17,
      attribution:
        'Karte: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · Daten: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>',
    },
  },
  layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
}

const VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

export interface MapPoint {
  pos: LonLat
  role: 'start' | 'end' | 'via'
}

interface Props {
  base: BaseMap
  overlay: Overlay
  points: MapPoint[]
  candidates: PlannedRoute[]
  selectedId: string | null
  /** position highlighted from the elevation chart */
  hoverAlong: number | null
  user: { pos: LonLat; heading: number | null; accuracy: number } | null
  follow: boolean
  headingUp: boolean
  fitKey: string
  onMapClick: (pos: LonLat) => void
  onSelect: (id: string) => void
  /** computed way back onto the route while navigating */
  detour: LonLat[] | null
  /** the user dragged the map: stop following the position */
  onUserPan: () => void
}

const empty = { type: 'FeatureCollection' as const, features: [] }

function routeFeatures(r: PlannedRoute) {
  const { raw } = r
  if (!raw.segments.length || !raw.segments[0].tags.highway) {
    return [{ type: 'Feature' as const, properties: { color: '#2e7d32' }, geometry: { type: 'LineString' as const, coordinates: raw.coords } }]
  }
  // split the line into coloured pieces by way kind
  const out = []
  let i = 0
  for (const s of raw.segments) {
    const color = WAY_COLOR[wayKind(s.tags)]
    const coords: LonLat[] = [pointAt(raw.coords, raw.cum, s.start)]
    while (i < raw.coords.length && raw.cum[i] <= s.start) i++
    let j = i
    while (j < raw.coords.length && raw.cum[j] < s.end) coords.push(raw.coords[j++])
    coords.push(pointAt(raw.coords, raw.cum, s.end))
    if (coords.length >= 2) out.push({ type: 'Feature' as const, properties: { color }, geometry: { type: 'LineString' as const, coordinates: coords } })
  }
  return out
}

export function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const props = useRef(p)
  props.current = p
  const userMarker = useRef<maplibregl.Marker | null>(null)

  // create the map once
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: TOPO_STYLE,
      center: REGION.center,
      zoom: REGION.zoom,
      attributionControl: { compact: true },
    })
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    m.on('click', (e) => {
      const hit = m.queryRenderedFeatures(e.point, { layers: ['cand-line'] })
      const id = hit[0]?.properties?.id as string | undefined
      if (id && id !== props.current.selectedId) props.current.onSelect(id)
      else props.current.onMapClick([e.lngLat.lng, e.lngLat.lat])
    })
    m.on('style.load', () => ensureLayers(m))
    m.on('dragstart', () => props.current.onUserPan())
    m.on('error', (e) => console.error('Karte:', e.error?.message ?? e))
    if (import.meta.env.DEV) Object.assign(window, { __owildMap: m })
    map.current = m
    const el2 = document.createElement('div')
    el2.className = 'user-dot'
    el2.innerHTML = '<div class="user-cone"></div><div class="user-core"></div>'
    userMarker.current = new maplibregl.Marker({ element: el2, rotationAlignment: 'map' })
    const fly = (e: Event): void => {
      m.flyTo({ center: (e as CustomEvent<LonLat>).detail, zoom: 14 })
    }
    window.addEventListener('owild-fly', fly)
    return () => {
      window.removeEventListener('owild-fly', fly)
      m.remove()
    }
  }, [])

  function ensureLayers(m: MlMap) {
    const cur = props.current
    if (cur.overlay !== 'none' && !m.getSource('overlay')) {
      m.addSource('overlay', { type: 'raster', tiles: [overlayTiles(cur.overlay)], tileSize: 256, attribution: 'Wege: © waymarkedtrails.org' })
      m.addLayer({ id: 'overlay', type: 'raster', source: 'overlay', paint: { 'raster-opacity': 0.8 } })
    }
    if (!m.getSource('cand')) {
      m.addSource('cand', { type: 'geojson', data: empty })
      m.addLayer({ id: 'cand-line', type: 'line', source: 'cand', paint: { 'line-color': '#37474f', 'line-width': 6, 'line-opacity': 0.45 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addSource('sel', { type: 'geojson', data: empty })
      m.addLayer({ id: 'sel-casing', type: 'line', source: 'sel', paint: { 'line-color': '#ffffff', 'line-width': 9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addLayer({ id: 'sel-line', type: 'line', source: 'sel', paint: { 'line-color': ['get', 'color'], 'line-width': 5.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addSource('pts', { type: 'geojson', data: empty })
      m.addLayer({
        id: 'pts',
        type: 'circle',
        source: 'pts',
        paint: {
          'circle-radius': ['match', ['get', 'role'], 'via', 6, 9],
          'circle-color': ['match', ['get', 'role'], 'start', '#2e7d32', 'end', '#c62828', '#f9a825'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2.5,
        },
      })
      m.addSource('detour', { type: 'geojson', data: empty })
      m.addLayer({ id: 'detour-casing', type: 'line', source: 'detour', paint: { 'line-color': '#ffffff', 'line-width': 8 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addLayer({ id: 'detour-line', type: 'line', source: 'detour', paint: { 'line-color': '#e07b24', 'line-width': 5, 'line-dasharray': [1.5, 1.5] }, layout: { 'line-join': 'round' } })
      m.addSource('hover', { type: 'geojson', data: empty })
      m.addLayer({ id: 'hover', type: 'circle', source: 'hover', paint: { 'circle-radius': 7, 'circle-color': '#ff6f00', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
    }
    syncData(m)
  }

  function syncData(m: MlMap) {
    const cur = props.current
    const src = (id: string) => m.getSource(id) as GeoJSONSource | undefined
    const sel = cur.candidates.find((c) => c.id === cur.selectedId)
    src('cand')?.setData({
      type: 'FeatureCollection',
      features: cur.candidates
        .filter((c) => c.id !== cur.selectedId)
        .map((c) => ({ type: 'Feature', properties: { id: c.id }, geometry: { type: 'LineString', coordinates: c.raw.coords } })),
    })
    src('sel')?.setData({ type: 'FeatureCollection', features: sel ? routeFeatures(sel) : [] })
    src('pts')?.setData({
      type: 'FeatureCollection',
      features: cur.points.map((pt) => ({ type: 'Feature', properties: { role: pt.role }, geometry: { type: 'Point', coordinates: pt.pos } })),
    })
    src('detour')?.setData(
      cur.detour ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: cur.detour } }] } : empty,
    )
    const hp = sel && cur.hoverAlong !== null ? pointAt(sel.raw.coords, sel.raw.cum, cur.hoverAlong) : null
    src('hover')?.setData(hp ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: hp } }] } : empty)
  }

  // base map switch
  const firstBase = useRef(true)
  useEffect(() => {
    if (firstBase.current) {
      firstBase.current = false
      return
    }
    map.current?.setStyle(p.base === 'topo' ? TOPO_STYLE : VECTOR_STYLE)
  }, [p.base])

  // overlay switch
  useEffect(() => {
    const m = map.current
    if (!m || !m.isStyleLoaded()) return
    if (m.getLayer('overlay')) m.removeLayer('overlay')
    if (m.getSource('overlay')) m.removeSource('overlay')
    if (p.overlay !== 'none') {
      m.addSource('overlay', { type: 'raster', tiles: [overlayTiles(p.overlay)], tileSize: 256, attribution: 'Wege: © waymarkedtrails.org' })
      m.addLayer({ id: 'overlay', type: 'raster', source: 'overlay', paint: { 'raster-opacity': 0.8 } }, m.getLayer('cand-line') ? 'cand-line' : undefined)
    }
  }, [p.overlay])

  // data changes
  useEffect(() => {
    const m = map.current
    if (m && m.getSource('cand')) syncData(m)
  }, [p.candidates, p.selectedId, p.points, p.hoverAlong, p.detour])

  // fit to the candidates when a new search arrives
  useEffect(() => {
    const m = map.current
    if (!m || !p.candidates.length) return
    const b = new maplibregl.LngLatBounds()
    for (const c of p.candidates) for (const x of c.raw.coords) b.extend(x)
    const narrow = window.innerWidth < 800
    m.fitBounds(b, { padding: narrow ? 40 : { top: 60, bottom: 60, left: 440, right: 60 }, duration: 600 })
  }, [p.fitKey])

  // user position
  useEffect(() => {
    const m = map.current
    const mk = userMarker.current
    if (!m || !mk) return
    if (!p.user) {
      mk.remove()
      return
    }
    mk.setLngLat(p.user.pos).addTo(m)
    mk.setRotation(p.user.heading ?? 0)
    mk.getElement().classList.toggle('no-heading', p.user.heading === null)
    if (p.follow) {
      m.easeTo({
        center: p.user.pos,
        zoom: Math.max(m.getZoom(), 16),
        bearing: p.headingUp && p.user.heading !== null ? p.user.heading : m.getBearing(),
        pitch: p.headingUp ? 45 : 0,
        duration: 800,
      })
    }
  }, [p.user, p.follow, p.headingUp])

  return <div ref={el} className="map" />
}

export function flyTo(pos: LonLat) {
  window.dispatchEvent(new CustomEvent('owild-fly', { detail: pos }))
}
