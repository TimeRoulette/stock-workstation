import type {
  BriefItem,
  Candle,
  ChartPeriod,
  Market,
  ProviderHealth,
  Quote,
  QuoteProvider,
  QuoteProviderMode,
  QuoteSource,
} from '../types'
import * as db from './db'

/** 内部统一代码：600519.SH / 000001.SZ / 00700.HK / AAPL */
export function normalizeSymbol(raw: string): { symbol: string; market: Market } {
  let s = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!s) return { symbol: '', market: 'US' }

  const prefix = s.match(/^(SH|SZ|HK)(\d{1,6})$/)
  if (prefix) {
    const m = prefix[1] as Market
    const code = prefix[2]
    if (m === 'HK') return { symbol: `${code.padStart(5, '0')}.HK`, market: 'HK' }
    return { symbol: `${code.padStart(6, '0')}.${m}`, market: m }
  }

  if (s.endsWith('.SH') || s.endsWith('.SS')) {
    const code = s.replace(/\.(SH|SS)$/, '').padStart(6, '0')
    return { symbol: `${code}.SH`, market: 'SH' }
  }
  if (s.endsWith('.SZ')) {
    const code = s.replace(/\.SZ$/, '').padStart(6, '0')
    return { symbol: `${code}.SZ`, market: 'SZ' }
  }
  if (s.endsWith('.HK')) {
    const code = s.replace(/\.HK$/, '').replace(/^0+/, '') || '0'
    return { symbol: `${code.padStart(5, '0')}.HK`, market: 'HK' }
  }

  if (/^\d{6}$/.test(s)) {
    if (s.startsWith('6') || s.startsWith('9')) return { symbol: `${s}.SH`, market: 'SH' }
    return { symbol: `${s}.SZ`, market: 'SZ' }
  }

  if (/^\d{4,5}$/.test(s)) {
    return { symbol: `${s.padStart(5, '0')}.HK`, market: 'HK' }
  }

  return { symbol: s, market: 'US' }
}

export function toYahooSymbol(symbol: string): string {
  const { symbol: s, market } = normalizeSymbol(symbol)
  if (market === 'SH') return s.replace('.SH', '.SS')
  if (market === 'SZ') return s
  if (market === 'HK') {
    const code = s.replace('.HK', '').replace(/^0+/, '') || '0'
    return `${code.padStart(4, '0')}.HK`
  }
  return s
}

export function toEastmoneySecid(symbol: string): string | null {
  const { symbol: s, market } = normalizeSymbol(symbol)
  if (market === 'SH') return `1.${s.replace('.SH', '')}`
  if (market === 'SZ') return `0.${s.replace('.SZ', '')}`
  if (market === 'HK') {
    const code = s.replace('.HK', '').replace(/^0+/, '') || '0'
    return `116.${code.padStart(5, '0')}`
  }
  return null
}

export function toSinaListCode(symbol: string): string | null {
  const { symbol: s, market } = normalizeSymbol(symbol)
  if (market === 'SH') return `sh${s.replace('.SH', '')}`
  if (market === 'SZ') return `sz${s.replace('.SZ', '')}`
  if (market === 'HK') {
    const code = s.replace('.HK', '').replace(/^0+/, '') || '0'
    return `rt_hk${code.padStart(5, '0')}`
  }
  return null
}

export function detectMarket(symbol: string): Market {
  return normalizeSymbol(symbol).market
}

export function currencyFor(symbol: string): string {
  const m = detectMarket(symbol)
  if (m === 'HK') return 'HKD'
  if (m === 'US') return 'USD'
  return 'CNY'
}

export function lotSize(symbol: string): number {
  const m = detectMarket(symbol)
  return m === 'SH' || m === 'SZ' ? 100 : 1
}

export function sourceBadgeLabel(source: QuoteSource): string {
  switch (source) {
    case 'eastmoney':
      return '东财'
    case 'sina':
      return '新浪'
    case 'yahoo':
      return 'Yahoo'
    case 'cache':
      return '缓存'
    default:
      return '模拟'
  }
}

/** 简单 FX 提示（非实时汇率，仅展示用） */
export const FX_HINT: Record<string, { vsCny: number; note: string }> = {
  CNY: { vsCny: 1, note: '记账本位币' },
  HKD: { vsCny: 0.92, note: '示意汇率 ≈0.92，非实时' },
  USD: { vsCny: 7.2, note: '示意汇率 ≈7.2，非实时' },
}

export function toCnyHint(amount: number, currency: string): string {
  const fx = FX_HINT[currency] || FX_HINT.CNY
  if (currency === 'CNY') return ''
  return `≈¥${(amount * fx.vsCny).toFixed(0)}（${fx.note}）`
}

const BASE_PRICES: Record<string, { price: number; name: string }> = {
  '600519.SH': { price: 1680, name: '贵州茅台' },
  '000001.SZ': { price: 11.5, name: '平安银行' },
  '00700.HK': { price: 380, name: '腾讯控股' },
  AAPL: { price: 220, name: '苹果' },
  TSLA: { price: 250, name: '特斯拉' },
  BABA: { price: 90, name: '阿里巴巴' },
  MSFT: { price: 420, name: '微软' },
  NVDA: { price: 120, name: '英伟达' },
  '000858.SZ': { price: 140, name: '五粮液' },
  '601318.SH': { price: 48, name: '中国平安' },
}

function seededRandom(seed: string): () => number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return () => {
    h = (Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) | 0
    return ((h >>> 0) % 10000) / 10000
  }
}

function baseFor(symbol: string) {
  const key = normalizeSymbol(symbol).symbol
  if (BASE_PRICES[key]) return BASE_PRICES[key]
  const rnd = seededRandom(key)
  return { price: 50 + rnd() * 200, name: key }
}

function mockQuote(symbol: string, now = Date.now()): Quote {
  const norm = normalizeSymbol(symbol).symbol
  const base = baseFor(norm)
  const rnd = seededRandom(norm + Math.floor(now / 60_000))
  const walk = (rnd() - 0.48) * 0.02
  const price = +(base.price * (1 + walk)).toFixed(4)
  const prevClose = +base.price.toFixed(4)
  const change = +(price - prevClose).toFixed(4)
  const changePercent = +((change / prevClose) * 100).toFixed(2)
  const open = +(prevClose * (1 + (rnd() - 0.5) * 0.01)).toFixed(4)
  const high = +Math.max(price, open, prevClose).toFixed(4)
  const low = +Math.min(price, open, prevClose * 0.99).toFixed(4)
  return {
    symbol: norm,
    name: base.name,
    price,
    change,
    changePercent,
    open,
    high,
    low,
    prevClose,
    volume: Math.floor(1_000_000 + rnd() * 9_000_000),
    currency: currencyFor(norm),
    asOf: new Date(now).toISOString(),
    delayed: true,
    source: 'mock',
  }
}

function mockCandles(symbol: string, days = 90, period: ChartPeriod = '1d'): Candle[] {
  const norm = normalizeSymbol(symbol).symbol
  const base = baseFor(norm)
  const rnd = seededRandom(norm + '-candles-' + period)
  let price = base.price * (0.85 + rnd() * 0.1)
  const out: Candle[] = []
  const today = new Date()

  if (period === '1m' || period === '5m') {
    const step = period === '1m' ? 1 : 5
    const bars = period === '1m' ? 240 : 78
    for (let i = bars - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setMinutes(d.getMinutes() - i * step)
      const open = price
      const ret = (rnd() - 0.48) * 0.004
      const close = +(open * (1 + ret)).toFixed(4)
      const high = +Math.max(open, close) * (1 + rnd() * 0.002)
      const low = +Math.min(open, close) * (1 - rnd() * 0.002)
      const pad = (n: number) => String(n).padStart(2, '0')
      const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
      out.push({
        time,
        open: +open.toFixed(4),
        high: +high.toFixed(4),
        low: +low.toFixed(4),
        close,
        volume: Math.floor(10_000 + rnd() * 90_000),
      })
      price = close
    }
    return out
  }

  const span = period === '1w' ? days * 5 : period === '1M' ? days * 22 : days
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    if (d.getDay() === 0 || d.getDay() === 6) continue
    const open = price
    const ret = (rnd() - 0.48) * 0.03
    const close = +(open * (1 + ret)).toFixed(4)
    const high = +Math.max(open, close) * (1 + rnd() * 0.01)
    const low = +Math.min(open, close) * (1 - rnd() * 0.01)
    out.push({
      time: d.toISOString().slice(0, 10),
      open: +open.toFixed(4),
      high: +high.toFixed(4),
      low: +low.toFixed(4),
      close,
      volume: Math.floor(500_000 + rnd() * 5_000_000),
    })
    price = close
  }
  if (period === '1w') return aggregateCandles(out, 'week')
  if (period === '1M') return aggregateCandles(out, 'month')
  return out
}

function aggregateCandles(daily: Candle[], mode: 'week' | 'month'): Candle[] {
  const buckets = new Map<string, Candle>()
  for (const c of daily) {
    const d = new Date(c.time)
    let key: string
    if (mode === 'week') {
      const day = d.getDay() || 7
      const monday = new Date(d)
      monday.setDate(d.getDate() - day + 1)
      key = monday.toISOString().slice(0, 10)
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    }
    const prev = buckets.get(key)
    if (!prev) {
      buckets.set(key, { ...c, time: key })
    } else {
      buckets.set(key, {
        time: key,
        open: prev.open,
        high: Math.max(prev.high, c.high),
        low: Math.min(prev.low, c.low),
        close: c.close,
        volume: prev.volume + c.volume,
      })
    }
  }
  return [...buckets.values()].sort((a, b) => a.time.localeCompare(b.time))
}

export const mockProvider: QuoteProvider = {
  id: 'mock',
  label: '本地模拟',
  async fetchQuotes(symbols) {
    return symbols.map((s) => mockQuote(s))
  },
  async fetchCandles(symbol, days = 90, period = '1d') {
    return mockCandles(symbol, days, period)
  },
}

/* ---------- fetch helpers: retry + timeout ---------- */

async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { retries?: number; timeoutMs?: number; label?: string } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2
  const timeoutMs = opts.timeoutMs ?? 8000
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    } catch (e) {
      clearTimeout(timer)
      lastErr = e
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${opts.label || 'fetch'} 失败`)
}

/* ---------- Static hosting / CORS (GitHub Pages has no Vite proxy) ---------- */

function isElectronRuntime(): boolean {
  return Boolean(typeof window !== 'undefined' && (window as Window & { stockWorkstation?: { isElectron?: boolean } }).stockWorkstation?.isElectron)
}

/**
 * Build candidate URLs for a quote API call.
 * - DEV: Vite `/api/*` proxies (reliable).
 * - Electron: direct HTTPS (no browser CORS).
 * - Static Pages / plain browser: try direct, then a public CORS relay (best-effort;
 *   providers still fall through to SQLite cache → mock).
 */
function quoteCandidateUrls(devProxyUrl: string, absoluteUrl: string): string[] {
  if (import.meta.env.DEV) return [devProxyUrl]
  if (isElectronRuntime()) return [absoluteUrl]
  return [
    absoluteUrl,
    // Public CORS relay — rate-limited / may change; not a hard dependency
    `https://corsproxy.io/?${encodeURIComponent(absoluteUrl)}`,
  ]
}

async function fetchFirstOk(
  urls: string[],
  init: RequestInit = {},
  opts: { retries?: number; timeoutMs?: number; label?: string } = {},
): Promise<Response> {
  let lastErr: unknown
  for (const url of urls) {
    try {
      return await fetchWithRetry(url, init, { ...opts, retries: opts.retries ?? 1 })
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${opts.label || 'fetch'} 失败`)
}

/* ---------- Provider health ---------- */

type HealthInternal = {
  status: ProviderHealth['status']
  latencyMs: number | null
  lastOkAt: string | null
  lastError: string | null
  message: string
}

const healthMap: Record<string, HealthInternal> = {
  eastmoney: { status: 'unknown', latencyMs: null, lastOkAt: null, lastError: null, message: '尚未探测' },
  sina: { status: 'unknown', latencyMs: null, lastOkAt: null, lastError: null, message: '尚未探测' },
  yahoo: { status: 'unknown', latencyMs: null, lastOkAt: null, lastError: null, message: '尚未探测' },
  mock: { status: 'ok', latencyMs: 0, lastOkAt: new Date().toISOString(), lastError: null, message: '本地始终可用' },
  cache: { status: 'unknown', latencyMs: null, lastOkAt: null, lastError: null, message: '取决于是否有缓存' },
}

function markHealth(id: string, ok: boolean, latencyMs: number, err?: string) {
  const h = healthMap[id]
  if (!h) return
  h.latencyMs = latencyMs
  if (ok) {
    h.status = latencyMs > 5000 ? 'degraded' : 'ok'
    h.lastOkAt = new Date().toISOString()
    h.lastError = null
    h.message = ok ? `正常 · ${latencyMs}ms` : h.message
  } else {
    h.status = 'down'
    h.lastError = err || '失败'
    h.message = err || '请求失败'
  }
}

export function getProviderHealth(): ProviderHealth[] {
  const labels: Record<string, string> = {
    eastmoney: '东方财富',
    sina: '新浪财经',
    yahoo: 'Yahoo Finance',
    mock: '本地模拟',
    cache: 'SQLite 缓存',
  }
  return Object.keys(labels).map((id) => ({
    id,
    label: labels[id],
    ...healthMap[id],
  }))
}

function yahooChartUrls(yahooSymbol: string, range: string, interval: string): string[] {
  const path = `/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=${interval}`
  return quoteCandidateUrls(`/api/yahoo${path}`, `https://query1.finance.yahoo.com${path}`)
}

async function fetchYahooChart(yahooSymbol: string, range = '3mo', interval = '1d') {
  const urls = yahooChartUrls(yahooSymbol, range, interval)
  const t0 = performance.now()
  try {
    const res = await fetchFirstOk(urls, { headers: { Accept: 'application/json' } }, { label: 'Yahoo', retries: 1 })
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) throw new Error('Yahoo 无数据')
    markHealth('yahoo', true, Math.round(performance.now() - t0))
    return result
  } catch (e) {
    markHealth('yahoo', false, Math.round(performance.now() - t0), e instanceof Error ? e.message : 'Yahoo 失败')
    throw e
  }
}

async function fetchOneYahooQuote(symbol: string): Promise<Quote> {
  const norm = normalizeSymbol(symbol).symbol
  const y = toYahooSymbol(norm)
  const result = await fetchYahooChart(y, '5d', '1d')
  const meta = result.meta
  const price = Number(meta.regularMarketPrice ?? meta.previousClose)
  if (!Number.isFinite(price) || price <= 0) throw new Error('Yahoo 无效价格')
  const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? price)
  const change = price - prevClose
  const changePercent = prevClose ? (change / prevClose) * 100 : 0
  return {
    symbol: norm,
    name: BASE_PRICES[norm]?.name || norm,
    price: +price.toFixed(4),
    change: +change.toFixed(4),
    changePercent: +changePercent.toFixed(2),
    open: Number(meta.regularMarketOpen ?? price),
    high: Number(meta.regularMarketDayHigh ?? price),
    low: Number(meta.regularMarketDayLow ?? price),
    prevClose: +prevClose.toFixed(4),
    volume: Number(meta.regularMarketVolume ?? 0),
    currency: meta.currency || currencyFor(norm),
    asOf: new Date((meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
    delayed: true,
    source: 'yahoo',
  }
}

export const yahooProvider: QuoteProvider = {
  id: 'yahoo',
  label: 'Yahoo Finance',
  async fetchQuotes(symbols) {
    const quotes = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          return await fetchOneYahooQuote(symbol)
        } catch {
          throw new Error(`Yahoo 失败: ${symbol}`)
        }
      }),
    )
    return quotes
  },
  async fetchCandles(symbol, days = 90, period = '1d') {
    const norm = normalizeSymbol(symbol).symbol
    const y = toYahooSymbol(norm)
    if (period === '1m' || period === '5m') {
      const interval = period === '1m' ? '1m' : '5m'
      const range = period === '1m' ? '1d' : '5d'
      const result = await fetchYahooChart(y, range, interval)
      const ts: number[] = result.timestamp || []
      const q = result.indicators?.quote?.[0] || {}
      const candles: Candle[] = []
      for (let i = 0; i < ts.length; i++) {
        if (q.open?.[i] == null || q.close?.[i] == null) continue
        const d = new Date(ts[i] * 1000)
        const pad = (n: number) => String(n).padStart(2, '0')
        candles.push({
          time: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
          open: +Number(q.open[i]).toFixed(4),
          high: +Number(q.high[i]).toFixed(4),
          low: +Number(q.low[i]).toFixed(4),
          close: +Number(q.close[i]).toFixed(4),
          volume: Number(q.volume?.[i] ?? 0),
        })
      }
      if (candles.length === 0) throw new Error('Yahoo 分钟线为空')
      return candles
    }
    const range = days <= 30 ? '1mo' : days <= 90 ? '3mo' : '1y'
    const result = await fetchYahooChart(y, range, '1d')
    const ts: number[] = result.timestamp || []
    const q = result.indicators?.quote?.[0] || {}
    const candles: Candle[] = []
    for (let i = 0; i < ts.length; i++) {
      if (q.open?.[i] == null || q.close?.[i] == null) continue
      candles.push({
        time: new Date(ts[i] * 1000).toISOString().slice(0, 10),
        open: +Number(q.open[i]).toFixed(4),
        high: +Number(q.high[i]).toFixed(4),
        low: +Number(q.low[i]).toFixed(4),
        close: +Number(q.close[i]).toFixed(4),
        volume: Number(q.volume?.[i] ?? 0),
      })
    }
    if (candles.length === 0) throw new Error('Yahoo K 线为空')
    if (period === '1w') return aggregateCandles(candles, 'week')
    if (period === '1M') return aggregateCandles(candles, 'month')
    return candles
  },
}

function eastmoneyUrls(path: string): string[] {
  return quoteCandidateUrls(`/api/eastmoney${path}`, `https://push2.eastmoney.com${path}`)
}

function eastmoneyHisUrls(path: string): string[] {
  return quoteCandidateUrls(`/api/eastmoney-his${path}`, `https://push2his.eastmoney.com${path}`)
}

async function fetchEastmoneyBatch(symbols: string[]): Promise<Quote[]> {
  const pairs = symbols
    .map((s) => {
      const norm = normalizeSymbol(s).symbol
      const secid = toEastmoneySecid(norm)
      return secid ? { norm, secid } : null
    })
    .filter(Boolean) as Array<{ norm: string; secid: string }>

  if (pairs.length === 0) return []

  const secids = pairs.map((p) => p.secid).join(',')
  const fields = 'f12,f14,f2,f3,f4,f5,f15,f16,f17,f18'
  const path = `/api/qt/ulist.np/get?fltt=2&invt=2&secids=${encodeURIComponent(secids)}&fields=${fields}`
  const t0 = performance.now()
  try {
    const res = await fetchFirstOk(
      eastmoneyUrls(path),
      { headers: { Accept: 'application/json' } },
      { label: '东财', retries: 1, timeoutMs: 9000 },
    )
    const json = await res.json()
    const diffs: Array<Record<string, unknown>> = json?.data?.diff || []
    if (!Array.isArray(diffs) || diffs.length === 0) throw new Error('东财无数据')

    const byCode = new Map<string, Record<string, unknown>>()
    for (const row of diffs) {
      const code = String(row.f12 || '')
      byCode.set(code, row)
    }

    const out: Quote[] = []
    for (const { norm, secid } of pairs) {
      const code = secid.split('.')[1]
      const row = byCode.get(code)
      if (!row) continue
      const price = Number(row.f2)
      if (!Number.isFinite(price) || price <= 0) continue
      const changePercent = Number(row.f3) || 0
      const change = Number(row.f4) || 0
      const volume = Number(row.f5) || 0
      const high = Number(row.f15) || price
      const low = Number(row.f16) || price
      const open = Number(row.f17) || price
      const prevClose = Number(row.f18) || price - change
      const name = String(row.f14 || BASE_PRICES[norm]?.name || norm)
      out.push({
        symbol: norm,
        name,
        price: +price.toFixed(4),
        change: +change.toFixed(4),
        changePercent: +changePercent.toFixed(2),
        open: +open.toFixed(4),
        high: +high.toFixed(4),
        low: +low.toFixed(4),
        prevClose: +prevClose.toFixed(4),
        volume,
        currency: currencyFor(norm),
        asOf: new Date().toISOString(),
        delayed: true,
        source: 'eastmoney',
      })
    }
    if (out.length === 0) throw new Error('东财解析为空')
    markHealth('eastmoney', true, Math.round(performance.now() - t0))
    return out
  } catch (e) {
    markHealth('eastmoney', false, Math.round(performance.now() - t0), e instanceof Error ? e.message : '东财失败')
    throw e
  }
}

function eastmoneyKlt(period: ChartPeriod): number {
  switch (period) {
    case '1m':
      return 1
    case '5m':
      return 5
    case '1w':
      return 102
    case '1M':
      return 103
    case '1d':
    default:
      return 101
  }
}

async function fetchEastmoneyCandles(symbol: string, days = 90, period: ChartPeriod = '1d'): Promise<Candle[]> {
  const norm = normalizeSymbol(symbol).symbol
  const secid = toEastmoneySecid(norm)
  if (!secid) throw new Error('东财不支持该市场 K 线')
  const klt = eastmoneyKlt(period)
  const lmt = period === '1m' ? 240 : period === '5m' ? 120 : days
  const path =
    `/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}` +
    `&klt=${klt}&fqt=1&lmt=${lmt}&end=20500101` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58`
  const t0 = performance.now()
  try {
    const res = await fetchFirstOk(
      eastmoneyHisUrls(path),
      { headers: { Accept: 'application/json' } },
      { label: '东财K线', retries: 1 },
    )
    const json = await res.json()
    const klines: string[] = json?.data?.klines || []
    if (!Array.isArray(klines) || klines.length === 0) throw new Error('东财 K 线为空')
    markHealth('eastmoney', true, Math.round(performance.now() - t0))
    return klines.map((line) => {
      const [timeRaw, open, close, high, low, volume] = line.split(',')
      // 分钟线时间形如 2024-01-02 09:31
      const time = timeRaw.includes(' ') ? timeRaw.replace(' ', 'T').slice(0, 16) : timeRaw.slice(0, 10)
      return {
        time,
        open: +Number(open).toFixed(4),
        high: +Number(high).toFixed(4),
        low: +Number(low).toFixed(4),
        close: +Number(close).toFixed(4),
        volume: Number(volume) || 0,
      }
    })
  } catch (e) {
    markHealth('eastmoney', false, Math.round(performance.now() - t0), e instanceof Error ? e.message : '东财K线失败')
    throw e
  }
}

export const eastmoneyProvider: QuoteProvider = {
  id: 'eastmoney',
  label: '东方财富',
  async fetchQuotes(symbols) {
    const aShareLike = symbols.filter((s) => toEastmoneySecid(s))
    if (aShareLike.length === 0) throw new Error('东财无适用标的')
    const quotes = await fetchEastmoneyBatch(aShareLike)
    const got = new Set(quotes.map((q) => q.symbol))
    const missing = aShareLike.filter((s) => !got.has(normalizeSymbol(s).symbol))
    if (missing.length === aShareLike.length) throw new Error('东财全部失败')
    return quotes
  },
  async fetchCandles(symbol, days = 90, period = '1d') {
    return fetchEastmoneyCandles(symbol, days, period)
  },
}

function quoteFromCache(symbol: string): Quote | null {
  try {
    const cached = db.getCachedQuote(normalizeSymbol(symbol).symbol)
    if (!cached) return null
    healthMap.cache.status = 'ok'
    healthMap.cache.lastOkAt = new Date().toISOString()
    healthMap.cache.message = '已命中离线最后报价'
    return { ...cached, source: 'cache' as QuoteSource }
  } catch {
    return null
  }
}

function persistQuotes(quotes: Quote[]) {
  for (const q of quotes) {
    if (q.source === 'mock' || q.source === 'cache') continue
    try {
      db.cacheQuote(q)
    } catch {
      /* ignore */
    }
  }
}

function sinaUrls(list: string): string[] {
  const path = `/list=${encodeURIComponent(list)}`
  return quoteCandidateUrls(`/api/sina${path}`, `https://hq.sinajs.cn${path}`)
}

async function fetchSinaQuotes(symbols: string[]): Promise<Quote[]> {
  const pairs = symbols
    .map((s) => {
      const norm = normalizeSymbol(s).symbol
      const code = toSinaListCode(norm)
      return code ? { norm, code } : null
    })
    .filter(Boolean) as Array<{ norm: string; code: string }>
  if (pairs.length === 0) throw new Error('新浪无适用标的')

  const list = pairs.map((p) => p.code).join(',')
  const t0 = performance.now()
  try {
    const res = await fetchFirstOk(
      sinaUrls(list),
      {},
      { label: '新浪', retries: 1, timeoutMs: 9000 },
    )
    const buf = await res.arrayBuffer()
    let body: string
    try {
      body = new TextDecoder('gb18030').decode(buf)
    } catch {
      body = new TextDecoder('utf-8').decode(buf)
    }

    const byCode = new Map<string, string[]>()
    for (const line of body.split('\n')) {
      const m = line.match(/hq_str_([^=]+)="([^"]*)"/)
      if (!m || !m[2]) continue
      byCode.set(m[1], m[2].split(','))
    }

    const out: Quote[] = []
    for (const { norm, code } of pairs) {
      const parts = byCode.get(code)
      if (!parts || parts.length < 10) continue
      const name = parts[0] || BASE_PRICES[norm]?.name || norm
      const open = Number(parts[1])
      const prevClose = Number(parts[2])
      const price = Number(parts[3])
      const high = Number(parts[4])
      const low = Number(parts[5])
      const volume = Number(parts[8]) || 0
      if (!Number.isFinite(price) || price <= 0) continue
      const change = price - (prevClose || price)
      const changePercent = prevClose ? (change / prevClose) * 100 : 0
      const date = parts[30] || ''
      const time = parts[31] || ''
      const asOf =
        date && time
          ? new Date(`${date.replace(/(\d{4})-(\d{2})-(\d{2})/, '$1-$2-$3')}T${time}+08:00`).toISOString()
          : new Date().toISOString()
      out.push({
        symbol: norm,
        name,
        price: +price.toFixed(4),
        change: +change.toFixed(4),
        changePercent: +changePercent.toFixed(2),
        open: +(open || price).toFixed(4),
        high: +(high || price).toFixed(4),
        low: +(low || price).toFixed(4),
        prevClose: +(prevClose || price).toFixed(4),
        volume,
        currency: currencyFor(norm),
        asOf: Number.isNaN(Date.parse(asOf)) ? new Date().toISOString() : asOf,
        delayed: true,
        source: 'sina',
      })
    }
    if (out.length === 0) throw new Error('新浪解析为空')
    markHealth('sina', true, Math.round(performance.now() - t0))
    return out
  } catch (e) {
    markHealth('sina', false, Math.round(performance.now() - t0), e instanceof Error ? e.message : '新浪失败')
    throw e
  }
}

export const sinaProvider: QuoteProvider = {
  id: 'sina',
  label: '新浪财经',
  async fetchQuotes(symbols) {
    return fetchSinaQuotes(symbols)
  },
  async fetchCandles(_symbol, _days = 90, _period = '1d') {
    throw new Error('新浪不提供 K 线')
  },
}

export class QuoteService {
  private mode: QuoteProviderMode = 'auto'

  setMode(mode: QuoteProviderMode) {
    this.mode = mode
  }

  getMode() {
    return this.mode
  }

  private chain(): QuoteProvider[] {
    const em = eastmoneyProvider
    const sn = sinaProvider
    const yh = yahooProvider
    const mk = mockProvider
    switch (this.mode) {
      case 'mock':
        return [mk]
      case 'yahoo':
        return [yh, sn, mk]
      case 'eastmoney':
        return [em, sn, yh, mk]
      case 'auto':
      default:
        return [em, sn, yh, mk]
    }
  }

  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return []
    const norms = symbols.map((s) => normalizeSymbol(s).symbol)
    const unique = [...new Set(norms)]
    const result = new Map<string, Quote>()

    for (const provider of this.chain()) {
      const pending = unique.filter((s) => !result.has(s))
      if (pending.length === 0) break
      if (provider.id === 'mock') {
        for (const s of pending) result.set(s, mockQuote(s))
        break
      }
      try {
        if (provider.id === 'yahoo') {
          await Promise.all(
            pending.map(async (s) => {
              try {
                const q = await fetchOneYahooQuote(s)
                result.set(s, q)
              } catch {
                /* next */
              }
            }),
          )
        } else if (provider.id === 'eastmoney') {
          try {
            const batch = await fetchEastmoneyBatch(pending.filter((s) => toEastmoneySecid(s)))
            batch.forEach((q) => result.set(q.symbol, q))
          } catch {
            /* next */
          }
        } else if (provider.id === 'sina') {
          try {
            const batch = await fetchSinaQuotes(pending.filter((s) => toSinaListCode(s)))
            batch.forEach((q) => result.set(q.symbol, q))
          } catch {
            /* next */
          }
        }
      } catch {
        /* next provider */
      }
    }

    for (const s of unique) {
      if (result.has(s)) continue
      const cached = quoteFromCache(s)
      if (cached) result.set(s, cached)
      else result.set(s, mockQuote(s))
    }

    const list = unique.map((s) => result.get(s)!)
    persistQuotes(list)
    return list
  }

  async fetchCandles(symbol: string, days = 90, period: ChartPeriod = '1d'): Promise<Candle[]> {
    const norm = normalizeSymbol(symbol).symbol
    for (const provider of this.chain()) {
      if (provider.id === 'mock') return mockCandles(norm, days, period)
      try {
        if (provider.id === 'eastmoney' && !toEastmoneySecid(norm)) continue
        if (provider.id === 'sina') continue
        const candles = await provider.fetchCandles(norm, days, period)
        if (candles.length > 0) return candles
      } catch {
        /* next */
      }
    }
    return mockCandles(norm, days, period)
  }

  async probeProviders(): Promise<ProviderHealth[]> {
    const sampleA = '600519.SH'
    const sampleUs = 'AAPL'
    const tasks: Array<Promise<void>> = [
      (async () => {
        try {
          await fetchEastmoneyBatch([sampleA])
        } catch {
          /* health already marked */
        }
      })(),
      (async () => {
        try {
          await fetchSinaQuotes([sampleA])
        } catch {
          /* */
        }
      })(),
      (async () => {
        try {
          await fetchOneYahooQuote(sampleUs)
        } catch {
          /* */
        }
      })(),
    ]
    await Promise.all(tasks)
    const cached = db.getCachedQuote(sampleA)
    const meta = db.getCachedQuoteMeta(sampleA)
    if (cached && meta) {
      const ageMin = Math.round((Date.now() - new Date(meta.updatedAt).getTime()) / 60000)
      healthMap.cache.status = ageMin <= 30 ? 'ok' : 'degraded'
      healthMap.cache.latencyMs = null
      healthMap.cache.lastOkAt = meta.updatedAt
      healthMap.cache.lastError = null
      healthMap.cache.message =
        ageMin <= 0 ? '有新鲜缓存' : `离线报价 · ${ageMin} 分钟前`
    } else {
      healthMap.cache.status = 'unknown'
      healthMap.cache.message = '暂无缓存（成功拉行情后写入）'
      healthMap.cache.lastOkAt = null
    }
    healthMap.mock.status = 'ok'
    healthMap.mock.latencyMs = 0
    healthMap.mock.lastOkAt = new Date().toISOString()
    healthMap.mock.message = '本地始终可用'
    // 汇总：若真源全挂，提示会用缓存/模拟
    const live = ['eastmoney', 'sina', 'yahoo']
    const allDown = live.every((id) => healthMap[id]?.status === 'down')
    if (allDown) {
      healthMap.cache.message += ' · 真源均不可用，将优先缓存/模拟'
    }
    return getProviderHealth()
  }

  async activeSourceLabel(): Promise<string> {
    const labels: Record<string, string> = {
      auto: '自动（东财 → 新浪 → Yahoo → 缓存 → 模拟）',
      eastmoney: '东方财富优先',
      yahoo: 'Yahoo 优先',
      mock: '本地模拟',
    }
    return labels[this.mode] || this.mode
  }
}

export const quoteService = new QuoteService()

export interface BriefProvider {
  id: string
  fetchBrief(
    watchSymbols?: string[],
    holdings?: Array<{ symbol: string; name: string; qty: number }>,
  ): Promise<BriefItem[]>
}

function sampleBrief(
  watchSymbols: string[] = [],
  holdings: Array<{ symbol: string; name: string; qty: number }> = [],
): BriefItem[] {
  const day = new Date().toISOString().slice(0, 10)
  const focus = watchSymbols.slice(0, 3)
  const focusLabel = focus.length ? focus.join('、') : '自选股'
  const holdSyms = holdings.slice(0, 5).map((h) => h.symbol)
  const holdLabel =
    holdings.length === 0
      ? ''
      : holdings
          .slice(0, 4)
          .map((h) => `${h.name || h.symbol}×${h.qty}`)
          .join('、') + (holdings.length > 4 ? '…' : '')
  const items: BriefItem[] = []
  if (holdings.length > 0) {
    items.push({
      id: 'hold-today',
      title: `模拟持仓速览：${holdings.length} 只`,
      summary: `当前纸上持仓：${holdLabel}。点代码可进「模拟」查看仓位；也可在盯盘看走势。`,
      source: '工作台 · 持仓',
      category: 'holding',
      publishedAt: day,
      symbols: holdSyms,
      jumpTo: 'portfolio',
    })
  }
  items.push(
    {
      id: 's1',
      title: `自选关注：${focusLabel} 隔夜要点`,
      summary:
        focus.length > 0
          ? `你的自选（${focusLabel}）今日可关注开盘缺口、成交量是否放大，以及板块联动。点击代码可回到盯盘。`
          : '添加自选后，这里会生成与自选相关的简报要点。',
      source: '工作台 · 自选',
      category: 'trend',
      publishedAt: day,
      symbols: focus,
      jumpTo: 'watchlist',
    },
    {
      id: 's2',
      title: '市场情绪偏谨慎，科技股分化',
      summary: '美股科技龙头走势分化；港股互联网板块波动加大。关注财报季指引变化与汇率波动。',
      source: '样例资讯',
      category: 'news',
      publishedAt: day,
      symbols: ['AAPL', '00700.HK', 'TSLA'],
    },
    {
      id: 's3',
      title: 'A 股消费龙头估值仍处历史中枢',
      summary: '以茅台为代表的白酒板块成交温和，短线或延续震荡，中长期看盈利稳定性。',
      source: '样例趋势',
      category: 'trend',
      publishedAt: day,
      symbols: ['600519.SH', '000858.SZ'],
    },
    {
      id: 's4',
      title: '学习提示：先定仓位再谈买卖',
      summary: '模拟盘建议单票仓位不超过总资产 20%，用复盘笔记写下买卖逻辑。价格提醒可帮你盯破位。',
      source: '工作台',
      category: 'tip',
      publishedAt: day,
    },
    {
      id: 's5',
      title: '港股通资金流向观察',
      summary: '南向资金近期对互联网与创新药偏好有所回升，注意汇率与节假日流动性。',
      source: '样例资讯',
      category: 'news',
      publishedAt: day,
      symbols: ['00700.HK'],
    },
    {
      id: 's6',
      title: '数据说明：行情回退链',
      summary:
        '默认优先东方财富，其次新浪，再 Yahoo，最后 SQLite 缓存/模拟。公开源常延迟；断网时显示上次好价。',
      source: '工作台',
      category: 'tip',
      publishedAt: day,
    },
  )
  return items
}

/** 尝试拉取东财财经快讯（失败则静默回退样例） */
async function tryFetchEastmoneyHeadlines(): Promise<BriefItem[]> {
  try {
    // 公开板块榜（尽力而为，失败回退样例）
    const newsPath =
      '/api/qt/clist/get?pn=1&pz=8&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f12,f14,f3,f62'
    const res = await fetchFirstOk(
      eastmoneyUrls(newsPath),
      { headers: { Accept: 'application/json' } },
      { retries: 0, timeoutMs: 6000, label: '东财快讯' },
    )
    const json = await res.json()
    const diffs: Array<Record<string, unknown>> = json?.data?.diff || []
    if (!Array.isArray(diffs) || diffs.length === 0) return []
    const day = new Date().toISOString().slice(0, 10)
    return diffs.slice(0, 6).map((row, i) => {
      const code = String(row.f12 || '')
      const name = String(row.f14 || code)
      const pct = Number(row.f3) || 0
      const symbol = code.length === 6 ? (code.startsWith('6') ? `${code}.SH` : `${code}.SZ`) : code
      return {
        id: `em-${i}-${code}`,
        title: `${name}（${code}）板块异动 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
        summary: `东财公开榜摘录：${name} 相关题材今日涨跌幅 ${pct.toFixed(2)}%。仅供参考，非投资建议。`,
        source: '东方财富 · 公开榜',
        category: 'news' as const,
        publishedAt: day,
        symbols: symbol.includes('.') ? [symbol] : undefined,
        url: undefined,
      }
    })
  } catch {
    return []
  }
}

export const sampleBriefProvider: BriefProvider = {
  id: 'sample+fetch',
  async fetchBrief(watchSymbols = [], holdings = []) {
    const remote = await tryFetchEastmoneyHeadlines()
    const sample = sampleBrief(watchSymbols, holdings)
    if (remote.length === 0) return sample
    // 持仓/自选样例置顶，再拼接远程头条
    const top = sample.filter((x) => x.category === 'holding' || x.id === 's1')
    const rest = sample.filter((x) => !(x.category === 'holding' || x.id === 's1'))
    return [...top, ...remote, ...rest]
  },
}

let briefProvider: BriefProvider = sampleBriefProvider

export function setBriefProvider(p: BriefProvider) {
  briefProvider = p
}

export function getBriefProvider() {
  return briefProvider
}

/** 检查价格提醒是否触发（尊重免打扰时段与稍后） */
export function evaluateAlerts(
  quotes: Record<string, Quote>,
): Array<{ alertId: number; message: string }> {
  const fired: Array<{ alertId: number; message: string }> = []
  try {
    if (db.isInMuteHours()) return fired
  } catch {
    /* */
  }
  let alerts
  try {
    alerts = db.listEnabledAlerts()
  } catch {
    return fired
  }
  const now = Date.now()
  for (const a of alerts) {
    if (a.snoozedUntil) {
      const until = new Date(a.snoozedUntil).getTime()
      if (Number.isFinite(until) && until > now) continue
    }
    const q = quotes[a.symbol]
    if (!q) continue
    let hit = false
    let detail = ''
    if (a.type === 'above' && q.price >= a.threshold) {
      hit = true
      detail = `现价 ${q.price} ≥ ${a.threshold}`
    } else if (a.type === 'below' && q.price <= a.threshold) {
      hit = true
      detail = `现价 ${q.price} ≤ ${a.threshold}`
    } else if (a.type === 'pct_change' && Math.abs(q.changePercent) >= Math.abs(a.threshold)) {
      hit = true
      detail = `涨跌幅 ${q.changePercent}%（阈值 ±${a.threshold}%）`
    }
    if (hit) {
      try {
        db.markAlertTriggered(a.id)
      } catch {
        /* */
      }
      fired.push({
        alertId: a.id,
        message: `提醒：${a.name || a.symbol} ${detail}`,
      })
    }
  }
  return fired
}
