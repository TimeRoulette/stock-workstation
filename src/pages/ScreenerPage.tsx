import { useCallback, useEffect, useState } from 'react'
import { Glossary } from '../components/Glossary'
import { SkeletonTable } from '../components/Skeleton'
import * as db from '../services/db'
import {
  fetchChangeRank,
  type ScreenerMarketTab,
  type ScreenerRow,
  type ScreenerSort,
} from '../services/screener'
import { normalizeSymbol } from '../services/quotes'
import { fmt, fmtPct, fmtTime, safeNum } from '../utils/format'
import type { ToastItem } from '../types'

interface Props {
  onToast?: (t: Omit<ToastItem, 'id'>) => void
  onFocusSymbol?: (symbol: string) => void
}

function fmtVol(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return fmt(n, 0)
}

function fmtAmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return fmt(n, 0)
}

const MARKET_TABS: Array<{ key: ScreenerMarketTab; label: string }> = [
  { key: 'A', label: 'A股' },
  { key: 'HK', label: '港股' },
  { key: 'US', label: '美股' },
]

export function ScreenerPage({ onToast, onFocusSymbol }: Props) {
  const [market, setMarket] = useState<ScreenerMarketTab>('A')
  const [sort, setSort] = useState<ScreenerSort>('gainers')
  const [rows, setRows] = useState<ScreenerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'eastmoney' | 'mock' | null>(null)
  const [asOf, setAsOf] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [watchSet, setWatchSet] = useState<Set<string>>(new Set())

  const reloadWatch = useCallback(() => {
    try {
      setWatchSet(new Set(db.listWatchlist().map((i) => i.symbol)))
    } catch {
      setWatchSet(new Set())
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchChangeRank(market, sort, 50)
      setRows(r.rows)
      setSource(r.source)
      setAsOf(r.asOf)
      setTotal(r.total)
      if (r.error) setError(r.error)
    } catch (e) {
      setRows([])
      setError(e instanceof Error ? e.message : '加载失败')
      setSource(null)
    } finally {
      setLoading(false)
    }
  }, [market, sort])

  useEffect(() => {
    reloadWatch()
    void load()
  }, [load, reloadWatch])

  useEffect(() => {
    const onRefresh = () => void load()
    window.addEventListener('sw:refresh-quotes', onRefresh)
    return () => window.removeEventListener('sw:refresh-quotes', onRefresh)
  }, [load])

  const addWatch = (row: ScreenerRow) => {
    const { symbol, market: mkt } = normalizeSymbol(row.symbol)
    try {
      if (watchSet.has(symbol)) {
        onToast?.({ message: `${symbol} 已在自选`, type: 'info' })
        return
      }
      db.addWatchlistItem(symbol, row.name, mkt)
      reloadWatch()
      onToast?.({ message: `已加入自选 ${symbol}`, type: 'success' })
    } catch (e) {
      onToast?.({
        message: e instanceof Error ? e.message : '加入自选失败',
        type: 'error',
      })
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h2>选股</h2>
          <p className="subtitle">
            涨跌幅排名
            {asOf ? ` · ${fmtTime(asOf)}` : ''}
            {source === 'eastmoney' ? ' · 东财公开榜' : source === 'mock' ? ' · 示意数据' : ''}
            {total > 0 ? ` · 全市场约 ${total}` : ''}
            {loading ? ' · 加载中' : ''}
          </p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn primary" onClick={() => void load()} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>

      <div className="page-body">
        <div className="tip-banner">
          数据来自东方财富公开 list 接口，通常有延迟，仅供学习研究，不构成投资建议。点代码可跳转盯盘；「+自选」加入本地自选。
        </div>

        <div className="toolbar screener-toolbar" style={{ marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
          <div className="seg-control" role="tablist" aria-label="市场">
            {MARKET_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={market === t.key ? 'active' : ''}
                onClick={() => setMarket(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="seg-control" role="tablist" aria-label="排序">
            <button
              type="button"
              className={sort === 'gainers' ? 'active' : ''}
              onClick={() => setSort('gainers')}
            >
              涨幅榜
            </button>
            <button
              type="button"
              className={sort === 'losers' ? 'active' : ''}
              onClick={() => setSort('losers')}
            >
              跌幅榜
            </button>
          </div>
        </div>

        {error && <div className="state-banner error">{error}</div>}

        {loading && rows.length === 0 ? (
          <div className="panel">
            <SkeletonTable rows={8} />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state panel">
            <h3>暂无榜单</h3>
            <p>请稍后重试，或检查网络。设置页可查看选股数据源健康状态。</p>
          </div>
        ) : (
          <div className="panel">
            <div className="panel-header">
              <span>
                {market === 'A' ? 'A股' : market === 'HK' ? '港股' : '美股'}
                {sort === 'gainers' ? '涨幅' : '跌幅'} · {rows.length} 条
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {source === 'eastmoney' ? '延迟行情' : '示意 · 非实盘'}
              </span>
            </div>
            <div className="table-scroll">
              <table className="data dense">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>代码</th>
                    <th>名称</th>
                    <th>最新价</th>
                    <th>涨跌幅</th>
                    <th>成交量</th>
                    <th>成交额</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const up = safeNum(r.changePercent) >= 0
                    const inWatch = watchSet.has(r.symbol)
                    return (
                      <tr key={`${r.symbol}-${r.rank}`} style={{ cursor: 'default' }}>
                        <td className="mono muted">{r.rank}</td>
                        <td>
                          <button
                            type="button"
                            className="link-symbol mono touch-target"
                            onClick={() => onFocusSymbol?.(r.symbol)}
                            title="在盯盘中打开"
                          >
                            {r.symbol}
                          </button>
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {r.name}
                        </td>
                        <td className={`mono ${up ? 'up' : 'down'}`}>
                          {fmt(r.price, safeNum(r.price) >= 100 ? 2 : 3)}
                        </td>
                        <td className={`mono ${up ? 'up' : 'down'}`}>{fmtPct(r.changePercent)}</td>
                        <td className="mono muted">{fmtVol(r.volume)}</td>
                        <td className="mono muted">{fmtAmt(r.amount)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-xs touch-target"
                            disabled={inWatch}
                            onClick={() => addWatch(r)}
                            title={inWatch ? '已在自选' : '加入自选'}
                          >
                            {inWatch ? '已自选' : '+自选'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <Glossary kind="screener" />
        </div>
      </div>
    </>
  )
}
