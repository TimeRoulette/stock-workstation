/**
 * 实盘分析：基于用户手动导入的真实成交（与模拟盘隔离）
 * 仅本地计算，非券商对接，不构成投资建议。
 */
import type { EquitySnapshot, LiveTrade, Position, Trade } from '../types'
import { computeClosedRounds, maxDrawdownPct } from './paperPerf'
import { normalizeSymbol } from './quoteSymbols'

export interface LivePositionView extends Position {
  weightPct: number
  currency?: string
}

export interface LiveConcentration {
  symbol: string
  name: string
  marketValue: number
  weightPct: number
}

export interface LiveAnalysisResult {
  tradeCount: number
  positionCount: number
  totalCost: number
  totalMarketValue: number
  floatingPnl: number
  floatingPnlPct: number | null
  realizedPnl: number
  closedRounds: number
  wins: number
  losses: number
  winRate: number | null
  maxDrawdownPct: number | null
  concentration: LiveConcentration[]
  positions: LivePositionView[]
  recentTrades: LiveTrade[]
  equityCurve: EquitySnapshot[]
  note: string
}

/** 将实盘成交映射为纸上 Trade 形状以便复用 FIFO */
export function liveToPaperTrades(trades: LiveTrade[]): Trade[] {
  return trades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    name: t.name,
    side: t.side,
    qty: t.qty,
    price: t.price,
    fee: t.fee,
    ts: t.ts,
  }))
}

/** 从成交 FIFO 推算当前持仓成本 */
export function computeLivePositions(trades: LiveTrade[]): Position[] {
  type Lot = { qty: number; price: number; name: string }
  const books = new Map<string, Lot[]>()
  const sorted = [...trades].sort((a, b) => {
    const ta = new Date(a.ts).getTime()
    const tb = new Date(b.ts).getTime()
    if (ta !== tb) return ta - tb
    return a.id - b.id
  })
  for (const t of sorted) {
    const lots = books.get(t.symbol) || []
    if (t.side === 'buy') {
      lots.push({ qty: t.qty, price: t.price, name: t.name })
      books.set(t.symbol, lots)
      continue
    }
    let remain = t.qty
    while (remain > 1e-9 && lots.length) {
      const lot = lots[0]
      const take = Math.min(lot.qty, remain)
      lot.qty -= take
      remain -= take
      if (lot.qty <= 1e-9) lots.shift()
    }
    books.set(t.symbol, lots)
  }
  const positions: Position[] = []
  for (const [symbol, lots] of books) {
    const qty = lots.reduce((s, l) => s + l.qty, 0)
    if (qty <= 1e-9) continue
    const cost = lots.reduce((s, l) => s + l.qty * l.price, 0)
    const name = lots[lots.length - 1]?.name || symbol
    positions.push({
      symbol,
      name,
      qty,
      avgCost: cost / qty,
    })
  }
  return positions.sort((a, b) => a.symbol.localeCompare(b.symbol))
}

/**
 * 从成交推算示意净值曲线（累计已实现 + 浮动；起点为 0 投入示意）。
 * 非券商对账单；仅用于回撤估算。
 */
export function buildLiveEquityCurve(
  trades: LiveTrade[],
  priceMap: Record<string, number> = {},
): EquitySnapshot[] {
  const sorted = [...trades].sort((a, b) => {
    const ta = new Date(a.ts).getTime()
    const tb = new Date(b.ts).getTime()
    if (ta !== tb) return ta - tb
    return a.id - b.id
  })
  type Lot = { qty: number; price: number }
  const books = new Map<string, Lot[]>()
  let cashFlow = 0
  const snaps: EquitySnapshot[] = []
  let i = 0
  for (const t of sorted) {
    i++
    const lots = books.get(t.symbol) || []
    if (t.side === 'buy') {
      cashFlow -= t.qty * t.price + (t.fee || 0)
      lots.push({ qty: t.qty, price: t.price })
      books.set(t.symbol, lots)
    } else {
      cashFlow += t.qty * t.price - (t.fee || 0)
      let remain = t.qty
      while (remain > 1e-9 && lots.length) {
        const lot = lots[0]
        const take = Math.min(lot.qty, remain)
        lot.qty -= take
        remain -= take
        if (lot.qty <= 1e-9) lots.shift()
      }
      books.set(t.symbol, lots)
    }
    let mv = 0
    for (const [sym, ls] of books) {
      const qty = ls.reduce((s, l) => s + l.qty, 0)
      if (qty <= 0) continue
      const px = priceMap[sym] ?? ls[ls.length - 1]?.price ?? 0
      mv += qty * px
    }
    // equity = 当前市值 + 累计现金流（买入为负、卖出为正）的「投入后净值」示意
    const equity = cashFlow + mv
    snaps.push({
      id: i,
      ts: t.ts,
      cash: cashFlow,
      marketValue: mv,
      equity,
    })
  }
  return snaps
}

export function analyzeLivePortfolio(
  trades: LiveTrade[],
  priceMap: Record<string, number> = {},
  opts?: { recentLimit?: number },
): LiveAnalysisResult {
  const positions = computeLivePositions(trades)
  const paper = liveToPaperTrades(trades)
  const rounds = computeClosedRounds(paper)
  const realizedPnl = rounds.reduce((s, r) => s + r.pnl, 0)
  const wins = rounds.filter((r) => r.win).length
  const losses = rounds.length - wins
  const winRate = rounds.length ? (wins / rounds.length) * 100 : null

  let totalCost = 0
  let totalMv = 0
  const views: LivePositionView[] = positions.map((p) => {
    const last = priceMap[p.symbol]
    const px = Number.isFinite(last) ? last! : p.avgCost
    const mv = px * p.qty
    const pnl = (px - p.avgCost) * p.qty
    const pnlPercent = p.avgCost ? ((px - p.avgCost) / p.avgCost) * 100 : 0
    totalCost += p.avgCost * p.qty
    totalMv += mv
    return {
      ...p,
      lastPrice: px,
      marketValue: mv,
      pnl,
      pnlPercent,
      weightPct: 0,
    }
  })
  for (const v of views) {
    v.weightPct = totalMv > 0 ? ((v.marketValue || 0) / totalMv) * 100 : 0
  }
  views.sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))

  const floatingPnl = totalMv - totalCost
  const floatingPnlPct = totalCost > 0 ? (floatingPnl / totalCost) * 100 : null

  const equityCurve = buildLiveEquityCurve(trades, priceMap)
  const mdd = maxDrawdownPct(equityCurve)

  const concentration: LiveConcentration[] = views.slice(0, 8).map((v) => ({
    symbol: v.symbol,
    name: v.name,
    marketValue: v.marketValue || 0,
    weightPct: v.weightPct,
  }))

  const recent = [...trades]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, opts?.recentLimit ?? 20)

  return {
    tradeCount: trades.length,
    positionCount: views.length,
    totalCost,
    totalMarketValue: totalMv,
    floatingPnl,
    floatingPnlPct,
    realizedPnl,
    closedRounds: rounds.length,
    wins,
    losses,
    winRate,
    maxDrawdownPct: mdd,
    concentration,
    positions: views,
    recentTrades: recent,
    equityCurve,
    note: '数据仅存本机浏览器/桌面应用；非券商对接；分析结果仅供个人复盘学习，不构成投资建议。',
  }
}

export function parseLiveTradesCsv(csv: string): Array<{
  tradeDate: string
  symbol: string
  name: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  fee: number
  note: string
}> {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) return []

  const split = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (c === '"') inQ = false
        else cur += c
      } else if (c === '"') inQ = true
      else if (c === ',' || c === '\t') {
        out.push(cur)
        cur = ''
      } else cur += c
    }
    out.push(cur)
    return out.map((s) => s.trim())
  }

  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ''))
  const idx = (aliases: string[]) => {
    for (const a of aliases) {
      const i = header.indexOf(a)
      if (i >= 0) return i
    }
    return -1
  }
  const iDate = idx(['date', 'tradedate', '成交日期', '交易日期', '日期', 'ts', 'time', 'datetime', '成交时间'])
  const iSym = idx(['symbol', 'code', '证券代码', '股票代码', '代码', 'ticker'])
  const iName = idx(['name', '证券名称', '股票名称', '名称'])
  const iSide = idx(['side', '买卖标志', '买卖', '方向', '操作', 'bs', 'entrustbs'])
  const iPrice = idx(['price', '成交价格', '成交价', '价格', '均价'])
  const iQty = idx(['qty', 'quantity', '成交数量', '成交量', '数量', 'volume', '股数'])
  const iFee = idx(['fee', '手续费', '佣金', '费用', '总和费用'])
  const iNote = idx(['note', '备注', '说明', '摘要'])

  if (iSym < 0 || iSide < 0 || iPrice < 0 || iQty < 0) {
    throw new Error('CSV 需包含：代码/买卖/价格/数量（日期可选，费用可选）')
  }

  const out: Array<{
    tradeDate: string
    symbol: string
    name: string
    side: 'buy' | 'sell'
    qty: number
    price: number
    fee: number
    note: string
  }> = []

  for (let li = 1; li < lines.length; li++) {
    const cols = split(lines[li])
    if (cols.every((c) => !c)) continue
    const rawSym = cols[iSym] || ''
    const { symbol } = normalizeSymbol(rawSym)
    if (!symbol) continue
    const sideRaw = (cols[iSide] || '').toLowerCase().replace(/\s+/g, '')
    let side: 'buy' | 'sell' | null = null
    if (['buy', 'b', '买', '买入', 'bid', 'b买', '1', '证券买入'].includes(sideRaw) || sideRaw.includes('买'))
      side = 'buy'
    else if (['sell', 's', '卖', '卖出', 'ask', 's卖', '2', '证券卖出'].includes(sideRaw) || sideRaw.includes('卖'))
      side = 'sell'
    if (!side) continue // 宽容：跳过无法识别的行
    const qty = Number(String(cols[iQty]).replace(/,/g, ''))
    const price = Number(String(cols[iPrice]).replace(/,/g, ''))
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) continue
    const fee = iFee >= 0 ? Number(cols[iFee]) || 0 : 0
    let tradeDate = iDate >= 0 ? cols[iDate] : ''
    if (!tradeDate) tradeDate = new Date().toISOString()
    else if (/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) tradeDate = `${tradeDate}T00:00:00.000Z`
    else if (!Number.isNaN(Date.parse(tradeDate))) tradeDate = new Date(tradeDate).toISOString()
    else if (/^\d{8}$/.test(tradeDate)) {
      tradeDate = `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}T00:00:00.000Z`
    } else continue
    out.push({
      tradeDate,
      symbol,
      name: iName >= 0 ? cols[iName] || symbol : symbol,
      side,
      qty,
      price,
      fee,
      note: iNote >= 0 ? cols[iNote] || '' : '',
    })
  }
  return out
}

export function exportLiveAnalysisMarkdown(a: LiveAnalysisResult): string {
  const lines = [
    '# 实盘分析摘要',
    '',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '> 数据仅本地；非券商对接；不构成投资建议。',
    '',
    '## 概览',
    '',
    `- 成交笔数：${a.tradeCount}`,
    `- 持仓标的：${a.positionCount}`,
    `- 持仓成本合计：${a.totalCost.toFixed(2)}`,
    `- 市值合计：${a.totalMarketValue.toFixed(2)}`,
    `- 浮动盈亏：${a.floatingPnl.toFixed(2)}${a.floatingPnlPct != null ? `（${a.floatingPnlPct.toFixed(2)}%）` : ''}`,
    `- 已实现盈亏：${a.realizedPnl.toFixed(2)}`,
    `- 胜率：${a.winRate != null ? `${a.winRate.toFixed(1)}%（${a.wins}胜/${a.losses}负，${a.closedRounds} 回合）` : '—'}`,
    `- 最大回撤（估算）：${a.maxDrawdownPct != null ? `${a.maxDrawdownPct.toFixed(2)}%` : '—'}`,
    '',
    '## 持仓集中度',
    '',
  ]
  for (const c of a.concentration) {
    lines.push(`- ${c.symbol} ${c.name}：市值 ${c.marketValue.toFixed(2)}（${c.weightPct.toFixed(1)}%）`)
  }
  lines.push('', '## 近期成交', '')
  for (const t of a.recentTrades) {
    lines.push(
      `- ${t.ts.slice(0, 10)} ${t.side === 'buy' ? '买' : '卖'} ${t.symbol} ×${t.qty} @${t.price}${t.fee ? ` 费用${t.fee}` : ''}`,
    )
  }
  lines.push('', a.note, '')
  return lines.join('\n')
}

export function exportLiveAnalysisCsv(a: LiveAnalysisResult): string {
  const rows = [
    'section,symbol,name,side,qty,price,fee,ts,marketValue,pnl,weightPct,metric,value',
  ]
  rows.push(`summary,,,,,,,${new Date().toISOString()},,,,tradeCount,${a.tradeCount}`)
  rows.push(`summary,,,,,,,,,,,floatingPnl,${a.floatingPnl}`)
  rows.push(`summary,,,,,,,,,,,realizedPnl,${a.realizedPnl}`)
  rows.push(`summary,,,,,,,,,,,winRate,${a.winRate ?? ''}`)
  rows.push(`summary,,,,,,,,,,,maxDrawdownPct,${a.maxDrawdownPct ?? ''}`)
  for (const p of a.positions) {
    rows.push(
      [
        'position',
        p.symbol,
        csvEsc(p.name),
        '',
        p.qty,
        p.avgCost,
        '',
        '',
        p.marketValue ?? '',
        p.pnl ?? '',
        p.weightPct,
        '',
        '',
      ].join(','),
    )
  }
  for (const t of a.recentTrades) {
    rows.push(
      ['trade', t.symbol, csvEsc(t.name), t.side, t.qty, t.price, t.fee, t.ts, '', '', '', '', ''].join(
        ',',
      ),
    )
  }
  return rows.join('\n')
}

function csvEsc(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}


/** 持仓与成交对账：由成交推算持仓，并附带手动分红/送股备注 */
export function reconcileLivePositions(
  trades: LiveTrade[],
  corpNotes: Array<{ symbol: string; note: string }> = [],
): Array<{
  symbol: string
  name: string
  qtyFromTrades: number
  avgCost: number
  corpNote: string
  ok: boolean
  hint: string
}> {
  const positions = computeLivePositions(trades)
  const noteMap = new Map(corpNotes.map((n) => [n.symbol.toUpperCase(), n.note]))
  return positions.map((p) => {
    const corp = noteMap.get(p.symbol.toUpperCase()) || ''
    return {
      symbol: p.symbol,
      name: p.name,
      qtyFromTrades: p.qty,
      avgCost: p.avgCost,
      corpNote: corp,
      ok: true,
      hint: corp ? '已附分红/送股备注（手动，不自动调数量）' : '数量由成交 FIFO 推算',
    }
  })
}

export function liveSymbolPerformance(trades: LiveTrade[]): Array<{
  symbol: string
  name: string
  realizedPnl: number
  rounds: number
  winRate: number | null
}> {
  const rounds = computeClosedRounds(liveToPaperTrades(trades))
  const map = new Map<string, { name: string; pnl: number; rounds: number; wins: number }>()
  for (const r of rounds) {
    const cur = map.get(r.symbol) || { name: r.name, pnl: 0, rounds: 0, wins: 0 }
    cur.pnl += r.pnl
    cur.rounds += 1
    if (r.win) cur.wins += 1
    cur.name = r.name || cur.name
    map.set(r.symbol, cur)
  }
  return [...map.entries()]
    .map(([symbol, v]) => ({
      symbol,
      name: v.name,
      realizedPnl: v.pnl,
      rounds: v.rounds,
      winRate: v.rounds ? (v.wins / v.rounds) * 100 : null,
    }))
    .sort((a, b) => b.realizedPnl - a.realizedPnl)
}

/** 实盘 vs 模拟对比小卡数据 */
export function compareLiveVsPaper(opts: {
  liveFloating: number
  liveRealized: number
  paperEquityReturnPct: number | null
  paperFloating: number
}): {
  liveTotal: number
  paperHint: string
  deltaHint: string
} {
  const liveTotal = opts.liveFloating + opts.liveRealized
  const paperHint =
    opts.paperEquityReturnPct != null
      ? `模拟净值区间收益 ${opts.paperEquityReturnPct.toFixed(2)}%`
      : `模拟浮动 ${opts.paperFloating.toFixed(0)}`
  const deltaHint =
    '两边账户与规则不同，数字不可直接当「谁更强」；仅供并排浏览。非投资建议。'
  return { liveTotal, paperHint, deltaHint }
}
