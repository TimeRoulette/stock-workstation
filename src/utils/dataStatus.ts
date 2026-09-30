import type { Quote, QuoteProviderMode, QuoteSource } from '../types'

/** 顶栏汇总数据态 */
export type DataStatusKind = 'live' | 'delayed' | 'cache' | 'mock'

export interface DataStatusSummary {
  kind: DataStatusKind
  label: string
  /** 简短可解释说明 */
  detail: string
  counts: Record<DataStatusKind, number>
  total: number
}

const LIVE_SOURCES: QuoteSource[] = ['eastmoney', 'sina', 'ths']

export function classifyQuote(q: Quote): DataStatusKind {
  if (q.source === 'mock') return 'mock'
  if (q.source === 'cache') return 'cache'
  if (q.delayed || q.source === 'yahoo') return 'delayed'
  if (LIVE_SOURCES.includes(q.source)) return 'live'
  return 'delayed'
}

export function isPagesHost(): boolean {
  try {
    if (typeof window === 'undefined') return false
    if (window.stockWorkstation?.isElectron) return false
    const h = window.location.hostname
    return h.endsWith('github.io') || h.includes('pages.dev')
  } catch {
    return false
  }
}

/**
 * 按当前行情汇总顶栏徽章：
 * 示意 > 缓存 > 延迟 > 实时（任一强降级优先；mock 模式强制示意）
 */
export function summarizeDataStatus(
  quotes: Record<string, Quote> | Quote[],
  opts?: { providerMode?: QuoteProviderMode },
): DataStatusSummary {
  const list = Array.isArray(quotes) ? quotes : Object.values(quotes)
  const counts: Record<DataStatusKind, number> = {
    live: 0,
    delayed: 0,
    cache: 0,
    mock: 0,
  }
  for (const q of list) {
    counts[classifyQuote(q)] += 1
  }
  const total = list.length

  if (opts?.providerMode === 'mock') {
    return {
      kind: 'mock',
      label: '示意',
      detail: '已选「仅本地模拟」行情源',
      counts,
      total,
    }
  }

  let kind: DataStatusKind = 'live'
  let detail = '行情多为实时源'

  if (total === 0) {
    kind = isPagesHost() ? 'delayed' : 'live'
    detail = isPagesHost()
      ? '公开站可能演示/延迟；加入自选后刷新可见具体状态'
      : '暂无行情，加入自选后刷新'
  } else if (counts.mock > 0 && counts.mock >= Math.max(1, Math.ceil(total * 0.5))) {
    kind = 'mock'
    detail = `${counts.mock}/${total} 只为示意行情（真源不可用或仅模拟）`
  } else if (counts.mock > 0) {
    kind = 'mock'
    detail = `${counts.mock}/${total} 只示意，其余真源/缓存`
  } else if (counts.cache > 0 && counts.cache >= Math.max(1, Math.ceil(total * 0.5))) {
    kind = 'cache'
    detail = `${counts.cache}/${total} 只来自本地缓存`
  } else if (counts.cache > 0) {
    kind = 'cache'
    detail = `${counts.cache}/${total} 只用缓存，真源暂不可用`
  } else if (counts.delayed > 0) {
    kind = 'delayed'
    detail = `${counts.delayed}/${total} 只延迟（含 Yahoo 等）`
  } else {
    kind = 'live'
    detail = `${counts.live}/${total} 只实时源`
  }

  if (isPagesHost() && kind === 'live') {
    detail = `${detail} · 公开站可能演示/延迟`
  } else if (isPagesHost() && kind !== 'mock') {
    detail = `${detail} · 公开站可能演示/延迟`
  }

  const labelMap: Record<DataStatusKind, string> = {
    live: '实时',
    delayed: '延迟',
    cache: '缓存',
    mock: '示意',
  }

  return { kind, label: labelMap[kind], detail, counts, total }
}
