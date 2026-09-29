import { useEffect, useMemo, useState } from 'react'
import { Skeleton } from '../components/Skeleton'
import * as db from '../services/db'
import { getBriefProvider } from '../services/quotes'
import type { BriefDataStatus, BriefItem, BriefSection, BriefSentiment } from '../types'

const CAT: Record<BriefItem['category'], string> = {
  news: '资讯',
  trend: '趋势',
  tip: '提示',
  holding: '持仓',
}

const SECTION_ORDER: Array<{ key: BriefSection; title: string }> = [
  { key: 'premarket', title: '盘前概览' },
  { key: 'holding', title: '持仓速览' },
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

interface Props {
  onOpenSymbol?: (symbol: string, target?: 'watchlist' | 'portfolio') => void
}

export function BriefPage({ onOpenSymbol }: Props) {
  const [items, setItems] = useState<BriefItem[]>([])
  const [loading, setLoading] = useState(true)
  const [sourceId, setSourceId] = useState('')
  const [holdingCount, setHoldingCount] = useState(0)
  const [watchCount, setWatchCount] = useState(0)

  const load = () => {
    setLoading(true)
    const watchItems = db.listWatchlist().map((w) => ({
      symbol: w.symbol,
      name: w.name,
      tag: w.tag,
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
      .then(setItems)
      .finally(() => setLoading(false))
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
        <div className="tip-banner">
          公开源：人民日报财经、央视财经、华尔街见闻、BBC Business、美联储新闻稿、东财板块榜（均无密钥）。
          每条标注「实时/缓存/示意」；自选匹配若仅标题关键词会标明。情绪为规则摘要，非荐股或 AI 预测。仅供研究，不构成投资建议。
        </div>

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
              // 跳过 meta 盘前卡自己重复分区标题
              return (
                <section key={key} className="brief-section">
                  <h3 className="brief-section-title">{title}</h3>
                  <div className="brief-list">
                    {list.map((item) => (
                      <article
                        key={item.id}
                        className={`brief-card${item.category === 'holding' ? ' brief-holding' : ''}`}
                      >
                        <div className="brief-meta">
                          <span className={`badge ${item.category}`}>{CAT[item.category]}</span>
                          {item.dataStatus && (
                            <span className={statusClass(item.dataStatus)}>{statusLabel(item.dataStatus)}</span>
                          )}
                          {(item.matchMode === 'title_keyword' || item.matchMode === 'industry') && (
                            <span className="brief-status keyword">标题关键词关联</span>
                          )}
                          {item.sentiment && item.symbols && item.symbols.length > 0 && (
                            <span className={sentimentClass(item.sentiment)}>
                              {sentimentLabel(item.sentiment)}
                            </span>
                          )}
                          <span>{item.source}</span>
                          <span>·</span>
                          <span>{item.publishedAt}</span>
                        </div>
                        <h3>{item.title}</h3>
                        <p>{item.summary}</p>
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
                          <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                            原文链接
                          </a>
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
