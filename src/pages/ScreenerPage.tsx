import { useCallback, useEffect, useRef, useState } from 'react'
import { Glossary } from '../components/Glossary'
import { SkeletonTable } from '../components/Skeleton'
import * as db from '../services/db'
import {
  fetchBoardConstituents,
  fetchBoardRank,
  fetchChangeRank,
  fetchFullMarketList,
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
import {
  clearTechCandleCache,
  MAIN_RISE_PARAMS,
  scanTechCandidates,
  TECH_RULES_TEXT,
  techConditionLabel,
  type TechCombineMode,
  type TechConditionId,
  type TechScanHit,
  type TechScanProgress,
} from '../services/techScreener'
import { normalizeSymbol, quoteService } from '../services/quotes'
import { fmt, fmtPct, fmtTime, safeNum } from '../utils/format'
import type { ToastItem } from '../types'

interface Props {
  onToast?: (t: Omit<ToastItem, 'id'>) => void
  onFocusSymbol?: (symbol: string) => void
}

type MainTab = 'stocks' | 'boards' | 'tech'

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

  // —— 技术筛选 ——
  const [techConds, setTechConds] = useState<TechConditionId[]>(['macd_golden'])
  const [techCombine, setTechCombine] = useState<TechCombineMode>('any')
  const [macdLookback, setMacdLookback] = useState(5)
  const [pressureWindow, setPressureWindow] = useState<20 | 60>(20)
  const [techHits, setTechHits] = useState<TechScanHit[]>([])
  const [techProgress, setTechProgress] = useState<TechScanProgress | null>(null)
  const [techScanning, setTechScanning] = useState(false)
  const [techError, setTechError] = useState<string | null>(null)
  const [techMockSkipped, setTechMockSkipped] = useState(0)
  const [techFailed, setTechFailed] = useState(0)
  const [techInsufficient, setTechInsufficient] = useState(0)
  /** top200=涨跌幅前200；full=全市场代码表 */
  const [techScope, setTechScope] = useState<'top200' | 'full'>('top200')
  const [techHitPage, setTechHitPage] = useState(1)
  const [listProgress, setListProgress] = useState<string | null>(null)
  const techAbort = useRef(0)
  const TECH_HIT_PAGE_SIZE = 20

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
    if (mainTab === 'tech') return
    if (mainTab === 'stocks') await loadStocks()
    else if (selectedBoard) await openBoard(selectedBoard)
    else await loadBoards()
  }, [loadBoards, loadStocks, mainTab, openBoard, selectedBoard])

  useEffect(() => {
    reloadWatch()
  }, [reloadWatch])

  // 主 Tab / 市场 / 板块类型切换：重置列表（loadBoards 会清详情）；技术 Tab 不自动扫
  useEffect(() => {
    if (mainTab === 'stocks') void loadStocks()
    else if (mainTab === 'boards') void loadBoards()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, market, boardKind])

  // 涨跌幅切换：保留板块详情态；跳过首轮避免与上一 effect 重复请求
  const skipFirstSort = useRef(true)
  useEffect(() => {
    if (skipFirstSort.current) {
      skipFirstSort.current = false
      return
    }
    if (mainTab === 'tech') return
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

  const addWatch = (row: ScreenerRow | BoardConstituent | TechScanHit) => {
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

  const toggleTechCond = (id: TechConditionId) => {
    setTechConds((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev
        return prev.filter((x) => x !== id)
      }
      return [...prev, id]
    })
  }

  const runTechScan = useCallback(async () => {
    const token = ++techAbort.current
    setTechScanning(true)
    setTechError(null)
    setTechHits([])
    setTechHitPage(1)
    setTechMockSkipped(0)
    setTechFailed(0)
    setTechInsufficient(0)
    setListProgress(null)
    setTechProgress({ done: 0, total: 0, hits: 0, failed: 0, mockSkipped: 0, insufficient: 0 })
    try {
      let all: ScreenerRow[] = []
      if (techScope === 'full') {
        setListProgress('正在分页拉取全市场代码表…')
        const r = await fetchFullMarketList(market, {
          shouldAbort: () => token !== techAbort.current,
          onProgress: (p) => {
            if (token !== techAbort.current) return
            setListProgress(`代码表 ${p.loaded}/${p.totalHint || '…'}（第 ${p.page} 页）`)
          },
        })
        if (token !== techAbort.current) return
        if (r.source === 'mock' || r.rows.length === 0) {
          setTechError(r.error || '全市场列表不可用，已停止（不使用示意列表）')
          setTechScanning(false)
          setListProgress(null)
          return
        }
        all = r.rows
        const truncNote = r.truncated ? '（已截断/中止，未拉完全部）' : ''
        setListProgress(`代码表就绪 ${all.length} 只${truncNote}，开始拉 K 线…`)
        if (market !== 'A') {
          setTechError(
            `提示：${market === 'HK' ? '港股' : '美股'}全列表有页数上限，当前已加载 ${all.length} 只（接口 total≈${r.total}）。`,
          )
        }
      } else {
        let page = 1
        let hasMore = true
        while (hasMore && page <= SCREENER_MAX_PAGES) {
          if (token !== techAbort.current) return
          const r = await fetchChangeRank(market, sort, { page, pageSize: SCREENER_PAGE_SIZE })
          if (token !== techAbort.current) return
          if (r.source === 'mock') {
            setTechError(
              r.error ||
                '涨跌幅榜为示意数据，已停止技术扫描（示意榜不可伪装为真实技术命中）',
            )
            setTechScanning(false)
            return
          }
          for (const row of r.rows) {
            if (!all.some((x) => x.symbol === row.symbol)) all.push(row)
          }
          hasMore = r.hasMore && page < SCREENER_MAX_PAGES
          page += 1
        }
      }
      if (token !== techAbort.current) return
      if (all.length === 0) {
        setTechError('无候选股票')
        setTechScanning(false)
        return
      }
      setTechProgress({ done: 0, total: all.length, hits: 0, failed: 0, mockSkipped: 0, insufficient: 0 })
      let mockSkip = 0
      let lastFailed = 0
      const hits = await scanTechCandidates(
        all,
        async (symbol, days) => {
          const meta = await quoteService.fetchCandlesWithMeta(symbol, days, '1d')
          if (meta.source === 'mock') mockSkip += 1
          return { candles: meta.candles, source: meta.source }
        },
        {
          conditions: techConds,
          combine: techCombine,
          macdLookback,
          pressureWindow,
          concurrency: techScope === 'full' ? 3 : 4,
          timeoutMs: 10000,
          shouldAbort: () => token !== techAbort.current,
          onProgress: (p) => {
            if (token !== techAbort.current) return
            setTechProgress(p)
            if (p.mockSkipped != null) setTechMockSkipped(p.mockSkipped)
            if (p.failed != null) {
              lastFailed = p.failed
              setTechFailed(p.failed)
            }
            if (p.insufficient != null) setTechInsufficient(p.insufficient)
          },
        },
      )
      if (token !== techAbort.current) return
      setTechMockSkipped(mockSkip)
      setTechHits(hits)
      setSource('eastmoney')
      setAsOf(new Date().toISOString())
      setListProgress(null)
      if (hits.length === 0) {
        setTechError(
          mockSkip > 0 || lastFailed > 0
            ? `扫描完成：无真实命中（示意跳过 ${mockSkip}，失败 ${lastFailed}）`
            : '扫描完成：当前条件无命中（规则偏严或数据不足属正常）',
        )
      } else if (market === 'A' || techScope === 'top200') {
        setTechError(null)
      }
    } catch (e) {
      if (token !== techAbort.current) return
      setTechError(e instanceof Error ? e.message : '技术扫描失败')
    } finally {
      if (token === techAbort.current) {
        setTechScanning(false)
        setListProgress(null)
      }
    }
  }, [macdLookback, market, pressureWindow, sort, techCombine, techConds, techScope])

  const stopTechScan = useCallback(() => {
    techAbort.current += 1
    setTechScanning(false)
    setListProgress(null)
    onToast?.({ message: '已请求停止扫描（进行中的请求会尽快结束）', type: 'info' })
  }, [onToast])

  const subtitle = (() => {
    const parts: string[] = []
    if (mainTab === 'tech') {
      parts.push('技术条件')
      if (techScanning && techProgress) {
        parts.push(`${techProgress.done}/${techProgress.total}`)
        parts.push(`命中 ${techProgress.hits}`)
        if (techScope === 'full') parts.push('全市场')
      } else if (techHits.length) {
        parts.push(`命中 ${techHits.length}`)
        if (techScope === 'full') parts.push('全市场')
      }
    } else if (mainTab === 'stocks') parts.push('个股涨跌幅')
    else if (selectedBoard) parts.push(`${selectedBoard.name} · 成分股`)
    else parts.push(boardKind === 'industry' ? '行业板块' : '概念板块')
    if (asOf) parts.push(fmtTime(asOf))
    if (mainTab !== 'tech') {
      if (source === 'eastmoney') parts.push('东财公开榜')
      else if (source === 'mock') parts.push('示意数据')
    }
    if (total > 0 && mainTab !== 'tech') parts.push(`全市场约 ${total}`)
    if (loading || techScanning) parts.push('加载中')
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
          {mainTab === 'tech' && techScanning ? (
            <button type="button" className="btn" onClick={stopTechScan}>
              停止
            </button>
          ) : null}
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (mainTab === 'tech') void runTechScan()
              else void load()
            }}
            disabled={loading || techScanning}
          >
            {mainTab === 'tech'
              ? techScanning
                ? '扫描中…'
                : techScope === 'full'
                  ? '全市场扫描'
                  : '开始扫描'
              : loading
                ? '刷新中…'
                : '刷新'}
          </button>
        </div>
      </header>

      <div className="page-body">
        <div className="tip-banner">
          数据来自东方财富公开 list 接口，通常有延迟，仅供学习研究，不构成投资建议。个股榜可加载至前{' '}
          {SCREENER_MAX_ROWS}；板块点开可看成分股，并标注龙头/中军。技术筛选可选涨跌幅前 {SCREENER_MAX_ROWS} 或全市场代码表；示意 K 线不计命中；失败跳过。
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
            <button
              type="button"
              className={mainTab === 'tech' ? 'active' : ''}
              onClick={() => {
                setMainTab('tech')
                setSelectedBoard(null)
              }}
            >
              技术筛选
            </button>
          </div>

          {(mainTab === 'stocks' || mainTab === 'tech') && (
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

        {error && mainTab !== 'tech' && <div className="state-banner error">{error}</div>}
        {techError && mainTab === 'tech' && (
          <div className={`state-banner ${techHits.length ? 'info' : 'error'}`}>{techError}</div>
        )}

        {/* —— 技术筛选 —— */}
        {mainTab === 'tech' ? (
          <>
            <div className="panel tech-panel" style={{ marginBottom: 12, padding: 12 }}>
              <div className="tech-rules" style={{ marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  勾选条件后扫描。范围可选涨跌幅前 {SCREENER_MAX_ROWS} 或全市场（A
                  股沪深主板+创业板+科创板；港/美有页数上限）。全市场并发 3、前200 并发
                  4；单票超时 10s；K 线缓存约 10 分钟。示意 K 线与失败均跳过不计命中。全市场约数千只，预计十余分钟，可随时点「停止」。
                </div>
                <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  {(
                    ['main_rise', 'volume_wash', 'macd_golden', 'breakout_pullback'] as TechConditionId[]
                  ).map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`chip touch-target ${techConds.includes(id) ? 'chip-on' : ''}`}
                      onClick={() => toggleTechCond(id)}
                    >
                      {techConditionLabel(id)}
                    </button>
                  ))}
                </div>
                <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div className="seg-control" role="tablist" aria-label="扫描范围">
                    <button
                      type="button"
                      className={techScope === 'top200' ? 'active' : ''}
                      disabled={techScanning}
                      onClick={() => setTechScope('top200')}
                    >
                      前 {SCREENER_MAX_ROWS}
                    </button>
                    <button
                      type="button"
                      className={techScope === 'full' ? 'active' : ''}
                      disabled={techScanning}
                      onClick={() => setTechScope('full')}
                    >
                      全市场扫描
                    </button>
                  </div>
                  {techScope === 'full' && (
                    <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                      预计耗时：A 股全市场约 10–20 分钟（视网络/中继）
                    </span>
                  )}
                </div>
                <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div className="seg-control" role="tablist" aria-label="组合">
                    <button
                      type="button"
                      className={techCombine === 'any' ? 'active' : ''}
                      onClick={() => setTechCombine('any')}
                    >
                      任一条件
                    </button>
                    <button
                      type="button"
                      className={techCombine === 'all' ? 'active' : ''}
                      onClick={() => setTechCombine('all')}
                    >
                      全部条件
                    </button>
                  </div>
                  <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    金叉回看
                    <select
                      value={macdLookback}
                      onChange={(e) => setMacdLookback(Number(e.target.value))}
                      disabled={techScanning}
                    >
                      {[3, 5, 8, 10].map((n) => (
                        <option key={n} value={n}>
                          {n} 日
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    压力窗口
                    <select
                      value={pressureWindow}
                      onChange={(e) => setPressureWindow(Number(e.target.value) as 20 | 60)}
                      disabled={techScanning}
                    >
                      <option value={20}>20 日</option>
                      <option value={60}>60 日</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={techScanning}
                    onClick={() => {
                      clearTechCandleCache()
                      onToast?.({ message: '已清空技术筛选 K 线缓存', type: 'info' })
                    }}
                  >
                    清缓存
                  </button>
                </div>
                <details className="tech-rule-details">
                  <summary>查看规则阈值</summary>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)' }}>
                    <li>{TECH_RULES_TEXT.main_rise}</li>
                    <li>{TECH_RULES_TEXT.volume_wash}</li>
                    <li>{TECH_RULES_TEXT.macd_golden}</li>
                    <li>{TECH_RULES_TEXT.breakout_pullback}</li>
                    <li>
                      主升参数：回看 {MAIN_RISE_PARAMS.lookback} 日、摆动半宽{' '}
                      {MAIN_RISE_PARAMS.swingHalfWidth}、间隔≥{MAIN_RISE_PARAMS.minSwingGap}、更高低点×
                      {MAIN_RISE_PARAMS.higherLowRatio}、量比≥{MAIN_RISE_PARAMS.volRatioMin}（近{' '}
                      {MAIN_RISE_PARAMS.volLookback} 日）。
                    </li>
                  </ul>
                </details>
              </div>
              {(listProgress || (techScanning && techProgress)) && (
                <div className="tech-progress">
                  {techProgress && techProgress.total > 0 && (
                    <div className="tech-progress-bar">
                      <div
                        style={{
                          width: `${(100 * techProgress.done) / techProgress.total}%`,
                        }}
                      />
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    {listProgress ? `${listProgress} · ` : ''}
                    {techProgress && techProgress.total > 0
                      ? `已扫描 ${techProgress.done}/${techProgress.total}`
                      : techScanning
                        ? '准备中…'
                        : ''}
                    {techProgress?.current ? ` · ${techProgress.current}` : ''} · 命中{' '}
                    {techProgress?.hits ?? 0}
                    {techFailed ? ` · 失败 ${techFailed}` : ''}
                    {techMockSkipped ? ` · 示意跳过 ${techMockSkipped}` : ''}
                    {techInsufficient ? ` · K线不足 ${techInsufficient}` : ''}
                  </div>
                </div>
              )}
            </div>

            {!techScanning && techHits.length === 0 ? (
              <div className="empty-state panel">
                <h3>尚未扫描或无命中</h3>
                <p>选择条件后点右上角「开始扫描」。数据不足或仅有示意 K 线时不会假命中。</p>
              </div>
            ) : techHits.length > 0 ? (
              <div className="panel">
                <div className="panel-header">
                  <span>
                    技术命中 · {techHits.length} 只
                    {techMockSkipped ? ` · 示意跳过 ${techMockSkipped}` : ''}
                    {techFailed ? ` · 失败 ${techFailed}` : ''}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    仅真实 K 线 · 非投资建议
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
                        <th>数据</th>
                        <th>命中依据</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {techHits
                        .slice((techHitPage - 1) * TECH_HIT_PAGE_SIZE, techHitPage * TECH_HIT_PAGE_SIZE)
                        .map((r, i) => {
                        const idx = (techHitPage - 1) * TECH_HIT_PAGE_SIZE + i
                        const up = safeNum(r.changePercent) >= 0
                        const inWatch = watchSet.has(r.symbol)
                        return (
                          <tr key={r.symbol}>
                            <td className="mono muted">{idx + 1}</td>
                            <td>
                              <button
                                type="button"
                                className="link-symbol mono touch-target"
                                onClick={() => onFocusSymbol?.(r.symbol)}
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
                            <td>
                              <span className="brief-status live">真实</span>
                              <div className="muted mono" style={{ fontSize: 11 }}>
                                {r.candleCount}根 · {r.lastBarDate || '—'}
                              </div>
                            </td>
                            <td style={{ fontSize: 12, maxWidth: 280 }}>
                              {r.hits.map((h) => (
                                <div key={h.condition + h.label} style={{ marginBottom: 4 }}>
                                  <strong>{h.label}</strong>：{h.detail}
                                </div>
                              ))}
                            </td>
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
                {techHits.length > TECH_HIT_PAGE_SIZE && (
                  <div
                    className="toolbar"
                    style={{ padding: 12, justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}
                  >
                    <button
                      type="button"
                      className="btn btn-xs touch-target"
                      disabled={techHitPage <= 1}
                      onClick={() => setTechHitPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </button>
                    <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                      {techHitPage}/{Math.ceil(techHits.length / TECH_HIT_PAGE_SIZE)} 页 · 每页{' '}
                      {TECH_HIT_PAGE_SIZE}
                    </span>
                    <button
                      type="button"
                      className="btn btn-xs touch-target"
                      disabled={techHitPage >= Math.ceil(techHits.length / TECH_HIT_PAGE_SIZE)}
                      onClick={() =>
                        setTechHitPage((p) =>
                          Math.min(Math.ceil(techHits.length / TECH_HIT_PAGE_SIZE), p + 1),
                        )
                      }
                    >
                      下一页
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </>
        ) : mainTab === 'boards' && selectedBoard ? (
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
