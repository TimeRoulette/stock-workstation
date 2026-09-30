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
import {
  clearTechScanSnapshot,
  loadTechScanSnapshot,
  saveTechScanSnapshot,
  snapshotSummary,
  type TechScanScope,
  type TechScanSnapshot,
} from '../services/scanSnapshot'
import { isPagesHost } from '../utils/dataStatus'
import { Icons } from '../components/Icon'
import { BOARD_KIND_TABS, MARKET_TABS, RoleBadge, fmtAmt, fmtVol } from './screener/helpers'

interface Props {
  onToast?: (t: Omit<ToastItem, 'id'>) => void
  onFocusSymbol?: (symbol: string) => void
}

type MainTab = 'stocks' | 'boards' | 'tech'


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
  /** top200=涨跌幅前200；watchlist=自选；full=全市场代码表 */
  const [techScope, setTechScope] = useState<TechScanScope>('top200')
  const [techHitPage, setTechHitPage] = useState(1)
  const [listProgress, setListProgress] = useState<string | null>(null)
  const techAbort = useRef(0)
  const TECH_HIT_PAGE_SIZE = 20
  const [lastSnapshot, setLastSnapshot] = useState<TechScanSnapshot | null>(() => loadTechScanSnapshot())
  const scanStartedAt = useRef<string | null>(null)
  const pagesHost = isPagesHost()
  const isElectron = Boolean(typeof window !== 'undefined' && window.stockWorkstation?.isElectron)

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

  const persistScanSnapshot = useCallback(
    (opts: {
      hits: TechScanHit[]
      incomplete: boolean
      progress: TechScanProgress | null
      mockSkipped: number
      failed: number
      insufficient: number
      completedAt: string | null
    }) => {
      const started = scanStartedAt.current || new Date().toISOString()
      const snap = {
        meta: {
          scope: techScope,
          market,
          conditions: [...techConds],
          combine: techCombine,
          macdLookback,
          pressureWindow,
          startedAt: started,
          updatedAt: new Date().toISOString(),
          completedAt: opts.completedAt,
          incomplete: opts.incomplete,
          progress: opts.progress,
          mockSkipped: opts.mockSkipped,
          failed: opts.failed,
          insufficient: opts.insufficient,
        },
        hits: opts.hits,
      }
      saveTechScanSnapshot(snap)
      setLastSnapshot(loadTechScanSnapshot())
    },
    [macdLookback, market, pressureWindow, techCombine, techConds, techScope],
  )

  const runTechScan = useCallback(async () => {
    if (techScope === 'full' && pagesHost && !isElectron) {
      const ok = confirm(
        '全市场扫描在公开站（GitHub Pages）上通常很慢，且受 CORS/中继限制，可能中途失败。\n\n推荐：本机 npm run dev 或 Electron。\n\n仍要继续？',
      )
      if (!ok) return
    }
    const token = ++techAbort.current
    scanStartedAt.current = new Date().toISOString()
    setTechScanning(true)
    setTechError(null)
    setTechHits([])
    setTechHitPage(1)
    setTechMockSkipped(0)
    setTechFailed(0)
    setTechInsufficient(0)
    setListProgress(null)
    setTechProgress({ done: 0, total: 0, hits: 0, failed: 0, mockSkipped: 0, insufficient: 0 })
    let latestHits: TechScanHit[] = []
    let latestProgress: TechScanProgress | null = {
      done: 0,
      total: 0,
      hits: 0,
      failed: 0,
      mockSkipped: 0,
      insufficient: 0,
    }
    let mockSkip = 0
    let lastFailed = 0
    let lastInsufficient = 0
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
          setTechError(r.error || '全市场列表不可用，已停止（不使用演示列表）')
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
      } else if (techScope === 'watchlist') {
        const wl = db.listWatchlist()
        if (wl.length === 0) {
          setTechError('自选为空，请先在盯盘加入股票，或改用「前200 / 板块」')
          setTechScanning(false)
          return
        }
        all = wl.map((w, i) => ({
          rank: i + 1,
          symbol: w.symbol,
          name: w.name,
          market: w.market,
          price: 0,
          changePercent: 0,
          volume: 0,
          amount: 0,
        }))
        setListProgress(`自选 ${all.length} 只，开始拉 K 线…`)
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
                '涨跌幅榜为演示数据，已停止技术扫描（演示榜不可伪装为真实技术命中）',
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
            latestProgress = p
            setTechProgress(p)
            if (p.mockSkipped != null) setTechMockSkipped(p.mockSkipped)
            if (p.failed != null) {
              lastFailed = p.failed
              setTechFailed(p.failed)
            }
            if (p.insufficient != null) {
              lastInsufficient = p.insufficient
              setTechInsufficient(p.insufficient)
            }
            // 周期性保存进度元数据（命中列表在结束时再写完整）
            if (p.done > 0 && p.done % 25 === 0) {
              persistScanSnapshot({
                hits: latestHits,
                incomplete: true,
                progress: p,
                mockSkipped: p.mockSkipped ?? mockSkip,
                failed: p.failed ?? lastFailed,
                insufficient: p.insufficient ?? lastInsufficient,
                completedAt: null,
              })
            }
          },
        },
      )
      latestHits = hits
      if (token !== techAbort.current) {
        // 被中止：保存已有命中与进度
        persistScanSnapshot({
          hits: latestHits,
          incomplete: true,
          progress: latestProgress,
          mockSkipped: mockSkip,
          failed: lastFailed,
          insufficient: lastInsufficient,
          completedAt: null,
        })
        return
      }
      setTechMockSkipped(mockSkip)
      setTechHits(hits)
      setSource('eastmoney')
      setAsOf(new Date().toISOString())
      setListProgress(null)
      persistScanSnapshot({
        hits,
        incomplete: false,
        progress: latestProgress,
        mockSkipped: mockSkip,
        failed: lastFailed,
        insufficient: lastInsufficient,
        completedAt: new Date().toISOString(),
      })
      if (hits.length === 0) {
        setTechError(
          mockSkip > 0 || lastFailed > 0
            ? `扫描完成：无真实命中（演示跳过 ${mockSkip}，失败 ${lastFailed}）`
            : '扫描完成：当前条件无命中（规则偏严或数据不足属正常）',
        )
      } else if (market === 'A' || techScope === 'top200' || techScope === 'watchlist') {
        setTechError(null)
      }
    } catch (e) {
      if (token !== techAbort.current) return
      setTechError(e instanceof Error ? e.message : '技术扫描失败')
      persistScanSnapshot({
        hits: latestHits,
        incomplete: true,
        progress: latestProgress,
        mockSkipped: mockSkip,
        failed: lastFailed,
        insufficient: lastInsufficient,
        completedAt: null,
      })
    } finally {
      if (token === techAbort.current) {
        setTechScanning(false)
        setListProgress(null)
      }
    }
  }, [
    isElectron,
    macdLookback,
    market,
    pagesHost,
    persistScanSnapshot,
    pressureWindow,
    sort,
    techCombine,
    techConds,
    techScope,
  ])

  const stopTechScan = useCallback(() => {
    techAbort.current += 1
    setTechScanning(false)
    setListProgress(null)
    // 保存中止时的进度元数据与当前命中
    persistScanSnapshot({
      hits: techHits,
      incomplete: true,
      progress: techProgress,
      mockSkipped: techMockSkipped,
      failed: techFailed,
      insufficient: techInsufficient,
      completedAt: null,
    })
    onToast?.({ message: '已停止并保存进度快照，可稍后查看上次结果', type: 'info' })
  }, [
    onToast,
    persistScanSnapshot,
    techFailed,
    techHits,
    techInsufficient,
    techMockSkipped,
    techProgress,
  ])

  const applyPreset = (id: 'main_rise' | 'volume_wash' | 'macd_golden') => {
    setTechConds([id])
    setTechCombine('any')
    if (id === 'macd_golden') setMacdLookback(5)
    onToast?.({ message: `已套用预置：${techConditionLabel(id)}`, type: 'info' })
  }

  const loadLastSnapshot = () => {
    const s = loadTechScanSnapshot()
    if (!s) {
      onToast?.({ message: '暂无扫描快照', type: 'info' })
      return
    }
    setLastSnapshot(s)
    setTechHits(s.hits)
    setTechConds(s.meta.conditions.length ? s.meta.conditions : ['macd_golden'])
    setTechCombine(s.meta.combine)
    setTechScope(s.meta.scope)
    setMacdLookback(s.meta.macdLookback)
    setPressureWindow(s.meta.pressureWindow)
    setTechMockSkipped(s.meta.mockSkipped)
    setTechFailed(s.meta.failed)
    setTechInsufficient(s.meta.insufficient)
    setTechProgress(s.meta.progress)
    setTechHitPage(1)
    setTechError(
      s.meta.incomplete
        ? `已加载未完成快照（${snapshotSummary(s)}）。可改范围后重新扫描；全量「继续」需重新跑剩余标的（进度已记录）。`
        : `已加载上次结果（${snapshotSummary(s)}）`,
    )
    onToast?.({ message: '已加载扫描快照', type: 'success' })
  }

  const resumeIncomplete = () => {
    const s = loadTechScanSnapshot()
    if (!s || !s.meta.incomplete) {
      onToast?.({ message: '没有未完成的扫描可继续', type: 'info' })
      return
    }
    setTechScope(s.meta.scope)
    setTechConds(s.meta.conditions.length ? s.meta.conditions : techConds)
    setTechCombine(s.meta.combine)
    setMacdLookback(s.meta.macdLookback)
    setPressureWindow(s.meta.pressureWindow)
    setTechHits(s.hits)
    onToast?.({
      message: `已恢复条件与部分命中（${s.hits.length}）。点「开始扫描」将重新跑该范围（进度 ${s.meta.progress?.done || 0}/${s.meta.progress?.total || '?'} 已记录）。`,
      type: 'info',
    })
  }

  const subtitle = (() => {
    const parts: string[] = []
    if (mainTab === 'tech') {
      parts.push('技术条件')
      if (techScanning && techProgress) {
        parts.push(`${techProgress.done}/${techProgress.total}`)
        parts.push(`命中 ${techProgress.hits}`)
        if (techScope === 'full') parts.push('全市场')
        else if (techScope === 'watchlist') parts.push('自选')
      } else if (techHits.length) {
        parts.push(`命中 ${techHits.length}`)
        if (techScope === 'full') parts.push('全市场')
        else if (techScope === 'watchlist') parts.push('自选')
      }
    } else if (mainTab === 'stocks') parts.push('个股涨跌幅')
    else if (selectedBoard) parts.push(`${selectedBoard.name} · 成分股`)
    else parts.push(boardKind === 'industry' ? '行业板块' : '概念板块')
    if (asOf) parts.push(fmtTime(asOf))
    if (mainTab !== 'tech') {
      if (source === 'eastmoney') parts.push('东财公开榜')
      else if (source === 'mock') parts.push('演示数据')
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
                  : techScope === 'watchlist'
                    ? '扫描自选'
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
          {SCREENER_MAX_ROWS}；板块点开可看成分股，并标注龙头/中军。技术筛选推荐前 {SCREENER_MAX_ROWS}/自选；全市场慢且公开站受限。结果可本地快照；演示 K 不计命中。
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
                  勾选条件或点预置卡后扫描。优先用前 {SCREENER_MAX_ROWS} / 自选 / 板块；全市场慢且 Pages
                  常受限，推荐本机或 Electron。并发：全市场 3、其它 4；超时 10s；K 线缓存约 10
                  分钟。演示 K 与失败跳过。可停止并保存快照。
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
                <div className="tech-preset-row" style={{ marginBottom: 10 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    预置条件（一点套好）
                  </div>
                  <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="chip touch-target tech-preset-card"
                      disabled={techScanning}
                      onClick={() => applyPreset('main_rise')}
                    >
                      主升趋势
                    </button>
                    <button
                      type="button"
                      className="chip touch-target tech-preset-card"
                      disabled={techScanning}
                      onClick={() => applyPreset('volume_wash')}
                    >
                      洗盘
                    </button>
                    <button
                      type="button"
                      className="chip touch-target tech-preset-card"
                      disabled={techScanning}
                      onClick={() => applyPreset('macd_golden')}
                    >
                      MACD 金叉
                    </button>
                  </div>
                </div>
                <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div className="seg-control" role="tablist" aria-label="扫描范围">
                    <button
                      type="button"
                      className={techScope === 'top200' ? 'active' : ''}
                      disabled={techScanning}
                      onClick={() => setTechScope('top200')}
                      title="推荐：涨跌幅前200，速度快"
                    >
                      前 {SCREENER_MAX_ROWS}（推荐）
                    </button>
                    <button
                      type="button"
                      className={techScope === 'watchlist' ? 'active' : ''}
                      disabled={techScanning}
                      onClick={() => setTechScope('watchlist')}
                      title="仅扫描当前自选"
                    >
                      自选
                    </button>
                    <button
                      type="button"
                      className={techScope === 'full' ? 'active' : ''}
                      disabled={techScanning}
                      onClick={() => setTechScope('full')}
                      title="全市场很慢，公开站受限"
                    >
                      全市场
                    </button>
                  </div>
                </div>
                {techScope === 'full' && (
                  <div className="state-banner warn mobile-full-market-guide" style={{ marginBottom: 8 }}>
                    全市场扫描慢（A 股约 10–20 分钟），公开站受 CORS/中继限制易失败。推荐本机或 Electron；也可先用前{SCREENER_MAX_ROWS}/自选/板块。
                    {pagesHost && !isElectron ? ' 当前为公开站环境。' : ''}
                  </div>
                )}
                {techScope === 'top200' && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                    默认推荐前 {SCREENER_MAX_ROWS}：更快、更稳。板块榜见上方「板块」页签。
                  </p>
                )}
                <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <button type="button" className="btn btn-xs" disabled={techScanning} onClick={loadLastSnapshot}>
                    <Icons.save /> 查看上次结果
                  </button>
                  {lastSnapshot?.meta.incomplete && (
                    <button type="button" className="btn btn-xs" disabled={techScanning} onClick={resumeIncomplete}>
                      继续未完成
                    </button>
                  )}
                  {lastSnapshot && (
                    <button
                      type="button"
                      className="btn btn-xs"
                      disabled={techScanning}
                      onClick={() => {
                        if (!confirm('清除本地扫描快照？')) return
                        clearTechScanSnapshot()
                        setLastSnapshot(null)
                        onToast?.({ message: '已清除扫描快照', type: 'info' })
                      }}
                    >
                      清除快照
                    </button>
                  )}
                  {lastSnapshot && (
                    <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
                      {snapshotSummary(lastSnapshot)}
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
                      onToast?.({ message: '已清空技术筛选 K 线本地缓存', type: 'info' })
                    }}
                  >
                    清本地K
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
                    {techMockSkipped ? ` · 演示跳过 ${techMockSkipped}` : ''}
                    {techInsufficient ? ` · K线不足 ${techInsufficient}` : ''}
                  </div>
                </div>
              )}
            </div>

            {!techScanning && techHits.length === 0 ? (
              <div className="empty-state panel">
                <h3>尚未扫描或无命中</h3>
                <p>选择条件后点右上角「开始扫描」。数据不足或仅有演示 K 线时不会假命中。</p>
              </div>
            ) : techHits.length > 0 ? (
              <div className="panel">
                <div className="panel-header">
                  <span>
                    技术命中 · {techHits.length} 只
                    {techMockSkipped ? ` · 演示跳过 ${techMockSkipped}` : ''}
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
                    {source === 'eastmoney' ? '延时行情' : '演示 · 非实盘'}
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
                  {source === 'eastmoney' ? '延时行情' : '演示 · 非实盘'}
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
                {source === 'eastmoney' ? '延时行情' : '演示 · 非实盘'}
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
