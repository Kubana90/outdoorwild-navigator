import { useMemo, useRef, useState } from 'react'
import { segmentAt, SURFACE_LABEL, surfaceKind, wayKind, WAY_COLOR, WAY_LABEL, km } from '../lib/analysis'
import type { PlannedRoute } from '../lib/planner'

interface Props {
  route: PlannedRoute
  /** current position along the route, metres (navigation) */
  marker?: number | null
  onHover?: (along: number | null) => void
  height?: number
}

const W = 360
const PAD = { l: 34, r: 8, t: 8, b: 26 }

export function ElevationChart({ route, marker = null, onHover, height = 150 }: Props) {
  const { raw, analysis } = route
  const ele = analysis.smoothedEle
  const [hover, setHover] = useState<number | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const H = height
  const plotH = H - PAD.t - PAD.b - 8

  const geo = useMemo(() => {
    const lo = Math.floor((analysis.minEle - 10) / 10) * 10
    const hi = Math.ceil((analysis.maxEle + 10) / 10) * 10
    const span = Math.max(20, hi - lo)
    const x = (d: number) => PAD.l + (d / Math.max(1, raw.length)) * (W - PAD.l - PAD.r)
    const y = (e: number) => PAD.t + plotH - ((e - lo) / span) * plotH
    // thin the profile to ~300 points
    const step = Math.max(1, Math.floor(ele.length / 300))
    let d = ''
    for (let i = 0; i < ele.length; i += step) d += `${i === 0 ? 'M' : 'L'}${x(raw.cum[i]).toFixed(1)},${y(ele[i]).toFixed(1)}`
    d += `L${x(raw.length).toFixed(1)},${y(ele[ele.length - 1]).toFixed(1)}`
    const area = `${d}L${x(raw.length)},${PAD.t + plotH}L${PAD.l},${PAD.t + plotH}Z`
    const ticks = [lo, lo + span / 2, lo + span].map(Math.round)
    return { x, y, d, area, ticks, lo }
  }, [route])

  const pick = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect()
    const fx = ((clientX - r.left) / r.width) * W
    const along = Math.min(raw.length, Math.max(0, ((fx - PAD.l) / (W - PAD.l - PAD.r)) * raw.length))
    setHover(along)
    onHover?.(along)
  }
  const leave = () => {
    setHover(null)
    onHover?.(null)
  }

  const hoverInfo = useMemo(() => {
    if (hover === null) return null
    const i = Math.max(0, raw.cum.findIndex((c) => c >= hover))
    const seg = segmentAt(raw.segments, hover)
    return {
      ele: ele[i],
      kind: seg ? WAY_LABEL[wayKind(seg.tags)] : '',
      surface: seg ? SURFACE_LABEL[surfaceKind(seg.tags)] : '',
    }
  }, [hover])

  const bandY = PAD.t + plotH + 3
  const kmStep = raw.length > 40000 ? 10000 : raw.length > 15000 ? 5000 : raw.length > 6000 ? 2000 : 1000
  const kmTicks = Array.from({ length: Math.floor(raw.length / kmStep) + 1 }, (_, i) => i * kmStep)

  return (
    <div className="elev">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Höhenprofil"
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={leave}
        onTouchMove={(e) => pick(e.touches[0].clientX)}
        onTouchEnd={leave}
      >
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} className="grid" />
            <text x={PAD.l - 4} y={geo.y(t) + 3} textAnchor="end" className="tick">
              {t}
            </text>
          </g>
        ))}
        <path d={geo.area} className="elev-area" />
        <path d={geo.d} className="elev-line" />
        {raw.segments.map((s, i) => (
          <rect key={i} x={geo.x(s.start)} width={Math.max(0.5, geo.x(s.end) - geo.x(s.start))} y={bandY} height={6} fill={WAY_COLOR[wayKind(s.tags)]} />
        ))}
        {kmTicks.map((d) => (
          <text key={d} x={geo.x(d)} y={H - 4} textAnchor="middle" className="tick">
            {d / 1000}
          </text>
        ))}
        <text x={W - PAD.r} y={H - 4} textAnchor="end" className="tick">
          km
        </text>
        {marker !== null && <line x1={geo.x(marker)} x2={geo.x(marker)} y1={PAD.t} y2={bandY + 6} className="pos-line" />}
        {hover !== null && <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.t} y2={bandY + 6} className="hover-line" />}
      </svg>
      <div className="elev-info">
        {hoverInfo ? (
          <>
            {km(hover!)} · {Math.round(hoverInfo.ele)} m · {hoverInfo.kind}
            {hoverInfo.surface !== 'unbekannt' ? `, ${hoverInfo.surface}` : ''}
          </>
        ) : (
          <>Fahre mit dem Finger oder der Maus über das Profil</>
        )}
      </div>
    </div>
  )
}
