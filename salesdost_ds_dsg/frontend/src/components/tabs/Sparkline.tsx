interface SparklineProps {
  values: number[]
  color?: string
  height?: number
}

export default function Sparkline({ values, color = '#3b82f6', height = 52 }: SparklineProps) {
  if (values.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-gray-700 text-[10px]"
        style={{ height }}
      >
        —
      </div>
    )
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const W = 200
  const pad = 4

  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: pad + (1 - (v - min) / range) * (height - pad * 2),
  }))

  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const cx = ((pts[i - 1].x + pts[i].x) / 2).toFixed(1)
    d += ` C${cx},${pts[i - 1].y.toFixed(1)} ${cx},${pts[i].y.toFixed(1)} ${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`
  }

  const area = `${d} L${W},${height} L0,${height} Z`
  const last = pts[pts.length - 1]

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full"
      style={{ height }}
      preserveAspectRatio="none"
    >
      <path d={area} fill={color} fillOpacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r="2.5" fill={color} />
    </svg>
  )
}
