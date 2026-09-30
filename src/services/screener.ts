/**
 * 涨跌幅榜 / 板块榜 — 东财公开 clist 接口（无密钥）
 * 优先 push2delay；DEV 走 Vite 代理；Pages 直连 + corsproxy 回退
 * 个股榜分页：pn/pz，默认每页 50，最多 4 页 = 前 200
 */
import { quoteCandidateUrls } from './quoteTransport'
import type { Market, ProviderHealth } from '../types'
import { normalizeSymbol } from './quotes'

export type ScreenerMarketTab = 'A' | 'HK' | 'US'
export type ScreenerSort = 'gainers' | 'losers'
export type BoardKind = 'industry' | 'concept'
export type ConstituentRole = 'leader' | 'mid' | null

export const SCREENER_PAGE_SIZE = 50
export const SCREENER_MAX_ROWS = 200
export const SCREENER_MAX_PAGES = Math.ceil(SCREENER_MAX_ROWS / SCREENER_PAGE_SIZE)

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
  page: number
  pageSize: number
  hasMore: boolean
  error?: string
}

export interface BoardRow {
  rank: number
  code: string
  name: string
  kind: BoardKind
  changePercent: number
  amount: number
  upCount: number
  downCount: number
  leadName: string
  leadPct: number
}

export interface BoardResult {
  rows: BoardRow[]
  kind: BoardKind
  sort: ScreenerSort
  source: 'eastmoney' | 'mock'
  delayed: true
  asOf: string
  total: number
  error?: string
}

export interface BoardConstituent extends ScreenerRow {
  role: ConstituentRole
}

export interface BoardDetailResult {
  board: BoardRow
  rows: BoardConstituent[]
  source: 'eastmoney' | 'mock'
  delayed: true
  asOf: string
  total: number
  error?: string
  /** 规则说明，供 UI 展示 */
  roleRules: string
}

export const LEADER_MID_RULES =
  '龙头：成分股按涨跌幅降序，在前 5 名中取成交额最大者。' +
  '中军：涨幅第 2–5 名中排除龙头后，取成交额最大者。二者皆为启发式标注，非投资建议。'

const TIMEOUT_MS = 8000

/** A 股：深主板/创业板 + 沪主板/科创板 */
const FS_A = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
/** 港股主板等（东财 m:128） */
const FS_HK = 'm:128+t:3,m:128+t:4,m:128+t:1,m:128+t:2'
/** 美股（纳斯达克/纽交所等） */
const FS_US = 'm:105,m:106,m:107'
/** 行业板块 */
const FS_INDUSTRY = 'm:90+t:2+f:!50'
/** 概念板块 */
const FS_CONCEPT = 'm:90+t:3+f:!50'

const FIELDS_STOCK = 'f12,f13,f14,f2,f3,f5,f6'
const FIELDS_BOARD = 'f12,f14,f3,f6,f104,f105,f128,f136'

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
    label: '选股 · 涨跌幅/板块榜',
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

/** DEV 代理 + 直连 delay/push2 + 公共中继（与行情同源策略） */
function screenerCandidateUrls(apiPath: string): string[] {
  const absDelay = `https://push2delay.eastmoney.com${apiPath}`
  const absPush2 = `https://push2.eastmoney.com${apiPath}`
  if (import.meta.env.DEV) {
    return [`/api/eastmoney-delay${apiPath}`, `/api/eastmoney${apiPath}`]
  }
  // 原生壳：只直连；浏览器：直连 + 用户代理 + allorigins/cors.eu.org
  const a = quoteCandidateUrls(`/api/eastmoney-delay${apiPath}`, absDelay)
  const b = quoteCandidateUrls(`/api/eastmoney${apiPath}`, absPush2)
  // 合并去重，delay 优先
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of [...a, ...b]) {
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
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

function fsForBoard(kind: BoardKind): string {
  return kind === 'concept' ? FS_CONCEPT : FS_INDUSTRY
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
  if (f13 === 1 || c.startsWith('6') || c.startsWith('9')) {
    return { symbol: `${c.padStart(6, '0')}.SH`, mkt: 'SH' }
  }
  return { symbol: `${c.padStart(6, '0')}.SZ`, mkt: 'SZ' }
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : NaN
}

function parseStockRows(
  diffs: Array<Record<string, unknown>>,
  market: ScreenerMarketTab,
  rankOffset = 0,
): ScreenerRow[] {
  const out: ScreenerRow[] = []
  let rank = rankOffset
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

function parseBoardRows(
  diffs: Array<Record<string, unknown>>,
  kind: BoardKind,
): BoardRow[] {
  const out: BoardRow[] = []
  let rank = 0
  for (const row of diffs) {
    const code = String(row.f12 || '')
    if (!code) continue
    const changePercent = num(row.f3)
    if (!Number.isFinite(changePercent)) continue
    rank += 1
    out.push({
      rank,
      code,
      name: String(row.f14 || code),
      kind,
      changePercent,
      amount: Number.isFinite(num(row.f6)) ? num(row.f6) : 0,
      upCount: Number.isFinite(num(row.f104)) ? num(row.f104) : 0,
      downCount: Number.isFinite(num(row.f105)) ? num(row.f105) : 0,
      leadName: String(row.f128 || ''),
      leadPct: Number.isFinite(num(row.f136)) ? num(row.f136) : NaN,
    })
  }
  return out
}

/** 公开榜拉取失败时的示意数据（仅学习用） */
function mockRank(market: ScreenerMarketTab, sort: ScreenerSort, page: number, pageSize: number): ScreenerRow[] {
  const seedA: Array<{ code: string; name: string; price: number; pct: number; amount: number }> = [
    { code: '300750', name: '宁德时代', price: 198.5, pct: 5.82, amount: 8e9 },
    { code: '600519', name: '贵州茅台', price: 1680, pct: 2.15, amount: 5e9 },
    { code: '000858', name: '五粮液', price: 140.2, pct: 1.88, amount: 3e9 },
    { code: '601318', name: '中国平安', price: 48.6, pct: -0.92, amount: 4e9 },
    { code: '000001', name: '平安银行', price: 11.35, pct: -1.45, amount: 2e9 },
    { code: '002594', name: '比亚迪', price: 265, pct: 3.4, amount: 7e9 },
    { code: '688981', name: '中芯国际', price: 48.2, pct: 4.1, amount: 6e9 },
    { code: '301716', name: '示意新股', price: 32.1, pct: 12.5, amount: 1.5e9 },
  ]
  const seedHk = [
    { code: '00700', name: '腾讯控股', price: 380, pct: 2.1, amount: 4e9 },
    { code: '09988', name: '阿里巴巴-SW', price: 90, pct: -1.2, amount: 3e9 },
    { code: '03690', name: '美团-W', price: 120, pct: 1.5, amount: 2e9 },
  ]
  const seedUs = [
    { code: 'AAPL', name: '苹果', price: 220, pct: 1.2, amount: 1e10 },
    { code: 'NVDA', name: '英伟达', price: 120, pct: 3.5, amount: 2e10 },
    { code: 'TSLA', name: '特斯拉', price: 250, pct: -2.1, amount: 8e9 },
  ]
  const seed = market === 'HK' ? seedHk : market === 'US' ? seedUs : seedA
  const sorted = [...seed].sort((a, b) => (sort === 'gainers' ? b.pct - a.pct : a.pct - b.pct))
  const start = (page - 1) * pageSize
  const slice = sorted.slice(start, start + pageSize)
  return slice.map((s, i) => {
    const f13 = s.code.startsWith('6') ? 1 : 0
    const { symbol, mkt } = toSymbol(s.code, f13, market)
    return {
      rank: start + i + 1,
      symbol,
      name: s.name,
      market: mkt,
      price: s.price,
      changePercent: s.pct,
      volume: 1_000_000 * (i + 1),
      amount: s.amount,
    }
  })
}

function mockBoards(kind: BoardKind, sort: ScreenerSort): BoardRow[] {
  const rows: BoardRow[] =
    kind === 'concept'
      ? [
          { rank: 1, code: 'BK0493', name: '新能源车（示意）', kind, changePercent: 3.2, amount: 5e10, upCount: 40, downCount: 10, leadName: '比亚迪', leadPct: 5.1 },
          { rank: 2, code: 'BK0896', name: '人工智能（示意）', kind, changePercent: 2.1, amount: 4e10, upCount: 55, downCount: 20, leadName: '科大讯飞', leadPct: 6.2 },
          { rank: 3, code: 'BK0816', name: '半导体（示意）', kind, changePercent: -1.4, amount: 6e10, upCount: 12, downCount: 60, leadName: '中芯国际', leadPct: 2.0 },
        ]
      : [
          { rank: 1, code: 'BK0477', name: '酿酒行业（示意）', kind, changePercent: 1.8, amount: 3e10, upCount: 15, downCount: 5, leadName: '贵州茅台', leadPct: 2.1 },
          { rank: 2, code: 'BK0475', name: '银行（示意）', kind, changePercent: -0.6, amount: 8e10, upCount: 8, downCount: 30, leadName: '招商银行', leadPct: 0.5 },
          { rank: 3, code: 'BK0481', name: '证券（示意）', kind, changePercent: 2.4, amount: 4e10, upCount: 20, downCount: 10, leadName: '中信证券', leadPct: 4.0 },
        ]
  return [...rows].sort((a, b) =>
    sort === 'gainers' ? b.changePercent - a.changePercent : a.changePercent - b.changePercent,
  ).map((r, i) => ({ ...r, rank: i + 1 }))
}

function mockConstituents(board: BoardRow): BoardConstituent[] {
  const base: ScreenerRow[] = [
    { rank: 1, symbol: '002594.SZ', name: '比亚迪', market: 'SZ', price: 265, changePercent: 5.1, volume: 2e7, amount: 9e9 },
    { rank: 2, symbol: '300750.SZ', name: '宁德时代', market: 'SZ', price: 198, changePercent: 4.2, volume: 1.5e7, amount: 8e9 },
    { rank: 3, symbol: '601012.SH', name: '隆基绿能', market: 'SH', price: 18, changePercent: 3.5, volume: 3e7, amount: 4e9 },
    { rank: 4, symbol: '002460.SZ', name: '赣锋锂业', market: 'SZ', price: 42, changePercent: 2.8, volume: 2e7, amount: 5e9 },
    { rank: 5, symbol: '300014.SZ', name: '亿纬锂能', market: 'SZ', price: 48, changePercent: 2.1, volume: 1e7, amount: 3e9 },
    { rank: 6, symbol: '600519.SH', name: '贵州茅台', market: 'SH', price: 1680, changePercent: 1.2, volume: 5e5, amount: 6e9 },
  ]
  void board
  return tagLeaderAndMid(base)
}

/**
 * 龙头 / 中军启发式标注
 * - 龙头：涨跌幅 Top5 中成交额最大
 * - 中军：涨幅第 2–5 名中排除龙头后成交额最大
 */
export function tagLeaderAndMid(rows: ScreenerRow[]): BoardConstituent[] {
  const sorted = [...rows].sort((a, b) => b.changePercent - a.changePercent)
  const top5 = sorted.slice(0, 5)
  let leaderSym: string | null = null
  if (top5.length > 0) {
    leaderSym = top5.reduce((best, r) => (r.amount > best.amount ? r : best)).symbol
  }
  const midPool = sorted.slice(1, 5).filter((r) => r.symbol !== leaderSym)
  let midSym: string | null = null
  if (midPool.length > 0) {
    midSym = midPool.reduce((best, r) => (r.amount > best.amount ? r : best)).symbol
  }
  return sorted.map((r, i) => ({
    ...r,
    rank: i + 1,
    role: r.symbol === leaderSym ? 'leader' : r.symbol === midSym ? 'mid' : null,
  }))
}

export async function fetchChangeRank(
  market: ScreenerMarketTab = 'A',
  sort: ScreenerSort = 'gainers',
  opts: { page?: number; pageSize?: number } | number = {},
): Promise<ScreenerResult> {
  // 兼容旧调用 fetchChangeRank(m, s, 50)
  const page =
    typeof opts === 'number' ? 1 : Math.min(Math.max(opts.page ?? 1, 1), SCREENER_MAX_PAGES)
  const pageSize =
    typeof opts === 'number'
      ? Math.min(Math.max(opts, 10), SCREENER_PAGE_SIZE)
      : Math.min(Math.max(opts.pageSize ?? SCREENER_PAGE_SIZE, 10), SCREENER_PAGE_SIZE)

  const po = sort === 'gainers' ? 1 : 0
  const fs = encodeURIComponent(fsFor(market))
  const apiPath =
    `/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=${po}&np=1` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2` +
    `&fid=f3&fs=${fs}&fields=${FIELDS_STOCK}`

  const t0 = performance.now()
  try {
    const res = await fetchFirstOk(screenerCandidateUrls(apiPath))
    const json = await res.json()
    const diffs: Array<Record<string, unknown>> = json?.data?.diff || []
    if (!Array.isArray(diffs) || diffs.length === 0) {
      throw new Error('榜单为空')
    }
    const rankOffset = (page - 1) * pageSize
    const rows = parseStockRows(diffs, market, rankOffset)
    if (rows.length === 0) throw new Error('解析无有效行')
    const total = Number(json?.data?.total) || rows.length
    const loadedEnd = rankOffset + rows.length
    const hasMore = page < SCREENER_MAX_PAGES && loadedEnd < Math.min(total, SCREENER_MAX_ROWS) && rows.length >= pageSize
    const latency = Math.round(performance.now() - t0)
    markScreener(true, latency)
    return {
      rows,
      market,
      sort,
      source: 'eastmoney',
      delayed: true,
      asOf: new Date().toISOString(),
      total,
      page,
      pageSize,
      hasMore,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '拉取失败'
    markScreener(false, Math.round(performance.now() - t0), msg)
    const rows = mockRank(market, sort, page, pageSize)
    return {
      rows,
      market,
      sort,
      source: 'mock',
      delayed: true,
      asOf: new Date().toISOString(),
      total: 0,
      page,
      pageSize,
      hasMore: false,
      error: `东财公开榜暂不可用（${msg}），已回退示意数据，仅供学习`,
    }
  }
}

export async function fetchBoardRank(
  kind: BoardKind = 'industry',
  sort: ScreenerSort = 'gainers',
  limit = 50,
): Promise<BoardResult> {
  const po = sort === 'gainers' ? 1 : 0
  const pz = Math.min(Math.max(limit, 10), 100)
  const fs = encodeURIComponent(fsForBoard(kind))
  const apiPath =
    `/api/qt/clist/get?pn=1&pz=${pz}&po=${po}&np=1` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2` +
    `&fid=f3&fs=${fs}&fields=${FIELDS_BOARD}`

  const t0 = performance.now()
  try {
    const res = await fetchFirstOk(screenerCandidateUrls(apiPath))
    const json = await res.json()
    const diffs: Array<Record<string, unknown>> = json?.data?.diff || []
    if (!Array.isArray(diffs) || diffs.length === 0) {
      throw new Error('板块榜为空')
    }
    const rows = parseBoardRows(diffs, kind)
    if (rows.length === 0) throw new Error('板块解析无有效行')
    const latency = Math.round(performance.now() - t0)
    markScreener(true, latency)
    return {
      rows,
      kind,
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
      rows: mockBoards(kind, sort),
      kind,
      sort,
      source: 'mock',
      delayed: true,
      asOf: new Date().toISOString(),
      total: 0,
      error: `东财板块榜暂不可用（${msg}），已回退示意数据，仅供学习`,
    }
  }
}

export async function fetchBoardConstituents(
  board: BoardRow,
  sort: ScreenerSort = 'gainers',
  limit = 80,
): Promise<BoardDetailResult> {
  const po = sort === 'gainers' ? 1 : 0
  const pz = Math.min(Math.max(limit, 10), 100)
  const fs = encodeURIComponent(`b:${board.code}+f:!50`)
  const apiPath =
    `/api/qt/clist/get?pn=1&pz=${pz}&po=${po}&np=1` +
    `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2` +
    `&fid=f3&fs=${fs}&fields=${FIELDS_STOCK}`

  const t0 = performance.now()
  try {
    const res = await fetchFirstOk(screenerCandidateUrls(apiPath))
    const json = await res.json()
    const diffs: Array<Record<string, unknown>> = json?.data?.diff || []
    if (!Array.isArray(diffs) || diffs.length === 0) {
      throw new Error('成分股为空')
    }
    const parsed = parseStockRows(diffs, 'A', 0)
    if (parsed.length === 0) throw new Error('成分股解析无有效行')
    // 跌幅榜：接口已按 f3 升序；龙头/中军仍按涨幅视角标注（取涨幅最高侧）
    const forRoles =
      sort === 'losers'
        ? [...parsed].sort((a, b) => b.changePercent - a.changePercent)
        : parsed
    const tagged = tagLeaderAndMid(forRoles)
    // 展示顺序跟随 sort
    const rows =
      sort === 'losers'
        ? [...tagged].sort((a, b) => a.changePercent - b.changePercent).map((r, i) => ({ ...r, rank: i + 1 }))
        : tagged
    const latency = Math.round(performance.now() - t0)
    markScreener(true, latency)
    return {
      board,
      rows,
      source: 'eastmoney',
      delayed: true,
      asOf: new Date().toISOString(),
      total: Number(json?.data?.total) || rows.length,
      roleRules: LEADER_MID_RULES,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '拉取失败'
    markScreener(false, Math.round(performance.now() - t0), msg)
    return {
      board,
      rows: mockConstituents(board),
      source: 'mock',
      delayed: true,
      asOf: new Date().toISOString(),
      total: 0,
      roleRules: LEADER_MID_RULES,
      error: `成分股暂不可用（${msg}），已回退示意数据，仅供学习`,
    }
  }
}


/** 全市场列表单页最大条数（东财 clist 常用上限约 100） */
export const FULL_MARKET_PAGE_SIZE = 100
/** A 股全市场页数上限（约 5000+ 只，留余量） */
export const FULL_MARKET_MAX_PAGES_A = 60
/** 港股/美股全列表上限页数（防止一次拉爆；UI 会提示限制） */
export const FULL_MARKET_MAX_PAGES_HK_US = 30

export interface FullMarketProgress {
  page: number
  loaded: number
  totalHint: number
}

export interface FullMarketResult {
  rows: ScreenerRow[]
  market: ScreenerMarketTab
  source: 'eastmoney' | 'mock'
  delayed: true
  asOf: string
  total: number
  pagesFetched: number
  truncated: boolean
  error?: string
}

/**
 * 分页拉取全市场代码表（东财 clist）。
 * - A 股：沪深主板 + 创业板 + 科创板（FS_A），按代码升序稳定分页
 * - 港/美：尽力拉全列表，有页数上限并标记 truncated
 * - 示意回退不用于全市场技术扫描（source=mock）
 */
export async function fetchFullMarketList(
  market: ScreenerMarketTab = 'A',
  opts: {
    onProgress?: (p: FullMarketProgress) => void
    shouldAbort?: () => boolean
    pageSize?: number
    maxPages?: number
  } = {},
): Promise<FullMarketResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? FULL_MARKET_PAGE_SIZE, 20), 100)
  const maxPages =
    opts.maxPages ??
    (market === 'A' ? FULL_MARKET_MAX_PAGES_A : FULL_MARKET_MAX_PAGES_HK_US)
  const fs = encodeURIComponent(fsFor(market))
  const all: ScreenerRow[] = []
  let total = 0
  let pagesFetched = 0
  let truncated = false
  const t0 = performance.now()

  try {
    for (let page = 1; page <= maxPages; page++) {
      if (opts.shouldAbort?.()) {
        truncated = true
        break
      }
      // 按代码升序，避免涨跌幅榜偏差；稳定全量覆盖
      const apiPath =
        `/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=0&np=1` +
        `&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2` +
        `&fid=f12&fs=${fs}&fields=${FIELDS_STOCK}`
      const res = await fetchFirstOk(screenerCandidateUrls(apiPath))
      const json = await res.json()
      const diffs: Array<Record<string, unknown>> = json?.data?.diff || []
      if (!Array.isArray(diffs) || diffs.length === 0) break
      const rankOffset = all.length
      const rows = parseStockRows(diffs, market, rankOffset)
      for (const row of rows) {
        if (!all.some((x) => x.symbol === row.symbol)) all.push(row)
      }
      total = Number(json?.data?.total) || all.length
      pagesFetched = page
      opts.onProgress?.({ page, loaded: all.length, totalHint: total })
      if (rows.length < pageSize) break
      if (all.length >= total && total > 0) break
      if (page === maxPages && all.length < total) truncated = true
      // 轻微间隔，避免打爆源
      await new Promise((r) => setTimeout(r, 80))
    }
    if (all.length === 0) throw new Error('全市场列表为空')
    const latency = Math.round(performance.now() - t0)
    markScreener(true, latency)
    return {
      rows: all.map((r, i) => ({ ...r, rank: i + 1 })),
      market,
      source: 'eastmoney',
      delayed: true,
      asOf: new Date().toISOString(),
      total: total || all.length,
      pagesFetched,
      truncated,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '拉取失败'
    markScreener(false, Math.round(performance.now() - t0), msg)
    return {
      rows: [],
      market,
      source: 'mock',
      delayed: true,
      asOf: new Date().toISOString(),
      total: 0,
      pagesFetched,
      truncated: false,
      error: `全市场列表暂不可用（${msg}），不回退示意列表以免伪装全市场扫描`,
    }
  }
}

/** 轻量探测：拉 3 条 A 股涨幅 */
export async function probeScreener(): Promise<ProviderHealth> {
  const r = await fetchChangeRank('A', 'gainers', { page: 1, pageSize: 3 })
  if (r.source === 'mock' && r.error) {
    /* already marked down */
  }
  return getScreenerHealth()
}
