import { useEffect, useRef, useState } from 'react'
import { Advanced } from '../components/Advanced'
import * as db from '../services/db'
import { getProviderHealth, quoteService, syncQuoteProxyFromDb } from '../services/quotes'
import { getScreenerHealth, probeScreener } from '../services/screener'
import { fmtDateTime } from '../utils/format'
import type { AppSettings, ProviderHealth, QuoteProviderMode } from '../types'
import { ThemeToggle } from '../components/ThemeToggle'
import type { ThemeMode } from '../utils/theme'
import {
  BACKUP_FIELD_HELP,
  downloadBackup,
  importWorkstationBackup,
  validateBackup,
} from '../services/backup'
import {
  getNotifyPermission,
  requestNotifyPermission,
  sendSystemNotification,
  setNotifyEnabledSetting,
} from '../services/notify'
import { Icons } from '../components/Icon'
import { isPagesHost } from '../utils/dataStatus'
import { HONEST_QUOTE_BOUNDARY, PAGES_QUOTE_HINT } from '../utils/dataStatusLabels'
import {
  isLlmFeatureAvailable,
  loadLlmKey,
  saveLlmKey,
  summarizeWithUserLlm,
} from '../services/llmSummary'

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
  const fileRef = useRef<HTMLInputElement>(null)
  const [notifyPerm, setNotifyPerm] = useState(() => getNotifyPermission())
  const [importBusy, setImportBusy] = useState(false)
  const [llmKey, setLlmKey] = useState('')
  const [llmBusy, setLlmBusy] = useState(false)
  const [llmTestOut, setLlmTestOut] = useState<string | null>(null)

  useEffect(() => {
    setHealth(getProviderHealth())
    setScreenerHealth(getScreenerHealth())
    // 进入设置页自动轻量刷新缓存/模拟状态，并异步探测
    void probe(true)
    if (isElectron && window.stockWorkstation?.getLlmKey) {
      void loadLlmKey().then(setLlmKey)
      void window.stockWorkstation.getOpenAtLogin?.().then((r) => {
        if (r.openAtLogin !== settings.electronOpenAtLogin) {
          /* sync display from OS */
        }
      })
    }
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
        return '通'
      case 'degraded':
        return '慢'
      case 'down':
        return '挂'
      case 'skipped':
        return '跳过'
      default:
        return '未测'
    }
  }

  const okCount = health.filter((h) => h.status === 'ok' || h.status === 'degraded').length
  const downCount = health.filter((h) => h.status === 'down').length

  return (
    <>
      <header className="page-header">
        <div>
          <h2>设置</h2>
          <p className="subtitle">
            行情健康
            {health.length > 0 ? ` · ${okCount} 通` : ''}
            {downCount > 0 ? ` · ${downCount} 挂` : ''}
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
                    <th>耗时</th>
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
              进入本页会自动探测（真实轻量请求）。「通」=可用，「挂」=失败冷却中，「慢」=偏慢。单源超时约 7s；失败立刻下一源并退避。auto 对已知挂掉的源冷却约 3 分钟。旧行情新鲜 TTL 30 分钟，可放宽至 24 小时后再用演示数据（绝不会把演示标成最新）。日报源亦在此探测。
              {isPagesHost() ? ` ${PAGES_QUOTE_HINT}` : ' Electron/本机可走原生 HTTP，通常比公开站更稳。'}
              {' '}{HONEST_QUOTE_BOUNDARY}
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
                    clist pn/pz 分页至前200；行业/概念板块榜；成分股龙头/中军；失败回退演示数据
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
                    量价洗盘 / MACD 金叉 / 突破回踩；前200按需拉K线；演示数据不计命中
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
                <option value="auto">自动（东财 → 新浪 → 同花顺 → Yahoo → 旧行情 → 演示）</option>
                <option value="eastmoney">东方财富优先</option>
                <option value="ths">同花顺优先</option>
                <option value="yahoo">Yahoo Finance 优先</option>
                <option value="mock">仅本地演示数据</option>
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
          <div className="panel-header">自备行情代理（可选）</div>
          <div className="panel-body">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              填写你自己的 CORS 中继或网关（仅存本机，不进仓库）。支持完整前缀、末尾 <code>?url=</code>，或带 <code>{'{url}'}</code> 占位。
              Pages 静态站无密钥；桌面版优先原生 HTTP。
            </p>
            <div className="form-row">
              <label>代理 URL</label>
              <input
                className="input"
                style={{ maxWidth: 420 }}
                placeholder="https://your-relay.example/proxy?url="
                value={settings.quoteProxyUrl || ''}
                onChange={(e) => {
                  const v = e.target.value.trim()
                  db.setSetting('quoteProxyUrl', v)
                  try {
                    localStorage.setItem('sw-quote-proxy-url', v)
                  } catch {
                    /* */
                  }
                  syncQuoteProxyFromDb()
                  onChange({ ...settings, quoteProxyUrl: v })
                }}
              />
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">模拟费率与本地风控</div>
          <div className="panel-body">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              费率仅用于纸上成交扣减现金；印花税仅卖出计。风控为本地提醒，非强制平仓、非券商规则。
            </p>
            <div className="form-row">
              <label>佣金费率</label>
              <input
                className="input"
                style={{ maxWidth: 120 }}
                inputMode="decimal"
                value={String(settings.paperFeeRate ?? 0.0003)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v) || v < 0) return
                  db.setSetting('paperFeeRate', String(v))
                  onChange({ ...settings, paperFeeRate: v })
                }}
              />
              <span className="muted" style={{ fontSize: 12 }}>默认 0.0003（0.03%）</span>
            </div>
            <div className="form-row">
              <label>印花税（卖）</label>
              <input
                className="input"
                style={{ maxWidth: 120 }}
                inputMode="decimal"
                value={String(settings.paperStampTaxRate ?? 0.0005)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v) || v < 0) return
                  db.setSetting('paperStampTaxRate', String(v))
                  onChange({ ...settings, paperStampTaxRate: v })
                }}
              />
              <span className="muted" style={{ fontSize: 12 }}>默认 0.0005；买不加</span>
            </div>
            <div className="form-row">
              <label>单票仓位上限</label>
              <input
                className="input"
                style={{ maxWidth: 120 }}
                inputMode="decimal"
                value={String(settings.riskMaxPositionPct ?? 0.35)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v) || v < 0) return
                  db.setSetting('riskMaxPositionPct', String(v))
                  onChange({ ...settings, riskMaxPositionPct: v })
                }}
              />
              <span className="muted" style={{ fontSize: 12 }}>占净值；0=关闭提醒</span>
            </div>
            <div className="form-row">
              <label>日内亏损提醒</label>
              <input
                className="input"
                style={{ maxWidth: 120 }}
                inputMode="decimal"
                value={String(settings.riskDailyLossPct ?? 0.03)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v) || v < 0) return
                  db.setSetting('riskDailyLossPct', String(v))
                  onChange({ ...settings, riskDailyLossPct: v })
                }}
              />
              <span className="muted" style={{ fontSize: 12 }}>占净值；0=关闭</span>
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
          <div className="panel-header">桌面端（Electron）</div>
          <div className="panel-body">
            {!isElectron ? (
              <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 0 }}>
                当前为浏览器 / GitHub Pages。托盘、开机自启仅在 <code>npm run electron:dev</code> 或桌面包中可用。
                Linux 部分桌面环境对系统托盘支持不完整；开机自启依赖 Electron Login Item，部分发行版无效——属平台限制，非假实现。
              </p>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                  托盘：关闭窗口时可最小化到托盘（若桌面环境支持 Tray）。开机自启：macOS/Windows 较稳；Linux 视桌面而定。
                </p>
                <div className="form-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.electronMinimizeToTray}
                      onChange={async (e) => {
                        const v = e.target.checked
                        db.setSetting('electronMinimizeToTray', v ? '1' : '0')
                        onChange({ ...settings, electronMinimizeToTray: v })
                        await window.stockWorkstation?.setMinimizeToTray?.(v)
                        setMsg(v ? '已开启：关闭时最小化到托盘' : '已关闭托盘驻留')
                      }}
                    />{' '}
                    关闭时最小化到托盘
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.electronOpenAtLogin}
                      onChange={async (e) => {
                        const v = e.target.checked
                        const r = await window.stockWorkstation?.setOpenAtLogin?.(v)
                        if (r && r.ok === false) {
                          setMsg(`开机自启设置失败：${r.error || '平台不支持'}`)
                          return
                        }
                        db.setSetting('electronOpenAtLogin', v ? '1' : '0')
                        onChange({ ...settings, electronOpenAtLogin: v })
                        setMsg(v ? '已请求开机自启' : '已关闭开机自启')
                      }}
                    />{' '}
                    开机时启动
                  </label>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">可选 LLM 总结（默认关闭）</div>
          <div className="panel-body">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              用你自备的 OpenAI 兼容 API Key 对复盘/分析文本做短总结。Key <strong>仅存 Electron userData</strong>，
              <strong>绝不</strong>打进 GitHub Pages 静态包；浏览器站不提供 Key 输入。
            </p>
            {!isLlmFeatureAvailable() ? (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                当前环境不可配置 Key。请使用桌面 Electron 壳。
              </p>
            ) : (
              <>
                <div className="form-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.llmSummaryEnabled}
                      onChange={(e) => {
                        const v = e.target.checked
                        db.setSetting('llmSummaryEnabled', v ? '1' : '0')
                        onChange({ ...settings, llmSummaryEnabled: v })
                        setMsg(v ? '已启用 LLM 总结' : '已关闭 LLM 总结')
                      }}
                    />{' '}
                    启用 LLM 总结
                  </label>
                </div>
                <div className="form-row">
                  <label>API Key（本机）</label>
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    value={llmKey}
                    onChange={(e) => setLlmKey(e.target.value)}
                    placeholder="sk-…"
                    style={{ minWidth: 220 }}
                  />
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={llmBusy}
                    onClick={async () => {
                      setLlmBusy(true)
                      try {
                        const r = await saveLlmKey(llmKey)
                        setMsg(r.ok ? 'Key 已保存到本机 userData' : r.error || '保存失败')
                      } finally {
                        setLlmBusy(false)
                      }
                    }}
                  >
                    保存 Key
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={llmBusy}
                    onClick={async () => {
                      setLlmBusy(true)
                      setLlmTestOut(null)
                      try {
                        const out = await summarizeWithUserLlm(
                          '示例：今日买入 600519 100股，计划持有波段，情绪平稳。请用三条总结。',
                        )
                        setLlmTestOut(out)
                        setMsg('LLM 测试成功')
                      } catch (err) {
                        setMsg(err instanceof Error ? err.message : 'LLM 测试失败')
                      } finally {
                        setLlmBusy(false)
                      }
                    }}
                  >
                    测试调用
                  </button>
                </div>
                {llmTestOut && (
                  <pre className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {llmTestOut}
                  </pre>
                )}
              </>
            )}
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


        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <span>系统通知</span>
            <Icons.bell />
          </div>
          <div className="panel-body">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              价格 / RVOL 提醒触发时，在已授权且非免打扰时段推送系统通知（Web Notification 或 Electron 桌面通知）。不做微信/钉钉。
            </p>
            {isPagesHost() && (
              <p className="muted" style={{ fontSize: 12 }}>
                公开站可能演示/延时；部分浏览器需用户手势后才可授权通知。
              </p>
            )}
            <div className="form-row" style={{ alignItems: 'center' }}>
              <label>启用通知</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={settings.notifyEnabled}
                  onChange={async (e) => {
                    const on = e.target.checked
                    if (on) {
                      const perm = await requestNotifyPermission()
                      setNotifyPerm(perm)
                      if (perm !== 'granted') {
                        setMsg(perm === 'denied' ? '通知权限被拒绝，请在浏览器设置中开启' : '无法请求通知权限')
                        setNotifyEnabledSetting(false)
                        onChange({ ...settings, notifyEnabled: false })
                        return
                      }
                    }
                    setNotifyEnabledSetting(on)
                    onChange({ ...settings, notifyEnabled: on })
                    setMsg(on ? '已启用系统通知' : '已关闭系统通知')
                  }}
                />
                授权后推送桌面/系统通知
              </label>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              权限状态：
              {notifyPerm === 'granted'
                ? '已授权'
                : notifyPerm === 'denied'
                  ? '已拒绝'
                  : notifyPerm === 'unsupported'
                    ? '不支持'
                    : '未请求'}
              {' · '}免打扰时段内不会推送（与 Toast 一致）
            </p>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  let perm = getNotifyPermission()
                  if (perm !== 'granted') {
                    perm = await requestNotifyPermission()
                    setNotifyPerm(perm)
                  }
                  if (perm !== 'granted') {
                    setMsg('请先允许通知权限')
                    return
                  }
                  if (!settings.notifyEnabled) {
                    setNotifyEnabledSetting(true)
                    onChange({ ...settings, notifyEnabled: true })
                  }
                  const r = await sendSystemNotification(
                    { title: '股票工作台', body: '测试通知：权限与通道正常。' },
                    { force: true, ignoreMute: true },
                  )
                  setMsg(
                    r === 'ok'
                      ? '已发送测试通知'
                      : r === 'denied'
                        ? '权限不足'
                        : `测试失败：${r}`,
                  )
                }}
              >
                测试通知
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={async () => {
                  const perm = await requestNotifyPermission()
                  setNotifyPerm(perm)
                  setMsg(`权限：${perm}`)
                }}
              >
                请求权限
              </button>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <span>工作台备份</span>
          </div>
          <div className="panel-body">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              导出自选、分组、提醒、成交、持仓备注、净值、复盘、设置/主题及扫描快照等核心数据为 JSON。
              <strong>清除浏览器缓存会丢失本地数据，请定期备份。</strong>
            </p>
            <ul className="muted" style={{ fontSize: 12, marginTop: 0, paddingLeft: 18 }}>
              {BACKUP_FIELD_HELP.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  try {
                    const r = downloadBackup('0.10.0')
                    setMsg(`已下载 ${r.filename}`)
                  } catch (e) {
                    setMsg(e instanceof Error ? e.message : '导出失败')
                  }
                }}
              >
                <Icons.download /> 导出备份
              </button>
              <button
                type="button"
                className="btn"
                disabled={importBusy}
                onClick={() => fileRef.current?.click()}
              >
                <Icons.upload /> 导入并覆盖
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  setImportBusy(true)
                  try {
                    const text = await file.text()
                    let parsed: unknown
                    try {
                      parsed = JSON.parse(text)
                    } catch {
                      setMsg('JSON 解析失败，请检查文件')
                      return
                    }
                    const v = validateBackup(parsed)
                    if (!v.ok || !v.backup) {
                      setMsg(v.error || '备份校验失败')
                      return
                    }
                    const ok1 = confirm(
                      `即将用备份覆盖当前工作台数据（导出于 ${v.backup.exportedAt}）。此操作不可撤销，是否继续？`,
                    )
                    if (!ok1) return
                    const ok2 = confirm('二次确认：确定覆盖自选、成交、提醒、复盘等全部核心数据？')
                    if (!ok2) return
                    importWorkstationBackup(v.backup)
                    const s = db.getSettings()
                    onChange(s)
                    quoteService.setMode(s.quoteProvider)
                    setMsg('备份已导入，建议刷新页面以确保界面同步')
                    setTimeout(() => window.location.reload(), 800)
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : '导入失败')
                  } finally {
                    setImportBusy(false)
                  }
                }}
              />
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
          <div className="panel-header">窗口与 PWA</div>
          <div className="panel-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
            <p style={{ marginTop: 0 }}>
              浏览器从别处点开本站链接时，<strong>无法 100% 强制合并到同一标签</strong>（安全限制）。
              可减少多标签的做法：
            </p>
            <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
              <li>用浏览器「安装应用 / 添加到主屏幕」（PWA，standalone）</li>
              <li>固定收藏夹入口；可控入口使用命名窗口 <code>stock-workstation</code></li>
              <li>若检测到重复实例，顶栏可「尝试聚焦已有窗口」</li>
            </ul>
            <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
              站内外链：同 URL 将复用已开窗口（非每次无条件新开）。
            </p>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">关于</div>
          <div className="panel-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
            <p style={{ marginTop: 0 }}>
              <strong>股票工作台</strong> v0.12.0 · 文案/行情加固/模拟实盘加深
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
