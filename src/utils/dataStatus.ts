import type { Quote, QuoteProviderMode, QuoteSource } from '../types'
import {
  DATA_KIND_BADGE,
  DATA_KIND_HINT,
  PAGES_QUOTE_HINT,
  type DataStatusKind,
} from './dataStatusLabels'

export type { DataStatusKind }

/** 顶栏汇总数据态 */
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
 * 演示 > 旧行情 > 延时 > 最新（任一强降级优先；mock 模式强制演示）
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
      label: DATA_KIND_BADGE.mock,
      detail: `已选「仅本地模拟」行情源。${DATA_KIND_HINT.mock}`,
      counts,
      total,
    }
  }

  let kind: DataStatusKind = 'live'
  let detail = '行情多为公开最新源'

  if (total === 0) {
    kind = isPagesHost() ? 'delayed' : 'live'
    detail = isPagesHost()
      ? PAGES_QUOTE_HINT
      : '暂无行情，加入自选后刷新'
  } else if (counts.mock > 0 && counts.mock >= Math.max(1, Math.ceil(total * 0.5))) {
    kind = 'mock'
    detail = `${counts.mock}/${total} 只为演示数据（真源不可用或仅模拟）。${DATA_KIND_HINT.mock}`
  } else if (counts.mock > 0) {
    kind = 'mock'
    detail = `${counts.mock}/${total} 只演示，其余真源/旧行情。${DATA_KIND_HINT.mock}`
  } else if (counts.cache > 0 && counts.cache >= Math.max(1, Math.ceil(total * 0.5))) {
    kind = 'cache'
    detail = `${counts.cache}/${total} 只来自刚才存下的行情。${DATA_KIND_HINT.cache}`
  } else if (counts.cache > 0) {
    kind = 'cache'
    detail = `${counts.cache}/${total} 只用旧行情，真源暂不可用。${DATA_KIND_HINT.cache}`
  } else if (counts.delayed > 0) {
    kind = 'delayed'
    detail = `${counts.delayed}/${total} 只延时行情（含 Yahoo 等，通常数分钟）。${DATA_KIND_HINT.delayed}`
  } else {
    kind = 'live'
    detail = `${counts.live}/${total} 只最新公开源。${DATA_KIND_HINT.live}`
  }

  if (isPagesHost() && kind !== 'mock') {
    detail = `${detail} · ${PAGES_QUOTE_HINT}`
  }

  return { kind, label: DATA_KIND_BADGE[kind], detail, counts, total }
}
