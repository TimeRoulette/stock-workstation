/**
 * 涨跌幅榜 — 东财公开 clist 接口（无密钥）
 * 优先 push2delay；DEV 走 Vite 代理；Pages 直连 + corsproxy 回退
 */
import type { Market, ProviderHealth } from '../types'
import { normalizeSymbol } from './quotes'

export type ScreenerMarketTab = 'A' | 'HK' | 'US'
export type ScreenerSort = 'gainers' | 'losers'

export interface ScreenerRow {
  rank: number
  symbol: string
  name: string
  market: Market
  price: number
  changePercent: number
  volume: number
  amount: number
}

export interface ScreenerResult {
  rows: ScreenerRow[]
  market: ScreenerMarketTab
  sort: ScreenerSort
  source: 'eastmoney' | 'mock'
  delayed: true
  asOf: string
  total: number
  error?: string
}

const TIMEOUT_MS = 8000
const PAGE_SIZE = 50

/** A 股：深主板/创业板 + 沪主板/科创板 */
const FS_A = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
/** 港股主板等（东财 m:128） */
const FS_HK = 'm:128+t:3,m:128+t:4,m:128+t:1,m:128+t:2'
/** 美股（纳斯达克/纽交所等） */
const FS_US = 'm:105,m:106,m:107'

const FIELDS = 'f12,f13,f14,f2,f3,f5,f6'

type HealthInternal = {
  status: ProviderHealth['status']
  latencyMs: number | null
  lastOkAt: string | null
  lastError: string | null
  message: string
}

const screenerHealth: HealthInternal = {
  status: 'unknown',
  latencyMs: null,
  lastOkAt: null,
  lastError: null,
  message: '尚未探测',
}

export function getScreenerHealth(): ProviderHealth {
  return {
    id: 'screener',
    label: '选股 · 涨跌幅榜',
    ...screenerHealth,
  }
}

function markScreener(ok: boolean, latencyMs: number, err?: string) {
  screenerHealth.latencyMs = latencyMs
  if (ok) {
    screenerHealth.status = latencyMs > 5000 ? 'degraded' : 'ok'
    screenerHealth.lastOkAt = new Date().toISOString()
    screenerHealth.lastError = null
    screenerHealth.message = `东财公开榜 · ${latencyMs}ms`
  } else {
    screenerHealth.status = 'down'
    screenerHealth.lastError = err || '失败'
    screenerHealth.message = err || '请求失败'
  }
}

function isElectronRuntime(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      (window as Window & { stockWorkstation?: { isElectron?: boolean } }).stockWorkstation?.isElectron,
  )
}

/** DEV 代理 + 直连 delay/push2 + corsproxy */
function screenerCandidateUrls(apiPath: string): string[] {
  const absDelay = `https://push2delay.eastmoney.com${apiPath}`
  const absPush2 = `https://push2.eastmoney.com${apiPath}`
  if (import.meta.env.DEV) {
    return [`/api/eastmoney-delay${apiPath}`, `/api/eastmoney${apiPath}`]
  }
  if (isElectronRuntime()) {
    return [absDelay, absPush2]
  }
  return [
    absDelay,
    absPush2,
    `https://corsproxy.io/?${encodeURIComponent(absDelay)}`,
    `https://corsproxy.io/?${encodeURIComponent(absPush2)}`,
  ]
}

async function fetchWithTimeout(url: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`超时 ${timeoutMs}ms`)
    }
    throw e instanceof Error ? e : new Error('请求失败')
  }
}

async function fetchFirstOk(urls: string[]): Promise<Response> {
  let lastErr: unknown
  for (const url of urls) {
    try {
      return await fetchWithTimeout(url)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('全部候选失败')
}

function fsFor(market: ScreenerMarketTab): string {
  if (market === 'HK') return FS_HK
  if (market === 'US') return FS_US
  return FS_A
}

function toSymbol(code: string, f13: number | null, market: ScreenerMarketTab): { symbol: string; mkt: Market } {
  const c = String(code || '').trim()
  if (market === 'US') {
    const { symbol, market: m } = normalizeSymbol(c)
    return { symbol, mkt: m }
  }
  if (market === 'HK') {
    const { symbol, market: m } = normalizeSymbol(c.endsWith('.HK') ? c : `${c}.HK`)
    return { symbol, mkt: m }
  }
  // A 股：优先 f13（0 深 / 1 沪），否则按代码推断
  if (f13 === 1 || c.startsWith('6') || c.startsWith('9')) {
    return { symbol: `${c.padStart(6, '0')}.SH`, mkt: 'SH' }
  }
  return { symbol: `${c.padStart(6, '0')}.SZ`, mkt: 'SZ' }
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : NaN
}

function parseRows(
  diffs: Array<Record<string, unknown>>,
  market: ScreenerMarketTab,
): ScreenerRow[] {
  const out: ScreenerRow[] = []
  let rank = 0
  for (const row of diffs) {
    const code = String(row.f12 || '')
    if (!code) continue
    const price = num(row.f2)
    const changePercent = num(row.f3)
    if (!Number.isFinite(price) || !Number.isFinite(changePercent)) continue
    const f13Raw = num(row.f13)
    const f13 = Number.isFinite(f13Raw) ? f13Raw : null
    const { symbol, mkt } = toSymbol(code, f13, market)
    rank += 1
    out.push({
      rank,
      symbol,
      name: String(row.f14 || code),
      market: mkt,
      price,
      changePercent,
      volume: Number.isFinite(num(row.f5)) ? num(row.f5) : 0,
      amount: Number.isFinite(num(row.f6)) ? num(row.f6) : 0,
    })
  }
  return out
}

/** 公开榜拉取失败时的示意数据（仅学习用） */
function mockRank(market: ScreenerMarketTab, sort: ScreenerSort): ScreenerRow[] {
  const seedA: Array<{ code: string; name: string; price: number; pct: number }> = [
    { code: '300750', name: '宁德时代', price: 198.5, pct: 5.82 },
    { code: '600519', name: '贵州茅台', price: 1680, pct: 2.15 },
    { code: '000858', name: '五粮液', price: 140.2, pct: 1.88 },
    { code: '601318', name: '中国平安', price: 48.6, pct: -0.92 },
    { code: '000001', name: '平安银行', price: 11.35, pct: -1.45 },
    { code: '002594', name: '比亚迪', price: 265, pct: 3.4 },
    { code: '688981', name: '中芯国际', price: 48.2, pct: 4.1 },
    { code: '301716', name: '示意新股', price: 32.1, pct: 12.5 },
  ]
  const seedHk = [
    { code: '00700', name: '腾讯控股', price: 380, pct: 2.1 },
    { code: '09988', name: '阿里巴巴-SW', price: 90, pct: -1.2 },
    { code: '03690', name: '美团-W', price: 120, pct: 1.5 },
  ]
  const seedUs = [
    { code: 'AAPL', name: '苹果', price: 220, pct: 1.2 },
    { code: 'NVDA', name: '英伟达', price: 120, pct: 3.5 },
    { code: 'TSLA', name: '特斯拉', price: 250, pct: -2.1 },
  ]
  const seed = market === 'HK' ? seedHk : market === 'US' ? seedUs : seedA
  const sorted = [...seed].sort((a, b) => (sort === 'gainers' ? b.pct - a.pct : a.pct - b.pct))
  return sorted.map((s, i) => {
    const f13 = s.code.startsWith('6') ? 1 : 0
    const { symbol, mkt } = toSymbol(s.code, f13, market)
    return {
      rank: i + 1,
      symbol,
      name: s.name,
      market: mkt,
      price: s.price,
      changePercent: s.pct,
      volume: 1_000_000 * (i + 1),
      amount: s.price * 1_000_000 * (i + 1),
    }
  })
}

export async function fetchChangeRank(
  market: ScreenerMarketTab = 'A',
  sort: ScreenerSort = 'gainers',
  limit = PAGE_SIZE,
): Promise<ScreenerResult> {
  const po = sort === 'gainers' ? 1 : 0
  const fs = encodeURIComponent(fsFor(market))
  const pz = Math.min(Math.max(limit, 10), 100)
  const apiPath =
    `/api/qt/clist/get?pn=1&pz=${pz}&po=${po}&np=1` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2` +
    `&fid=f3&fs=${fs}&fields=${FIELDS}`

  const t0 = performance.now()
  try {
    const res = await fetchFirstOk(screenerCandidateUrls(apiPath))
    const json = await res.json()
    const diffs: Array<Record<string, unknown>> = json?.data?.diff || []
    if (!Array.isArray(diffs) || diffs.length === 0) {
      throw new Error('榜单为空')
    }
    const rows = parseRows(diffs, market)
    if (rows.length === 0) throw new Error('解析无有效行')
    const latency = Math.round(performance.now() - t0)
    markScreener(true, latency)
    return {
      rows,
      market,
      sort,
      source: 'eastmoney',
      delayed: true,
      asOf: new Date().toISOString(),
      total: Number(json?.data?.total) || rows.length,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '拉取失败'
    markScreener(false, Math.round(performance.now() - t0), msg)
    return {
      rows: mockRank(market, sort),
      market,
      sort,
      source: 'mock',
      delayed: true,
      asOf: new Date().toISOString(),
      total: 0,
      error: `东财公开榜暂不可用（${msg}），已回退示意数据，仅供学习`,
    }
  }
}

/** 轻量探测：拉 3 条 A 股涨幅 */
export async function probeScreener(): Promise<ProviderHealth> {
  const r = await fetchChangeRank('A', 'gainers', 3)
  if (r.source === 'mock' && r.error) {
    /* already marked down */
  }
  return getScreenerHealth()
}
