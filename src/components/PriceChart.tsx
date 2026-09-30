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
import { getChartThemeColors, subscribeThemeChange } from '../utils/theme'

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
    const colors = getChartThemeColors()
    const chart = createChart(ref.current, {
      height: mainH,
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
    chartRef.current = chart

    const candleSeries = chart.addCandlestickSeries({
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    })

    let ma5: ISeriesApi<'Line'> | null = null
    let ma10: ISeriesApi<'Line'> | null = null
    let ma20: ISeriesApi<'Line'> | null = null
    if (showMa) {
      ma5 = chart.addLineSeries({ color: colors.warn, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      ma10 = chart.addLineSeries({ color: colors.accent, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      ma20 = chart.addLineSeries({ color: colors.purple, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    }

    let volChart: IChartApi | null = null
    let volSeries: ISeriesApi<'Histogram'> | null = null
    if (showVol && volRef.current) {
      volChart = createChart(volRef.current, {
        height: subH,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: colors.text,
        },
        grid: {
          vertLines: { color: colors.gridSoft },
          horzLines: { color: colors.gridSoft },
        },
        rightPriceScale: { borderColor: colors.border },
        timeScale: { borderColor: colors.border, visible: false },
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
          textColor: colors.text,
        },
        grid: {
          vertLines: { color: colors.gridSoft },
          horzLines: { color: colors.gridSoft },
        },
        rightPriceScale: { borderColor: colors.border },
        timeScale: { borderColor: colors.border, visible: false },
        crosshair: { mode: 0 },
      })
      histSeries = macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false })
      difSeries = macdChart.addLineSeries({ color: colors.accent, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      deaSeries = macdChart.addLineSeries({ color: colors.warn, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
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
        const c = getChartThemeColors()
        volSeries.setData(
          candles.map((bar) => ({
            time: parseTime(bar.time),
            value: bar.volume,
            color: bar.close >= bar.open ? c.upSoft : c.downSoft,
          })),
        )
      }
      if (difSeries && deaSeries && histSeries) {
        const { dif, dea, hist } = macdSeries(closes)
        const c = getChartThemeColors()
        difSeries.setData(candles.map((bar, i) => ({ time: parseTime(bar.time), value: dif[i] })))
        deaSeries.setData(candles.map((bar, i) => ({ time: parseTime(bar.time), value: dea[i] })))
        histSeries.setData(
          candles.map((bar, i) => ({
            time: parseTime(bar.time),
            value: hist[i],
            color: hist[i] >= 0 ? c.upSoft : c.downSoft,
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

    const applyThemeColors = () => {
      const c = getChartThemeColors()
      const layoutOpts = {
        layout: { background: { type: ColorType.Solid, color: 'transparent' as const }, textColor: c.text },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border },
      }
      chart.applyOptions(layoutOpts)
      candleSeries.applyOptions({
        upColor: c.up, downColor: c.down,
        borderUpColor: c.up, borderDownColor: c.down,
        wickUpColor: c.up, wickDownColor: c.down,
      })
      volChart?.applyOptions({
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: c.text },
        grid: { vertLines: { color: c.gridSoft }, horzLines: { color: c.gridSoft } },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border },
      })
      macdChart?.applyOptions({
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: c.text },
        grid: { vertLines: { color: c.gridSoft }, horzLines: { color: c.gridSoft } },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border },
      })
      // refresh vol/macd bar colors
      applyData()
    }
    const unsubTheme = subscribeThemeChange(() => applyThemeColors())

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth })
      if (volRef.current && volChart) volChart.applyOptions({ width: volRef.current.clientWidth })
      if (macdRef.current && macdChart) macdChart.applyOptions({ width: macdRef.current.clientWidth })
    })
    ro.observe(ref.current)

    return () => {
      unsubTheme()
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
