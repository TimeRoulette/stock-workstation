/**
 * 技术条件选股：量价洗盘 / MACD 金叉 / 突破回踩
 * 客观阈值 + 命中证据；示意 K 线不得伪装为真实命中
 */
import type { Candle, Market } from '../types'
import type { ScreenerMarketTab, ScreenerRow } from './screener'

export type TechConditionId = 'volume_wash' | 'macd_golden' | 'breakout_pullback'
export type TechCombineMode = 'any' | 'all'
export type CandleDataStatus = 'live' | 'mock' | 'insufficient' | 'error'

export const TECH_RULES_TEXT: Record<TechConditionId, string> = {
  volume_wash:
    '量价洗盘（满足其一）：①近 4 周周成交量逐级放大（允许相邻周量比 ≥ 0.92）；' +
    '②近 22 日内某日成交量 ≥ 前 20 日均量 × 2.0，随后连续 4 个交易日：价格振幅均值 ≤ 6%、' +
    '相对放量日收盘回撤 ≤ 8%、且 4 日均量 ≤ 放量日量 × 0.75。数据不足 30 根日线则跳过。',
  macd_golden:
    'MACD 金叉：标准 DIF/DEA(12,26,9)。在最近 lookback 日（默认 5）内，' +
    '出现 DIF 上穿 DEA（前一日 DIF≤DEA 且当日 DIF>DEA）。展示距金叉日数与当前 MACD 柱。',
  breakout_pullback:
    '突破回踩：过去 N 日（默认 20，可 60）最高价为压力；近 10 日内放量日收盘有效突破' +
    '（收盘 ≥ 压力 × 1.005，且量 ≥ 前 20 日均量 × 1.5）；之后回踩不有效跌破支撑' +
    '（支撑=突破日开/低价均价，容差 1.5%），且最近 2 日收盘站上支撑并收阳或下影收敛。',
}

export interface MacdPoint {
  dif: number
  dea: number
  hist: number
}

export interface TechHitEvidence {
  condition: TechConditionId
  label: string
  detail: string
  /** 关键数字摘要 */
  metrics: Record<string, number | string>
}

export interface TechScanHit {
  symbol: string
  name: string
  market: Market
  price: number
  changePercent: number
  dataStatus: CandleDataStatus
  /** 命中的条件 */
  hits: TechHitEvidence[]
  candleCount: number
  lastBarDate: string
  error?: string
}

export interface TechScanProgress {
  done: number
  total: number
  hits: number
  current?: string
}

export interface TechScanOptions {
  conditions: TechConditionId[]
  combine: TechCombineMode
  /** MACD 金叉回看日数 */
  macdLookback?: number
  /** 压力位窗口 20 | 60 */
  pressureWindow?: 20 | 60
  concurrency?: number
  timeoutMs?: number
  onProgress?: (p: TechScanProgress) => void
}

export interface CandleFetchResult {
  candles: Candle[]
  source: 'live' | 'mock'
}

const CACHE_TTL_MS = 10 * 60 * 1000
const candleCache = new Map<string, { ts: number; result: CandleFetchResult }>()

export function clearTechCandleCache() {
  candleCache.clear()
}

function emaSeries(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  let prev = sum / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/** 标准 MACD(12,26,9)：DIF = EMA12-EMA26；DEA = EMA(DIF,9)；柱 = (DIF-DEA)*2（国内常用） */
export function computeMacd(closes: number[]): MacdPoint[] {
  const ema12 = emaSeries(closes, 12)
  const ema26 = emaSeries(closes, 26)
  const dif: number[] = closes.map((_, i) =>
    Number.isFinite(ema12[i]) && Number.isFinite(ema26[i]) ? ema12[i] - ema26[i] : NaN,
  )
  // DEA：对有效 DIF 序列做 EMA9；对齐到原下标
  const difValidIdx: number[] = []
  const difValid: number[] = []
  for (let i = 0; i < dif.length; i++) {
    if (Number.isFinite(dif[i])) {
      difValidIdx.push(i)
      difValid.push(dif[i])
    }
  }
  const deaOnValid = emaSeries(difValid, 9)
  const dea = new Array(closes.length).fill(NaN)
  for (let j = 0; j < difValidIdx.length; j++) {
    dea[difValidIdx[j]] = deaOnValid[j]
  }
  return closes.map((_, i) => {
    const d = dif[i]
    const e = dea[i]
    if (!Number.isFinite(d) || !Number.isFinite(e)) return { dif: NaN, dea: NaN, hist: NaN }
    return { dif: d, dea: e, hist: (d - e) * 2 }
  })
}

function sortCandles(candles: Candle[]): Candle[] {
  return [...candles].filter((c) => Number.isFinite(c.close) && Number.isFinite(c.volume)).sort((a, b) => a.time.localeCompare(b.time))
}

/** 按自然周（周一为周起始）聚合周量 */
export function weeklyVolumes(daily: Candle[]): Array<{ week: string; volume: number; bars: number }> {
  const buckets = new Map<string, { volume: number; bars: number }>()
  for (const c of daily) {
    const d = new Date(c.time.slice(0, 10))
    if (Number.isNaN(d.getTime())) continue
    const day = d.getDay() || 7
    const monday = new Date(d)
    monday.setDate(d.getDate() - day + 1)
    const key = monday.toISOString().slice(0, 10)
    const prev = buckets.get(key) || { volume: 0, bars: 0 }
    prev.volume += c.volume
    prev.bars += 1
    buckets.set(key, prev)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, v]) => ({ week, volume: v.volume, bars: v.bars }))
}

/**
 * A1：近四周周量逐级放大（容差：后周/前周 ≥ 0.92 视为未萎缩，且至少 3/3 相邻满足「≥」严格放大中允许一次容差）
 * 实际规则：四周量 V1≤V2≤V3≤V4，但允许相邻比 ≥ 0.92；且 V4/V1 ≥ 1.15（整体放大）
 */
export function checkWeeklyVolumeExpansion(daily: Candle[]): TechHitEvidence | null {
  const weeks = weeklyVolumes(daily)
  if (weeks.length < 4) return null
  const last4 = weeks.slice(-4)
  const vols = last4.map((w) => w.volume)
  if (vols.some((v) => !(v > 0))) return null
  let softOk = true
  for (let i = 1; i < 4; i++) {
    if (vols[i] / vols[i - 1] < 0.92) softOk = false
  }
  const overall = vols[3] / vols[0]
  const strictlyNonDecreasing = vols[1] >= vols[0] * 0.92 && vols[2] >= vols[1] * 0.92 && vols[3] >= vols[2] * 0.92
  if (!(softOk && strictlyNonDecreasing && overall >= 1.15)) return null
  return {
    condition: 'volume_wash',
    label: '周量逐级放大',
    detail: `近4周量比约 ${(vols[1] / vols[0]).toFixed(2)} → ${(vols[2] / vols[1]).toFixed(2)} → ${(vols[3] / vols[2]).toFixed(2)}，整体 ×${overall.toFixed(2)}（容差 0.92，整体≥1.15）`,
    metrics: {
      week1: last4[0].week,
      week4: last4[3].week,
      v1: Math.round(vols[0]),
      v4: Math.round(vols[3]),
      overall: +overall.toFixed(3),
    },
  }
}

/**
 * A2：突发放量 + 随后 4 日震荡收敛
 */
export function checkSurgeThenConsolidate(daily: Candle[]): TechHitEvidence | null {
  if (daily.length < 30) return null
  const n = daily.length
  // 放量日候选：在 [n-6, n-5] 之前，即最后 4 日为震荡窗，放量日在其前
  // 搜索近 22 日（不含最后 4 日）
  const consol = daily.slice(-4)
  const searchEnd = n - 4
  const searchStart = Math.max(20, searchEnd - 22)
  let best: { idx: number; rvol: number } | null = null
  for (let i = searchStart; i < searchEnd; i++) {
    const hist = daily.slice(Math.max(0, i - 20), i)
    if (hist.length < 10) continue
    const avg = hist.reduce((s, c) => s + c.volume, 0) / hist.length
    if (!(avg > 0)) continue
    const rvol = daily[i].volume / avg
    if (rvol >= 2.0 && (!best || rvol > best.rvol)) best = { idx: i, rvol }
  }
  if (!best) return null
  const surge = daily[best.idx]
  // 震荡窗须紧接在放量日之后的连续 4 日——若放量日不是 consol 前一根，检查放量日到末段之间间隔
  const gap = n - 1 - best.idx
  if (gap < 4 || gap > 8) return null
  const window = daily.slice(best.idx + 1, best.idx + 5)
  if (window.length < 4) return null

  const amps = window.map((c) => {
    const base = (c.high + c.low) / 2 || c.close
    return base > 0 ? ((c.high - c.low) / base) * 100 : 99
  })
  const avgAmp = amps.reduce((a, b) => a + b, 0) / amps.length
  const maxDrawdown =
    surge.close > 0 ? ((surge.close - Math.min(...window.map((c) => c.low))) / surge.close) * 100 : 99
  const avgVol = window.reduce((s, c) => s + c.volume, 0) / 4
  const volShrink = surge.volume > 0 ? avgVol / surge.volume : 1

  if (avgAmp > 6) return null
  if (maxDrawdown > 8) return null
  if (volShrink > 0.75) return null

  return {
    condition: 'volume_wash',
    label: '突发放量后震荡',
    detail: `${surge.time.slice(0, 10)} 放量 RVOL=${best.rvol.toFixed(2)}，随后4日均振幅 ${avgAmp.toFixed(1)}%、回撤 ${maxDrawdown.toFixed(1)}%、量能比 ${volShrink.toFixed(2)}`,
    metrics: {
      surgeDate: surge.time.slice(0, 10),
      rvol: +best.rvol.toFixed(2),
      avgAmp: +avgAmp.toFixed(2),
      maxDrawdown: +maxDrawdown.toFixed(2),
      volShrink: +volShrink.toFixed(2),
    },
  }
}

export function checkVolumeWash(daily: Candle[]): TechHitEvidence | null {
  return checkWeeklyVolumeExpansion(daily) || checkSurgeThenConsolidate(daily)
}

export function checkMacdGolden(daily: Candle[], lookback = 5): TechHitEvidence | null {
  if (daily.length < 35) return null
  const closes = daily.map((c) => c.close)
  const macd = computeMacd(closes)
  const lb = Math.max(1, Math.min(lookback, 15))
  const last = macd.length - 1
  for (let i = last; i >= Math.max(26, last - lb + 1); i--) {
    const cur = macd[i]
    const prev = macd[i - 1]
    if (!cur || !prev) continue
    if (!Number.isFinite(cur.dif) || !Number.isFinite(cur.dea) || !Number.isFinite(prev.dif) || !Number.isFinite(prev.dea)) {
      continue
    }
    if (prev.dif <= prev.dea && cur.dif > cur.dea) {
      const daysAgo = last - i
      const now = macd[last]
      return {
        condition: 'macd_golden',
        label: 'MACD 金叉',
        detail: `${daily[i].time.slice(0, 10)} 金叉（DIF 上穿 DEA），距今 ${daysAgo} 日；当前柱 ${(now.hist || 0).toFixed(4)}`,
        metrics: {
          crossDate: daily[i].time.slice(0, 10),
          daysAgo,
          dif: +cur.dif.toFixed(4),
          dea: +cur.dea.toFixed(4),
          hist: +((now.hist as number) || 0).toFixed(4),
        },
      }
    }
  }
  return null
}

export function checkBreakoutPullback(daily: Candle[], pressureWindow: 20 | 60 = 20): TechHitEvidence | null {
  const need = Math.max(pressureWindow + 15, 40)
  if (daily.length < need) return null
  const n = daily.length
  // 在近 10 日内找突破日
  for (let bi = n - 10; bi < n - 2; bi++) {
    if (bi < pressureWindow) continue
    const pressureBars = daily.slice(bi - pressureWindow, bi)
    const pressure = Math.max(...pressureBars.map((c) => c.high))
    if (!(pressure > 0)) continue
    const histVol = daily.slice(Math.max(0, bi - 20), bi)
    if (histVol.length < 10) continue
    const avgVol = histVol.reduce((s, c) => s + c.volume, 0) / histVol.length
    const bar = daily[bi]
    const breakout = bar.close >= pressure * 1.005 && avgVol > 0 && bar.volume >= avgVol * 1.5
    if (!breakout) continue

    const support = (bar.open + bar.low) / 2
    const after = daily.slice(bi + 1)
    if (after.length < 2) continue
    // 回踩阶段：不有效跌破支撑（low >= support * 0.985）
    const broke = after.some((c) => c.low < support * 0.985)
    if (broke) continue
    // 最近 2 日企稳：收盘 ≥ 支撑，且至少一日收阳或振幅收敛
    const last2 = daily.slice(-2)
    if (last2.some((c) => c.close < support * 0.995)) continue
    const steadied = last2.some((c) => c.close >= c.open) || last2.every((c) => c.close >= support)
    if (!steadied) continue

    const rvol = avgVol > 0 ? bar.volume / avgVol : 0
    return {
      condition: 'breakout_pullback',
      label: '突破回踩',
      detail: `${bar.time.slice(0, 10)} 放量突破 ${pressureWindow} 日高 ${pressure.toFixed(2)}（RVOL=${rvol.toFixed(2)}），支撑≈${support.toFixed(2)}，其后未有效跌破并企稳`,
      metrics: {
        breakoutDate: bar.time.slice(0, 10),
        pressure: +pressure.toFixed(3),
        support: +support.toFixed(3),
        rvol: +rvol.toFixed(2),
        window: pressureWindow,
        lastClose: +daily[n - 1].close.toFixed(3),
      },
    }
  }
  return null
}

export function evaluateTechConditions(
  daily: Candle[],
  opts: {
    conditions: TechConditionId[]
    combine: TechCombineMode
    macdLookback?: number
    pressureWindow?: 20 | 60
  },
): TechHitEvidence[] {
  const sorted = sortCandles(daily)
  const hits: TechHitEvidence[] = []
  const set = new Set(opts.conditions)
  if (set.has('volume_wash')) {
    const h = checkVolumeWash(sorted)
    if (h) hits.push(h)
  }
  if (set.has('macd_golden')) {
    const h = checkMacdGolden(sorted, opts.macdLookback ?? 5)
    if (h) hits.push(h)
  }
  if (set.has('breakout_pullback')) {
    const h = checkBreakoutPullback(sorted, opts.pressureWindow ?? 20)
    if (h) hits.push(h)
  }
  if (opts.combine === 'all' && hits.length < opts.conditions.length) return []
  return hits
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) || 1 }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/**
 * 对候选列表按需拉 K 线并筛选。
 * fetchCandles 必须返回 source；source=mock 时不记为真实命中（可返回 dataStatus=mock 供 UI 提示）。
 */
export async function scanTechCandidates(
  candidates: ScreenerRow[],
  fetchCandles: (symbol: string, days: number) => Promise<CandleFetchResult>,
  opts: TechScanOptions,
): Promise<TechScanHit[]> {
  const conditions = opts.conditions.length ? opts.conditions : (['macd_golden'] as TechConditionId[])
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 6))
  const timeoutMs = opts.timeoutMs ?? 10000
  const days = Math.max(90, (opts.pressureWindow ?? 20) + 40)
  const hits: TechScanHit[] = []
  let done = 0

  await mapPool(candidates, concurrency, async (row) => {
    const cacheKey = `${row.symbol}:${days}`
    let result: CandleFetchResult | null = null
    const cached = candleCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      result = cached.result
    } else {
      try {
        result = await withTimeout(fetchCandles(row.symbol, days), timeoutMs, row.symbol)
        candleCache.set(cacheKey, { ts: Date.now(), result })
      } catch (e) {
        done += 1
        opts.onProgress?.({ done, total: candidates.length, hits: hits.length, current: row.symbol })
        hits.push({
          symbol: row.symbol,
          name: row.name,
          market: row.market,
          price: row.price,
          changePercent: row.changePercent,
          dataStatus: 'error',
          hits: [],
          candleCount: 0,
          lastBarDate: '',
          error: e instanceof Error ? e.message : 'K线失败',
        })
        // 错误行不计入「命中」列表——下面会过滤；这里先不 push 到最终，改用旁路
        hits.pop()
        return
      }
    }

    done += 1
    const candles = sortCandles(result!.candles)
    const lastBarDate = candles.length ? candles[candles.length - 1].time.slice(0, 10) : ''

    if (result!.source === 'mock') {
      opts.onProgress?.({ done, total: candidates.length, hits: hits.length, current: row.symbol })
      // 示意数据：不算命中，但可在进度中体现；不加入 hits
      return
    }
    if (candles.length < 30) {
      opts.onProgress?.({ done, total: candidates.length, hits: hits.length, current: row.symbol })
      return
    }

    const ev = evaluateTechConditions(candles, {
      conditions,
      combine: opts.combine,
      macdLookback: opts.macdLookback,
      pressureWindow: opts.pressureWindow,
    })
    if (ev.length > 0) {
      hits.push({
        symbol: row.symbol,
        name: row.name,
        market: row.market,
        price: row.price,
        changePercent: row.changePercent,
        dataStatus: 'live',
        hits: ev,
        candleCount: candles.length,
        lastBarDate,
      })
    }
    opts.onProgress?.({ done, total: candidates.length, hits: hits.length, current: row.symbol })
  })

  return hits.sort((a, b) => b.hits.length - a.hits.length || b.changePercent - a.changePercent)
}

export function techConditionLabel(id: TechConditionId): string {
  if (id === 'volume_wash') return '量价洗盘'
  if (id === 'macd_golden') return 'MACD金叉'
  return '突破回踩'
}

/** 市场 Tab → 选股候选所用 */
export function marketTabOfRow(row: ScreenerRow): ScreenerMarketTab {
  if (row.market === 'HK') return 'HK'
  if (row.market === 'US') return 'US'
  return 'A'
}
