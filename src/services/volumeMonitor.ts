import type { Candle, WatchlistItem } from '../types'

export type RvolLevel = '爆量' | '放量' | '正常' | '缩量' | '极致缩量' | '—'

export interface VolumeStats {
  todayVolume: number | null
  avgVolume: number | null
  rvol: number | null
  vsYesterday: number | null
  lookbackUsed: number
}

export interface WatchlistVolumeRow {
  symbol: string
  name: string
  market: string
  tag: string
  price: number | null
  changePercent: number | null
  todayVolume: number | null
  avgVolume: number | null
  rvol: number | null
  vsYesterday: number | null
  level: RvolLevel
  error?: string
}

const DEFAULT_LOOKBACK = 20
const MIN_HISTORY = 5

/**
 * RVOL = 最新日线成交量 / 近 lookback 日均量（不含当日）。
 * 历史不足 lookback 时用可用历史；少于 5 根则 RVOL 为 null。
 */
export function computeVolumeStats(candles: Candle[], lookback = DEFAULT_LOOKBACK): VolumeStats {
  const lb = Math.max(1, Math.floor(lookback) || DEFAULT_LOOKBACK)
  if (!candles.length) {
    return { todayVolume: null, avgVolume: null, rvol: null, vsYesterday: null, lookbackUsed: 0 }
  }

  const sorted = [...candles].sort((a, b) => a.time.localeCompare(b.time))
  const last = sorted[sorted.length - 1]
  const todayVolume = Number.isFinite(last.volume) ? last.volume : null

  const history = sorted.slice(0, -1)
  const usable = history.filter((c) => Number.isFinite(c.volume) && c.volume >= 0)
  const lookbackUsed = Math.min(lb, usable.length)
  const window = usable.slice(-lookbackUsed)

  let avgVolume: number | null = null
  let rvol: number | null = null
  if (lookbackUsed >= MIN_HISTORY && todayVolume != null) {
    const sum = window.reduce((s, c) => s + c.volume, 0)
    avgVolume = sum / lookbackUsed
    if (avgVolume > 0) rvol = todayVolume / avgVolume
    else rvol = null
  } else if (lookbackUsed > 0) {
    const sum = window.reduce((s, c) => s + c.volume, 0)
    avgVolume = sum / lookbackUsed
  }

  let vsYesterday: number | null = null
  if (todayVolume != null && history.length > 0) {
    const yVol = history[history.length - 1].volume
    if (Number.isFinite(yVol) && yVol > 0) vsYesterday = todayVolume / yVol
  }

  return { todayVolume, avgVolume, rvol, vsYesterday, lookbackUsed }
}

export function classifyRvol(rvol: number | null): RvolLevel {
  if (rvol == null || !Number.isFinite(rvol)) return '—'
  if (rvol >= 3.5) return '爆量'
  if (rvol >= 1.5) return '放量'
  if (rvol >= 0.8) return '正常'
  if (rvol >= 0.5) return '缩量'
  return '极致缩量'
}

/** CSS class for RVOL level badge */
export function rvolLevelClass(level: RvolLevel): string {
  switch (level) {
    case '爆量':
      return 'rvol-surge'
    case '放量':
      return 'rvol-high'
    case '正常':
      return 'rvol-normal'
    case '缩量':
      return 'rvol-low'
    case '极致缩量':
      return 'rvol-dry'
    default:
      return 'rvol-na'
  }
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

export type FetchCandlesFn = (symbol: string, days: number, period: '1d') => Promise<Candle[]>

/**
 * 并发受限扫描自选日线，汇总 RVOL。
 * quotes 可选：用于现价/涨跌%/名称。
 */
export async function scanWatchlistVolume(
  items: Array<Pick<WatchlistItem, 'symbol' | 'name' | 'market' | 'tag'>>,
  fetchCandles: FetchCandlesFn,
  lookback = DEFAULT_LOOKBACK,
  quotes?: Record<string, { price?: number; changePercent?: number; name?: string; volume?: number }>,
  concurrency = 3,
): Promise<WatchlistVolumeRow[]> {
  const lb = Math.max(5, Math.floor(lookback) || DEFAULT_LOOKBACK)
  const days = lb + 5

  return mapPool(items, concurrency, async (item) => {
    const q = quotes?.[item.symbol]
    const base: WatchlistVolumeRow = {
      symbol: item.symbol,
      name: q?.name || item.name,
      market: item.market,
      tag: item.tag || '',
      price: q?.price != null && Number.isFinite(q.price) ? q.price : null,
      changePercent:
        q?.changePercent != null && Number.isFinite(q.changePercent) ? q.changePercent : null,
      todayVolume: null,
      avgVolume: null,
      rvol: null,
      vsYesterday: null,
      level: '—',
    }
    try {
      const candles = await fetchCandles(item.symbol, days, '1d')
      const stats = computeVolumeStats(candles, lb)
      return {
        ...base,
        todayVolume: stats.todayVolume,
        avgVolume: stats.avgVolume,
        rvol: stats.rvol,
        vsYesterday: stats.vsYesterday,
        level: classifyRvol(stats.rvol),
      }
    } catch (e) {
      return {
        ...base,
        error: e instanceof Error ? e.message : '拉取失败',
      }
    }
  })
}

/** 从扫描结果构建 rvolMap，供 evaluateAlerts 使用 */
export function buildRvolMap(rows: WatchlistVolumeRow[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const r of rows) {
    if (r.rvol != null && Number.isFinite(r.rvol)) map[r.symbol] = r.rvol
  }
  return map
}
