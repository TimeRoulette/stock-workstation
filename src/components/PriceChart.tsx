import { useEffect, useRef } from 'react'
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  ColorType,
  type UTCTimestamp,
  type BusinessDay,
} from 'lightweight-charts'
import type { Candle, IndicatorKey } from '../types'

interface Props {
  candles: Candle[]
  height?: number
  indicators?: IndicatorKey[]
}

function parseTime(t: string): UTCTimestamp | BusinessDay {
  if (t.includes('T') || t.includes(' ')) {
    const d = new Date(t.includes('T') ? t : t.replace(' ', 'T'))
    return Math.floor(d.getTime() / 1000) as UTCTimestamp
  }
  const [y, m, d] = t.split('-').map(Number)
  return { year: y, month: m, day: d }
}

function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = []
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < period) {
      out.push(null)
      continue
    }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    out.push(sum / period)
  }
  return out
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev = values[0] ?? 0
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      out.push(values[0])
      prev = values[0]
    } else {
      const v = values[i] * k + prev * (1 - k)
      out.push(v)
      prev = v
    }
  }
  return out
}

function macdSeries(closes: number[]) {
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const dif = ema12.map((v, i) => v - ema26[i])
  const dea = ema(dif, 9)
  const hist = dif.map((v, i) => (v - dea[i]) * 2)
  return { dif, dea, hist }
}

export function PriceChart({ candles, height = 360, indicators = ['ma', 'vol'] }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const volRef = useRef<HTMLDivElement>(null)
  const macdRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const volChartRef = useRef<IChartApi | null>(null)
  const macdChartRef = useRef<IChartApi | null>(null)

  const showVol = indicators.includes('vol')
  const showMacd = indicators.includes('macd')
  const showMa = indicators.includes('ma')

  const mainH = showVol || showMacd ? Math.max(220, height - (showVol ? 90 : 0) - (showMacd ? 90 : 0)) : height
  const subH = 90

  useEffect(() => {
    if (!ref.current) return
    const chart = createChart(ref.current, {
      height: mainH,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b949e',
      },
      grid: {
        vertLines: { color: 'rgba(48,54,61,0.6)' },
        horzLines: { color: 'rgba(48,54,61,0.6)' },
      },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    })
    chartRef.current = chart

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#f85149',
      downColor: '#3fb950',
      borderUpColor: '#f85149',
      borderDownColor: '#3fb950',
      wickUpColor: '#f85149',
      wickDownColor: '#3fb950',
    })

    let ma5: ISeriesApi<'Line'> | null = null
    let ma10: ISeriesApi<'Line'> | null = null
    let ma20: ISeriesApi<'Line'> | null = null
    if (showMa) {
      ma5 = chart.addLineSeries({ color: '#e0b15a', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      ma10 = chart.addLineSeries({ color: '#5b9fd4', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      ma20 = chart.addLineSeries({ color: '#c4a8f0', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    }

    let volChart: IChartApi | null = null
    let volSeries: ISeriesApi<'Histogram'> | null = null
    if (showVol && volRef.current) {
      volChart = createChart(volRef.current, {
        height: subH,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#8b949e',
        },
        grid: {
          vertLines: { color: 'rgba(48,54,61,0.4)' },
          horzLines: { color: 'rgba(48,54,61,0.4)' },
        },
        rightPriceScale: { borderColor: '#30363d' },
        timeScale: { borderColor: '#30363d', visible: false },
        crosshair: { mode: 0 },
      })
      volSeries = volChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceLineVisible: false,
        lastValueVisible: false,
      })
      volChartRef.current = volChart
    }

    let macdChart: IChartApi | null = null
    let difSeries: ISeriesApi<'Line'> | null = null
    let deaSeries: ISeriesApi<'Line'> | null = null
    let histSeries: ISeriesApi<'Histogram'> | null = null
    if (showMacd && macdRef.current) {
      macdChart = createChart(macdRef.current, {
        height: subH,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#8b949e',
        },
        grid: {
          vertLines: { color: 'rgba(48,54,61,0.4)' },
          horzLines: { color: 'rgba(48,54,61,0.4)' },
        },
        rightPriceScale: { borderColor: '#30363d' },
        timeScale: { borderColor: '#30363d', visible: false },
        crosshair: { mode: 0 },
      })
      histSeries = macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false })
      difSeries = macdChart.addLineSeries({ color: '#5b9fd4', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      deaSeries = macdChart.addLineSeries({ color: '#e0b15a', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      macdChartRef.current = macdChart
    }

    const applyData = () => {
      const data = candles.map((c) => ({
        time: parseTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      candleSeries.setData(data)
      const closes = candles.map((c) => c.close)
      if (showMa && ma5 && ma10 && ma20) {
        const s5 = sma(closes, 5)
        const s10 = sma(closes, 10)
        const s20 = sma(closes, 20)
        ma5.setData(
          candles
            .map((c, i) => (s5[i] == null ? null : { time: parseTime(c.time), value: s5[i]! }))
            .filter(Boolean) as Array<{ time: UTCTimestamp | BusinessDay; value: number }>,
        )
        ma10.setData(
          candles
            .map((c, i) => (s10[i] == null ? null : { time: parseTime(c.time), value: s10[i]! }))
            .filter(Boolean) as Array<{ time: UTCTimestamp | BusinessDay; value: number }>,
        )
        ma20.setData(
          candles
            .map((c, i) => (s20[i] == null ? null : { time: parseTime(c.time), value: s20[i]! }))
            .filter(Boolean) as Array<{ time: UTCTimestamp | BusinessDay; value: number }>,
        )
      }
      if (volSeries) {
        volSeries.setData(
          candles.map((c) => ({
            time: parseTime(c.time),
            value: c.volume,
            color: c.close >= c.open ? 'rgba(248,81,73,0.55)' : 'rgba(63,185,80,0.55)',
          })),
        )
      }
      if (difSeries && deaSeries && histSeries) {
        const { dif, dea, hist } = macdSeries(closes)
        difSeries.setData(candles.map((c, i) => ({ time: parseTime(c.time), value: dif[i] })))
        deaSeries.setData(candles.map((c, i) => ({ time: parseTime(c.time), value: dea[i] })))
        histSeries.setData(
          candles.map((c, i) => ({
            time: parseTime(c.time),
            value: hist[i],
            color: hist[i] >= 0 ? 'rgba(248,81,73,0.55)' : 'rgba(63,185,80,0.55)',
          })),
        )
      }
      chart.timeScale().fitContent()
      volChart?.timeScale().fitContent()
      macdChart?.timeScale().fitContent()
    }

    applyData()

    const sync = (timeRange: unknown) => {
      if (!timeRange) return
      try {
        volChart?.timeScale().setVisibleLogicalRange(chart.timeScale().getVisibleLogicalRange()!)
        macdChart?.timeScale().setVisibleLogicalRange(chart.timeScale().getVisibleLogicalRange()!)
      } catch {
        /* */
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(sync)

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth })
      if (volRef.current && volChart) volChart.applyOptions({ width: volRef.current.clientWidth })
      if (macdRef.current && macdChart) macdChart.applyOptions({ width: macdRef.current.clientWidth })
    })
    ro.observe(ref.current)

    return () => {
      ro.disconnect()
      chart.remove()
      volChart?.remove()
      macdChart?.remove()
      chartRef.current = null
      volChartRef.current = null
      macdChartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, showVol, showMacd, showMa, candles])

  return (
    <div className="price-chart-stack">
      <div className="chart-wrap" ref={ref} style={{ height: mainH }} />
      {showVol && (
        <div className="chart-sub">
          <div className="chart-sub-label">VOL</div>
          <div ref={volRef} className="chart-wrap-sub" style={{ height: subH }} />
        </div>
      )}
      {showMacd && (
        <div className="chart-sub">
          <div className="chart-sub-label">MACD</div>
          <div ref={macdRef} className="chart-wrap-sub" style={{ height: subH }} />
        </div>
      )}
    </div>
  )
}
