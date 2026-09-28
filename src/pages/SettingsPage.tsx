import { useEffect, useState } from 'react'
import { Advanced } from '../components/Advanced'
import * as db from '../services/db'
import { getProviderHealth, quoteService } from '../services/quotes'
import { fmtDateTime } from '../utils/format'
import type { AppSettings, ProviderHealth, QuoteProviderMode } from '../types'

interface Props {
  settings: AppSettings
  onChange: (s: AppSettings) => void
  onShowCoach?: () => void
  onShowShortcuts?: () => void
}

export function SettingsPage({ settings, onChange, onShowCoach, onShowShortcuts }: Props) {
  const [msg, setMsg] = useState<string | null>(null)
  const [health, setHealth] = useState<ProviderHealth[]>([])
  const [probing, setProbing] = useState(false)
  const [clearTrades, setClearTrades] = useState(true)
  const [clearEquity, setClearEquity] = useState(true)
  const [clearNotes, setClearNotes] = useState(true)
  const [clearJournal, setClearJournal] = useState(false)
  const [restoreCash, setRestoreCash] = useState(true)
  const isElectron = Boolean(window.stockWorkstation?.isElectron)

  useEffect(() => {
    setHealth(getProviderHealth())
    // 进入设置页自动轻量刷新缓存/模拟状态，并异步探测
    void probe(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveProvider = (v: QuoteProviderMode) => {
    db.setSetting('quoteProvider', v)
    quoteService.setMode(v)
    onChange({ ...settings, quoteProvider: v })
    setMsg('行情源优先级已保存')
  }

  const saveInterval = (sec: number) => {
    db.setSetting('refreshIntervalSec', String(sec))
    onChange({ ...settings, refreshIntervalSec: sec })
    setMsg('刷新间隔已保存')
  }

  const probe = async (silent = false) => {
    setProbing(true)
    try {
      const h = await quoteService.probeProviders()
      setHealth(h)
      if (!silent) setMsg('已探测各行情源健康状态')
    } finally {
      setProbing(false)
    }
  }

  const reset = () => {
    const parts: string[] = []
    if (clearTrades) parts.push('成交')
    if (clearEquity) parts.push('净值')
    if (clearNotes) parts.push('止损备注')
    if (clearJournal) parts.push('复盘笔记')
    if (restoreCash) parts.push('现金恢复百万')
    if (parts.length === 0) {
      setMsg('请至少勾选一项')
      return
    }
    if (!confirm(`确认重置？将处理：${parts.join('、')}。`)) return
    db.resetPaperAccount({
      clearTrades,
      clearEquity,
      clearNotes,
      clearJournal,
      restoreCash,
    })
    setMsg('模拟账户已按选项重置')
  }

  const statusLabel = (s: ProviderHealth['status']) => {
    switch (s) {
      case 'ok':
        return '正常'
      case 'degraded':
        return '缓慢'
      case 'down':
        return '不可用'
      case 'skipped':
        return '跳过'
      default:
        return '未知'
    }
  }

  const okCount = health.filter((h) => h.status === 'ok').length
  const downCount = health.filter((h) => h.status === 'down').length

  return (
    <>
      <header className="page-header">
        <div>
          <h2>设置</h2>
          <p className="subtitle">
            行情健康
            {health.length > 0 ? ` · ${okCount} 正常` : ''}
            {downCount > 0 ? ` · ${downCount} 不可用` : ''}
          </p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={onShowShortcuts}>
            快捷键 ?
          </button>
        </div>
      </header>
      <div className="page-body">
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <span>行情源健康</span>
            <button className="btn btn-xs" onClick={() => probe(false)} disabled={probing}>
              {probing ? '探测中…' : '立即探测'}
            </button>
          </div>
          <div className="panel-body">
            {health.length === 0 ? (
              <div className="empty-state compact">加载健康状态…</div>
            ) : (
              <table className="data dense">
                <thead>
                  <tr>
                    <th>源</th>
                    <th>状态</th>
                    <th>延迟</th>
                    <th>上次成功</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {health.map((h) => (
                    <tr key={h.id} style={{ cursor: 'default' }}>
                      <td>{h.label}</td>
                      <td>
                        <span className={`health-pill health-${h.status}`}>{statusLabel(h.status)}</span>
                      </td>
                      <td className="mono muted">{h.latencyMs != null ? `${h.latencyMs}ms` : '—'}</td>
                      <td className="muted" style={{ fontSize: 11 }}>
                        {h.lastOkAt ? fmtDateTime(h.lastOkAt) : '—'}
                      </td>
                      <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                        {h.message}
                        {h.lastError ? ` · ${h.lastError}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
              进入本页会自动探测。东财/新浪带重试；缓存 TTL 约 30 分钟，断网仍可显示上次好价。
            </p>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">行情与刷新</div>
          <div className="panel-body">
            <div className="form-row">
              <label>首选策略</label>
              <select
                className="select"
                value={settings.quoteProvider}
                onChange={(e) => saveProvider(e.target.value as QuoteProviderMode)}
              >
                <option value="auto">自动（东财 → 新浪 → Yahoo → 缓存 → 模拟）</option>
                <option value="eastmoney">东方财富优先</option>
                <option value="yahoo">Yahoo Finance 优先</option>
                <option value="mock">仅本地模拟</option>
              </select>
            </div>
            <div className="form-row">
              <label>刷新秒数</label>
              <select
                className="select"
                value={settings.refreshIntervalSec}
                onChange={(e) => saveInterval(Number(e.target.value))}
              >
                <option value={15}>15</option>
                <option value={30}>30（默认）</option>
                <option value={60}>60</option>
                <option value={0}>手动</option>
              </select>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">提醒免打扰</div>
          <div className="panel-body">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              在此时段内价格提醒不会 Toast（仍会在盯盘「已触发」列表里看到历史）。起止小时相同 = 关闭免打扰。
            </p>
            <div className="form-row">
              <label>开始（时）</label>
              <select
                className="select"
                value={settings.muteStartHour}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  db.setSetting('muteStartHour', String(v))
                  onChange({ ...settings, muteStartHour: v })
                  setMsg('免打扰开始时段已保存')
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>结束（时）</label>
              <select
                className="select"
                value={settings.muteEndHour}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  db.setSetting('muteEndHour', String(v))
                  onChange({ ...settings, muteEndHour: v })
                  setMsg('免打扰结束时段已保存')
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              当前：
              {settings.muteStartHour === settings.muteEndHour
                ? '免打扰已关闭'
                : `${String(settings.muteStartHour).padStart(2, '0')}:00 – ${String(settings.muteEndHour).padStart(2, '0')}:00（可跨午夜）`}
            </p>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">学习与快捷键</div>
          <div className="panel-body">
            <div className="toolbar">
              <button
                className="btn"
                onClick={() => {
                  db.setSetting('coachDismissed', '0')
                  onChange({ ...settings, coachDismissed: false })
                  onShowCoach?.()
                }}
              >
                重新显示引导
              </button>
              <button className="btn" onClick={onShowShortcuts}>
                查看快捷键
              </button>
            </div>
          </div>
        </div>

        <Advanced title="高级 · 模拟账户重置">
          <div className="panel" style={{ marginTop: 0 }}>
            <div className="panel-body">
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                可勾选保留项：例如只清空成交但保留复盘笔记。
              </p>
              <div className="check-grid">
                <label>
                  <input type="checkbox" checked={clearTrades} onChange={(e) => setClearTrades(e.target.checked)} />{' '}
                  清空成交
                </label>
                <label>
                  <input type="checkbox" checked={clearEquity} onChange={(e) => setClearEquity(e.target.checked)} />{' '}
                  清空净值快照
                </label>
                <label>
                  <input type="checkbox" checked={clearNotes} onChange={(e) => setClearNotes(e.target.checked)} />{' '}
                  清空止损/止盈备注
                </label>
                <label>
                  <input type="checkbox" checked={clearJournal} onChange={(e) => setClearJournal(e.target.checked)} />{' '}
                  清空复盘笔记
                </label>
                <label>
                  <input type="checkbox" checked={restoreCash} onChange={(e) => setRestoreCash(e.target.checked)} />{' '}
                  现金恢复 ¥1,000,000
                </label>
              </div>
              <button className="btn danger" onClick={reset} style={{ marginTop: 12 }}>
                按选项重置
              </button>
            </div>
          </div>
        </Advanced>

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">关于</div>
          <div className="panel-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
            <p style={{ marginTop: 0 }}>
              <strong>股票工作台</strong> v0.5.0 · 简单 UX，更深功能
            </p>
            <p className="muted">
              运行环境：{isElectron ? `Electron (${window.stockWorkstation?.platform})` : 'Web（浏览器）'}
            </p>
            <p className="muted">技术栈：Electron + Vite + React + TypeScript + sql.js + lightweight-charts</p>
          </div>
        </div>

        {msg && (
          <p className="msg-ok" style={{ marginTop: 14 }}>
            {msg}
          </p>
        )}
      </div>
    </>
  )
}
