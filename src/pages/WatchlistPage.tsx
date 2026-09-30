import { useEffect, useMemo, useRef, useState } from 'react'
import { Advanced } from '../components/Advanced'
import { CompareChart } from '../components/CompareChart'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Glossary } from '../components/Glossary'
import { PriceChart } from '../components/PriceChart'
import { Skeleton, SkeletonTable } from '../components/Skeleton'
import { Sparkline } from '../components/Sparkline'
import { useQuotes } from '../hooks/useQuotes'
import * as db from '../services/db'
import {
  evaluateAlerts,
  lotSize,
  normalizeSymbol,
  quoteService,
  sourceBadgeLabel,
} from '../services/quotes'
import {
  buildRvolMap,
  classifyRvol,
  rvolLevelClass,
  scanWatchlistVolume,
} from '../services/volumeMonitor'
import { fmt, fmtPct, fmtDateTime, fmtTime, safeNum } from '../utils/format'
import { notifyAlertFired } from '../services/notify'
import type {
  Candle,
  ChartPeriod,
  IndicatorKey,
  PriceAlert,
  ToastItem,
  WatchlistItem,
} from '../types'
import { sourceCornerBadge } from '../utils/dataStatusLabels'

const PERIODS: Array<{ key: ChartPeriod; label: string }> = [
  { key: '1d', label: '日' },
  { key: '1w', label: '周' },
  { key: '1M', label: '月' },
  { key: '5m', label: '5分' },
  { key: '1m', label: '1分' },
]

const TAGS = ['', '核心', '观察', '短线'] as const
const TAG_LABEL: Record<string, string> = {
  '': '全部',
  核心: '核心',
  观察: '观察',
  短线: '短线',
}

interface Props {
  refreshSec: number
  onToast?: (t: Omit<ToastItem, 'id'>) => void
  onAlertsChange?: () => void
  focusSymbol?: string | null
  /** 成交后跳转复盘并带草稿 */
  onAfterTrade?: (tradeId: number) => void
  volumeLookback?: number
  defaultRvolAlert?: number
}

export function WatchlistPage({
  refreshSec,
  onToast,
  onAlertsChange,
  focusSymbol,
  onAfterTrade,
  volumeLookback = 20,
  defaultRvolAlert = 2,
}: Props) {
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [candleLoading, setCandleLoading] = useState(false)
  const [candleError, setCandleError] = useState<string | null>(null)
  const [symbolInput, setSymbolInput] = useState('')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [msg, setMsg] = useState<string | null>(null)
  const [period, setPeriod] = useState<ChartPeriod>('1d')
  const [indicators, setIndicators] = useState<IndicatorKey[]>(['ma', 'vol'])
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [alertType, setAlertType] = useState<PriceAlert['type']>('above')
  const [alertThreshold, setAlertThreshold] = useState('')
  const [rvolBySymbol, setRvolBySymbol] = useState<Record<string, number | null>>({})
  const [sparkBySymbol, setSparkBySymbol] = useState<Record<string, { values: number[]; sample: boolean }>>({})
  const [confirmBuy, setConfirmBuy] = useState(false)
  const [candleNonce, setCandleNonce] = useState(0)
  const [compareMode, setCompareMode] = useState(false)
  const [comparePick, setComparePick] = useState<string[]>([])
  const [compareSeries, setCompareSeries] = useState<Array<{ symbol: string; candles: Candle[] }>>([])
  const [compareLoading, setCompareLoading] = useState(false)
  const [alertTab, setAlertTab] = useState<'active' | 'triggered'>('active')
  const addInputRef = useRef<HTMLInputElement>(null)

  const symbols = useMemo(() => items.map((i) => i.symbol), [items])
  const { quotes, loading, source, error: quoteError, refresh } = useQuotes(symbols, refreshSec)

  const filtered = useMemo(() => {
    if (!tagFilter) return items
    return items.filter((i) => (i.tag || '') === tagFilter)
  }, [items, tagFilter])

  const reload = () => {
    const list = db.listWatchlist()
    setItems(list)
    setAlerts(db.listAlerts())
    setSelected((prev) => {
      if (prev && list.find((i) => i.symbol === prev)) return prev
      return list[0]?.symbol ?? null
    })
  }

  useEffect(() => {
    reload()
  }, [])

  useEffect(() => {
    if (focusSymbol) {
      setSelected(normalizeSymbol(focusSymbol).symbol)
    }
  }, [focusSymbol])

  useEffect(() => {
    const onFocusAdd = () => addInputRef.current?.focus()
    window.addEventListener('sw:focus-add', onFocusAdd)
    const onRefresh = () => refresh()
    window.addEventListener('sw:refresh-quotes', onRefresh)
    return () => {
      window.removeEventListener('sw:focus-add', onFocusAdd)
      window.removeEventListener('sw:refresh-quotes', onRefresh)
    }
  }, [refresh])

  useEffect(() => {
    if (!selected) {
      setCandles([])
      setCandleError(null)
      return
    }
    let cancelled = false
    setCandleLoading(true)
    setCandleError(null)
    const days = period === '1M' ? 365 : period === '1w' ? 180 : 90
    quoteService
      .fetchCandles(selected, days, period)
      .then((c) => {
        if (cancelled) return
        setCandles(c)
        if (!c.length) setCandleError('暂无 K 线数据')
      })
      .catch((e) => {
        if (cancelled) return
        setCandles([])
        setCandleError(e instanceof Error ? e.message : 'K 线加载失败')
      })
      .finally(() => {
        if (!cancelled) setCandleLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, period, candleNonce])


  // 自选 sparkline：近 20 日收盘
  useEffect(() => {
    if (items.length === 0) {
      setSparkBySymbol({})
      return
    }
    let cancelled = false
    ;(async () => {
      const out: Record<string, { values: number[]; sample: boolean }> = {}
      const concurrency = 3
      let i = 0
      const run = async () => {
        while (i < items.length) {
          const idx = i++
          const it = items[idx]
          try {
            const candles = await quoteService.fetchCandles(it.symbol, 30, '1d')
            const closes = candles.map((c) => c.close).filter((v) => Number.isFinite(v) && v > 0)
            const slice = closes.slice(-20)
            out[it.symbol] = { values: slice, sample: slice.length < 5 }
          } catch {
            out[it.symbol] = { values: [], sample: true }
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => run()))
      if (!cancelled) setSparkBySymbol({ ...out })
    })()
    return () => {
      cancelled = true
    }
  }, [items])

  // 价格提醒：行情刷新时立即评估（带上已有 RVOL 缓存）
  useEffect(() => {
    if (Object.keys(quotes).length === 0) return
    const rvolMap: Record<string, number> = {}
    for (const [sym, rv] of Object.entries(rvolBySymbol)) {
      if (rv != null && Number.isFinite(rv)) rvolMap[sym] = rv
    }
    const fired = evaluateAlerts(quotes, rvolMap)
    if (fired.length) {
      fired.forEach((f) => {
        onToast?.({ message: f.message, type: 'alert' })
        notifyAlertFired(f.message)
      })
      setAlerts(db.listAlerts())
      onAlertsChange?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes])

  // 自选变更或回看天数变化时扫描 RVOL（供列展示）；有 rvol 提醒时一并评估
  useEffect(() => {
    if (items.length === 0) {
      setRvolBySymbol({})
      return
    }
    let cancelled = false
    scanWatchlistVolume(
      items,
      (sym, days, period) => quoteService.fetchCandles(sym, days, period),
      volumeLookback,
      quotes,
      3,
    )
      .then((rows) => {
        if (cancelled) return
        const map: Record<string, number | null> = {}
        for (const r of rows) map[r.symbol] = r.rvol
        setRvolBySymbol(map)
        const rvolMap = buildRvolMap(rows)
        if (Object.keys(quotes).length && Object.keys(rvolMap).length) {
          const more = evaluateAlerts(quotes, rvolMap)
          if (more.length) {
            more.forEach((f) => {
              onToast?.({ message: f.message, type: 'alert' })
              notifyAlertFired(f.message)
            })
            setAlerts(db.listAlerts())
            onAlertsChange?.()
          }
        }
      })
      .catch(() => {
        /* ignore scan errors */
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, volumeLookback])

  const add = () => {
    const { symbol, market } = normalizeSymbol(symbolInput)
    if (!symbol) {
      setMsg('请输入代码')
      return
    }
    const name = quotes[symbol]?.name || symbol
    try {
      db.addWatchlistItem(symbol, name, market, tagFilter || '')
      setSymbolInput('')
      setSelected(symbol)
      reload()
      setMsg(`已加入 ${symbol}`)
      onToast?.({ message: `已加入自选 ${symbol}`, type: 'success' })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '添加失败')
    }
  }

  const remove = (id: number) => {
    db.removeWatchlistItem(id)
    reload()
  }

  const setTag = (id: number, tag: string) => {
    db.setWatchlistTag(id, tag)
    reload()
  }

  const toggleComparePick = (sym: string) => {
    setComparePick((prev) => {
      if (prev.includes(sym)) return prev.filter((s) => s !== sym)
      if (prev.length >= 3) {
        onToast?.({ message: '对比最多选 3 只', type: 'info' })
        return prev
      }
      return [...prev, sym]
    })
  }

  useEffect(() => {
    if (!compareMode || comparePick.length < 2) {
      setCompareSeries([])
      return
    }
    let cancelled = false
    setCompareLoading(true)
    Promise.all(
      comparePick.map(async (sym) => {
        const candles = await quoteService.fetchCandles(sym, 90, '1d')
        return { symbol: sym, candles }
      }),
    )
      .then((rows) => {
        if (!cancelled) setCompareSeries(rows)
      })
      .catch(() => {
        if (!cancelled) setCompareSeries([])
      })
      .finally(() => {
        if (!cancelled) setCompareLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode, comparePick.join('|')])

  const toggleInd = (key: IndicatorKey) => {
    setIndicators((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const addAlert = (type?: PriceAlert['type'], threshold?: number) => {
    if (!selected) {
      setMsg('请先选择一只股票')
      return
    }
    const t = type ?? alertType
    const th = threshold ?? Number(alertThreshold)
    if (!Number.isFinite(th)) {
      setMsg('请输入有效阈值')
      return
    }
    const name = quotes[selected]?.name || items.find((i) => i.symbol === selected)?.name || selected
    try {
      db.addAlert({ symbol: selected, name, type: t, threshold: th })
      setAlertThreshold('')
      setAlerts(db.listAlerts())
      onAlertsChange?.()
      onToast?.({ message: `已添加提醒：${selected}`, type: 'success' })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '添加提醒失败')
    }
  }

  const applyAlertTemplate = (kind: 'plus3' | 'minus3' | 'pct5') => {
    if (!selected) {
      setMsg('请先选择一只股票')
      return
    }
    const q = quotes[selected]
    const px = safeNum(q?.price)
    if (kind !== 'pct5' && px <= 0) {
      setMsg('等待行情后再用模板')
      return
    }
    if (kind === 'plus3') addAlert('above', +(px * 1.03).toFixed(4))
    else if (kind === 'minus3') addAlert('below', +(px * 0.97).toFixed(4))
    else addAlert('pct_change', 5)
  }

  const quickBuyQty = selected ? lotSize(selected) : 100
  const quickBuyPrice = selected ? safeNum(quotes[selected]?.price) : 0

  const doQuickBuy = () => {
    if (!selected || quickBuyPrice <= 0) {
      setConfirmBuy(false)
      setMsg('暂无有效价格')
      return
    }
    try {
      const name = quotes[selected]?.name || items.find((i) => i.symbol === selected)?.name || selected
      const trade = db.placeTrade({
        symbol: selected,
        name,
        side: 'buy',
        qty: quickBuyQty,
        price: quickBuyPrice,
      })
      db.snapshotEquity({ [selected]: quickBuyPrice })
      setConfirmBuy(false)
      onToast?.({
        message: `模拟买入成功：${trade.symbol} × ${trade.qty} @ ${trade.price}（可到「复盘」自动草稿）`,
        type: 'success',
      })
      onAfterTrade?.(trade.id)
    } catch (e) {
      setConfirmBuy(false)
      setMsg(e instanceof Error ? e.message : '买入失败')
      onToast?.({ message: e instanceof Error ? e.message : '买入失败', type: 'error' })
    }
  }

  const selectedItem = items.find((i) => i.symbol === selected)

  return (
    <>
      <header className="page-header">
        <div>
          <h2>盯盘</h2>
          <p className="subtitle">
            自选 · K 线 · 提醒
            {source ? ` · ${source}` : ''}
            {loading ? ' · 刷新中' : ''}
          </p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>
      <div className="page-body">
        <Glossary kind="watchlist" className="glossary-banner" />
        {/* 一键添加 — 置顶少点击 */}
        <div className="quick-bar panel" data-coach="watchlist">
          <div className="panel-body quick-bar-inner">
            <input
              ref={addInputRef}
              id="sw-add-symbol"
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="添加代码：600519 / AAPL（回车）"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <button className="btn primary" onClick={add}>
              添加自选
            </button>
            <div className="seg-control tag-seg">
              {TAGS.map((t) => (
                <button
                  key={t || 'all'}
                  type="button"
                  className={tagFilter === t ? 'active' : ''}
                  onClick={() => setTagFilter(t)}
                  title={t ? `筛选「${t}」` : '全部自选'}
                >
                  {TAG_LABEL[t]}
                </button>
              ))}
            </div>
            {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
          </div>
        </div>

        {quoteError && (
          <div className="state-banner error">行情异常：{quoteError}（将尽量使用旧行情/演示）</div>
        )}

        {items.length === 0 ? (
          <div className="empty-state panel">
            <h3>还没有自选股</h3>
            <p>在上方输入 <code>600519</code> 或 <code>AAPL</code> 回车即可。也可点下方样例一键添加。</p>
            <div className="toolbar" style={{ justifyContent: 'center', marginTop: 12 }}>
              {[
                { s: '600519.SH', n: '贵州茅台', m: 'SH' as const },
                { s: 'AAPL', n: '苹果', m: 'US' as const },
              ].map((x) => (
                <button
                  key={x.s}
                  className="btn"
                  onClick={() => {
                    db.addWatchlistItem(x.s, x.n, x.m)
                    setSelected(x.s)
                    reload()
                  }}
                >
                  + {x.n}
                </button>
              ))}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state panel">
            <h3>该分组暂无股票</h3>
            <p>切换「全部」，或添加自选时先选好分组标签。</p>
          </div>
        ) : (
          <div className="grid-2 watch-grid">
            <div className="panel">
              <div className="panel-header">
                <span>自选列表</span>
                <div className="toolbar">
                  <button
                    type="button"
                    className={`btn btn-xs ${compareMode ? 'primary' : ''}`}
                    onClick={() => {
                      setCompareMode((v) => !v)
                      if (compareMode) setComparePick([])
                    }}
                    title="勾选 2–3 只叠加归一化走势"
                  >
                    {compareMode ? '退出对比' : '对比走势'}
                  </button>
                  <span className="muted">
                    {filtered.length}/{items.length}
                  </span>
                </div>
              </div>
              {loading && Object.keys(quotes).length === 0 ? (
                <SkeletonTable rows={5} />
              ) : (
                <table className="data dense">
                  <thead>
                    <tr>
                      <th>代码</th>
                      <th>最新</th>
                      <th>涨跌</th>
                      <th>走势</th>
                      <th>RVOL</th>
                      <th>标签</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const q = quotes[item.symbol]
                      const up = safeNum(q?.changePercent) >= 0
                      return (
                        <tr
                          key={item.id}
                          className={`${selected === item.symbol ? 'selected' : ''}${q?.source === 'mock' ? ' row-mock' : ''}`.trim()}
                          onClick={() => {
                            if (compareMode) toggleComparePick(item.symbol)
                            else setSelected(item.symbol)
                          }}
                        >
                          <td>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                              {compareMode && (
                                <input
                                  type="checkbox"
                                  checked={comparePick.includes(item.symbol)}
                                  onChange={() => toggleComparePick(item.symbol)}
                                  onClick={(e) => e.stopPropagation()}
                                  title="加入对比"
                                  style={{ marginTop: 3 }}
                                />
                              )}
                              <div>
                                <div className="mono">{item.symbol}</div>
                                <div className="muted" style={{ fontSize: 11 }}>
                                  {q?.name || item.name}
                                  {q?.source === 'mock' && (
                                    <span className="mock-corner" title={sourceCornerBadge('mock')?.title || '演示数据'}>
                                      {' '}演示
                                    </span>
                                  )}
                                  {q?.source === 'cache' && (
                                    <span className="cache-corner" title={sourceCornerBadge('cache')?.title || '刚才存下的行情'}>
                                      {' '}旧行情
                                    </span>
                                  )}
                                  {q?.suspicious && (
                                    <span className="mock-corner" title={q.suspiciousReason || '报价与 K 线偏差较大'}>
                                      {' '}可疑
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className={`mono ${q ? (up ? 'up' : 'down') : ''}`}>
                            {q ? fmt(q.price, safeNum(q.price) >= 100 ? 2 : 3) : '—'}
                          </td>
                          <td className={`mono ${q ? (up ? 'up' : 'down') : ''}`}>
                            {q ? fmtPct(q.changePercent) : '—'}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              const sp = sparkBySymbol[item.symbol]
                              if (!sp || sp.values.length < 2) return <span className="muted">—</span>
                              return (
                                <Sparkline
                                  values={sp.values}
                                  sample={sp.sample || q?.source === 'mock'}
                                  title={sp.sample ? '走势点不足/演示' : '近20日收盘'}
                                />
                              )
                            })()}
                          </td>
                          <td>
                            {(() => {
                              const rv = rvolBySymbol[item.symbol]
                              const level = classifyRvol(rv ?? null)
                              if (rv == null) return <span className="muted">—</span>
                              return (
                                <span className={`rvol-badge compact ${rvolLevelClass(level)}`} title={`RVOL ${rv.toFixed(2)}×`}>
                                  {rv.toFixed(1)}×
                                </span>
                              )
                            })()}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <select
                              className="select compact tag-select"
                              value={item.tag || ''}
                              onChange={(e) => setTag(item.id, e.target.value)}
                              title="分组标签"
                            >
                              <option value="">—</option>
                              <option value="核心">核心</option>
                              <option value="观察">观察</option>
                              <option value="短线">短线</option>
                            </select>
                          </td>
                          <td>
                            <button
                              className="btn danger btn-xs"
                              onClick={(e) => {
                                e.stopPropagation()
                                remove(item.id)
                              }}
                            >
                              移除
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel chart-panel">
              <div className="panel-header">
                <span>
                  K 线 · {selected || '未选择'}
                  {selected && quotes[selected] ? (
                    <span className="muted">
                      {' '}
                      ·{' '}
                      <span className={`src-badge src-${quotes[selected].source}`}>
                        {sourceBadgeLabel(quotes[selected].source)}
                      </span>
                      {' · '}
                      {fmtTime(quotes[selected].asOf)}
                    </span>
                  ) : null}
                </span>
                {selected && (
                  <button
                    className="btn buy btn-xs"
                    disabled={quickBuyPrice <= 0}
                    onClick={() => setConfirmBuy(true)}
                    title="按 1 手（A 股 100 股）市价模拟买入"
                  >
                    一键模拟买入
                  </button>
                )}
              </div>
              <div className="panel-body chart-body">
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <span className="chip-label">周期</span>
                  <div className="seg-control">
                    {PERIODS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        className={period === p.key ? 'active' : ''}
                        onClick={() => setPeriod(p.key)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <span className="chip-label" style={{ marginLeft: 8 }}>
                    指标
                  </span>
                  {(
                    [
                      ['ma', 'MA'],
                      ['vol', 'VOL'],
                      ['macd', 'MACD'],
                    ] as Array<[IndicatorKey, string]>
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`chip ${indicators.includes(k) ? 'chip-on' : ''}`}
                      onClick={() => toggleInd(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {!selected ? (
                  <div className="empty-state compact">选择一只股票查看走势</div>
                ) : candleLoading && candles.length === 0 ? (
                  <Skeleton rows={6} height={18} />
                ) : candleError && candles.length === 0 ? (
                  <div className="empty-state compact">
                    <p>{candleError}</p>
                    <button
                      className="btn btn-xs"
                      style={{ marginTop: 8 }}
                      onClick={() => setCandleNonce((n) => n + 1)}
                    >
                      重试
                    </button>
                  </div>
                ) : candles.length ? (
                  <PriceChart candles={candles} height={360} indicators={indicators} />
                ) : (
                  <div className="empty-state compact">暂无 K 线</div>
                )}
                <Advanced title="高级 · 图表术语">
                  <Glossary kind="chart" compact />
                </Advanced>
              </div>
            </div>
          </div>
        )}

        {compareMode && (
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-header">
              <span>走势对比（归一化）</span>
              <span className="muted">
                已选 {comparePick.length}/3 · 需 2–3 只
              </span>
            </div>
            <div className="panel-body">
              {comparePick.length < 2 ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  在左侧列表勾选 2–3 只股票，叠加对比相对表现（起点=100）。
                </p>
              ) : compareLoading ? (
                <Skeleton rows={5} height={16} />
              ) : (
                <CompareChart series={compareSeries} />
              )}
            </div>
          </div>
        )}

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">
            <span>价格提醒{selected ? ` · ${selected}` : ''}</span>
            <div className="toolbar">
              <div className="seg-control">
                <button
                  type="button"
                  className={alertTab === 'active' ? 'active' : ''}
                  onClick={() => setAlertTab('active')}
                >
                  监听中 ({alerts.filter((a) => a.enabled && !a.triggeredAt).length})
                </button>
                <button
                  type="button"
                  className={alertTab === 'triggered' ? 'active' : ''}
                  onClick={() => setAlertTab('triggered')}
                >
                  已触发 ({alerts.filter((a) => a.triggeredAt).length})
                </button>
              </div>
            </div>
          </div>
          <div className="panel-body">
            <div className="chip-row" style={{ marginTop: 0 }}>
              <span className="chip-label">模板</span>
              <button type="button" className="chip" disabled={!selected} onClick={() => applyAlertTemplate('plus3')}>
                现价 +3%
              </button>
              <button type="button" className="chip" disabled={!selected} onClick={() => applyAlertTemplate('minus3')}>
                现价 −3%
              </button>
              <button type="button" className="chip" disabled={!selected} onClick={() => applyAlertTemplate('pct5')}>
                涨跌 ≥5%
              </button>
              <button
                type="button"
                className="chip"
                disabled={!selected}
                onClick={() => addAlert('rvol_above', defaultRvolAlert)}
                title="相对成交量达到默认倍数时提醒"
              >
                RVOL ≥{defaultRvolAlert}×
              </button>
            </div>
            <Advanced title="高级 · 自定义阈值">
              <div className="toolbar" style={{ marginBottom: 10 }}>
                <select
                  className="select compact"
                  value={alertType}
                  onChange={(e) => setAlertType(e.target.value as PriceAlert['type'])}
                >
                  <option value="above">价格高于</option>
                  <option value="below">价格低于</option>
                  <option value="pct_change">涨跌幅≥%</option>
                  <option value="rvol_above">相对成交量≥</option>
                </select>
                <input
                  className="input compact"
                  style={{ maxWidth: 120 }}
                  placeholder={
                    alertType === 'pct_change'
                      ? '如 3'
                      : alertType === 'rvol_above'
                        ? `如 ${defaultRvolAlert}`
                        : '阈值'
                  }
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addAlert()}
                />
                <button className="btn primary" onClick={() => addAlert()} disabled={!selected}>
                  添加
                </button>
              </div>
            </Advanced>
            {(() => {
              const active = alerts.filter((a) => !a.triggeredAt)
              const triggered = alerts.filter((a) => !!a.triggeredAt)
              const rows = alertTab === 'active' ? active : triggered
              if (rows.length === 0) {
                return (
                  <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                    {alertTab === 'active'
                      ? '暂无监听中的提醒。点模板即可为当前标的设提醒（免打扰时段不弹 Toast）。'
                      : '还没有触发记录。触发后会出现在这里，可「稍后 1h」或「重新监听」。'}
                  </p>
                )
              }
              return (
              <table className="data dense" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>条件</th>
                    <th>状态</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 16).map((a) => {
                    const snoozing =
                      a.snoozedUntil && new Date(a.snoozedUntil).getTime() > Date.now()
                    return (
                    <tr key={a.id} style={{ cursor: 'default' }} className={a.triggeredAt ? 'alert-triggered-row' : ''}>
                      <td className="mono">{a.symbol}</td>
                      <td>
                        {a.type === 'above' && `≥ ${a.threshold}`}
                        {a.type === 'below' && `≤ ${a.threshold}`}
                        {a.type === 'pct_change' && `|涨跌|≥${a.threshold}%`}
                        {a.type === 'rvol_above' && `RVOL≥${a.threshold}×`}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {a.triggeredAt
                          ? `已触发 · ${fmtDateTime(a.triggeredAt)}`
                          : snoozing
                            ? `稍后至 ${fmtDateTime(a.snoozedUntil!)}`
                            : a.enabled
                              ? '监听中'
                              : '已暂停'}
                      </td>
                      <td>
                        {a.triggeredAt ? (
                          <>
                            <button
                              className="btn btn-xs"
                              title="1 小时内不再触发"
                              onClick={() => {
                                db.snoozeAlert(a.id, 60)
                                setAlerts(db.listAlerts())
                                onAlertsChange?.()
                                onToast?.({ message: `${a.symbol} 已稍后 1 小时`, type: 'info' })
                              }}
                            >
                              稍后 1h
                            </button>
                            <button
                              className="btn btn-xs"
                              onClick={() => {
                                db.rearmAlert(a.id)
                                setAlerts(db.listAlerts())
                                onAlertsChange?.()
                              }}
                            >
                              重新监听
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn btn-xs"
                              title="1 小时内跳过"
                              onClick={() => {
                                db.snoozeAlert(a.id, 60)
                                setAlerts(db.listAlerts())
                                onAlertsChange?.()
                              }}
                            >
                              稍后
                            </button>
                            <button
                              className="btn btn-xs"
                              onClick={() => {
                                db.setAlertEnabled(a.id, !a.enabled)
                                setAlerts(db.listAlerts())
                                onAlertsChange?.()
                              }}
                            >
                              {a.enabled ? '暂停' : '启用'}
                            </button>
                          </>
                        )}
                        <button
                          className="btn danger btn-xs"
                          onClick={() => {
                            db.deleteAlert(a.id)
                            setAlerts(db.listAlerts())
                            onAlertsChange?.()
                          }}
                        >
                          删
                        </button>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
              )
            })()}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmBuy}
        title="一键模拟买入"
        message={
          selected
            ? `市价买入 ${selected}${selectedItem ? `（${selectedItem.name}）` : ''} × ${quickBuyQty}` +
              `（${lotSize(selected) === 100 ? '1 手' : '1 股'}），约 ${fmt(quickBuyPrice * quickBuyQty, 0)}` +
              `（另计约 0.03% 费用）。可在「模拟」页查看持仓。`
            : ''
        }
        confirmLabel="确认买入"
        onConfirm={doQuickBuy}
        onCancel={() => setConfirmBuy(false)}
      />
    </>
  )
}
