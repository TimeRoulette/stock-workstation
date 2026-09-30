/**
 * 数据态 UI 文案（v0.12）：内部枚举 live/delayed/cache/mock/fetching 保持兼容。
 */
import type { BriefDataStatus, QuoteSource } from '../types'

export type DataStatusKind = 'live' | 'delayed' | 'cache' | 'mock' | 'fetching'

/** 顶栏短徽章 */
export const DATA_KIND_BADGE: Record<DataStatusKind, string> = {
  live: '最新',
  delayed: '延时',
  cache: '旧行情',
  mock: '演示',
  fetching: '拉取中',
}

/** 稍长标签（列表/日报） */
export const DATA_KIND_LABEL: Record<DataStatusKind, string> = {
  live: '最新行情',
  delayed: '延时行情',
  cache: '刚才的行情',
  mock: '演示数据',
  fetching: '正在拉真行情',
}

/** tooltip / 旁注 */
export const DATA_KIND_HINT: Record<DataStatusKind, string> = {
  live: '公开源刚拉取到的行情；免费接口仍可能有短暂延迟，做不到券商 Level-2。',
  delayed: '公开源标明或通常有数分钟延迟（如 Yahoo）；以券商为准。',
  cache: '刚才存下来的行情，可能已过时；真源暂不可用时优先用它，不会伪装成最新。',
  mock: '不是真行情，仅供界面演示。请勿据此交易判断；演示价下单需强确认。',
  fetching: '正在向公开源请求真行情；若暂无缓存会先显示拉取中，不会立刻标成演示。',
}

export function briefStatusBadge(s: BriefDataStatus): string {
  if (s === 'live') return '最新'
  if (s === 'cached') return '旧行情'
  if (s === 'sample') return '演示'
  return '降级'
}

export function briefStatusLabel(s: BriefDataStatus): string {
  if (s === 'live') return '最新行情'
  if (s === 'cached') return '刚才的行情'
  if (s === 'sample') return '演示数据'
  return '降级'
}

export function sourceCornerBadge(source: QuoteSource): { text: string; title: string } | null {
  if (source === 'mock') {
    return { text: '演示', title: DATA_KIND_HINT.mock }
  }
  if (source === 'cache') {
    return { text: '旧行情', title: DATA_KIND_HINT.cache }
  }
  return null
}

export function sourceBadgeLabelZh(source: QuoteSource): string {
  switch (source) {
    case 'eastmoney':
      return '东财'
    case 'sina':
      return '新浪'
    case 'ths':
      return '同花顺'
    case 'yahoo':
      return 'Yahoo'
    case 'cache':
      return '旧行情'
    default:
      return '演示'
  }
}

export const PAGES_QUOTE_HINT =
  '公开静态站受 CORS/中继限制：同花顺 A 股通常可直连；东财/新浪/Yahoo 多需中继或自备代理。桌面版（Electron）与安卓壳（Capacitor 原生 HTTP）通常更准。公开免费源本身有延迟与限流，做不到券商级。'

export const HONEST_QUOTE_BOUNDARY =
  '公开免费行情源本身就有延迟与限流，本工具做不到券商级实时与撮合；仅供学习研究，不构成投资建议。'
