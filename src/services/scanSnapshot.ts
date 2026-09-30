import type { TechCombineMode, TechConditionId, TechScanHit, TechScanProgress } from './techScreener'
import type { ScreenerMarketTab } from './screener'

const KEY = 'sw-tech-scan-snapshot-v1'
const SCHEMA = 'stock-workstation-tech-scan'
const VERSION = 1

export type TechScanScope = 'top200' | 'full' | 'watchlist'

export interface TechScanSnapshotMeta {
  scope: TechScanScope
  market: ScreenerMarketTab
  conditions: TechConditionId[]
  combine: TechCombineMode
  macdLookback: number
  pressureWindow: 20 | 60
  startedAt: string
  updatedAt: string
  completedAt: string | null
  /** 是否被中止/未完成 */
  incomplete: boolean
  progress: TechScanProgress | null
  mockSkipped: number
  failed: number
  insufficient: number
}

export interface TechScanSnapshot {
  schema: typeof SCHEMA
  version: typeof VERSION
  meta: TechScanSnapshotMeta
  hits: TechScanHit[]
}

export function loadTechScanSnapshot(): TechScanSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as TechScanSnapshot
    if (parsed?.schema !== SCHEMA || parsed?.version !== VERSION) return null
    if (!parsed.meta || !Array.isArray(parsed.hits)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveTechScanSnapshot(snap: Omit<TechScanSnapshot, 'schema' | 'version'>): void {
  const full: TechScanSnapshot = {
    schema: SCHEMA,
    version: VERSION,
    meta: snap.meta,
    hits: snap.hits,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(full))
  } catch (e) {
    console.warn('保存扫描快照失败（可能超出配额）', e)
  }
}

export function clearTechScanSnapshot(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* */
  }
}

export function snapshotSummary(s: TechScanSnapshot | null): string {
  if (!s) return '无上次结果'
  const { meta, hits } = s
  const scopeLabel =
    meta.scope === 'full' ? '全市场' : meta.scope === 'watchlist' ? '自选' : '前200'
  const status = meta.incomplete ? '未完成' : '已完成'
  return `${scopeLabel} · ${status} · 命中 ${hits.length} · ${meta.updatedAt.slice(0, 16).replace('T', ' ')}`
}
