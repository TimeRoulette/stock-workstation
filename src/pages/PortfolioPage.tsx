import { useEffect, useMemo, useRef, useState } from 'react'
import { Advanced } from '../components/Advanced'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EquityChart } from '../components/EquityChart'
import { Glossary } from '../components/Glossary'
import { useQuotes } from '../hooks/useQuotes'
import * as db from '../services/db'
import { notifyAlertFired } from '../services/notify'
import { BENCHMARKS, computePaperPerf, type BenchmarkId, type PaperPerfResult } from '../services/paperPerf'
import { detectMarket, lotSize, normalizeSymbol, quoteService, toCnyHint } from '../services/quotes'
import { fmt, fmtPct, fmtSigned, safeNum } from '../utils/format'
import type { EquitySnapshot, PaperAccount, PendingOrder, Position, ToastItem, Trade, TradeSide } from '../types'

type OrderType = 'market' | 'limit'

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  refreshSec: number
  onToast?: (t: Omit<ToastItem, 'id'>) => void
  onAfterTrade?: (tradeId: number) => void
  /** 从盯盘跳转过来时预填 */
  prefillSymbol?: string | null
}

export function PortfolioPage({ refreshSec, onToast, onAfterTrade, prefillSymbol }: Props) {
  const [account, setAccount] = useState<PaperAccount | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [snapshots, setSnapshots] = useState<EquitySnapshot[]>([])
  const [symbol, setSymbol] = useState('600519.SH')
  const [name, setName] = useState('贵州茅台')
  const [qty, setQty] = useState('100')
  const [price, setPrice] = useState('')
  const [orderType, setOrderType] = useState<OrderType>('market')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [confirmSide, setConfirmSide] = useState<TradeSide | null>(null)
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null)
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [tradeSideFilter, setTradeSideFilter] = useState<'all' | TradeSide>('all')
  const [tradeSymbolFilter, setTradeSymbolFilter] = useState('')
  const [importRebuildCash, setImportRebuildCash] = useState(true)
  const [confirmRebuild, setConfirmRebuild] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingOrder[]>([])
  const [alertOnTouch, setAlertOnTouch] = useState(false)
  const [autoCloseOnTouch, setAutoCloseOnTouch] = useState(false)
  const [perf, setPerf] = useState<PaperPerfResult | null>(null)
  const [benchId, setBenchId] = useState<BenchmarkId>('000300.SH')
  const stopEvalRef = useRef<string>('')

  const symbols = useMemo(() => {
    const set = new Set(positions.map((p) => p.symbol))
    const n = normalizeSymbol(symbol).symbol
    if (n) set.add(n)
    return [...set]
  }, [positions, symbol])

  const { quotes, error: quoteError, refresh } = useQuotes(symbols, refreshSec)

  const reload = () => {
    setAccount(db.getAccount())
    setPositions(db.listPositions())
    setTrades(
      db.listTrades({
        side: tradeSideFilter,
        symbol: tradeSymbolFilter || undefined,
        limit: 80,
      }),
    )
    setSnapshots(db.listEquitySnapshots(300))
    setPending(db.listPendingOrders('pending'))
  }

  useEffect(() => {
    reload()
  }, [tradeSideFilter, tradeSymbolFilter])

  useEffect(() => {
    if (prefillSymbol) {
      const n = normalizeSymbol(prefillSymbol)
      setSymbol(n.symbol)
      const lot = lotSize(n.symbol)
      setQty(String(lot))
    }
  }, [prefillSymbol])

  useEffect(() => {
    const onRefresh = () => refresh()
    window.addEventListener('sw:refresh-quotes', onRefresh)
    return () => window.removeEventListener('sw:refresh-quotes', onRefresh)
  }, [refresh])

  useEffect(() => {
    const norm = normalizeSymbol(symbol).symbol
    const q = quotes[norm]
    if (q && (orderType === 'market' || !price)) {
      setPrice(String(q.price))
    }
    if (q?.name && (!name || name === symbol || name === norm)) setName(q.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, symbol, orderType])

  // 切换代码时按市场默认手数
  useEffect(() => {
    const lot = lotSize(symbol)
    const q = Number(qty)
    if (!Number.isFinite(q) || q <= 0 || (lot > 1 && q % lot !== 0)) {
      setQty(String(lot))
    }
    // only when symbol market lot changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizeSymbol(symbol).market])

  const enriched = positions.map((p) => {
    const q = quotes[p.symbol]
    const last = safeNum(q?.price, safeNum(p.avgCost))
    const avg = safeNum(p.avgCost)
    const qty = safeNum(p.qty)
    const mv = last * qty
    const pnl = (last - avg) * qty
    const pnlPercent = avg ? ((last - avg) / avg) * 100 : 0
    return {
      ...p,
      lastPrice: last,
      marketValue: safeNum(mv),
      pnl: safeNum(pnl),
      pnlPercent: safeNum(pnlPercent),
      dayChange: q?.change,
      dayChangePercent: q?.changePercent,
      currency: q?.currency || 'CNY',
    }
  })

  const totalMv = enriched.reduce((s, p) => s + safeNum(p.marketValue), 0)
  const totalPnl = enriched.reduce((s, p) => s + safeNum(p.pnl), 0)
  const equity = safeNum(account?.cash) + totalMv
  const lot = lotSize(symbol)
  const market = detectMarket(symbol)
  const orderCcy = quotes[normalizeSymbol(symbol).symbol]?.currency || 'CNY'
  const qtyPresets = lot >= 100 ? [100, 200, 500, 1000] : [1, 5, 10, 50]

  useEffect(() => {
    if (!account || Object.keys(quotes).length === 0) return
    const priceMap: Record<string, number> = {}
    positions.forEach((p) => {
      if (quotes[p.symbol] && Number.isFinite(quotes[p.symbol].price)) {
        priceMap[p.symbol] = quotes[p.symbol].price
      }
    })
    if (Object.keys(priceMap).length === 0 && positions.length > 0) return
    const last = snapshots[snapshots.length - 1]
    const now = Date.now()
    if (last && now - new Date(last.ts).getTime() < 60_000) return
    try {
      db.snapshotEquity(priceMap)
      setSnapshots(db.listEquitySnapshots(300))
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes])

  // 限价挂单撮合 + 止损触及（演示规则，非券商）
  useEffect(() => {
    if (Object.keys(quotes).length === 0) return
    const priceMap: Record<string, number> = {}
    for (const [sym, q] of Object.entries(quotes)) {
      if (Number.isFinite(q.price)) priceMap[sym] = q.price
    }
    try {
      const filled = db.matchPendingOrders(priceMap)
      if (filled.length) {
        for (const f of filled) {
          const msg = `限价单成交（演示）：${f.order.side === 'buy' ? '买' : '卖'} ${f.order.symbol} ×${f.order.qty} @${f.order.limitPrice}`
          onToast?.({ message: msg, type: 'success' })
        }
        db.snapshotEquity(priceMap)
        reload()
      }
    } catch {
      /* */
    }
    try {
      const qmap: Record<string, { price: number; name?: string }> = {}
      for (const [sym, q] of Object.entries(quotes)) {
        qmap[sym] = { price: q.price, name: q.name }
      }
      const events = db.evaluateStopTouches(qmap)
      if (events.length) {
        for (const ev of events) {
          const kind = ev.kind === 'stop' ? '止损' : '止盈'
          const msg = ev.autoClosed
            ? `${kind}触及并演示平仓：${ev.symbol} @${ev.price}（阈值 ${ev.threshold}；非券商撮合）`
            : `${kind}触及提醒：${ev.symbol} 现价 ${ev.price}（阈值 ${ev.threshold}）`
          const key = `${ev.symbol}-${ev.kind}-${ev.threshold}-${ev.autoClosed}`
          if (stopEvalRef.current === key) continue
          stopEvalRef.current = key
          onToast?.({ message: msg, type: 'alert' })
          notifyAlertFired(msg)
        }
        if (events.some((e) => e.autoClosed)) {
          db.snapshotEquity(priceMap)
          reload()
        } else {
          reload()
        }
      }
    } catch {
      /* */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes])

  // 简易绩效
  useEffect(() => {
    let cancelled = false
    const allTrades = db.listTrades({ limit: 5000 })
    const snaps = db.listEquitySnapshots(500)
    const label = BENCHMARKS.find((b) => b.id === benchId)?.label || benchId
    ;(async () => {
      let closes: number[] = []
      let sample = false
      try {
        const candles = await quoteService.fetchCandles(benchId, 120, '1d')
        closes = candles.map((c) => c.close).filter((v) => Number.isFinite(v) && v > 0)
        if (candles.some((c) => String((c as { source?: string }).source || '').includes('mock'))) sample = true
        // 无法从 candle 判断 mock；若价格全接近整数随机则仍可能是真；缺数据标 unavailable
      } catch {
        closes = []
      }
      if (cancelled) return
      setPerf(
        computePaperPerf(allTrades, snaps, {
          benchmarkId: benchId,
          benchmarkLabel: label,
          benchmarkCloses: closes,
          sample,
        }),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [benchId, trades, snapshots])

  const applyQtyPreset = (shares: number) => setQty(String(shares))

  const applyCashPercent = (pct: number) => {
    const cash = safeNum(account?.cash)
    const px = safeNum(Number(price) || quotes[normalizeSymbol(symbol).symbol]?.price)
    if (px <= 0) return
    const budget = cash * pct
    let q = Math.floor(budget / px)
    if (lot > 1) q = Math.floor(q / lot) * lot
    if (q < lot && lot > 1) q = 0
    setQty(String(Math.max(q, 0)))
  }

  const applyPosPercent = (pct: number) => {
    const norm = normalizeSymbol(symbol).symbol
    const pos = positions.find((p) => p.symbol === norm)
    if (!pos) return
    let q = Math.floor(safeNum(pos.qty) * pct)
    if (pct >= 1) q = Math.floor(safeNum(pos.qty))
    else if (lot > 1) q = Math.floor(q / lot) * lot
    setQty(String(Math.max(q, 0)))
  }

  const effectivePrice = (): number => {
    const norm = normalizeSymbol(symbol).symbol
    if (orderType === 'market') {
      return safeNum(quotes[norm]?.price || Number(price))
    }
    return safeNum(Number(price))
  }

  const requestPlace = (side: TradeSide) => {
    setError(null)
    setOk(null)
    const q = Number(qty)
    const p = effectivePrice()
    if (!Number.isFinite(q) || q <= 0) {
      setError('请输入有效数量')
      return
    }
    if (!Number.isFinite(p) || p <= 0) {
      setError('请输入有效价格或等待行情')
      return
    }
    if ((market === 'SH' || market === 'SZ') && (q % 100 !== 0 || lot !== 100)) {
      setError('A 股数量需为 100 的整数倍（1 手）')
      return
    }
    if (lot > 1 && q % lot !== 0) {
      setError(`数量需为 ${lot} 的整数倍`)
      return
    }
    setConfirmSide(side)
  }

  const doPlace = () => {
    if (!confirmSide) return
    try {
      const norm = normalizeSymbol(symbol)
      if (orderType === 'limit') {
        const order = db.placePendingOrder({
          symbol: norm.symbol,
          name: name.trim() || norm.symbol,
          side: confirmSide,
          qty: Number(qty),
          limitPrice: effectivePrice(),
          note: '限价挂单（演示撮合）',
        })
        const msg = `已进入待成交：${confirmSide === 'buy' ? '买' : '卖'} ${order.symbol} ×${order.qty} @${order.limitPrice}（非券商撮合）`
        setOk(msg)
        onToast?.({ message: msg, type: 'success' })
        setConfirmSide(null)
        reload()
        refresh()
        return
      }
      const trade = db.placeTrade({
        symbol: norm.symbol,
        name: name.trim() || norm.symbol,
        side: confirmSide,
        qty: Number(qty),
        price: effectivePrice(),
      })
      const priceMap: Record<string, number> = {}
      enriched.forEach((p) => {
        priceMap[p.symbol] = safeNum(p.lastPrice, safeNum(p.avgCost))
      })
      priceMap[trade.symbol] = trade.price
      db.snapshotEquity(priceMap)
      const msg = `${confirmSide === 'buy' ? '买入' : '卖出'}成功：${trade.symbol} × ${trade.qty}`
      setOk(msg)
      onToast?.({ message: msg, type: 'success' })
      setConfirmSide(null)
      reload()
      refresh()
      onAfterTrade?.(trade.id)
    } catch (e) {
      const m = e instanceof Error ? e.message : '下单失败'
      setError(m)
      onToast?.({ message: m, type: 'error' })
      setConfirmSide(null)
    }
  }

  const fillFromPos = (p: Position) => {
    setSymbol(p.symbol)
    setName(p.name)
    setDetailSymbol(p.symbol)
    const q = quotes[p.symbol]
    if (q) setPrice(String(q.price))
    setStopLoss(p.stopLoss != null ? String(p.stopLoss) : '')
    setTakeProfit(p.takeProfit != null ? String(p.takeProfit) : '')
    const note = db.getPositionNote(p.symbol)
    setAlertOnTouch(!!note?.alertOnTouch)
    setAutoCloseOnTouch(!!note?.autoCloseOnTouch)
  }

  const saveTargets = () => {
    if (!detailSymbol) return
    const sl = stopLoss.trim() ? Number(stopLoss) : null
    const tp = takeProfit.trim() ? Number(takeProfit) : null
    if (stopLoss.trim() && !Number.isFinite(sl)) {
      setError('止损价格无效')
      return
    }
    if (takeProfit.trim() && !Number.isFinite(tp)) {
      setError('止盈价格无效')
      return
    }
    db.upsertPositionNote(detailSymbol, {
      stopLoss: sl,
      takeProfit: tp,
      alertOnTouch,
      autoCloseOnTouch,
    })
    setOk(
      autoCloseOnTouch
        ? '已保存：触及可演示自动平仓（非券商撮合）'
        : alertOnTouch
          ? '已保存：触及将提醒（尊重免打扰）'
          : '已保存止损/止盈备注',
    )
    reload()
  }

  const onImportCsv = async (file: File) => {
    try {
      const text = await file.text()
      const n = db.importTradesCsv(text, { rebuildCash: importRebuildCash })
      const tip = importRebuildCash ? '（已按成交重算现金）' : '（未重算现金，可能与持仓不一致）'
      setOk(`已导入 ${n} 笔成交${tip}`)
      onToast?.({ message: `已导入 ${n} 笔成交${tip}`, type: 'success' })
      reload()
    } catch (e) {
      const m = e instanceof Error ? e.message : '导入失败'
      setError(m)
      onToast?.({ message: m, type: 'error' })
    }
  }

  const doRebuildCash = () => {
    try {
      const r = db.rebuildCashFromTrades()
      const drift = r.drift
      const msg =
        `已按 ${r.tradeCount} 笔成交重算现金：¥${r.previousCash.toFixed(0)} → ¥${r.newCash.toFixed(0)}` +
        `（漂移 ${drift >= 0 ? '+' : ''}${drift.toFixed(0)}）`
      setOk(msg)
      onToast?.({ message: msg, type: 'success' })
      setConfirmRebuild(false)
      reload()
    } catch (e) {
      const m = e instanceof Error ? e.message : '重算失败'
      setError(m)
      setConfirmRebuild(false)
    }
  }

  const detail = enriched.find((p) => p.symbol === detailSymbol) || null

  return (
    <>
      <header className="page-header">
        <div>
          <h2>模拟持仓</h2>
          <p className="subtitle">纸上交易 · 本位币 CNY · 起始 ¥1,000,000</p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => refresh()}>
            刷新行情
          </button>
        </div>
      </header>
      <div className="page-body">
        {quoteError && (
          <div className="state-banner error">行情异常：{quoteError}</div>
        )}

        <div className="stat-row">
          <div className="stat-card">
            <div className="label">总资产 (CNY)</div>
            <div className="value">¥{fmt(equity, 0)}</div>
          </div>
          <div className="stat-card">
            <div className="label">可用现金</div>
            <div className="value">¥{fmt(account?.cash || 0, 0)}</div>
          </div>
          <div className="stat-card">
            <div className="label">持仓市值</div>
            <div className="value">¥{fmt(totalMv, 0)}</div>
          </div>
          <div className="stat-card">
            <div className="label">浮动盈亏</div>
            <div className={`value ${totalPnl >= 0 ? 'up' : 'down'}`}>{fmtSigned(totalPnl, 0)}</div>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <span>净值曲线</span>
            <span className="muted">{snapshots.length} 个快照</span>
          </div>
          <div className="panel-body">
            {snapshots.length < 2 ? (
              <div className="empty-state compact">
                <p>完成几笔交易或等待行情刷新后，这里会画出资产变化。</p>
              </div>
            ) : (
              <EquityChart snapshots={snapshots} />
            )}
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <span>模拟简易绩效</span>
            <select
              className="select compact"
              value={benchId}
              onChange={(e) => setBenchId(e.target.value as BenchmarkId)}
              title="相对基准（示意）"
            >
              {BENCHMARKS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div className="panel-body">
            {!perf ? (
              <p className="muted" style={{ margin: 0 }}>计算中…</p>
            ) : (
              <>
                <div className="stat-row" style={{ marginBottom: 8 }}>
                  <div className="stat-card">
                    <div className="label">胜率（已平仓）</div>
                    <div className="value">
                      {perf.winRate == null ? '—' : `${perf.winRate.toFixed(0)}%`}
                      <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                        {perf.closedRounds} 回合 · 盈 {perf.wins} / 亏 {perf.losses}
                      </div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="label">最大回撤</div>
                    <div className="value">
                      {perf.maxDrawdownPct == null ? '—' : `${perf.maxDrawdownPct.toFixed(2)}%`}
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="label">净值区间收益</div>
                    <div className={`value ${(perf.equityReturnPct ?? 0) >= 0 ? 'up' : 'down'}`}>
                      {perf.equityReturnPct == null ? '—' : `${perf.equityReturnPct.toFixed(2)}%`}
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="label">相对基准</div>
                    <div className={`value ${(perf.relativePct ?? 0) >= 0 ? 'up' : 'down'}`}>
                      {perf.benchmarkStatus === 'unavailable'
                        ? '基准不可用'
                        : perf.relativePct == null
                          ? '—'
                          : `${perf.relativePct >= 0 ? '+' : ''}${perf.relativePct.toFixed(2)}%`}
                      <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                        {perf.benchmarkLabel}
                        {perf.benchmarkReturnPct != null ? ` ${perf.benchmarkReturnPct.toFixed(2)}%` : ''}
                        {perf.benchmarkStatus === 'sample' ? ' · 示意' : ''}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  {perf.note}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header">下单</div>
            <div className="panel-body">
              <div className="form-row">
                <label>代码</label>
                <input
                  className="input"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="600519 / AAPL"
                />
              </div>
              <div className="form-row">
                <label>名称</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-row">
                <label>类型</label>
                <div className="seg-control">
                  <button
                    type="button"
                    className={orderType === 'market' ? 'active' : ''}
                    onClick={() => setOrderType('market')}
                  >
                    市价
                  </button>
                  <button
                    type="button"
                    className={orderType === 'limit' ? 'active' : ''}
                    onClick={() => setOrderType('limit')}
                  >
                    限价
                  </button>
                </div>
              </div>
              <div className="form-row">
                <label>价格</label>
                <input
                  className="input"
                  value={price}
                  onChange={(e) => {
                    setOrderType('limit')
                    setPrice(e.target.value)
                  }}
                  disabled={orderType === 'market'}
                  placeholder="市价跟最新价"
                />
              </div>
              {orderCcy !== 'CNY' && Number(price) > 0 && (
                <p className="muted fx-hint">
                  报价币种 {orderCcy} · {toCnyHint(Number(price) * Number(qty || 0), orderCcy) || '—'}
                </p>
              )}
              <div className="form-row">
                <label>数量</label>
                <input className="input" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="chip-row">
                <span className="chip-label">{lot >= 100 ? '手数' : '股数'}</span>
                {qtyPresets.map((n) => (
                  <button key={n} type="button" className="chip" onClick={() => applyQtyPreset(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="chip-row">
                <span className="chip-label">现金%</span>
                {[0.25, 0.5, 1].map((p) => (
                  <button key={p} type="button" className="chip" onClick={() => applyCashPercent(p)}>
                    {p * 100}%
                  </button>
                ))}
                <span className="chip-label" style={{ marginLeft: 8 }}>
                  仓位%
                </span>
                {[0.25, 0.5, 1].map((p) => (
                  <button key={`pos-${p}`} type="button" className="chip" onClick={() => applyPosPercent(p)}>
                    {p * 100}%
                  </button>
                ))}
              </div>
              <div className="toolbar" style={{ marginTop: 12 }}>
                <button className="btn buy" onClick={() => requestPlace('buy')}>
                  买入
                </button>
                <button className="btn sell" onClick={() => requestPlace('sell')}>
                  卖出
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    const q = quotes[normalizeSymbol(symbol).symbol]
                    if (q) setPrice(String(q.price))
                    else refresh()
                  }}
                >
                  最新价
                </button>
              </div>
              <Advanced title="高级 · 下单术语">
                <Glossary kind="order" compact />
              </Advanced>
              {error && <p className="msg-error">{error}</p>}
              {ok && <p className="msg-ok">{ok}</p>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span>当前持仓</span>
              <span className="muted">{enriched.length} 只</span>
            </div>
            {enriched.length === 0 ? (
              <div className="empty-state">
                <h3>暂无持仓</h3>
                <p>左侧买入，或从盯盘图表「一键模拟买入」。也可在下方高级区导入 CSV。</p>
              </div>
            ) : (
              <table className="data dense">
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>数量</th>
                    <th>成本</th>
                    <th>市值</th>
                    <th>盈亏%</th>
                    <th>日涨跌</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.map((p) => (
                    <tr
                      key={p.symbol}
                      className={detailSymbol === p.symbol ? 'selected' : ''}
                      onClick={() => fillFromPos(p)}
                    >
                      <td>
                        <div className="mono">{p.symbol}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {p.name}
                          {p.currency !== 'CNY' ? ` · ${p.currency}` : ''}
                        </div>
                      </td>
                      <td className="mono">{fmt(p.qty, 0)}</td>
                      <td className="mono">{fmt(p.avgCost)}</td>
                      <td className="mono">{fmt(p.marketValue || 0, 0)}</td>
                      <td className={`mono ${(p.pnlPercent || 0) >= 0 ? 'up' : 'down'}`}>
                        {fmtPct(p.pnlPercent || 0)}
                        <div style={{ fontSize: 11 }}>{fmtSigned(p.pnl || 0, 0)}</div>
                      </td>
                      <td className={`mono ${(p.dayChangePercent || 0) >= 0 ? 'up' : 'down'}`}>
                        {p.dayChangePercent != null ? fmtPct(p.dayChangePercent) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {detail && (
              <div className="pos-detail">
                <div className="panel-header" style={{ borderTop: '1px solid var(--border)' }}>
                  <span>持仓详情 · {detail.symbol}</span>
                </div>
                <div className="panel-body">
                  <div className="detail-grid">
                    <div>
                      <span className="muted">成本</span>
                      <strong className="mono">{fmt(detail.avgCost)}</strong>
                    </div>
                    <div>
                      <span className="muted">现价</span>
                      <strong className="mono">{fmt(detail.lastPrice || 0)}</strong>
                    </div>
                    <div>
                      <span className="muted">市值</span>
                      <strong className="mono">¥{fmt(detail.marketValue || 0, 0)}</strong>
                    </div>
                    <div>
                      <span className="muted">盈亏</span>
                      <strong className={`mono ${(detail.pnl || 0) >= 0 ? 'up' : 'down'}`}>
                        {fmtSigned(detail.pnl || 0, 0)} ({fmtPct(detail.pnlPercent || 0)})
                      </strong>
                    </div>
                  </div>
                  <div className="form-row" style={{ marginTop: 12 }}>
                    <label>止损</label>
                    <input
                      className="input"
                      value={stopLoss}
                      onChange={(e) => setStopLoss(e.target.value)}
                      placeholder="备注价，不自动下单"
                    />
                  </div>
                  <div className="form-row">
                    <label>止盈</label>
                    <input
                      className="input"
                      value={takeProfit}
                      onChange={(e) => setTakeProfit(e.target.value)}
                      placeholder="备注价，不自动下单"
                    />
                  </div>
                  <label className="check-inline" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12.5 }}>
                    <input type="checkbox" checked={alertOnTouch} onChange={(e) => setAlertOnTouch(e.target.checked)} />
                    触及提醒（Toast/系统通知，尊重免打扰）
                  </label>
                  <label className="check-inline" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12.5 }}>
                    <input
                      type="checkbox"
                      checked={autoCloseOnTouch}
                      onChange={(e) => setAutoCloseOnTouch(e.target.checked)}
                    />
                    触及后演示自动平仓（非券商撮合）
                  </label>
                  <button className="btn primary" onClick={saveTargets} style={{ marginTop: 10 }}>
                    保存目标价
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">
            <span>待成交挂单</span>
            <span className="muted">{pending.length} · 演示撮合</span>
          </div>
          {pending.length === 0 ? (
            <div className="empty-state compact">
              <p>限价单会进入此队列；行情触及限价时成交并记流水。可取消。</p>
            </div>
          ) : (
            <table className="data dense">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>方向</th>
                  <th>代码</th>
                  <th>数量</th>
                  <th>限价</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((o) => (
                  <tr key={o.id} style={{ cursor: 'default' }}>
                    <td className="muted">{new Date(o.createdAt).toLocaleString('zh-CN')}</td>
                    <td className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? '买' : '卖'}</td>
                    <td className="mono">{o.symbol}</td>
                    <td className="mono">{fmt(o.qty, 0)}</td>
                    <td className="mono">{fmt(o.limitPrice)}</td>
                    <td>
                      <button
                        className="btn danger btn-xs"
                        onClick={() => {
                          try {
                            db.cancelPendingOrder(o.id)
                            setOk(`已取消挂单 #${o.id}`)
                            reload()
                          } catch (e) {
                            setError(e instanceof Error ? e.message : '取消失败')
                          }
                        }}
                      >
                        取消
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ fontSize: 11, margin: '8px 12px 10px' }}>
            规则：买限价当最新价≤限价成交；卖限价当最新价≥限价成交；成交价用限价。非券商撮合，仅供演示。
          </p>
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">
            <span>成交记录</span>
            <div className="toolbar">
              <select
                className="select compact"
                value={tradeSideFilter}
                onChange={(e) => setTradeSideFilter(e.target.value as 'all' | TradeSide)}
              >
                <option value="all">全部方向</option>
                <option value="buy">仅买入</option>
                <option value="sell">仅卖出</option>
              </select>
              <input
                className="input compact"
                style={{ maxWidth: 140 }}
                placeholder="按代码筛选"
                value={tradeSymbolFilter}
                onChange={(e) => setTradeSymbolFilter(e.target.value)}
              />
            </div>
          </div>
          {trades.length === 0 ? (
            <div className="empty-state compact">
              <p>还没有成交。完成后可到「复盘」一键生成草稿。</p>
            </div>
          ) : (
            <table className="data dense">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>方向</th>
                  <th>代码</th>
                  <th>名称</th>
                  <th>数量</th>
                  <th>价格</th>
                  <th>金额</th>
                  <th>费用</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} style={{ cursor: 'default' }}>
                    <td className="muted">{new Date(t.ts).toLocaleString('zh-CN')}</td>
                    <td className={t.side === 'buy' ? 'up' : 'down'}>{t.side === 'buy' ? '买' : '卖'}</td>
                    <td className="mono">{t.symbol}</td>
                    <td>{t.name}</td>
                    <td className="mono">{fmt(t.qty, 0)}</td>
                    <td className="mono">{fmt(t.price)}</td>
                    <td className="mono">{fmt(t.qty * t.price, 0)}</td>
                    <td className="mono muted">{fmt(t.fee, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <Advanced title="高级 · CSV 导入导出" className="panel-like" >
          <div className="toolbar" style={{ marginTop: 4 }}>
            <button className="btn" onClick={() => downloadText('trades.csv', db.exportTradesCsv())}>
              导出成交 CSV
            </button>
            <button
              className="btn"
              onClick={() => {
                const priceMap: Record<string, number> = {}
                enriched.forEach((p) => {
                  priceMap[p.symbol] = safeNum(p.lastPrice, safeNum(p.avgCost))
                })
                downloadText('positions.csv', db.exportPositionsCsv(priceMap))
              }}
            >
              导出持仓 CSV
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              导入成交 CSV
            </button>
            <button className="btn" onClick={() => setConfirmRebuild(true)} title="从成交日志回放起始资金">
              从成交重算现金
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onImportCsv(f)
                e.target.value = ''
              }}
            />
          </div>
          <label className="check-inline" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={importRebuildCash}
              onChange={(e) => setImportRebuildCash(e.target.checked)}
            />
            导入后按成交日志重算现金（推荐，修复 CSV 仅追加导致的现金漂移）
          </label>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            表头：symbol,name,side,qty,price,fee,ts · 持仓始终由成交推导 · 账户以 CNY 记账，外币仅示意折算。
          </p>
        </Advanced>
      </div>

      <ConfirmDialog
        open={!!confirmSide}
        title={
          quotes[normalizeSymbol(symbol).symbol]?.source === 'mock'
            ? confirmSide === 'buy'
              ? '示意行情 · 确认买入'
              : '示意行情 · 确认卖出'
            : confirmSide === 'buy'
              ? '确认模拟买入'
              : '确认模拟卖出'
        }
        message={
          confirmSide
            ? (quotes[normalizeSymbol(symbol).symbol]?.source === 'mock'
                ? `⚠ 当前价格来自示意/模拟源，不能当作真实市价。` +
                  `仍要${confirmSide === 'buy' ? '买入' : '卖出'} ${normalizeSymbol(symbol).symbol} × ${qty}？` +
                  `示意价 ${orderCcy} ${fmt(effectivePrice())}。纸上交易，不会真实下单。`
                : orderType === 'limit'
                  ? `即将提交限价挂单：${confirmSide === 'buy' ? '买' : '卖'} ${normalizeSymbol(symbol).symbol} × ${qty} @ ${orderCcy} ${fmt(effectivePrice())}。` +
                    `进入待成交队列；行情触及限价时按演示规则成交（买≤限价 / 卖≥限价），非券商撮合。`
                  : `即将${confirmSide === 'buy' ? '买入' : '卖出'} ${normalizeSymbol(symbol).symbol} × ${qty}（纸上交易）。` +
                    `市价跟最新 ${orderCcy} ${fmt(effectivePrice())}，` +
                    `合计约 ${fmt(Number(qty) * effectivePrice(), 0)}（另计约 0.03% 佣金）。不会真实下单。`)
            : ''
        }
        confirmLabel={
          quotes[normalizeSymbol(symbol).symbol]?.source === 'mock'
            ? '已知晓示意价，继续'
            : orderType === 'limit'
              ? '确认挂单'
              : confirmSide === 'buy'
                ? '确认买入'
                : '确认卖出'
        }
        danger={confirmSide === 'sell' || quotes[normalizeSymbol(symbol).symbol]?.source === 'mock'}
        onConfirm={doPlace}
        onCancel={() => setConfirmSide(null)}
      />
      <ConfirmDialog
        open={confirmRebuild}
        title="从成交重算现金"
        message={
          `将以起始资金 ¥${db.STARTING_CASH.toLocaleString('zh-CN')} 为基，` +
          `按时间顺序回放全部成交（含费用）重写可用现金。持仓本身已由成交推导，本操作只修复现金漂移。是否继续？`
        }
        confirmLabel="重算现金"
        onConfirm={doRebuildCash}
        onCancel={() => setConfirmRebuild(false)}
      />
    </>
  )
}
