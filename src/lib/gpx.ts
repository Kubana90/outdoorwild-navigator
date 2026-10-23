import type { RawRoute } from './brouter'
import { cumulative, type LonLat } from './geo'

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

export function toGpx(route: RawRoute, name: string, description = ''): string {
  const pts = route.coords
    .map((c, i) => {
      const e = route.ele[i]
      return `      <trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${Number.isFinite(e) ? `<ele>${e.toFixed(1)}</ele>` : ''}</trkpt>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OutdoorWild Navigator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name><desc>${esc(description)}</desc></metadata>
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`
}

/** Reads track points (or route points) from a GPX file into a route without way tags. */
export function fromGpx(xml: string): RawRoute {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  let nodes = Array.from(doc.getElementsByTagName('trkpt'))
  if (!nodes.length) nodes = Array.from(doc.getElementsByTagName('rtept'))
  if (nodes.length < 2) throw new Error('Die GPX-Datei enthält keinen Track.')
  const coords: LonLat[] = []
  const ele: number[] = []
  for (const n of nodes) {
    const lat = Number(n.getAttribute('lat'))
    const lon = Number(n.getAttribute('lon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    coords.push([lon, lat])
    const e = n.getElementsByTagName('ele')[0]?.textContent
    ele.push(e ? Number(e) : NaN)
  }
  const cum = cumulative(coords)
  const length = cum[cum.length - 1]
  return { coords, ele, cum, length, segments: [{ start: 0, end: length, tags: {} }], hints: [] }
}

export function download(filename: string, text: string, type = 'application/gpx+xml') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
