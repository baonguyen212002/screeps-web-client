import { BODY_PARTS, type BodyPartType } from './bodyParts'

type BodyWheelProps = {
  title: string
  parts: BodyPartType[]
  counts: Partial<Record<BodyPartType, number>>
  size?: number
}

const START_ANGLE = -Math.PI / 2

function polar(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  }
}

function describeArc(cx: number, cy: number, radius: number, start: number, end: number) {
  const startPoint = polar(cx, cy, radius, start)
  const endPoint = polar(cx, cy, radius, end)
  const largeArc = end - start > Math.PI ? 1 : 0
  return `M ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArc} 1 ${endPoint.x} ${endPoint.y}`
}

export default function BodyWheel({ title, parts, counts, size = 96 }: BodyWheelProps) {
  const total = parts.reduce((sum, part) => sum + (counts[part] ?? 0), 0)
  const radius = size * 0.36
  const center = size / 2
  let angle = START_ANGLE

  return (
    <div className="body-wheel-card">
      <div className="body-wheel-title">{title}</div>
      <div className="body-wheel-visual">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="body-wheel-svg" aria-hidden="true">
          <circle cx={center} cy={center} r={radius} className="body-wheel-track" />
          {total > 0 && parts.map((part) => {
            const value = counts[part] ?? 0
            if (!value) return null
            const nextAngle = angle + (Math.PI * 2 * value) / total
            const path = describeArc(center, center, radius, angle, nextAngle)
            angle = nextAngle
            return (
              <path
                key={part}
                d={path}
                stroke={BODY_PARTS[part].color}
                strokeWidth={size * 0.14}
                strokeLinecap="butt"
                fill="none"
              />
            )
          })}
          <circle cx={center} cy={center} r={size * 0.2} className="body-wheel-core" />
        </svg>
      </div>
      <div className="body-wheel-legend">
        {parts.map((part) => {
          const count = counts[part] ?? 0
          return (
            <div key={part} className={`body-wheel-legend-item ${count ? 'has-value' : ''}`}>
              <span className="body-wheel-legend-line" style={{ color: BODY_PARTS[part].color }}>
                {BODY_PARTS[part].label}
              </span>
              <span className="body-wheel-legend-value">{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
