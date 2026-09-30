import { useMemo } from 'react'

interface Props {
  /** 收盘价序列（旧→新），建议 5–20 点 */
  values: number[]
  width?: number
  height?: number
  /** 演示数据时弱化描边 */
  sample?: boolean
  className?: string
  title?: string
}

/** 迷你折线：真实收盘序列；演示时虚线+半透明 */
export function Sparkline({
  values,
  width = 64,
  height = 22,
  sample = false,
  className = '',
  title,
}: Props) {
  const path = useMemo(() => {
    const nums = values.filter((v) => Number.isFinite(v) && v > 0)
    if (nums.length < 2) return null
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    const span = max - min || 1
    const pad = 1
    const w = width - pad * 2
    const h = height - pad * 2
    const pts = nums.map((v, i) => {
      const x = pad + (i / (nums.length - 1)) * w
      const y = pad + (1 - (v - min) / span) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    return pts.join(' ')
  }, [values, width, height])

  if (!path) {
    return (
      <span className={`sparkline empty ${className}`} title={title || '暂无走势'}>
        —
      </span>
    )
  }

  const first = values.find((v) => Number.isFinite(v)) ?? 0
  const last = [...values].reverse().find((v) => Number.isFinite(v)) ?? first
  const up = last >= first

  return (
    <svg
      className={`sparkline ${up ? 'up' : 'down'} ${sample ? 'sample' : ''} ${className}`.trim()}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={title || (sample ? '演示走势' : '近端收盘走势')}
      role="img"
    >
      <title>{title || (sample ? '演示走势' : '近端收盘走势')}</title>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={sample ? 1 : 1.4}
        strokeDasharray={sample ? '2 2' : undefined}
        strokeOpacity={sample ? 0.45 : 0.95}
        points={path}
      />
    </svg>
  )
}
