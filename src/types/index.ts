export type Market = 'SH' | 'SZ' | 'HK' | 'US'

export type QuoteSource = 'eastmoney' | 'sina' | 'ths' | 'yahoo' | 'mock' | 'cache'

export type QuoteProviderMode = 'auto' | 'eastmoney' | 'ths' | 'yahoo' | 'mock'

/** 图表周期：日/周/月 或 分时 1m/5m */
export type ChartPeriod = '1m' | '5m' | '1d' | '1w' | '1M'

export type IndicatorKey = 'ma' | 'macd' | 'vol'

/** 自选分组标签（空字符串 = 未分组） */
export type WatchlistTag = '' | '核心' | '观察' | '短线'

export interface WatchlistItem {
  id: number
  symbol: string
  name: string
  market: Market
  sortOrder: number
  addedAt: string
  /** 分组标签，便于筛选 */
  tag: WatchlistTag | string
}

export interface Quote {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
  open: number
  high: number
  low: number
  prevClose: number
  volume: number
  currency: string
  asOf: string
  delayed: boolean
  source: QuoteSource
}

export interface Candle {
  /** YYYY-MM-DD（日线）或 YYYY-MM-DDTHH:mm（分钟线） */
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface PaperAccount {
  id: number
  cash: number
  currency: string
  createdAt: string
}

export type TradeSide = 'buy' | 'sell'

export interface Trade {
  id: number
  symbol: string
  name: string
  side: TradeSide
  qty: number
  price: number
  fee: number
  ts: string
}

export interface TradeFilter {
  side?: TradeSide | 'all'
  symbol?: string
  limit?: number
}

export interface Position {
  symbol: string
  name: string
  qty: number
  avgCost: number
  marketValue?: number
  pnl?: number
  pnlPercent?: number
  lastPrice?: number
  dayChange?: number
  dayChangePercent?: number
  stopLoss?: number | null
  takeProfit?: number | null
}

export interface PositionNote {
  symbol: string
  stopLoss: number | null
  takeProfit: number | null
  note: string
  updatedAt: string
}

export interface EquitySnapshot {
  id: number
  ts: string
  cash: number
  marketValue: number
  equity: number
}

/** 日报条目数据新鲜度：实时拉取 / 本地缓存 / 示意样例 / 降级 */
export type BriefDataStatus = 'live' | 'cached' | 'sample' | 'degraded'

/** 与自选的关联方式；标题关键词匹配须在 UI 标明 */
export type BriefMatchMode = 'none' | 'title_keyword' | 'symbol' | 'industry'

/** 规则化情绪标签，非荐股/预测 */
export type BriefSentiment = 'bullish' | 'bearish' | 'neutral' | 'watch'

/** 早盘日报分区 */
export type BriefSection = 'premarket' | 'summary' | 'overnight' | 'focus' | 'watchlist' | 'holding' | 'general'

export interface BriefItem {
  id: string
  title: string
  summary: string
  source: string
  category: 'news' | 'trend' | 'tip' | 'holding'
  publishedAt: string
  url?: string
  /** 关联自选代码，可点进盯盘 */
  symbols?: string[]
  /** 芯片跳转目标：盯盘或模拟 */
  jumpTo?: 'watchlist' | 'portfolio'
  /** 数据状态：实时/缓存/示意/降级 */
  dataStatus?: BriefDataStatus
  /** 关联方式；title_keyword 时 UI 须标「标题关键词关联」 */
  matchMode?: BriefMatchMode
  /** 规则化利好/利空/中性/关注 */
  sentiment?: BriefSentiment
  /** 情绪依据说明（规则摘要，非预测） */
  sentimentNote?: string
  /** 早盘分区 */
  section?: BriefSection
  /** 宏观主题标签，如 央行/利率、地缘、商品/汇率 */
  topics?: string[]
}

export type AlertType = 'above' | 'below' | 'pct_change' | 'rvol_above'

export interface PriceAlert {
  id: number
  symbol: string
  name: string
  type: AlertType
  threshold: number
  enabled: boolean
  triggeredAt: string | null
  createdAt: string
  note: string
  /** ISO 时间戳：在此之前不触发（稍后提醒） */
  snoozedUntil: string | null
}

export interface JournalNote {
  id: number
  tradeId: number | null
  symbol: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  quoteProvider: QuoteProviderMode
  refreshIntervalSec: number
  theme: 'light' | 'dark'
  locale: 'zh-CN'
  coachDismissed: boolean
  /** 免打扰开始小时 0–23；与 muteEndHour 相同表示关闭 */
  muteStartHour: number
  /** 免打扰结束小时 0–23（可跨午夜） */
  muteEndHour: number
  /** RVOL 均量回看天数（默认 20） */
  volumeLookback: number
  /** 新建「相对成交量≥」提醒的默认倍数（默认 2） */
  defaultRvolAlert: number
}

export interface QuoteProvider {
  id: string
  label: string
  fetchQuotes(symbols: string[]): Promise<Quote[]>
  fetchCandles(symbol: string, days?: number, period?: ChartPeriod): Promise<Candle[]>
}

export type ProviderHealthStatus = 'ok' | 'degraded' | 'down' | 'unknown' | 'skipped'

export interface ProviderHealth {
  id: string
  label: string
  status: ProviderHealthStatus
  latencyMs: number | null
  lastOkAt: string | null
  lastError: string | null
  message: string
}

export interface ResetAccountOptions {
  clearTrades: boolean
  clearEquity: boolean
  clearNotes: boolean
  clearJournal: boolean
  restoreCash: boolean
}

export interface ToastItem {
  id: string
  message: string
  type: 'info' | 'error' | 'success' | 'alert'
}

/** 从图表一键模拟买入的预填信息 */
export interface QuickBuyRequest {
  symbol: string
  name: string
  price: number
  qty: number
}

/** 按成交重算现金的结果 */
export interface RebuildCashResult {
  previousCash: number
  newCash: number
  tradeCount: number
  drift: number
}

export interface ImportTradesOptions {
  /** 导入后按成交日志重算现金（修复漂移） */
  rebuildCash?: boolean
}
