/**
 * 工作台 JSON 备份 / 恢复
 * 覆盖：自选、提醒、成交、账户、净值、持仓备注、复盘、设置、主题、扫描快照
 */
import * as db from './db'
import { clearTechScanSnapshot, loadTechScanSnapshot, saveTechScanSnapshot } from './scanSnapshot'
import type {
  AppSettings,
  EquitySnapshot,
  JournalNote,
  PaperAccount,
  PositionNote,
  PriceAlert,
  Trade,
  WatchlistItem,
} from '../types'
import type { TechScanSnapshot } from './scanSnapshot'

export const BACKUP_SCHEMA = 'stock-workstation-backup'
export const BACKUP_VERSION = 1

export interface WorkstationBackup {
  schema: typeof BACKUP_SCHEMA
  version: typeof BACKUP_VERSION
  appVersion: string
  exportedAt: string
  data: {
    watchlist: WatchlistItem[]
    alerts: PriceAlert[]
    account: PaperAccount
    trades: Trade[]
    equity: EquitySnapshot[]
    positionNotes: PositionNote[]
    journal: JournalNote[]
    settings: AppSettings & { notifyEnabled?: boolean }
    theme: 'light' | 'dark'
    techScanSnapshot: TechScanSnapshot | null
    pendingOrders?: import('../types').PendingOrder[]
  }
}

export function exportWorkstationBackup(appVersion = '0.10.0'): WorkstationBackup {
  const settings = db.getSettings()
  let theme: 'light' | 'dark' = settings.theme
  try {
    const t = localStorage.getItem('sw-theme')
    if (t === 'light' || t === 'dark') theme = t
  } catch {
    /* */
  }
  const notifyEnabled = db.getSetting('notifyEnabled') === '1'
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    data: {
      watchlist: db.listWatchlist(),
      alerts: db.listAlerts(),
      account: db.getAccount(),
      trades: db.listTrades({ limit: 10000 }),
      equity: db.listEquitySnapshots(5000),
      positionNotes: db.listPositionNotes(),
      journal: db.listJournalNotes(5000),
      settings: { ...settings, notifyEnabled },
      theme,
      techScanSnapshot: loadTechScanSnapshot(),
      pendingOrders: db.listPendingOrders('all'),
    },
  }
}

export function backupFilename(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `stock-workstation-backup-${y}${m}${day}.json`
}

export function downloadBackup(appVersion?: string): { filename: string; bytes: number } {
  const payload = exportWorkstationBackup(appVersion)
  const text = JSON.stringify(payload, null, 2)
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const filename = backupFilename()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return { filename, bytes: text.length }
}

export interface BackupValidation {
  ok: boolean
  error?: string
  backup?: WorkstationBackup
}

export function validateBackup(raw: unknown): BackupValidation {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: '文件不是有效 JSON 对象' }
  }
  const o = raw as Record<string, unknown>
  if (o.schema !== BACKUP_SCHEMA) {
    return { ok: false, error: `schema 不匹配（期望 ${BACKUP_SCHEMA}）` }
  }
  if (o.version !== BACKUP_VERSION) {
    return {
      ok: false,
      error: `版本不支持（文件 v${String(o.version)}，当前支持 v${BACKUP_VERSION}）`,
    }
  }
  const data = o.data as WorkstationBackup['data'] | undefined
  if (!data || typeof data !== 'object') {
    return { ok: false, error: '缺少 data 字段' }
  }
  if (!Array.isArray(data.watchlist) || !Array.isArray(data.trades) || !Array.isArray(data.alerts)) {
    return { ok: false, error: 'data 内自选/成交/提醒格式无效' }
  }
  if (!data.account || typeof data.account !== 'object') {
    return { ok: false, error: '缺少账户信息' }
  }
  if (!data.settings || typeof data.settings !== 'object') {
    return { ok: false, error: '缺少设置' }
  }
  return { ok: true, backup: o as unknown as WorkstationBackup }
}

/** 将备份覆盖写入本地库（调用前请二次确认） */
export function importWorkstationBackup(backup: WorkstationBackup): void {
  const v = validateBackup(backup)
  if (!v.ok || !v.backup) throw new Error(v.error || '校验失败')
  const d = v.backup.data

  db.replaceWorkstationData({
    watchlist: d.watchlist,
    alerts: d.alerts,
    account: d.account,
    trades: d.trades,
    equity: d.equity || [],
    positionNotes: d.positionNotes || [],
    journal: d.journal || [],
    settings: d.settings,
    pendingOrders: d.pendingOrders || [],
  })

  try {
    const theme = d.theme === 'light' || d.theme === 'dark' ? d.theme : 'dark'
    localStorage.setItem('sw-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.colorScheme = theme
  } catch {
    /* */
  }

  if (d.techScanSnapshot) {
    try {
      saveTechScanSnapshot({
        meta: d.techScanSnapshot.meta,
        hits: d.techScanSnapshot.hits,
      })
    } catch {
      /* */
    }
  } else {
    clearTechScanSnapshot()
  }
}

export const BACKUP_FIELD_HELP = [
  'watchlist — 自选（含分组标签）',
  'alerts — 价格/RVOL 提醒',
  'account — 模拟账户现金',
  'trades — 成交记录',
  'equity — 净值快照',
  'positionNotes — 止损/止盈备注',
  'journal — 复盘笔记',
  'pendingOrders — 限价挂单',
  'settings — 行情源/刷新/免打扰/量监/通知等',
  'theme — 日间/夜间',
  'techScanSnapshot — 技术扫描上次结果（若有）',
] as const
