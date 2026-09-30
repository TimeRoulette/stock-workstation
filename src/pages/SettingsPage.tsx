import { useEffect, useState } from 'react'
import { Advanced } from '../components/Advanced'
import * as db from '../services/db'
import { getProviderHealth, quoteService } from '../services/quotes'
import { getScreenerHealth, probeScreener } from '../services/screener'
import { fmtDateTime } from '../utils/format'
import type { AppSettings, ProviderHealth, QuoteProviderMode } from '../types'
import { ThemeToggle } from '../components/ThemeToggle'
import type { ThemeMode } from '../utils/theme'

interface Props {
  settings: AppSettings
  onChange: (s: AppSettings) => void
  onShowCoach?: () => void
  onShowShortcuts?: () => void
  theme?: ThemeMode
  onThemeChange?: (theme: ThemeMode) => void
}

export function SettingsPage({ settings, onChange, onShowCoach, onShowShortcuts, theme, onThemeChange }: Props) {
  const [msg, setMsg] = useState<string | null>(null)
  const [health, setHealth] = useState<ProviderHealth[]>([])
  const [screenerHealth, setScreenerHealth] = useState<ProviderHealth | null>(null)
  const [probing, setProbing] = useState(false)
  const [clearTrades, setClearTrades] = useState(true)
  const [clearEquity, setClearEquity] = useState(true)
  const [clearNotes, setClearNotes] = useState(true)
  const [clearJournal, setClearJournal] = useState(false)
  const [restoreCash, setRestoreCash] = useState(true)
  const isElectron = Boolean(window.stockWorkstation?.isElectron)

  useEffect(() => {
    setHealth(getProviderHealth())
    setScreenerHealth(getScreenerHealth())
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
      const sh = await probeScreener()
      setScreenerHealth(sh)
      if (!silent) setMsg('已探测各行情源与选股榜健康状态')
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
                  {[...health, ...(screenerHealth ? [screenerHealth] : [])].map((h) => (
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
              进入本页会自动探测（真实轻量请求）。单源超时约 7s；失败立刻下一源。auto 对已知 down 源冷却约 3 分钟。缓存新鲜 TTL 30 分钟，可放宽至 24 小时后再 mock。日报源（人民日报 / 央视 / 华尔街见闻 / BBC / 美联储 / 东财榜）亦在此探测。
            </p>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">源接入说明（核实后）</div>
          <div className="panel-body">
            <table className="data dense">
              <thead>
                <tr>
                  <th>源</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>同花顺</td>
                  <td>行情</td>
                  <td>
                    <span className="health-pill health-ok">已接</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    Web realhead JSONP（d.10jqka.com.cn，CORS *，无密钥）；A 股；入回退链
                  </td>
                </tr>
                <tr>
                  <td>东财涨跌幅榜</td>
                  <td>选股</td>
                  <td>
                    <span className="health-pill health-ok">已接</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    clist pn/pz 分页至前200；行业/概念板块榜；成分股龙头/中军；失败回退示意
                  </td>
                </tr>
                <tr>
                  <td>人民日报</td>
                  <td>日报</td>
                  <td>
                    <span className="health-pill health-ok">已接</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    人民网财经 RSS；Pages 经 rss2json 公网转换（无密钥）
                  </td>
                </tr>
                <tr>
                  <td>样式财经 → 央视财经</td>
                  <td>日报</td>
                  <td>
                    <span className="health-pill health-ok">已接</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    未找到「样式财经」站；同音接央视网 economy JSONP（无密钥）
                  </td>
                </tr>
                <tr>
                  <td>华尔街见闻</td>
                  <td>日报</td>
                  <td>
                    <span className="health-pill health-ok">已接</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    全球快讯公开 JSON（api-one-wscn）；Pages 经 corsproxy 回退
                  </td>
                </tr>
                <tr>
                  <td>BBC Business / 美联储</td>
                  <td>日报</td>
                  <td>
                    <span className="health-pill health-ok">已接</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    公开 RSS → rss2json（无密钥）；覆盖国际宏观 / 央行
                  </td>
                </tr>
                <tr>
                  <td>技术选股</td>
                  <td>选股</td>
                  <td>
                    <span className="health-pill health-ok">已接</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    量价洗盘 / MACD 金叉 / 突破回踩；前200按需拉K线；示意数据不计命中
                  </td>
                </tr>
                <tr>
                  <td>同花顺期货通</td>
                  <td>行情</td>
                  <td>
                    <span className="health-pill health-skipped">跳过</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    官方 REST 需 X-api-key；客户端协议需 Electron 本地桥
                  </td>
                </tr>
                <tr>
                  <td>通达信</td>
                  <td>行情</td>
                  <td>
                    <span className="health-pill health-skipped">跳过</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    TCP 客户端协议，GitHub Pages 不可直连；需 Electron 本地桥
                  </td>
                </tr>
                <tr>
                  <td>指南针股票</td>
                  <td>行情</td>
                  <td>
                    <span className="health-pill health-skipped">跳过</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    仅客户端/登录体系，无稳定无密钥公开 JSON
                  </td>
                </tr>
                <tr>
                  <td>华宝智投</td>
                  <td>行情</td>
                  <td>
                    <span className="health-pill health-skipped">跳过</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    券商 App 条件单产品，无公开行情 API
                  </td>
                </tr>
                <tr>
                  <td>财联社</td>
                  <td>资讯</td>
                  <td>
                    <span className="health-pill health-skipped">跳过</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    Web 电报接口需签名（errno 10012），不稳定且易失效
                  </td>
                </tr>
                <tr>
                  <td>开盘啦</td>
                  <td>行情</td>
                  <td>
                    <span className="health-pill health-skipped">跳过</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    App 私有接口（DeviceID/签名），Pages 不可靠
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">外观主题</div>
          <div className="panel-body">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              日间浅色 / 夜间深色。首次跟随系统，手动切换后记住你的选择。
            </p>
            <ThemeToggle
              variant="full"
              theme={theme ?? settings.theme}
              onChange={(th) => {
                onThemeChange?.(th)
                onChange({ ...settings, theme: th })
              }}
            />
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
                <option value="auto">自动（东财 → 新浪 → 同花顺 → Yahoo → 缓存 → 模拟）</option>
                <option value="eastmoney">东方财富优先</option>
                <option value="ths">同花顺优先</option>
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
          <div className="panel-header">成交量监测</div>
          <div className="panel-body">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              RVOL = 今日量 / 近 N 日均量（不含当日）。不足 5 根历史时不计算 RVOL。
            </p>
            <div className="form-row">
              <label>均量回看天数</label>
              <select
                className="select"
                value={settings.volumeLookback}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  db.setSetting('volumeLookback', String(v))
                  onChange({ ...settings, volumeLookback: v })
                  setMsg('均量回看天数已保存')
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20（默认）</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </div>
            <div className="form-row">
              <label>默认 RVOL 提醒</label>
              <select
                className="select"
                value={settings.defaultRvolAlert}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  db.setSetting('defaultRvolAlert', String(v))
                  onChange({ ...settings, defaultRvolAlert: v })
                  setMsg('默认 RVOL 提醒阈值已保存')
                }}
              >
                <option value={1.5}>1.5×（放量）</option>
                <option value={2}>2.0×（默认）</option>
                <option value={3}>3.0×</option>
                <option value={3.5}>3.5×（爆量）</option>
              </select>
            </div>
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
              <strong>股票工作台</strong> v0.9.1 · 简单 UX，更深功能
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
