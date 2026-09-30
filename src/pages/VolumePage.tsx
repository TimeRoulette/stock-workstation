import { useCallback, useEffect, useMemo, useState } from 'react'
import { Glossary } from '../components/Glossary'
import { SkeletonTable } from '../components/Skeleton'
import * as db from '../services/db'
import { evaluateAlerts, quoteService } from '../services/quotes'
import { notifyAlertFired } from '../services/notify'
import {
  buildRvolMap,
  rvolLevelClass,
  scanWatchlistVolume,
  type WatchlistVolumeRow,
} from '../services/volumeMonitor'
import { fmt, fmtPct, safeNum } from '../utils/format'
import type { Quote, ToastItem, WatchlistItem } from '../types'

interface Props {
  onToast?: (t: Omit<ToastItem, 'id'>) => void
  onAlertsChange?: () => void
  onFocusSymbol?: (symbol: string) => void
}

type SortKey = 'rvol' | 'vsYesterday' | 'changePercent' | 'symbol'
type SortDir = 'desc' | 'asc'

function fmtVol(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return fmt(n, 0)
}

export function VolumePage({ onToast, onAlertsChange, onFocusSymbol }: Props) {
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [rows, setRows] = useState<WatchlistVolumeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('rvol')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  const lookback = useMemo(() => {
    try {
      return db.getSettings().volumeLookback
    } catch {
      return 20
    }
  }, [])

  const scan = useCallback(async () => {
    const list = db.listWatchlist()
    setItems(list)
    if (!list.length) {
      setRows([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // 先拉现价，再扫日线
      const symbols = list.map((i) => i.symbol)
      let quoteMap: Record<string, Quote> = {}
      try {
        const qs = await quoteService.fetchQuotes(symbols)
        quoteMap = Object.fromEntries(qs.map((q) => [q.symbol, q]))
      } catch {
        /* 行情失败仍扫量 */
      }
      const lb = db.getSettings().volumeLookback
      const scanned = await scanWatchlistVolume(
        list,
        (sym, days, period) => quoteService.fetchCandles(sym, days, period),
        lb,
        quoteMap,
        3,
      )
      setRows(scanned)
      setUpdatedAt(new Date().toISOString())

      const rvolMap = buildRvolMap(scanned)
      const fired = evaluateAlerts(quoteMap, rvolMap)
      if (fired.length) {
        fired.forEach((f) => {
          onToast?.({ message: f.message, type: 'alert' })
          notifyAlertFired(f.message)
        })
        onAlertsChange?.()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '扫描失败')
    } finally {
      setLoading(false)
    }
  }, [onToast, onAlertsChange])

  useEffect(() => {
    void scan()
  }, [scan])

  useEffect(() => {
    const onRefresh = () => void scan()
    window.addEventListener('sw:refresh-quotes', onRefresh)
    return () => window.removeEventListener('sw:refresh-quotes', onRefresh)
  }, [scan])

  const sorted = useMemo(() => {
    const copy = [...rows]
    const dir = sortDir === 'desc' ? -1 : 1
    copy.sort((a, b) => {
      const av =
        sortKey === 'symbol'
          ? a.symbol
          : sortKey === 'rvol'
            ? a.rvol
            : sortKey === 'vsYesterday'
              ? a.vsYesterday
              : a.changePercent
      const bv =
        sortKey === 'symbol'
          ? b.symbol
          : sortKey === 'rvol'
            ? b.rvol
            : sortKey === 'vsYesterday'
              ? b.vsYesterday
              : b.changePercent
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * (sortDir === 'asc' ? 1 : -1)
      const an = av == null || !Number.isFinite(av as number) ? -Infinity : (av as number)
      const bn = bv == null || !Number.isFinite(bv as number) ? -Infinity : (bv as number)
      if (an === bn) return a.symbol.localeCompare(b.symbol)
      return an < bn ? -dir : dir
    })
    return copy
  }, [rows, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else {
      setSortKey(key)
      setSortDir(key === 'symbol' ? 'asc' : 'desc')
    }
  }

  const sortMark = (key: SortKey) => (sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '')

  const surgeCount = rows.filter((r) => r.level === '爆量' || r.level === '放量').length

  return (
    <>
      <header className="page-header">
        <div>
          <h2>成交量监测</h2>
          <p className="subtitle">
            RVOL = 今日量 / 近 {lookback} 日均量（不含当日）
            {surgeCount > 0 ? ` · ${surgeCount} 只放量/爆量` : ''}
            {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString('zh-CN')}` : ''}
            {loading ? ' · 扫描中' : ''}
          </p>
        </div>
        <div className="toolbar">
          <button className="btn primary" onClick={() => void scan()} disabled={loading}>
            {loading ? '扫描中…' : '刷新'}
          </button>
        </div>
      </header>
      <div className="page-body">
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body" style={{ fontSize: 13, lineHeight: 1.65 }}>
            <p style={{ margin: 0 }}>
              扫描自选日线，计算相对成交量（RVOL）并分级：
              <span className="rvol-badge rvol-surge">爆量 ≥3.5</span>
              <span className="rvol-badge rvol-high">放量 ≥1.5</span>
              <span className="rvol-badge rvol-normal">正常</span>
              <span className="rvol-badge rvol-low">缩量</span>
              <span className="rvol-badge rvol-dry">极致缩量 &lt;0.5</span>
            </p>
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
              历史不足 5 根时 RVOL 标为 —。点击代码可跳转盯盘。可在设置调整回看天数与默认 RVOL 提醒阈值。
            </p>
          </div>
        </div>

        {error && <div className="state-banner error">{error}</div>}

        {items.length === 0 ? (
          <div className="empty-state panel">
            <h3>暂无自选</h3>
            <p>请先到「盯盘」添加股票，再回来扫描成交量。</p>
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="panel">
            <SkeletonTable rows={6} />
          </div>
        ) : (
          <div className="panel">
            <div className="panel-header">
              <span>自选量能 · {sorted.length}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                点击表头排序
              </span>
            </div>
            <div className="table-scroll">
            <table className="data dense">
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('symbol')}>
                    代码{sortMark('symbol')}
                  </th>
                  <th>名称</th>
                  <th>现价</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('changePercent')}>
                    涨跌%{sortMark('changePercent')}
                  </th>
                  <th>今日量</th>
                  <th>{lookback}日均量</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('rvol')}>
                    RVOL{sortMark('rvol')}
                  </th>
                  <th>分级</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('vsYesterday')}>
                    较昨日{sortMark('vsYesterday')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const up = safeNum(r.changePercent) >= 0
                  return (
                    <tr key={r.symbol} style={{ cursor: 'default' }}>
                      <td>
                        <button
                          type="button"
                          className="link-symbol mono"
                          onClick={() => onFocusSymbol?.(r.symbol)}
                          title="在盯盘中打开"
                        >
                          {r.symbol}
                        </button>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {r.name}
                      </td>
                      <td className={`mono ${r.price != null ? (up ? 'up' : 'down') : ''}`}>
                        {r.price != null ? fmt(r.price, safeNum(r.price) >= 100 ? 2 : 3) : '—'}
                      </td>
                      <td className={`mono ${r.changePercent != null ? (up ? 'up' : 'down') : ''}`}>
                        {r.changePercent != null ? fmtPct(r.changePercent) : '—'}
                      </td>
                      <td className="mono">{fmtVol(r.todayVolume)}</td>
                      <td className="mono muted">{fmtVol(r.avgVolume)}</td>
                      <td className="mono">
                        {r.rvol != null ? `${r.rvol.toFixed(2)}×` : '—'}
                      </td>
                      <td>
                        <span className={`rvol-badge ${rvolLevelClass(r.level)}`}>{r.level}</span>
                        {r.error && (
                          <span className="muted" style={{ fontSize: 10, marginLeft: 4 }} title={r.error}>
                            !
                          </span>
                        )}
                      </td>
                      <td className="mono muted">
                        {r.vsYesterday != null ? `${r.vsYesterday.toFixed(2)}×` : '—'}
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
          <Glossary kind="volume" />
        </div>
      </div>
    </>
  )
}
