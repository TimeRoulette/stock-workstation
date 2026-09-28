import { useEffect, useRef } from 'react'
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  ColorType,
  type UTCTimestamp,
  type BusinessDay,
} from 'lightweight-charts'
import type { Candle } from '../types'

export interface CompareSeries {
  symbol: string
  candles: Candle[]
}

interface Props {
  series: CompareSeries[]
  height?: number
}

const COLORS = ['#5b9fd4', '#e0b15a', '#7fd99a', '#f07178']

function parseTime(t: string): UTCTimestamp | BusinessDay {
  if (t.includes('T') || t.includes(' ')) {
    const d = new Date(t.includes('T') ? t : t.replace(' ', 'T'))
    return Math.floor(d.getTime() / 1000) as UTCTimestamp
  }
  const [y, m, d] = t.split('-').map(Number)
  return { year: y, month: m, day: d }
}

function timeKey(t: string): string {
  return t.slice(0, 10)
}

/** 归一化到起点 100，按日期对齐后画叠加线 */
export function CompareChart({ series, height = 280 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const linesRef = useRef<ISeriesApi<'Line'>[]>([])

  useEffect(() => {
    if (!ref.current) return
    const chart = createChart(ref.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b949e',
      },
      grid: {
        vertLines: { color: 'rgba(48,54,61,0.45)' },
        horzLines: { color: 'rgba(48,54,61,0.45)' },
      },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d' },
      crosshair: { mode: 0 },
    })
    chartRef.current = chart
    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth })
    })
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      linesRef.current = []
    }
  }, [height])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    for (const s of linesRef.current) {
      try {
        chart.removeSeries(s)
      } catch {
        /* */
      }
    }
    linesRef.current = []

    const usable = series.filter((s) => s.candles.length >= 2).slice(0, 3)
    for (let i = 0; i < usable.length; i++) {
      const s = usable[i]
      const line = chart.addLineSeries({
        color: COLORS[i % COLORS.length],
        lineWidth: 2,
        title: s.symbol,
        priceLineVisible: false,
        lastValueVisible: true,
      })
      const base = s.candles[0].close
      if (!base || !Number.isFinite(base)) continue
      const byDay = new Map<string, number>()
      for (const c of s.candles) {
        if (!Number.isFinite(c.close) || c.close <= 0) continue
        byDay.set(timeKey(c.time), +((c.close / base) * 100).toFixed(2))
      }
      const data = [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([t, value]) => ({ time: parseTime(t), value }))
      line.setData(data)
      linesRef.current.push(line)
    }
    chart.timeScale().fitContent()
  }, [series])

  return (
    <div>
      <div className="compare-legend">
        {series.slice(0, 3).map((s, i) => (
          <span key={s.symbol} className="compare-legend-item">
            <i style={{ background: COLORS[i % COLORS.length] }} />
            {s.symbol}
            <span className="muted">（归一化=100）</span>
          </span>
        ))}
      </div>
      <div className="chart-wrap" ref={ref} />
    </div>
  )
}
