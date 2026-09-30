import { useEffect, useMemo, useRef, useState } from 'react'
import { Advanced } from '../components/Advanced'
import { Glossary } from '../components/Glossary'
import { SettingsSection } from '../components/SettingsSection'
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
  fetchRemoteModels,
  isLlmFeatureAvailable,
  llmKeyStorageHint,
  loadLlmKey,
  saveLlmKey,
  summarizeWithUserLlm,
} from '../services/llmSummary'
import { getLlmProvider, LLM_PROVIDERS } from '../services/llmProviders'
import {
  APP_VERSION,
  UPDATE_CHECKER_NOTE,
  UPDATE_WEB_NOTE,
  checkForAppUpdate,
  isNativeAndroid,
  openApkDownload,
  type AndroidUpdateMeta,
  type UpdateCheckResult,
} from '../services/appUpdate'

interface Props {
  settings: AppSettings
  onChange: (s: AppSettings) => void
  onShowCoach?: () => void
  onShowShortcuts?: () => void
  theme?: ThemeMode
  onThemeChange?: (theme: ThemeMode) => void
  onUpdateAvailable?: (info: {
    latestVersion: string
    currentVersion: string
    meta?: AndroidUpdateMeta
  }) => void
  onClearUpdateBadge?: () => void
}

export function SettingsPage({
  settings,
  onChange,
  onShowCoach,
  onShowShortcuts,
  theme,
  onThemeChange,
  onUpdateAvailable,
  onClearUpdateBadge,
}: Props) {
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
  const [llmModelOptions, setLlmModelOptions] = useState<string[]>([])
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [sectionTick, setSectionTick] = useState(0)

  const llmPreset = useMemo(
    () => getLlmProvider(settings.llmProvider || 'deepseek'),
    [settings.llmProvider],
  )

  const modelChoices = useMemo(() => {
    const set = new Set<string>([...llmPreset.models, ...llmModelOptions])
    if (settings.llmModel) set.add(settings.llmModel)
    return Array.from(set)
  }, [llmPreset.models, llmModelOptions, settings.llmModel])

  useEffect(() => {
    setHealth(getProviderHealth())
    setScreenerHealth(getScreenerHealth())
    void probe(true)
    if (isLlmFeatureAvailable()) {
      void loadLlmKey().then(setLlmKey)
    }
    setLlmModelOptions(getLlmProvider(settings.llmProvider || 'deepseek').models)
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

  const applyLlmProvider = (providerId: string) => {
    const p = getLlmProvider(providerId)
    const baseUrl = p.baseUrl
    const model = p.models[0] || settings.llmModel || ''
    db.setSetting('llmProvider', providerId)
    db.setSetting('llmBaseUrl', baseUrl)
    if (model) db.setSetting('llmModel', model)
    setLlmModelOptions(p.models)
    onChange({
      ...settings,
      llmProvider: providerId,
      llmBaseUrl: baseUrl,
      llmModel: model || settings.llmModel,
    })
    setMsg(`已切换供应商：${p.label}`)
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

  const collapseAll = () => {
    try {
      const ids = [
        'appearance',
        'quotes',
        'paper',
        'notify',
        'llm',
        'electron',
        'learning',
        'backup',
        'about',
      ]
      const map: Record<string, boolean> = {}
      for (const id of ids) map[id] = false
      localStorage.setItem('sw-settings-sections', JSON.stringify(map))
      setSectionTick((t) => t + 1)
      setMsg('已全部折叠')
    } catch {
      setMsg('无法写入折叠状态')
    }
  }

  const expandCommon = () => {
    try {
      const ids = [
        'appearance',
        'quotes',
        'paper',
        'notify',
        'llm',
        'electron',
        'learning',
        'backup',
        'about',
      ]
      const map: Record<string, boolean> = {}
      for (const id of ids) map[id] = id === 'appearance' || id === 'quotes'
      localStorage.setItem('sw-settings-sections', JSON.stringify(map))
      setSectionTick((t) => t + 1)
      setMsg('已展开常用区块（外观、行情）')
    } catch {
      setMsg('无法写入折叠状态')
    }
  }

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
        <div className="toolbar settings-header-tools">
          <button type="button" className="btn btn-xs" onClick={expandCommon}>
            常用
          </button>
          <button type="button" className="btn btn-xs" onClick={collapseAll}>
            全折
          </button>
          <button className="btn" onClick={onShowShortcuts}>
            快捷键 ?
          </button>
        </div>
      </header>
      <div className="page-body" key={sectionTick}>
        <Glossary kind="settings" className="glossary-banner" />
        <SettingsSection id="appearance" title="外观" defaultOpen>
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
        </SettingsSection>

        <SettingsSection
          id="quotes"
          title="行情 / 数据源"
          defaultOpen
          trailing={
            <button
              type="button"
              className="btn btn-xs primary"
              onClick={(e) => {
                e.stopPropagation()
                void probe(false)
              }}
              disabled={probing}
            >
              {probing ? '探测中…' : '立即探测'}
            </button>
          }
        >
          <div className="health-summary" role="status" aria-live="polite" style={{ marginBottom: 10 }}>
            <span className="health-summary-ok">通 {okCount}</span>
            <span className="health-summary-down">挂 {downCount}</span>
            <span className="health-summary-rest muted">
              其余 {Math.max(0, health.length - okCount - downCount)}（未测/跳过/演示）
            </span>
            {probing && <span className="health-summary-probing">正在探测真源…</span>}
          </div>
          {health.length === 0 ? (
            <div className="empty-state compact">加载健康状态…</div>
          ) : (
            <table className="data dense health-table">
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
                  <tr
                    key={h.id}
                    className={`health-row health-row-${h.status}`}
                    style={{ cursor: 'default' }}
                  >
                    <td>
                      <strong>{h.label}</strong>
                      {['eastmoney', 'sina', 'ths', 'yahoo'].includes(h.id) ? (
                        <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                          真源
                        </span>
                      ) : h.id === 'mock' ? (
                        <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                          非真行情
                        </span>
                      ) : null}
                    </td>
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
          <p className="muted" style={{ fontSize: 12, marginBottom: 12, marginTop: 8 }}>
            进入本页会自动探测。「通」=可用，「挂」=失败（auto 冷却约 60s）。
            {isPagesHost() ? ` ${PAGES_QUOTE_HINT}` : ' Electron/Capacitor 原生 HTTP 通常更稳。'}{' '}
            {HONEST_QUOTE_BOUNDARY}
          </p>

          <h4 className="settings-subhead">行情与刷新</h4>
          <div className="form-row">
            <label>首选策略</label>
            <select
              className="select"
              value={settings.quoteProvider}
              onChange={(e) => saveProvider(e.target.value as QuoteProviderMode)}
            >
              <option value="auto">自动（浏览器：同花顺优先；原生：东财优先 → … → 旧行情 → 演示）</option>
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

          <h4 className="settings-subhead">自备行情代理（可选）</h4>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            填写你自己的 CORS 中继或网关（仅存本机）。支持完整前缀、末尾 <code>?url=</code>，或带{' '}
            <code>{'{url}'}</code> 占位。
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

          <h4 className="settings-subhead">成交量监测</h4>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            RVOL = 今日量 / 近 N 日均量（不含当日）。不足 5 根历史时不计算 RVOL。
          </p>
          <div className="form-row">
            <label>均量回看</label>
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
            <label>默认 RVOL</label>
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

          <details className="settings-details">
            <summary>源接入说明（核实后）</summary>
            <table className="data dense" style={{ marginTop: 8 }}>
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
                    Web realhead JSONP（CORS *）；A 股；入回退链
                  </td>
                </tr>
                <tr>
                  <td>东财涨跌幅榜</td>
                  <td>选股</td>
                  <td>
                    <span className="health-pill health-ok">已接</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    clist 分页至前200；失败回退演示
                  </td>
                </tr>
                <tr>
                  <td>人民日报 / 央视 / 华尔街见闻 / BBC</td>
                  <td>日报</td>
                  <td>
                    <span className="health-pill health-ok">已接</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    公开 RSS/JSON；Pages 经公网转换
                  </td>
                </tr>
                <tr>
                  <td>通达信 / 期货通 / 指南针等</td>
                  <td>行情</td>
                  <td>
                    <span className="health-pill health-skipped">跳过</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>
                    需密钥或客户端协议，Pages 不可直连
                  </td>
                </tr>
              </tbody>
            </table>
          </details>
        </SettingsSection>

        <SettingsSection id="paper" title="模拟费率与本地风控" defaultOpen={false}>
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
            <span className="muted" style={{ fontSize: 12 }}>
              默认 0.0003（0.03%）
            </span>
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
            <span className="muted" style={{ fontSize: 12 }}>
              默认 0.0005；买不加
            </span>
          </div>
          <div className="form-row">
            <label>单票仓位</label>
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
            <span className="muted" style={{ fontSize: 12 }}>
              占净值；0=关闭提醒
            </span>
          </div>
          <div className="form-row">
            <label>日内亏损</label>
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
            <span className="muted" style={{ fontSize: 12 }}>
              占净值；0=关闭
            </span>
          </div>
        </SettingsSection>

        <SettingsSection
          id="notify"
          title="通知"
          defaultOpen={false}
          trailing={<Icons.bell />}
        >
          <h4 className="settings-subhead">提醒免打扰</h4>
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
          <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            当前：
            {settings.muteStartHour === settings.muteEndHour
              ? '免打扰已关闭'
              : `${String(settings.muteStartHour).padStart(2, '0')}:00 – ${String(settings.muteEndHour).padStart(2, '0')}:00（可跨午夜）`}
          </p>

          <h4 className="settings-subhead">系统通知</h4>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            价格 / RVOL 提醒触发时，在已授权且非免打扰时段推送系统通知（Web Notification 或 Electron
            桌面通知）。不做微信/钉钉。
          </p>
          {isPagesHost() && (
            <p className="muted" style={{ fontSize: 12 }}>
              公开站可能演示/延时；部分浏览器需用户手势后才可授权通知。
            </p>
          )}
          <div className="form-row form-row-check">
            <span className="form-row-label">启用通知</span>
            <label className="check-inline">
              <input
                type="checkbox"
                checked={settings.notifyEnabled}
                onChange={async (e) => {
                  const on = e.target.checked
                  // 先写入用户意图，避免权限失败时受控 checkbox「点了没反应」
                  setNotifyEnabledSetting(on)
                  onChange({ ...settings, notifyEnabled: on })
                  if (!on) {
                    setMsg('已关闭系统通知')
                    return
                  }
                  const perm = await requestNotifyPermission()
                  setNotifyPerm(perm)
                  if (perm === 'granted') {
                    setMsg('已启用系统通知（权限已授权）')
                  } else if (perm === 'denied') {
                    setMsg(
                      '已勾选启用意图，但通知权限已被拒绝。请在浏览器站点设置或系统设置中允许通知后，再点「请求权限」或「测试通知」。推送在获权前不会发出。',
                    )
                  } else if (perm === 'unsupported') {
                    setMsg(
                      '已勾选启用意图，但当前环境不支持系统通知（需 HTTPS、桌面壳或支持 Notification 的浏览器）。',
                    )
                  } else {
                    setMsg('已勾选启用意图，尚未完成授权。请点「请求权限」完成授权。')
                  }
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
                ? '已拒绝（可保留勾选，需到系统/浏览器改权限）'
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
                  setMsg(
                    perm === 'denied'
                      ? '权限已被拒绝：请在浏览器/系统设置中允许本站通知后再试'
                      : perm === 'unsupported'
                        ? '当前环境不支持系统通知'
                        : '请先允许通知权限',
                  )
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
                setMsg(
                  perm === 'granted'
                    ? '权限：已授权'
                    : perm === 'denied'
                      ? '权限：已拒绝（请到浏览器站点设置开启）'
                      : `权限：${perm}`,
                )
              }}
            >
              请求权限
            </button>
          </div>
        </SettingsSection>

        <SettingsSection id="llm" title="LLM（OpenAI 兼容）" defaultOpen={false}>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            用你自备的 OpenAI 兼容 API（含 DeepSeek 等）对复盘/分析文本做短总结。
            <strong>默认关闭</strong>。输出<strong>非投资建议</strong>，不荐股、不承诺收益。
            Key <strong>绝不</strong>打进 GitHub Pages 静态包。
          </p>
          <div className="form-row form-row-check">
            <span className="form-row-label">启用</span>
            <label className="check-inline">
              <input
                type="checkbox"
                checked={settings.llmSummaryEnabled}
                onChange={(e) => {
                  const v = e.target.checked
                  db.setSetting('llmSummaryEnabled', v ? '1' : '0')
                  onChange({ ...settings, llmSummaryEnabled: v })
                  setMsg(v ? '已启用 LLM 总结（非投资建议）' : '已关闭 LLM 总结')
                }}
              />
              启用 LLM 总结（默认关）
            </label>
          </div>

          <div className="form-row">
            <label>供应商</label>
            <select
              className="select"
              value={settings.llmProvider || 'deepseek'}
              onChange={(e) => applyLlmProvider(e.target.value)}
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {llmPreset.note && (
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              {llmPreset.note}
            </p>
          )}

          <div className="form-row">
            <label>Base URL</label>
            <div className="settings-inline-fields">
              <input
                className="input"
                style={{ minWidth: 0, flex: 1 }}
                value={settings.llmBaseUrl || ''}
                placeholder="https://api.deepseek.com/v1"
                onChange={(e) => {
                  const v = e.target.value.trim()
                  db.setSetting('llmBaseUrl', v)
                  onChange({ ...settings, llmBaseUrl: v })
                }}
              />
              <button
                type="button"
                className="btn btn-xs"
                title="恢复该供应商默认 URL"
                onClick={() => {
                  const p = getLlmProvider(settings.llmProvider || 'deepseek')
                  db.setSetting('llmBaseUrl', p.baseUrl)
                  onChange({ ...settings, llmBaseUrl: p.baseUrl })
                  setMsg(p.baseUrl ? `已恢复默认 URL：${p.baseUrl}` : '该供应商无默认 URL，请自行填写')
                }}
              >
                恢复默认 URL
              </button>
            </div>
          </div>

          <div className="form-row">
            <label>模型</label>
            <div className="settings-inline-fields">
              <select
                className="select"
                style={{ minWidth: 0, flex: 1 }}
                value={
                  modelChoices.includes(settings.llmModel) ? settings.llmModel : '__custom__'
                }
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__custom__') return
                  db.setSetting('llmModel', v)
                  onChange({ ...settings, llmModel: v })
                  setMsg(`模型已设为 ${v}`)
                }}
              >
                {modelChoices.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__custom__">手动输入…</option>
              </select>
              <input
                className="input"
                style={{ minWidth: 0, flex: 1 }}
                value={settings.llmModel || ''}
                placeholder="模型 id，可手输"
                onChange={(e) => {
                  const v = e.target.value.trim()
                  db.setSetting('llmModel', v)
                  onChange({ ...settings, llmModel: v })
                }}
              />
              <button
                type="button"
                className="btn btn-xs"
                disabled={llmBusy || !isLlmFeatureAvailable()}
                onClick={async () => {
                  setLlmBusy(true)
                  try {
                    const ids = await fetchRemoteModels({
                      baseUrl: settings.llmBaseUrl,
                      apiKey: llmKey,
                    })
                    setLlmModelOptions(ids)
                    if (!ids.includes(settings.llmModel) && ids[0]) {
                      db.setSetting('llmModel', ids[0])
                      onChange({ ...settings, llmModel: ids[0] })
                    }
                    setMsg(`已从远端刷新 ${ids.length} 个模型`)
                  } catch (err) {
                    setLlmModelOptions(llmPreset.models)
                    setMsg(
                      `刷新失败，已保留预设模型：${err instanceof Error ? err.message : String(err)}`,
                    )
                  } finally {
                    setLlmBusy(false)
                  }
                }}
              >
                刷新模型
              </button>
            </div>
          </div>

          {!isLlmFeatureAvailable() ? (
            <p className="msg-warn" style={{ fontSize: 12.5 }}>
              当前为 GitHub Pages / 公开 Web：为避免 Key 落在不安全环境，已禁用 Key 输入。请使用桌面
              Electron 或 Android APK 配置自备 API。
            </p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 12 }}>{llmKeyStorageHint()}</p>
              <div className="form-row">
                <label>API Key</label>
                <div className="settings-inline-fields">
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    value={llmKey}
                    onChange={(e) => setLlmKey(e.target.value)}
                    placeholder="sk-…"
                    style={{ minWidth: 0, flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={llmBusy}
                    onClick={async () => {
                      setLlmBusy(true)
                      try {
                        const r = await saveLlmKey(llmKey)
                        setMsg(r.ok ? 'Key 已保存到本机' : r.error || '保存失败')
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
                        if (!settings.llmSummaryEnabled) {
                          db.setSetting('llmSummaryEnabled', '1')
                          onChange({ ...settings, llmSummaryEnabled: true })
                        }
                        const out = await summarizeWithUserLlm(
                          '示例：今日买入 600519 100股，计划持有波段，情绪平稳。请用三条总结。',
                        )
                        setLlmTestOut(out)
                        setMsg('LLM 测试成功（输出非投资建议）')
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
              </div>
              {llmTestOut && (
                <pre className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {llmTestOut}
                </pre>
              )}
            </>
          )}
        </SettingsSection>

        <SettingsSection id="electron" title="桌面端（Electron）" defaultOpen={false}>
          {!isElectron ? (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 0 }}>
              当前为浏览器 / GitHub Pages。托盘、开机自启仅在 <code>npm run electron:dev</code> 或桌面包中可用。
              Linux 部分桌面环境对系统托盘支持不完整；开机自启依赖 Electron Login Item，部分发行版无效——属平台限制，非假实现。
            </p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                托盘：关闭窗口时可最小化到托盘（若桌面环境支持 Tray）。开机自启：macOS/Windows 较稳；Linux
                视桌面而定。
              </p>
              <div className="form-row form-row-check">
                <span className="form-row-label">托盘</span>
                <label className="check-inline">
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
                  />
                  关闭时最小化到托盘
                </label>
              </div>
              <div className="form-row form-row-check">
                <span className="form-row-label">自启</span>
                <label className="check-inline">
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
                  />
                  开机时启动
                </label>
              </div>
            </>
          )}
        </SettingsSection>

        <SettingsSection id="learning" title="学习与快捷键" defaultOpen={false}>
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
        </SettingsSection>

        <SettingsSection id="backup" title="备份" defaultOpen={false}>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            导出自选、分组、提醒、成交、持仓备注、净值、复盘、设置/主题及扫描快照等核心数据为 JSON。
            <strong>清除浏览器缓存会丢失本地数据，请定期备份。</strong>
            LLM API Key 不在备份中。
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
                  const r = downloadBackup(APP_VERSION)
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

          <div style={{ marginTop: 14 }}>
            <Advanced title="高级 · 模拟账户重置">
              <div className="panel" style={{ marginTop: 0 }}>
                <div className="panel-body">
                  <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                    可勾选保留项：例如只清空成交但保留复盘笔记。
                  </p>
                  <div className="check-grid">
                    <label>
                      <input
                        type="checkbox"
                        checked={clearTrades}
                        onChange={(e) => setClearTrades(e.target.checked)}
                      />{' '}
                      清空成交
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={clearEquity}
                        onChange={(e) => setClearEquity(e.target.checked)}
                      />{' '}
                      清空净值快照
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={clearNotes}
                        onChange={(e) => setClearNotes(e.target.checked)}
                      />{' '}
                      清空止损/止盈备注
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={clearJournal}
                        onChange={(e) => setClearJournal(e.target.checked)}
                      />{' '}
                      清空复盘笔记
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={restoreCash}
                        onChange={(e) => setRestoreCash(e.target.checked)}
                      />{' '}
                      现金恢复 ¥1,000,000
                    </label>
                  </div>
                  <button className="btn danger" onClick={reset} style={{ marginTop: 12 }}>
                    按选项重置
                  </button>
                </div>
              </div>
            </Advanced>
          </div>
        </SettingsSection>

        <SettingsSection
          id="about"
          title="关于 / 更新"
          defaultOpen={false}
          trailing={<Icons.refresh />}
        >
          <h4 className="settings-subhead">窗口与 PWA</h4>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <p style={{ marginTop: 0 }}>
              浏览器从别处点开本站链接时，<strong>无法 100% 强制合并到同一标签</strong>
              （安全限制）。可减少多标签的做法：
            </p>
            <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
              <li>用浏览器「安装应用 / 添加到主屏幕」（PWA，standalone）</li>
              <li>固定收藏夹入口；可控入口使用命名窗口 <code>stock-workstation</code></li>
              <li>若检测到重复实例，顶栏可「尝试聚焦已有窗口」</li>
            </ul>
          </div>

          <h4 className="settings-subhead">检查更新（Android APK）</h4>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            当前应用版本 <strong>v{APP_VERSION}</strong>
            {isNativeAndroid() ? ' · Capacitor 安卓壳' : ' · 浏览器 / PWA / 桌面'}
            。检查会拉取 Pages 上的 <code>app-update.json</code>；
            <strong>不强制、不静默升级</strong>。
          </p>
          <p className="muted" style={{ fontSize: 12 }}>
            {UPDATE_CHECKER_NOTE}
          </p>
          {!isNativeAndroid() && (
            <p className="muted" style={{ fontSize: 12 }}>
              {UPDATE_WEB_NOTE}
            </p>
          )}
          <div className="form-row form-row-check">
            <span className="form-row-label">自动检查</span>
            <label className="check-inline">
              <input
                type="checkbox"
                checked={settings.autoCheckUpdate !== false}
                onChange={(e) => {
                  const on = e.target.checked
                  db.setSetting('autoCheckUpdate', on ? '1' : '0')
                  onChange({ ...settings, autoCheckUpdate: on })
                  setMsg(on ? '已开启启动后轻量检查更新' : '已关闭自动检查更新')
                }}
              />
              启动后自动轻量检查（有新版本时角标/横幅，不打断）
            </label>
          </div>
          <div className="toolbar" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn primary"
              disabled={updateChecking}
              onClick={async () => {
                setUpdateChecking(true)
                setUpdateResult(null)
                try {
                  const r = await checkForAppUpdate({ currentVersion: APP_VERSION })
                  setUpdateResult(r)
                  if (r.status === 'update_available' && r.meta && r.latestVersion) {
                    onUpdateAvailable?.({
                      latestVersion: r.latestVersion,
                      currentVersion: r.currentVersion,
                      meta: r.meta,
                    })
                    setMsg(r.message)
                  } else if (r.status === 'up_to_date') {
                    onClearUpdateBadge?.()
                    setMsg(r.message)
                  } else {
                    setMsg(r.message)
                  }
                } finally {
                  setUpdateChecking(false)
                }
              }}
            >
              {updateChecking ? '检查中…' : '检查更新'}
            </button>
            {updateResult?.status === 'update_available' && updateResult.meta?.apkUrl && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void openApkDownload(updateResult.meta!.apkUrl).then((r) => {
                    setMsg(
                      r.ok
                        ? '已打开下载链接；请在系统安装界面确认（同 debug 签名可覆盖安装）'
                        : '无法打开下载链接，请到 Release 页手动下载',
                    )
                  })
                }}
              >
                <Icons.download /> 下载并安装 v{updateResult.latestVersion}
              </button>
            )}
            {updateResult?.meta?.releasePage && (
              <a
                className="btn btn-xs"
                href={updateResult.meta.releasePage}
                target="_blank"
                rel="noopener noreferrer"
              >
                Release 页
              </a>
            )}
          </div>
          {updateResult && (
            <div className="update-result" style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 6px', fontSize: 13 }}>
                {updateResult.status === 'update_available' && (
                  <span className="health-pill health-ok">有新版本</span>
                )}
                {updateResult.status === 'up_to_date' && (
                  <span className="health-pill health-ok">已最新</span>
                )}
                {updateResult.status === 'error' && (
                  <span className="health-pill health-down">失败</span>
                )}{' '}
                {updateResult.message}
                {updateResult.source ? (
                  <span className="muted"> · 来源 {updateResult.source}</span>
                ) : null}
              </p>
              {updateResult.meta?.changelog && updateResult.meta.changelog.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55 }}>
                  {updateResult.meta.changelog.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <h4 className="settings-subhead">关于</h4>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <p style={{ marginTop: 0 }}>
              <strong>股票工作台</strong> v{APP_VERSION} · 应用内检查更新
            </p>
            <p className="muted">
              运行环境：
              {isNativeAndroid()
                ? 'Android（Capacitor）'
                : isElectron
                  ? `Electron (${window.stockWorkstation?.platform})`
                  : 'Web（浏览器）'}
            </p>
            <p className="muted" style={{ marginBottom: 0 }}>
              技术栈：Electron + Vite + React + TypeScript + sql.js + lightweight-charts ·
              数据仅供学习，不构成投资建议。
            </p>
          </div>
        </SettingsSection>

        {msg && (
          <p className="msg-ok settings-msg-sticky" style={{ marginTop: 14 }} role="status">
            {msg}
          </p>
        )}
      </div>
    </>
  )
}
