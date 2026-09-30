import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuotes } from '../hooks/useQuotes'
import * as db from '../services/db'
import {
  analyzeLivePortfolio,
  exportLiveAnalysisCsv,
  exportLiveAnalysisMarkdown,
  parseLiveTradesCsv,
  type LiveAnalysisResult,
} from '../services/liveAnalysis'
import { normalizeSymbol } from '../services/quotes'
import { fmt, fmtPct, fmtSigned } from '../utils/format'
import type { LiveTrade, ToastItem, TradeSide } from '../types'
import { Icons } from '../components/Icon'

interface Props {
  refreshSec: number
  onToast?: (t: Omit<ToastItem, 'id'>) => void
  onOpenJournal?: (symbol: string) => void
}

function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function LivePage({ refreshSec, onToast, onOpenJournal }: Props) {
  const [trades, setTrades] = useState<LiveTrade[]>([])
  const [paste, setPaste] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<LiveAnalysisResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 手动单笔
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [symbol, setSymbol] = useState('600519.SH')
  const [name, setName] = useState('')
  const [side, setSide] = useState<TradeSide>('buy')
  const [qty, setQty] = useState('100')
  const [price, setPrice] = useState('')
  const [fee, setFee] = useState('0')

  const symbols = useMemo(() => {
    const set = new Set(trades.map((t) => t.symbol))
    return [...set]
  }, [trades])

  const { quotes, refresh } = useQuotes(symbols, refreshSec)

  const reload = () => {
    try {
      setTrades(db.listLiveTrades(5000))
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取实盘成交失败')
    }
  }

  useEffect(() => {
    reload()
  }, [])

  useEffect(() => {
    const onRefresh = () => refresh()
    window.addEventListener('sw:refresh-quotes', onRefresh)
    return () => window.removeEventListener('sw:refresh-quotes', onRefresh)
  }, [refresh])

  useEffect(() => {
    const priceMap: Record<string, number> = {}
    for (const [sym, q] of Object.entries(quotes)) {
      if (Number.isFinite(q.price)) priceMap[sym] = q.price
    }
    // 无行情时仍可按成本分析
    setAnalysis(analyzeLivePortfolio(trades, priceMap))
  }, [trades, quotes])

  const doImportText = (text: string) => {
    setError(null)
    try {
      const rows = parseLiveTradesCsv(text)
      if (!rows.length) throw new Error('没有可导入的行')
      const n = db.addLiveTradesBulk(
        rows.map((r) => ({
          ts: r.tradeDate,
          symbol: r.symbol,
          name: r.name,
          side: r.side,
          qty: r.qty,
          price: r.price,
          fee: r.fee,
          note: r.note,
        })),
      )
      reload()
      setPaste('')
      onToast?.({ message: `已导入 ${n} 笔实盘成交（仅本地）`, type: 'success' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '导入失败'
      setError(msg)
      onToast?.({ message: msg, type: 'error' })
    }
  }

  const addOne = () => {
    setError(null)
    try {
      const n = normalizeSymbol(symbol)
      if (!n.symbol) throw new Error('代码无效')
      const q = Number(qty)
      const p = Number(price)
      const f = Number(fee) || 0
      if (!Number.isFinite(q) || q <= 0) throw new Error('数量无效')
      if (!Number.isFinite(p) || p <= 0) throw new Error('价格无效')
      let ts = date
      if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) ts = `${ts}T00:00:00.000Z`
      db.addLiveTrade({
        ts,
        symbol: n.symbol,
        name: name || quotes[n.symbol]?.name || n.symbol,
        side,
        qty: q,
        price: p,
        fee: f,
      })
      reload()
      onToast?.({ message: '已添加实盘成交', type: 'success' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '添加失败'
      setError(msg)
    }
  }

  const a = analysis

  return (
    <>
      <header className="page-header">
        <div>
          <h2>实盘分析</h2>
          <p className="subtitle">手动导入真实成交 · 与模拟盘隔离 · 仅本地</p>
        </div>
        <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn-xs" onClick={() => refresh()}>
            <Icons.refresh /> 刷新行情
          </button>
          {a && (
            <>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() =>
                  downloadText(
                    `live-analysis-${new Date().toISOString().slice(0, 10)}.md`,
                    exportLiveAnalysisMarkdown(a),
                    'text/markdown;charset=utf-8',
                  )
                }
              >
                <Icons.download /> 导出 MD
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() =>
                  downloadText(
                    `live-analysis-${new Date().toISOString().slice(0, 10)}.csv`,
                    exportLiveAnalysisCsv(a),
                    'text/csv;charset=utf-8',
                  )
                }
              >
                <Icons.download /> 导出 CSV
              </button>
            </>
          )}
        </div>
      </header>

      <div className="page-body">
        <div className="state-banner warn" role="note">
          <strong>重要声明：</strong>
          实盘数据由你手动导入（CSV / 粘贴），仅保存在本机浏览器或 Electron
          本地库，<strong>不会</strong>上传、
          <strong>不是</strong>券商对接，也<strong>不做</strong>
          未授权爬取登录。分析结果仅供个人复盘学习，<strong>不构成投资建议</strong>。
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">导入成交</div>
          <div className="panel-body">
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              表头示例：
              <code>date,symbol,name,side,qty,price,fee</code>；side 支持 buy/sell 或
              买/卖。费用可选。与「模拟」页成交完全隔离。
            </p>
            <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <button type="button" className="btn primary touch-target" onClick={() => fileRef.current?.click()}>
                <Icons.upload /> 选择 CSV
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  doImportText(await f.text())
                }}
              />
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  downloadText(
                    'live-trades-template.csv',
                    'date,symbol,name,side,qty,price,fee,note\n2026-09-01,600519.SH,贵州茅台,buy,100,1680,5,\n2026-09-15,600519.SH,贵州茅台,sell,50,1750,5,部分止盈\n',
                    'text/csv;charset=utf-8',
                  )
                }}
              >
                下载模板
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  downloadText(
                    `live-trades-${new Date().toISOString().slice(0, 10)}.csv`,
                    db.exportLiveTradesCsv(),
                    'text/csv;charset=utf-8',
                  )
                }}
                disabled={!trades.length}
              >
                导出成交 CSV
              </button>
              <button
                type="button"
                className="btn btn-xs"
                disabled={!trades.length}
                onClick={() => {
                  if (!confirm('清空全部实盘成交？此操作不可恢复（不影响模拟盘）。')) return
                  db.clearLiveTrades()
                  reload()
                  onToast?.({ message: '已清空实盘成交', type: 'info' })
                }}
              >
                清空实盘
              </button>
            </div>
            <label className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              或粘贴 CSV
            </label>
            <textarea
              className="input"
              rows={4}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="date,symbol,name,side,qty,price,fee&#10;2026-09-01,600519.SH,贵州茅台,buy,100,1680,5"
              style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12 }}
            />
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn primary touch-target"
                disabled={!paste.trim()}
                onClick={() => doImportText(paste)}
              >
                从粘贴导入
              </button>
            </div>
            {error && (
              <p className="up" style={{ fontSize: 13, marginBottom: 0 }}>
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">手动记一笔</div>
          <div className="panel-body live-manual-form">
            <div className="form-grid live-form-grid">
              <label>
                日期
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                代码
                <input
                  className="input"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="600519"
                />
              </label>
              <label>
                名称
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="可选" />
              </label>
              <label>
                买卖
                <select className="input" value={side} onChange={(e) => setSide(e.target.value as TradeSide)}>
                  <option value="buy">买</option>
                  <option value="sell">卖</option>
                </select>
              </label>
              <label>
                价格
                <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                数量
                <input className="input" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" />
              </label>
              <label>
                费用
                <input className="input" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" />
              </label>
            </div>
            <button type="button" className="btn primary touch-target" style={{ marginTop: 10 }} onClick={addOne}>
              添加
            </button>
          </div>
        </div>

        {a && (
          <>
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-header">分析概览</div>
              <div className="panel-body">
                <div className="stat-grid live-stat-grid">
                  <div className="stat-card">
                    <div className="stat-label">持仓成本</div>
                    <div className="stat-value mono">{fmt(a.totalCost, 2)}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">市值</div>
                    <div className="stat-value mono">{fmt(a.totalMarketValue, 2)}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">浮动盈亏</div>
                    <div className={`stat-value mono ${a.floatingPnl >= 0 ? 'up' : 'down'}`}>
                      {fmtSigned(a.floatingPnl, 2)}
                      {a.floatingPnlPct != null ? ` (${fmtPct(a.floatingPnlPct)})` : ''}
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">已实现盈亏</div>
                    <div className={`stat-value mono ${a.realizedPnl >= 0 ? 'up' : 'down'}`}>
                      {fmtSigned(a.realizedPnl, 2)}
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">胜率</div>
                    <div className="stat-value mono">
                      {a.winRate != null ? `${a.winRate.toFixed(1)}%` : '—'}
                      <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
                        {a.closedRounds ? `${a.wins}/${a.closedRounds}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">最大回撤（示意）</div>
                    <div className="stat-value mono">
                      {a.maxDrawdownPct != null ? `${a.maxDrawdownPct.toFixed(2)}%` : '—'}
                    </div>
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                  {a.note} 浮动盈亏使用当前行情（失败时回退成本价）。回撤由成交推算净值曲线估算。
                </p>
              </div>
            </div>

            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-header">持仓与集中度</div>
              <div className="panel-body table-scroll">
                {a.positions.length === 0 ? (
                  <div className="empty-state compact">暂无持仓（导入买入成交后显示）</div>
                ) : (
                  <table className="data dense focusable-table">
                    <thead>
                      <tr>
                        <th>代码</th>
                        <th>名称</th>
                        <th>数量</th>
                        <th>成本</th>
                        <th>现价</th>
                        <th>市值</th>
                        <th>浮动</th>
                        <th>权重</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {a.positions.map((p) => (
                        <tr key={p.symbol} tabIndex={0}>
                          <td className="mono">{p.symbol}</td>
                          <td>{p.name}</td>
                          <td className="mono">{fmt(p.qty, 0)}</td>
                          <td className="mono">{fmt(p.avgCost, 3)}</td>
                          <td className="mono">{fmt(p.lastPrice || 0, 3)}</td>
                          <td className="mono">{fmt(p.marketValue || 0, 2)}</td>
                          <td className={`mono ${(p.pnl || 0) >= 0 ? 'up' : 'down'}`}>
                            {fmtSigned(p.pnl || 0, 2)}
                          </td>
                          <td className="mono">{fmt(p.weightPct, 1)}%</td>
                          <td>
                            {onOpenJournal && (
                              <button
                                type="button"
                                className="btn btn-xs"
                                onClick={() => onOpenJournal(p.symbol)}
                                title="去复盘"
                              >
                                复盘
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-header">近期交易回顾</div>
              <div className="panel-body table-scroll">
                {a.recentTrades.length === 0 ? (
                  <div className="empty-state compact">暂无成交</div>
                ) : (
                  <table className="data dense focusable-table">
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>买卖</th>
                        <th>代码</th>
                        <th>数量</th>
                        <th>价格</th>
                        <th>费用</th>
                        <th>备注</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {a.recentTrades.map((t) => (
                        <tr key={t.id} tabIndex={0}>
                          <td className="mono">{t.ts.slice(0, 10)}</td>
                          <td>{t.side === 'buy' ? '买' : '卖'}</td>
                          <td className="mono">{t.symbol}</td>
                          <td className="mono">{fmt(t.qty, 0)}</td>
                          <td className="mono">{fmt(t.price, 3)}</td>
                          <td className="mono">{fmt(t.fee, 2)}</td>
                          <td className="muted">{t.note || '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-xs"
                              aria-label="删除"
                              onClick={() => {
                                if (!confirm(`删除成交 #${t.id}？`)) return
                                db.deleteLiveTrade(t.id)
                                reload()
                              }}
                            >
                              删
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
