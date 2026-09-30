/**
 * 模拟简易绩效：胜率 / 最大回撤 / 相对基准示意
 * 仅供研究，非真实券商绩效。
 */
import type { EquitySnapshot, Trade } from '../types'

export interface ClosedRound {
  symbol: string
  name: string
  qty: number
  buyCost: number
  sellProceeds: number
  pnl: number
  win: boolean
}

export interface PaperPerfResult {
  closedRounds: number
  wins: number
  losses: number
  winRate: number | null
  maxDrawdownPct: number | null
  equityReturnPct: number | null
  benchmarkId: string
  benchmarkLabel: string
  benchmarkReturnPct: number | null
  relativePct: number | null
  benchmarkStatus: 'ok' | 'unavailable' | 'sample'
  note: string
}

/** FIFO 配对已平仓回合（卖出对应买入） */
export function computeClosedRounds(trades: Trade[]): ClosedRound[] {
  type Lot = { qty: number; price: number; name: string }
  const books = new Map<string, Lot[]>()
  const closed: ClosedRound[] = []

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
    let buyCost = 0
    let matched = 0
    let name = t.name
    while (remain > 1e-9 && lots.length) {
      const lot = lots[0]
      const take = Math.min(lot.qty, remain)
      buyCost += take * lot.price
      matched += take
      name = lot.name || name
      lot.qty -= take
      remain -= take
      if (lot.qty <= 1e-9) lots.shift()
    }
    books.set(t.symbol, lots)
    if (matched <= 1e-9) continue
    const sellProceeds = matched * t.price
    const pnl = sellProceeds - buyCost
    closed.push({
      symbol: t.symbol,
      name,
      qty: matched,
      buyCost,
      sellProceeds,
      pnl,
      win: pnl > 0,
    })
  }
  return closed
}

/** 净值曲线最大回撤（相对峰值，百分比） */
export function maxDrawdownPct(snapshots: EquitySnapshot[]): number | null {
  if (!snapshots.length) return null
  let peak = -Infinity
  let maxDd = 0
  let saw = false
  for (const s of snapshots) {
    const eq = s.equity
    if (!Number.isFinite(eq)) continue
    saw = true
    if (eq > peak) peak = eq
    if (peak > 0) {
      const dd = ((peak - eq) / peak) * 100
      if (dd > maxDd) maxDd = dd
    }
  }
  return saw ? maxDd : null
}

export function equityPeriodReturnPct(snapshots: EquitySnapshot[]): number | null {
  if (snapshots.length < 2) return null
  const first = snapshots[0].equity
  const last = snapshots[snapshots.length - 1].equity
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null
  return ((last - first) / first) * 100
}

export const BENCHMARKS = [
  { id: '000300.SH', label: '沪深300（示意）' },
  { id: '000001.SH', label: '上证指数（示意）' },
  { id: '399006.SZ', label: '创业板指（示意）' },
] as const

export type BenchmarkId = (typeof BENCHMARKS)[number]['id']

/**
 * @param benchmarkCloses 基准收盘序列（旧→新）；空则标不可用
 */
export function computePaperPerf(
  trades: Trade[],
  snapshots: EquitySnapshot[],
  opts?: {
    benchmarkId?: string
    benchmarkLabel?: string
    benchmarkCloses?: number[]
    sample?: boolean
  },
): PaperPerfResult {
  const rounds = computeClosedRounds(trades)
  const wins = rounds.filter((r) => r.win).length
  const losses = rounds.length - wins
  const winRate = rounds.length ? (wins / rounds.length) * 100 : null
  const mdd = maxDrawdownPct(snapshots)
  const eqRet = equityPeriodReturnPct(snapshots)

  const closes = (opts?.benchmarkCloses || []).filter((v) => Number.isFinite(v) && v > 0)
  let benchRet: number | null = null
  let status: PaperPerfResult['benchmarkStatus'] = 'unavailable'
  if (closes.length >= 2) {
    benchRet = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
    status = opts?.sample ? 'sample' : 'ok'
  }

  const relative =
    eqRet != null && benchRet != null && Number.isFinite(eqRet) && Number.isFinite(benchRet)
      ? eqRet - benchRet
      : null

  return {
    closedRounds: rounds.length,
    wins,
    losses,
    winRate,
    maxDrawdownPct: mdd,
    equityReturnPct: eqRet,
    benchmarkId: opts?.benchmarkId || '000300.SH',
    benchmarkLabel: opts?.benchmarkLabel || '沪深300（示意）',
    benchmarkReturnPct: benchRet,
    relativePct: relative,
    benchmarkStatus: status,
    note: '仅供研究，非真实券商绩效；撮合与基准均为演示规则。',
  }
}
