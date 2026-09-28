import { useEffect, useState } from 'react'
import { Skeleton } from '../components/Skeleton'
import * as db from '../services/db'
import { getBriefProvider } from '../services/quotes'
import type { BriefItem } from '../types'

const CAT: Record<BriefItem['category'], string> = {
  news: '资讯',
  trend: '趋势',
  tip: '提示',
  holding: '持仓',
}

interface Props {
  onOpenSymbol?: (symbol: string, target?: 'watchlist' | 'portfolio') => void
}

export function BriefPage({ onOpenSymbol }: Props) {
  const [items, setItems] = useState<BriefItem[]>([])
  const [loading, setLoading] = useState(true)
  const [sourceId, setSourceId] = useState('')
  const [holdingCount, setHoldingCount] = useState(0)

  const load = () => {
    setLoading(true)
    const watch = db.listWatchlist().map((w) => w.symbol)
    const positions = db.listPositions().map((p) => ({
      symbol: p.symbol,
      name: p.name,
      qty: p.qty,
    }))
    setHoldingCount(positions.length)
    const provider = getBriefProvider()
    setSourceId(provider.id)
    provider
      .fetchBrief(watch, positions)
      .then(setItems)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <>
      <header className="page-header">
        <div>
          <h2>日报</h2>
          <p className="subtitle">
            今日简报 · 自选 + 持仓关联 · 源：{sourceId || '…'}
            {holdingCount > 0 ? ` · 持仓 ${holdingCount} 只` : ''}
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
          💡 持仓速览置顶；自选相关靠前。点代码跳转盯盘或模拟（持仓卡片默认进模拟）。
        </div>

        {loading ? (
          <div className="panel" style={{ padding: 16 }}>
            <Skeleton rows={8} height={16} />
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state panel">
            <h3>暂无日报</h3>
            <p>接入资讯源后，这里会显示头条与趋势笔记。</p>
          </div>
        ) : (
          <div className="brief-list">
            {items.map((item) => (
              <article key={item.id} className={`brief-card${item.category === 'holding' ? ' brief-holding' : ''}`}>
                <div className="brief-meta">
                  <span className={`badge ${item.category}`}>{CAT[item.category]}</span>
                  <span>{item.source}</span>
                  <span>·</span>
                  <span>{item.publishedAt}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
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
                          <span className="chip-jump">{target === 'portfolio' ? ' · 模拟' : ' · 盯盘'}</span>
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
        )}
      </div>
    </>
  )
}
