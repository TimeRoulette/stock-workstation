import { useCallback, useEffect, useRef, useState } from 'react'
import { Glossary } from '../components/Glossary'
import { SkeletonTable } from '../components/Skeleton'
import * as db from '../services/db'
import {
  fetchBoardConstituents,
  fetchBoardRank,
  fetchChangeRank,
  LEADER_MID_RULES,
  SCREENER_MAX_PAGES,
  SCREENER_MAX_ROWS,
  SCREENER_PAGE_SIZE,
  type BoardConstituent,
  type BoardKind,
  type BoardRow,
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

type MainTab = 'stocks' | 'boards'

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

const BOARD_KIND_TABS: Array<{ key: BoardKind; label: string }> = [
  { key: 'industry', label: '行业' },
  { key: 'concept', label: '概念' },
]

function RoleBadge({ role }: { role: BoardConstituent['role'] }) {
  if (role === 'leader') return <span className="role-badge role-leader" title="龙头">龙头</span>
  if (role === 'mid') return <span className="role-badge role-mid" title="中军">中军</span>
  return null
}

export function ScreenerPage({ onToast, onFocusSymbol }: Props) {
  const [mainTab, setMainTab] = useState<MainTab>('stocks')
  const [market, setMarket] = useState<ScreenerMarketTab>('A')
  const [sort, setSort] = useState<ScreenerSort>('gainers')
  const [boardKind, setBoardKind] = useState<BoardKind>('industry')

  const [rows, setRows] = useState<ScreenerRow[]>([])
  const [stockPage, setStockPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [boards, setBoards] = useState<BoardRow[]>([])
  const [selectedBoard, setSelectedBoard] = useState<BoardRow | null>(null)
  const [constituents, setConstituents] = useState<BoardConstituent[]>([])
  const [roleRules, setRoleRules] = useState(LEADER_MID_RULES)

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

  const loadStocks = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelectedBoard(null)
    try {
      const r = await fetchChangeRank(market, sort, { page: 1, pageSize: SCREENER_PAGE_SIZE })
      setRows(r.rows)
      setStockPage(r.page)
      setHasMore(r.hasMore)
      setSource(r.source)
      setAsOf(r.asOf)
      setTotal(r.total)
      if (r.error) setError(r.error)
    } catch (e) {
      setRows([])
      setHasMore(false)
      setError(e instanceof Error ? e.message : '加载失败')
      setSource(null)
    } finally {
      setLoading(false)
    }
  }, [market, sort])

  const loadMoreStocks = useCallback(async () => {
    if (loadingMore || !hasMore || stockPage >= SCREENER_MAX_PAGES) return
    setLoadingMore(true)
    setError(null)
    try {
      const next = stockPage + 1
      const r = await fetchChangeRank(market, sort, { page: next, pageSize: SCREENER_PAGE_SIZE })
      setRows((prev) => {
        const merged = [...prev]
        for (const row of r.rows) {
          if (!merged.some((x) => x.symbol === row.symbol)) merged.push(row)
        }
        return merged.map((row, i) => ({ ...row, rank: i + 1 }))
      })
      setStockPage(r.page)
      setHasMore(r.hasMore && next < SCREENER_MAX_PAGES)
      setSource(r.source)
      setAsOf(r.asOf)
      if (r.total) setTotal(r.total)
      if (r.error) setError(r.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载更多失败')
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, market, sort, stockPage])

  const loadBoards = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelectedBoard(null)
    setConstituents([])
    try {
      const r = await fetchBoardRank(boardKind, sort, 50)
      setBoards(r.rows)
      setSource(r.source)
      setAsOf(r.asOf)
      setTotal(r.total)
      if (r.error) setError(r.error)
    } catch (e) {
      setBoards([])
      setError(e instanceof Error ? e.message : '板块榜加载失败')
      setSource(null)
    } finally {
      setLoading(false)
    }
  }, [boardKind, sort])

  const openBoard = useCallback(
    async (board: BoardRow) => {
      setSelectedBoard(board)
      setLoading(true)
      setError(null)
      try {
        const r = await fetchBoardConstituents(board, sort, 80)
        setConstituents(r.rows)
        setSource(r.source)
        setAsOf(r.asOf)
        setTotal(r.total)
        setRoleRules(r.roleRules)
        if (r.error) setError(r.error)
      } catch (e) {
        setConstituents([])
        setError(e instanceof Error ? e.message : '成分股加载失败')
      } finally {
        setLoading(false)
      }
    },
    [sort],
  )

  const load = useCallback(async () => {
    if (mainTab === 'stocks') await loadStocks()
    else if (selectedBoard) await openBoard(selectedBoard)
    else await loadBoards()
  }, [loadBoards, loadStocks, mainTab, openBoard, selectedBoard])

  useEffect(() => {
    reloadWatch()
  }, [reloadWatch])

  // 主 Tab / 市场 / 板块类型切换：重置列表（loadBoards 会清详情）
  useEffect(() => {
    if (mainTab === 'stocks') void loadStocks()
    else void loadBoards()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, market, boardKind])

  // 涨跌幅切换：保留板块详情态；跳过首轮避免与上一 effect 重复请求
  const skipFirstSort = useRef(true)
  useEffect(() => {
    if (skipFirstSort.current) {
      skipFirstSort.current = false
      return
    }
    if (mainTab === 'stocks') void loadStocks()
    else if (selectedBoard) void openBoard(selectedBoard)
    else void loadBoards()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort])

  useEffect(() => {
    const onRefresh = () => void load()
    window.addEventListener('sw:refresh-quotes', onRefresh)
    return () => window.removeEventListener('sw:refresh-quotes', onRefresh)
  }, [load])

  const addWatch = (row: ScreenerRow | BoardConstituent) => {
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

  const subtitle = (() => {
    const parts: string[] = []
    if (mainTab === 'stocks') parts.push('个股涨跌幅')
    else if (selectedBoard) parts.push(`${selectedBoard.name} · 成分股`)
    else parts.push(boardKind === 'industry' ? '行业板块' : '概念板块')
    if (asOf) parts.push(fmtTime(asOf))
    if (source === 'eastmoney') parts.push('东财公开榜')
    else if (source === 'mock') parts.push('示意数据')
    if (total > 0) parts.push(`全市场约 ${total}`)
    if (loading) parts.push('加载中')
    return parts.join(' · ')
  })()

  return (
    <>
      <header className="page-header">
        <div>
          <h2>选股</h2>
          <p className="subtitle">{subtitle}</p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn primary" onClick={() => void load()} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>

      <div className="page-body">
        <div className="tip-banner">
          数据来自东方财富公开 list 接口，通常有延迟，仅供学习研究，不构成投资建议。个股榜可加载至前{' '}
          {SCREENER_MAX_ROWS}；板块点开可看成分股，并标注龙头/中军。
        </div>

        <div className="toolbar screener-toolbar" style={{ marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
          <div className="seg-control" role="tablist" aria-label="选股主栏">
            <button
              type="button"
              className={mainTab === 'stocks' ? 'active' : ''}
              onClick={() => {
                setMainTab('stocks')
                setSelectedBoard(null)
              }}
            >
              个股榜
            </button>
            <button
              type="button"
              className={mainTab === 'boards' ? 'active' : ''}
              onClick={() => {
                setMainTab('boards')
                setSelectedBoard(null)
              }}
            >
              板块榜
            </button>
          </div>

          {mainTab === 'stocks' && (
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
          )}

          {mainTab === 'boards' && !selectedBoard && (
            <div className="seg-control" role="tablist" aria-label="板块类型">
              {BOARD_KIND_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={boardKind === t.key ? 'active' : ''}
                  onClick={() => setBoardKind(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

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

        {/* —— 板块详情 —— */}
        {mainTab === 'boards' && selectedBoard ? (
          <>
            <div className="toolbar" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn touch-target"
                onClick={() => {
                  setSelectedBoard(null)
                  setConstituents([])
                }}
              >
                ← 返回板块榜
              </button>
              <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                {selectedBoard.code} · {selectedBoard.kind === 'industry' ? '行业' : '概念'} ·{' '}
                {fmtPct(selectedBoard.changePercent)}
              </span>
            </div>
            <div className="tip-banner" style={{ marginBottom: 12 }}>
              {roleRules}
            </div>
            {loading && constituents.length === 0 ? (
              <div className="panel">
                <SkeletonTable rows={8} />
              </div>
            ) : constituents.length === 0 ? (
              <div className="empty-state panel">
                <h3>暂无成分股</h3>
                <p>请稍后重试，或返回板块榜另选。</p>
              </div>
            ) : (
              <div className="panel">
                <div className="panel-header">
                  <span>
                    {selectedBoard.name} · {constituents.length} 只
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
                        <th>角色</th>
                        <th>最新价</th>
                        <th>涨跌幅</th>
                        <th>成交额</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {constituents.map((r) => {
                        const up = safeNum(r.changePercent) >= 0
                        const inWatch = watchSet.has(r.symbol)
                        return (
                          <tr key={`${r.symbol}-${r.rank}`}>
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
                            <td>
                              <RoleBadge role={r.role} />
                            </td>
                            <td className={`mono ${up ? 'up' : 'down'}`}>
                              {fmt(r.price, safeNum(r.price) >= 100 ? 2 : 3)}
                            </td>
                            <td className={`mono ${up ? 'up' : 'down'}`}>{fmtPct(r.changePercent)}</td>
                            <td className="mono muted">{fmtAmt(r.amount)}</td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-xs touch-target"
                                disabled={inWatch}
                                onClick={() => addWatch(r)}
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
          </>
        ) : mainTab === 'boards' ? (
          /* —— 板块榜 —— */
          loading && boards.length === 0 ? (
            <div className="panel">
              <SkeletonTable rows={8} />
            </div>
          ) : boards.length === 0 ? (
            <div className="empty-state panel">
              <h3>暂无板块榜</h3>
              <p>请稍后重试，或检查网络。</p>
            </div>
          ) : (
            <div className="panel">
              <div className="panel-header">
                <span>
                  {boardKind === 'industry' ? '行业' : '概念'}
                  {sort === 'gainers' ? '涨幅' : '跌幅'} · {boards.length} 条
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
                      <th>板块</th>
                      <th>涨跌幅</th>
                      <th>上涨/下跌</th>
                      <th>成交额</th>
                      <th>领涨</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {boards.map((b) => {
                      const up = safeNum(b.changePercent) >= 0
                      return (
                        <tr key={b.code}>
                          <td className="mono muted">{b.rank}</td>
                          <td>
                            <button
                              type="button"
                              className="link-symbol touch-target"
                              onClick={() => void openBoard(b)}
                              title="查看成分股"
                            >
                              {b.name}
                            </button>
                            <div className="muted mono" style={{ fontSize: 11 }}>
                              {b.code}
                            </div>
                          </td>
                          <td className={`mono ${up ? 'up' : 'down'}`}>{fmtPct(b.changePercent)}</td>
                          <td className="mono muted">
                            <span className="up">{b.upCount}</span>
                            {' / '}
                            <span className="down">{b.downCount}</span>
                          </td>
                          <td className="mono muted">{fmtAmt(b.amount)}</td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {b.leadName || '—'}
                            {Number.isFinite(b.leadPct) ? (
                              <span className={`mono ${b.leadPct >= 0 ? 'up' : 'down'}`}>
                                {' '}
                                {fmtPct(b.leadPct)}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-xs touch-target"
                              onClick={() => void openBoard(b)}
                            >
                              详情
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : /* —— 个股榜 —— */
        loading && rows.length === 0 ? (
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
                {rows.length < SCREENER_MAX_ROWS ? ` / 最多 ${SCREENER_MAX_ROWS}` : ''}
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
            {hasMore && stockPage < SCREENER_MAX_PAGES && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn primary touch-target"
                  disabled={loadingMore}
                  onClick={() => void loadMoreStocks()}
                >
                  {loadingMore
                    ? '加载中…'
                    : `加载更多（第 ${stockPage + 1}/${SCREENER_MAX_PAGES} 页 · 每页 ${SCREENER_PAGE_SIZE}）`}
                </button>
              </div>
            )}
            {!hasMore && rows.length > 0 && (
              <div className="muted" style={{ padding: '8px 12px 12px', fontSize: 12, textAlign: 'center' }}>
                已显示 {rows.length} 条
                {rows.length >= SCREENER_MAX_ROWS ? `（上限 ${SCREENER_MAX_ROWS}）` : ''}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <Glossary kind="screener" />
        </div>
      </div>
    </>
  )
}
