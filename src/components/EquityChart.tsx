import { useEffect, useRef } from 'react'
import { createChart, type IChartApi, type ISeriesApi, ColorType, type UTCTimestamp } from 'lightweight-charts'
import type { EquitySnapshot } from '../types'
import { getChartThemeColors, subscribeThemeChange } from '../utils/theme'

interface Props {
  snapshots: EquitySnapshot[]
  height?: number
}

export function EquityChart({ snapshots, height = 220 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const colors = getChartThemeColors()
    const chart = createChart(ref.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: colors.text,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    })
    const series = chart.addAreaSeries({
      lineColor: colors.accent,
      topColor: 'rgba(91,159,212,0.35)',
      bottomColor: 'rgba(91,159,212,0.02)',
      lineWidth: 2,
    })
    chartRef.current = chart
    seriesRef.current = series

    const unsubTheme = subscribeThemeChange(() => {
      const c = getChartThemeColors()
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: c.text },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border },
      })
      series.applyOptions({ lineColor: c.accent })
    })

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth })
    })
    ro.observe(ref.current)

    return () => {
      unsubTheme()
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [height])

  useEffect(() => {
    if (!seriesRef.current) return
    if (snapshots.length === 0) {
      seriesRef.current.setData([])
      return
    }
    const byTime = new Map<number, number>()
    for (const s of snapshots) {
      const t = Math.floor(new Date(s.ts).getTime() / 1000)
      byTime.set(t, +s.equity.toFixed(2))
    }
    const data = [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as UTCTimestamp, value }))
    seriesRef.current.setData(data)
    chartRef.current?.timeScale().fitContent()
  }, [snapshots])

  return <div className="chart-wrap chart-wrap-sm" ref={ref} />
}
