import { useEffect, useMemo, useState } from 'react'
import { CollapsibleTip } from '../components/CollapsibleTip'
import { ExternalLink } from '../components/ExternalLink'
import { Skeleton } from '../components/Skeleton'
import * as db from '../services/db'
import { getBriefProvider, quoteService } from '../services/quotes'
import { classifyRvol, rvolLevelClass, scanWatchlistVolume } from '../services/volumeMonitor'
import { fmtPct } from '../utils/format'
import { EXTERNAL_LINK_HINT } from '../utils/openExternalLink'
import type { ReactNode } from 'react'
import type {
  BriefDataStatus,
  BriefItem,
  BriefSection,
  BriefSentiment,
  BriefSummaryBlock,
  Quote,
} from '../types'

const CAT: Record<BriefItem['category'], string> = {
  news: '资讯',
  trend: '趋势',
  tip: '提示',
  holding: '持仓',
}

const SECTION_ORDER: Array<{ key: BriefSection; title: string }> = [
  { key: 'premarket', title: '盘前概览' },
  { key: 'holding', title: '持仓速览' },
  { key: 'summary', title: '汇总分析' },
  { key: 'overnight', title: '隔夜全球' },
  { key: 'focus', title: '今日关注' },
  { key: 'watchlist', title: '自选影响' },
  { key: 'general', title: '其他资讯' },
]

function statusLabel(s?: BriefDataStatus): string {
  if (s === 'live') return '实时'
  if (s === 'cached') return '缓存'
  if (s === 'degraded') return '降级'
  if (s === 'sample') return '示意'
  return ''
}

function statusClass(s?: BriefDataStatus): string {
  if (s === 'live') return 'brief-status live'
  if (s === 'cached') return 'brief-status cached'
  if (s === 'sample') return 'brief-status sample'
  if (s === 'degraded') return 'brief-status degraded'
  return 'brief-status'
}

function sentimentLabel(s?: BriefSentiment): string {
  if (s === 'bullish') return '偏利好'
  if (s === 'bearish') return '偏利空'
  if (s === 'watch') return '需关注'
  if (s === 'neutral') return '中性'
  return ''
}

function sentimentClass(s?: BriefSentiment): string {
  if (s === 'bullish') return 'sent bull'
  if (s === 'bearish') return 'sent bear'
  if (s === 'watch') return 'sent watch'
  return 'sent neut'
}

function toneClass(t?: BriefSentiment): string {
  if (t === 'bullish') return 'tone-up'
  if (t === 'bearish') return 'tone-down'
  if (t === 'watch') return 'tone-watch'
  return 'tone-muted'
}

function renderEmphasized(body: string, emphasis?: string[]): ReactNode {
  if (!emphasis?.length) return body
  const keys = emphasis.filter(Boolean).sort((a, b) => b.length - a.length)
  if (!keys.length) return body
  const re = new RegExp(`(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
  const parts = body.split(re)
  return parts.map((p, i) =>
    keys.includes(p) ? (
      <strong key={i} className="brief-em">
        {p}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

interface PremarketRow {
  symbol: string
  name: string
  changePercent: number | null
  gapPercent: number | null
  rvol: number | null
  newsCount: number
  newsTags: string[]
  dataNote: string
}

interface Props {
  onOpenSymbol?: (symbol: string, target?: 'watchlist' | 'portfolio') => void
}

export function BriefPage({ onOpenSymbol }: Props) {
  const [items, setItems] = useState<BriefItem[]>([])
  const [loading, setLoading] = useState(true)
  const [sourceId, setSourceId] = useState('')
  const [holdingCount, setHoldingCount] = useState(0)
  const [watchCount, setWatchCount] = useState(0)
  const [premarket, setPremarket] = useState<PremarketRow[]>([])
  const [pmLoading, setPmLoading] = useState(false)

  const load = () => {
    setLoading(true)
    const watchList = db.listWatchlist()
    const watchItems = watchList.map((w) => ({
      symbol: w.symbol,
      name: w.name,
      tag: w.tag,
      market: w.market,
    }))
    const positions = db.listPositions().map((p) => ({
      symbol: p.symbol,
      name: p.name,
      qty: p.qty,
    }))
    setHoldingCount(positions.length)
    setWatchCount(watchItems.length)
    const provider = getBriefProvider()
    setSourceId(provider.id)
    provider
      .fetchBrief(
        watchItems.map((w) => w.symbol),
        positions,
        watchItems,
      )
      .then((briefItems) => {
        setItems(briefItems)
        void buildPremarket(watchItems, briefItems)
      })
      .finally(() => setLoading(false))
  }

  const buildPremarket = async (
    watchItems: Array<{ symbol: string; name: string; tag: string; market: import('../types').Market }>,
    briefItems: BriefItem[],
  ) => {
    if (!watchItems.length) {
      setPremarket([])
      return
    }
    setPmLoading(true)
    try {
      const symbols = watchItems.map((w) => w.symbol)
      let quotes: Record<string, Quote> = {}
      try {
        const list = await quoteService.fetchQuotes(symbols)
        quotes = Object.fromEntries(list.map((q) => [q.symbol, q]))
      } catch {
        /* */
      }
      const volRows = await scanWatchlistVolume(
        watchItems.map((w) => ({
          symbol: w.symbol,
          name: w.name,
          market: w.market,
          tag: w.tag,
        })),
        (sym, days, period) => quoteService.fetchCandles(sym, days, period),
        db.getSettings().volumeLookback,
        quotes,
        3,
      )
      const rvolMap = Object.fromEntries(volRows.map((r) => [r.symbol, r.rvol]))

      const rows: PremarketRow[] = watchItems.map((w) => {
        const q = quotes[w.symbol]
        const changePercent = q && Number.isFinite(q.changePercent) ? q.changePercent : null
        let gapPercent: number | null = null
        if (q && q.prevClose > 0 && Number.isFinite(q.open) && q.open > 0) {
          gapPercent = ((q.open - q.prevClose) / q.prevClose) * 100
        }
        const hits = briefItems.filter(
          (it) =>
            it.symbols?.includes(w.symbol) &&
            it.matchMode &&
            it.matchMode !== 'none' &&
            it.id !== 'watch-empty',
        )
        const tags = Array.from(
          new Set(hits.flatMap((h) => [sentimentLabel(h.sentiment), ...(h.topics || [])]).filter(Boolean)),
        ).slice(0, 4)
        const notes: string[] = []
        if (!q) notes.push('行情不可用')
        else if (q.source === 'mock') notes.push('示意行情')
        else if (q.source === 'cache') notes.push('缓存行情')
        if (rvolMap[w.symbol] == null) notes.push('RVOL不可用')
        if (!hits.length) notes.push('无新闻命中')
        return {
          symbol: w.symbol,
          name: q?.name || w.name,
          changePercent,
          gapPercent,
          rvol: rvolMap[w.symbol] ?? null,
          newsCount: hits.length,
          newsTags: tags,
          dataNote: notes.join(' · ') || '可用',
        }
      })
      setPremarket(rows)
    } finally {
      setPmLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const grouped = useMemo(() => {
    const map = new Map<BriefSection, BriefItem[]>()
    for (const it of items) {
      const sec = it.section || 'general'
      const arr = map.get(sec) || []
      arr.push(it)
      map.set(sec, arr)
    }
    return map
  }, [items])

  const liveN = items.filter((i) => i.dataStatus === 'live').length
  const cacheN = items.filter((i) => i.dataStatus === 'cached').length
  const sampleN = items.filter((i) => i.dataStatus === 'sample').length

  const renderSummaryBlocks = (blocks: BriefSummaryBlock[]) => (
    <div className="brief-summary-blocks">
      {blocks.map((b) => (
        <div key={b.title} className={`brief-summary-block ${toneClass(b.tone)}`}>
          <h4 className="brief-summary-h">{b.title}</h4>
          <p className="brief-summary-p">{renderEmphasized(b.body, b.emphasis)}</p>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <header className="page-header">
        <div>
          <h2>日报</h2>
          <p className="subtitle">
            早盘新闻分析 · 源：{sourceId || '…'}
            {watchCount > 0 ? ` · 自选 ${watchCount}` : ''}
            {holdingCount > 0 ? ` · 持仓 ${holdingCount}` : ''}
            {liveN ? ` · 实时 ${liveN}` : ''}
            {cacheN ? ` · 缓存 ${cacheN}` : ''}
            {sampleN ? ` · 示意 ${sampleN}` : ''}
          </p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={load} disabled={loading}>
            刷新日报
          </button>
        </div>
      </header>
      <div className="page-body">
        <CollapsibleTip summary="日报说明 · 外链复用（点击展开）">
          公开源：人民日报财经、央视财经、华尔街见闻、BBC Business、美联储新闻稿、东财板块榜（均无密钥）。
          每条标注「实时/缓存/示意」；自选匹配若仅标题关键词会标明。「汇总分析」为基于已抓取新闻的规则短文，非 AI
          荐股。仅供研究，不构成投资建议。
          <br />
          <span className="muted">{EXTERNAL_LINK_HINT}。</span>
        </CollapsibleTip>

        {(watchCount > 0 || pmLoading) && (
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-header">
              <span>自选早盘 · 价量 + 新闻命中</span>
              <span className="muted">{pmLoading ? '加载中…' : `${premarket.length} 只`}</span>
            </div>
            {pmLoading && premarket.length === 0 ? (
              <div className="panel-body">
                <Skeleton rows={4} height={14} />
              </div>
            ) : premarket.length === 0 ? (
              <div className="empty-state compact">
                <p>暂无自选，或行情/新闻数据不可用。</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data dense">
                  <thead>
                    <tr>
                      <th>代码</th>
                      <th>较昨收</th>
                      <th>缺口</th>
                      <th>RVOL</th>
                      <th>新闻</th>
                      <th>命中标签</th>
                      <th>数据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {premarket.map((r) => {
                      const up = (r.changePercent ?? 0) >= 0
                      const gapUp = (r.gapPercent ?? 0) >= 0
                      const level = classifyRvol(r.rvol)
                      return (
                        <tr key={r.symbol} onClick={() => onOpenSymbol?.(r.symbol, 'watchlist')}>
                          <td>
                            <div className="mono">{r.symbol}</div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {r.name}
                            </div>
                          </td>
                          <td className={`mono ${r.changePercent == null ? '' : up ? 'up' : 'down'}`}>
                            {r.changePercent == null ? '—' : fmtPct(r.changePercent)}
                          </td>
                          <td className={`mono ${r.gapPercent == null ? '' : gapUp ? 'up' : 'down'}`}>
                            {r.gapPercent == null ? (
                              <span className="muted" title="开盘或昨收不可用">
                                不可用
                              </span>
                            ) : (
                              fmtPct(r.gapPercent)
                            )}
                          </td>
                          <td>
                            {r.rvol == null ? (
                              <span className="muted">—</span>
                            ) : (
                              <span className={`rvol-badge compact ${rvolLevelClass(level)}`}>
                                {r.rvol.toFixed(1)}×
                              </span>
                            )}
                          </td>
                          <td className="mono">{r.newsCount}</td>
                          <td>
                            {r.newsTags.length ? (
                              <span className="pm-tags">{r.newsTags.join(' · ')}</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="muted" style={{ fontSize: 11 }}>
                            {r.dataNote}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ fontSize: 11, margin: '8px 12px 10px' }}>
              隔夜价差≈较昨收；缺口=(开盘−昨收)/昨收。无可靠数据已标注。非投资建议。
            </p>
          </div>
        )}

        {loading ? (
          <div className="panel" style={{ padding: 16 }}>
            <Skeleton rows={8} height={16} />
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state panel">
            <h3>暂无日报</h3>
            <p>公开资讯源暂不可用，请稍后刷新。不会伪造实时新闻。</p>
          </div>
        ) : (
          <div className="brief-sections">
            {SECTION_ORDER.map(({ key, title }) => {
              const list = grouped.get(key)
              if (!list || list.length === 0) return null
              return (
                <section key={key} className="brief-section">
                  <h3 className="brief-section-title">{title}</h3>
                  <div className="brief-list">
                    {list.map((item) => (
                      <article
                        key={item.id}
                        className={`brief-card${item.category === 'holding' ? ' brief-holding' : ''}${
                          item.section === 'summary' ? ' brief-summary-card' : ''
                        }`}
                      >
                        <div className="brief-meta">
                          <span className={`badge ${item.category}`}>{CAT[item.category]}</span>
                          {item.dataStatus && (
                            <span className={statusClass(item.dataStatus)}>{statusLabel(item.dataStatus)}</span>
                          )}
                          {(item.matchMode === 'title_keyword' || item.matchMode === 'industry') && (
                            <span className="brief-status keyword">标题关键词关联</span>
                          )}
                          {item.sentiment && (
                            <span className={sentimentClass(item.sentiment)}>{sentimentLabel(item.sentiment)}</span>
                          )}
                          <span className="brief-source">{item.source}</span>
                          <span>·</span>
                          <span className="brief-time">{item.publishedAt}</span>
                        </div>
                        <h3 className="brief-title">{item.title}</h3>
                        {item.structuredSummary && item.structuredSummary.length > 0
                          ? renderSummaryBlocks(item.structuredSummary)
                          : (
                            <p className={item.section === 'summary' ? 'brief-summary-plain' : undefined}>
                              {item.summary}
                            </p>
                          )}
                        {item.topics && item.topics.length > 0 && (
                          <div className="topic-chips">
                            {item.topics.map((t) => (
                              <span key={t} className="topic-chip">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.symbols && item.symbols.length > 0 && (
                          <div className="symbol-chips">
                            {item.symbols.map((s) => {
                              const target = item.jumpTo || 'watchlist'
                              return (
                                <button
                                  key={s}
                                  type="button"
                                  className={`chip chip-on${target === 'portfolio' ? ' chip-portfolio' : ''}`}
                                  onClick={() => onOpenSymbol?.(s, target)}
                                  title={target === 'portfolio' ? '在模拟中打开' : '在盯盘中打开'}
                                >
                                  {s}
                                  <span className="chip-jump">
                                    {target === 'portfolio' ? ' · 模拟' : ' · 盯盘'}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {item.url && (
                          <ExternalLink href={item.url} style={{ fontSize: 12 }}>
                            原文链接
                          </ExternalLink>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
