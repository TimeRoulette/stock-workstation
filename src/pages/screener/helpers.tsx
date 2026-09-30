import type { BoardConstituent, BoardKind, ScreenerMarketTab } from '../../services/screener'
import { fmt } from '../../utils/format'

export function fmtVol(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return fmt(n, 0)
}

export function fmtAmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return fmt(n, 0)
}

export const MARKET_TABS: Array<{ key: ScreenerMarketTab; label: string }> = [
  { key: 'A', label: 'A股' },
  { key: 'HK', label: '港股' },
  { key: 'US', label: '美股' },
]

export const BOARD_KIND_TABS: Array<{ key: BoardKind; label: string }> = [
  { key: 'industry', label: '行业' },
  { key: 'concept', label: '概念' },
]

export function RoleBadge({ role }: { role: BoardConstituent['role'] }) {
  if (role === 'leader') return <span className="role-badge role-leader" title="龙头">龙头</span>
  if (role === 'mid') return <span className="role-badge role-mid" title="中军">中军</span>
  return null
}
