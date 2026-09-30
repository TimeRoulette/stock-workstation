import initSqlJs, { Database, SqlValue } from 'sql.js'
import type {
  WatchlistItem,
  PaperAccount,
  Trade,
  Position,
  AppSettings,
  Market,
  TradeSide,
  TradeFilter,
  EquitySnapshot,
  PositionNote,
  Quote,
  QuoteProviderMode,
  PriceAlert,
  AlertType,
  JournalNote,
  ResetAccountOptions,
  RebuildCashResult,
  ImportTradesOptions,
} from '../types'

const DB_KEY = 'stock-workstation-db-v1'
const STARTING_CASH = 1_000_000
/** 行情缓存「新鲜」TTL：优先返回未过期缓存 */
export const QUOTE_CACHE_TTL_MS = 30 * 60 * 1000
/** 放宽 TTL：真源全失败时仍可用的过期缓存（标记 delayed / source=cache） */
export const QUOTE_CACHE_STALE_TTL_MS = 24 * 60 * 60 * 1000

let db: Database | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

const SEED_WATCHLIST: Array<{ symbol: string; name: string; market: Market }> = [
  { symbol: '600519.SH', name: '贵州茅台', market: 'SH' },
  { symbol: '000001.SZ', name: '平安银行', market: 'SZ' },
  { symbol: '00700.HK', name: '腾讯控股', market: 'HK' },
  { symbol: 'AAPL', name: '苹果', market: 'US' },
  { symbol: 'TSLA', name: '特斯拉', market: 'US' },
]

function scheduleSave() {
  if (!db) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const data = db!.export()
      const b64 = btoa(String.fromCharCode(...data))
      localStorage.setItem(DB_KEY, b64)
    } catch {
      try {
        const data = db!.export()
        let binary = ''
        const chunk = 0x8000
        for (let i = 0; i < data.length; i += chunk) {
          binary += String.fromCharCode(...data.subarray(i, i + chunk))
        }
        localStorage.setItem(DB_KEY, btoa(binary))
      } catch (err) {
        console.error('保存数据库失败', err)
      }
    }
  }, 200)
}

function run(sql: string, params: SqlValue[] = []) {
  if (!db) throw new Error('数据库未初始化')
  db.run(sql, params)
  scheduleSave()
}

function queryAll<T>(sql: string, params: SqlValue[] = [], map: (row: SqlValue[]) => T): T[] {
  if (!db) throw new Error('数据库未初始化')
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(map(stmt.get()))
  }
  stmt.free()
  return rows
}

function queryOne<T>(sql: string, params: SqlValue[] = [], map: (row: SqlValue[]) => T): T | null {
  const rows = queryAll(sql, params, map)
  return rows[0] ?? null
}

function migrate() {
  ;[
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS paper_account (
      id INTEGER PRIMARY KEY,
      cash REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      ts TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS equity_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      cash REAL NOT NULL,
      market_value REAL NOT NULL,
      equity REAL NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS position_notes (
      symbol TEXT PRIMARY KEY,
      stop_loss REAL,
      take_profit REAL,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS quote_cache (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      change_val REAL NOT NULL,
      change_percent REAL NOT NULL,
      open_val REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      prev_close REAL NOT NULL,
      volume REAL NOT NULL,
      currency TEXT NOT NULL,
      as_of TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      threshold REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      triggered_at TEXT,
      created_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS journal_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER,
      symbol TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ].forEach((statement) => run(statement))
  migrateWatchlistTag()
  migrateAlertSnooze()
}

/** v0.4: 自选分组标签（幂等） */
function migrateWatchlistTag() {
  if (!db) return
  try {
    const info = db.exec('PRAGMA table_info(watchlist)')
    const cols = (info[0]?.values || []).map((r) => String(r[1]))
    if (!cols.includes('tag')) {
      db.run('ALTER TABLE watchlist ADD COLUMN tag TEXT NOT NULL DEFAULT \'\'')
      scheduleSave()
    }
  } catch (e) {
    console.warn('migrateWatchlistTag', e)
  }
}

/** v0.5: 提醒稍后 / 免打扰（幂等） */
function migrateAlertSnooze() {
  if (!db) return
  try {
    const info = db.exec('PRAGMA table_info(price_alerts)')
    const cols = (info[0]?.values || []).map((r) => String(r[1]))
    if (!cols.includes('snoozed_until')) {
      db.run('ALTER TABLE price_alerts ADD COLUMN snoozed_until TEXT')
      scheduleSave()
    }
  } catch (e) {
    console.warn('migrateAlertSnooze', e)
  }
}

function seedIfEmpty() {
  const count = queryOne<{ c: number }>(
    'SELECT COUNT(*) FROM watchlist',
    [],
    (r) => ({ c: Number(r[0]) }),
  )
  if (!count || count.c === 0) {
    SEED_WATCHLIST.forEach((item, i) => {
      run(
        'INSERT INTO watchlist (symbol, name, market, sort_order, added_at) VALUES (?, ?, ?, ?, ?)',
        [item.symbol, item.name, item.market, i, new Date().toISOString()],
      )
    })
  }

  const acct = queryOne<{ id: number }>(
    'SELECT id FROM paper_account WHERE id = 1',
    [],
    (r) => ({ id: Number(r[0]) }),
  )
  if (!acct) {
    run('INSERT INTO paper_account (id, cash, currency, created_at) VALUES (1, ?, ?, ?)', [
      STARTING_CASH,
      'CNY',
      new Date().toISOString(),
    ])
  }

  if (!getSetting('quoteProvider')) setSetting('quoteProvider', 'auto')
  if (!getSetting('refreshIntervalSec')) setSetting('refreshIntervalSec', '30')
  if (!getSetting('coachDismissed')) setSetting('coachDismissed', '0')
  if (getSetting('muteStartHour') == null) setSetting('muteStartHour', '23')
  if (getSetting('muteEndHour') == null) setSetting('muteEndHour', '7')
  if (getSetting('volumeLookback') == null) setSetting('volumeLookback', '20')
  if (getSetting('defaultRvolAlert') == null) setSetting('defaultRvolAlert', '2')
  if (getSetting('notifyEnabled') == null) setSetting('notifyEnabled', '0')

  const snapCount = queryOne<{ c: number }>(
    'SELECT COUNT(*) FROM equity_snapshots',
    [],
    (r) => ({ c: Number(r[0]) }),
  )
  if (!snapCount || snapCount.c === 0) {
    const cash = getAccount().cash
    run(
      'INSERT INTO equity_snapshots (ts, cash, market_value, equity) VALUES (?, ?, ?, ?)',
      [new Date().toISOString(), cash, 0, cash],
    )
  }
}

export async function initDb(): Promise<void> {
  if (db) return
  const SQL = await initSqlJs({
    // BASE_URL is './' (or /REPO/) so wasm works on GitHub project Pages
    locateFile: (file) => `${import.meta.env.BASE_URL}${file}`,
  })

  const saved = localStorage.getItem(DB_KEY)
  if (saved) {
    const binary = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0))
    db = new SQL.Database(binary)
  } else {
    db = new SQL.Database()
  }
  migrate()
  seedIfEmpty()
  scheduleSave()
}

export function getSetting(key: string): string | null {
  return queryOne<string | null>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
    (r) => (r[0] == null ? null : String(r[0])),
  )
}

export function setSetting(key: string, value: string) {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
}

export function getSettings(): AppSettings {
  const provider = (getSetting('quoteProvider') as QuoteProviderMode) || 'auto'
  const muteStart = Number(getSetting('muteStartHour') ?? 23)
  const muteEnd = Number(getSetting('muteEndHour') ?? 7)
  const volLb = Number(getSetting('volumeLookback') ?? 20)
  const defRvol = Number(getSetting('defaultRvolAlert') ?? 2)
  let theme: 'light' | 'dark' = 'dark'
  try {
    const saved = localStorage.getItem('sw-theme')
    if (saved === 'light' || saved === 'dark') theme = saved
    else if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      theme = 'light'
    }
  } catch {
    /* */
  }
  return {
    quoteProvider: provider,
    refreshIntervalSec: Number(getSetting('refreshIntervalSec') || 30),
    theme,
    locale: 'zh-CN',
    coachDismissed: getSetting('coachDismissed') === '1',
    muteStartHour: Number.isFinite(muteStart) ? Math.max(0, Math.min(23, Math.floor(muteStart))) : 23,
    muteEndHour: Number.isFinite(muteEnd) ? Math.max(0, Math.min(23, Math.floor(muteEnd))) : 7,
    volumeLookback: Number.isFinite(volLb) ? Math.max(5, Math.min(120, Math.floor(volLb))) : 20,
    defaultRvolAlert: Number.isFinite(defRvol) ? Math.max(0.5, Math.min(20, defRvol)) : 2,
    notifyEnabled: getSetting('notifyEnabled') === '1',
  }
}

/** 当前本地时间是否处于免打扰时段（起止相同 = 关闭） */
export function isInMuteHours(now = new Date()): boolean {
  const s = getSettings()
  if (s.muteStartHour === s.muteEndHour) return false
  const h = now.getHours()
  if (s.muteStartHour < s.muteEndHour) {
    return h >= s.muteStartHour && h < s.muteEndHour
  }
  // 跨午夜，如 23–7
  return h >= s.muteStartHour || h < s.muteEndHour
}

export function listWatchlist(): WatchlistItem[] {
  return queryAll(
    'SELECT id, symbol, name, market, sort_order, added_at, COALESCE(tag, \'\') FROM watchlist ORDER BY sort_order, id',
    [],
    (r) => ({
      id: Number(r[0]),
      symbol: String(r[1]),
      name: String(r[2]),
      market: String(r[3]) as Market,
      sortOrder: Number(r[4]),
      addedAt: String(r[5]),
      tag: String(r[6] || ''),
    }),
  )
}

export function addWatchlistItem(symbol: string, name: string, market: Market, tag = '') {
  const max = queryOne<{ m: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) FROM watchlist',
    [],
    (r) => ({ m: Number(r[0]) }),
  )
  run(
    'INSERT OR IGNORE INTO watchlist (symbol, name, market, sort_order, added_at, tag) VALUES (?, ?, ?, ?, ?, ?)',
    [symbol.toUpperCase(), name, market, (max?.m ?? -1) + 1, new Date().toISOString(), tag || ''],
  )
}

export function setWatchlistTag(id: number, tag: string) {
  run('UPDATE watchlist SET tag = ? WHERE id = ?', [tag || '', id])
}

export function removeWatchlistItem(id: number) {
  run('DELETE FROM watchlist WHERE id = ?', [id])
}

export function getAccount(): PaperAccount {
  const a = queryOne<PaperAccount>(
    'SELECT id, cash, currency, created_at FROM paper_account WHERE id = 1',
    [],
    (r) => ({
      id: Number(r[0]),
      cash: Number(r[1]),
      currency: String(r[2]),
      createdAt: String(r[3]),
    }),
  )
  if (!a) throw new Error('模拟账户不存在')
  return a
}

export function listTrades(filter: TradeFilter | number = 50): Trade[] {
  const f: TradeFilter = typeof filter === 'number' ? { limit: filter } : filter
  const limit = f.limit ?? 100
  const params: SqlValue[] = []
  const where: string[] = []
  if (f.side && f.side !== 'all') {
    where.push('side = ?')
    params.push(f.side)
  }
  if (f.symbol && f.symbol.trim()) {
    where.push('symbol = ?')
    params.push(f.symbol.trim().toUpperCase())
  }
  const sql =
    `SELECT id, symbol, name, side, qty, price, fee, ts FROM trades` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ts DESC, id DESC LIMIT ?`
  params.push(limit)
  return queryAll(sql, params, (r) => ({
    id: Number(r[0]),
    symbol: String(r[1]),
    name: String(r[2]),
    side: String(r[3]) as TradeSide,
    qty: Number(r[4]),
    price: Number(r[5]),
    fee: Number(r[6]),
    ts: String(r[7]),
  }))
}

export function listPositions(): Position[] {
  const trades = queryAll(
    'SELECT symbol, name, side, qty, price FROM trades ORDER BY ts, id',
    [],
    (r) => ({
      symbol: String(r[0]),
      name: String(r[1]),
      side: String(r[2]) as TradeSide,
      qty: Number(r[3]),
      price: Number(r[4]),
    }),
  )
  const map = new Map<string, Position>()
  for (const t of trades) {
    const cur = map.get(t.symbol) || {
      symbol: t.symbol,
      name: t.name,
      qty: 0,
      avgCost: 0,
    }
    if (t.side === 'buy') {
      const px = Number.isFinite(t.price) ? t.price : 0
      const q = Number.isFinite(t.qty) ? t.qty : 0
      const totalCost = (Number.isFinite(cur.avgCost) ? cur.avgCost : 0) * cur.qty + px * q
      cur.qty += q
      cur.avgCost = cur.qty > 0 && Number.isFinite(totalCost) ? totalCost / cur.qty : 0
      if (!Number.isFinite(cur.avgCost)) cur.avgCost = 0
    } else {
      const q = Number.isFinite(t.qty) ? t.qty : 0
      cur.qty -= q
      if (cur.qty <= 0) {
        cur.qty = 0
        cur.avgCost = 0
      }
    }
    cur.name = t.name
    map.set(t.symbol, cur)
  }
  const notes = listPositionNotes()
  const noteMap = new Map(notes.map((n) => [n.symbol, n]))
  return [...map.values()]
    .filter((p) => p.qty > 0)
    .map((p) => {
      const n = noteMap.get(p.symbol)
      return {
        ...p,
        stopLoss: n?.stopLoss ?? null,
        takeProfit: n?.takeProfit ?? null,
      }
    })
}

export function placeTrade(input: {
  symbol: string
  name: string
  side: TradeSide
  qty: number
  price: number
}): Trade {
  if (!Number.isFinite(input.qty) || !Number.isFinite(input.price) || input.qty <= 0 || input.price <= 0) {
    throw new Error('数量和价格必须大于 0')
  }
  const feeRate = 0.0003
  const fee = Math.max(0.01, input.qty * input.price * feeRate)
  const account = getAccount()
  const symbol = input.symbol.toUpperCase()

  if (input.side === 'buy') {
    const cost = input.qty * input.price + fee
    if (cost > account.cash) throw new Error('现金不足')
    run('UPDATE paper_account SET cash = cash - ? WHERE id = 1', [cost])
  } else {
    const pos = listPositions().find((p) => p.symbol === symbol)
    if (!pos || pos.qty < input.qty) throw new Error('持仓不足')
    const proceeds = input.qty * input.price - fee
    run('UPDATE paper_account SET cash = cash + ? WHERE id = 1', [proceeds])
  }

  const ts = new Date().toISOString()
  run(
    'INSERT INTO trades (symbol, name, side, qty, price, fee, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [symbol, input.name, input.side, input.qty, input.price, fee, ts],
  )

  const trade = queryOne<Trade>(
    'SELECT id, symbol, name, side, qty, price, fee, ts FROM trades ORDER BY id DESC LIMIT 1',
    [],
    (r) => ({
      id: Number(r[0]),
      symbol: String(r[1]),
      name: String(r[2]),
      side: String(r[3]) as TradeSide,
      qty: Number(r[4]),
      price: Number(r[5]),
      fee: Number(r[6]),
      ts: String(r[7]),
    }),
  )
  if (!trade) throw new Error('下单失败')
  return trade
}

export function snapshotEquity(priceMap: Record<string, number> = {}) {
  const cash = getAccount().cash
  const positions = listPositions()
  let mv = 0
  for (const p of positions) {
    const px = priceMap[p.symbol] ?? p.avgCost
    mv += px * p.qty
  }
  const equity = cash + mv
  run(
    'INSERT INTO equity_snapshots (ts, cash, market_value, equity) VALUES (?, ?, ?, ?)',
    [new Date().toISOString(), cash, mv, equity],
  )
}

export function listEquitySnapshots(limit = 200): EquitySnapshot[] {
  return queryAll(
    'SELECT id, ts, cash, market_value, equity FROM equity_snapshots ORDER BY ts ASC, id ASC LIMIT ?',
    [limit],
    (r) => ({
      id: Number(r[0]),
      ts: String(r[1]),
      cash: Number(r[2]),
      marketValue: Number(r[3]),
      equity: Number(r[4]),
    }),
  )
}

export function getPositionNote(symbol: string): PositionNote | null {
  return queryOne(
    'SELECT symbol, stop_loss, take_profit, note, updated_at FROM position_notes WHERE symbol = ?',
    [symbol.toUpperCase()],
    (r) => ({
      symbol: String(r[0]),
      stopLoss: r[1] == null ? null : Number(r[1]),
      takeProfit: r[2] == null ? null : Number(r[2]),
      note: String(r[3] || ''),
      updatedAt: String(r[4]),
    }),
  )
}

export function listPositionNotes(): PositionNote[] {
  return queryAll(
    'SELECT symbol, stop_loss, take_profit, note, updated_at FROM position_notes',
    [],
    (r) => ({
      symbol: String(r[0]),
      stopLoss: r[1] == null ? null : Number(r[1]),
      takeProfit: r[2] == null ? null : Number(r[2]),
      note: String(r[3] || ''),
      updatedAt: String(r[4]),
    }),
  )
}

export function upsertPositionNote(
  symbol: string,
  input: { stopLoss?: number | null; takeProfit?: number | null; note?: string },
) {
  const sym = symbol.toUpperCase()
  const prev = getPositionNote(sym)
  const stopLoss = input.stopLoss !== undefined ? input.stopLoss : prev?.stopLoss ?? null
  const takeProfit = input.takeProfit !== undefined ? input.takeProfit : prev?.takeProfit ?? null
  const note = input.note !== undefined ? input.note : prev?.note ?? ''
  run(
    `INSERT OR REPLACE INTO position_notes (symbol, stop_loss, take_profit, note, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [sym, stopLoss, takeProfit, note, new Date().toISOString()],
  )
}

export function cacheQuote(q: Quote) {
  run(
    `INSERT OR REPLACE INTO quote_cache
      (symbol, name, price, change_val, change_percent, open_val, high, low, prev_close, volume, currency, as_of, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      q.symbol,
      q.name,
      q.price,
      q.change,
      q.changePercent,
      q.open,
      q.high,
      q.low,
      q.prevClose,
      q.volume,
      q.currency,
      q.asOf,
      q.source,
      new Date().toISOString(),
    ],
  )
}

export function getCachedQuote(symbol: string, maxAgeMs = QUOTE_CACHE_TTL_MS): Quote | null {
  const row = queryOne(
    `SELECT symbol, name, price, change_val, change_percent, open_val, high, low, prev_close, volume, currency, as_of, source, updated_at
     FROM quote_cache WHERE symbol = ?`,
    [symbol.toUpperCase()],
    (r) => ({
      quote: {
        symbol: String(r[0]),
        name: String(r[1]),
        price: Number(r[2]),
        change: Number(r[3]),
        changePercent: Number(r[4]),
        open: Number(r[5]),
        high: Number(r[6]),
        low: Number(r[7]),
        prevClose: Number(r[8]),
        volume: Number(r[9]),
        currency: String(r[10]),
        asOf: String(r[11]),
        delayed: true,
        source: String(r[12]) as Quote['source'],
      } satisfies Quote,
      updatedAt: String(r[13] || ''),
    }),
  )
  if (!row) return null
  const age = row.updatedAt ? Date.now() - new Date(row.updatedAt).getTime() : Infinity
  if (!Number.isFinite(age) || age > maxAgeMs) return null
  return row.quote
}

/** 任意年龄的缓存（仅当需要「有则返回，无则 mock」） */
export function getCachedQuoteAny(symbol: string): Quote | null {
  return getCachedQuote(symbol, Number.POSITIVE_INFINITY)
}

export function getCachedQuoteMeta(symbol: string): { updatedAt: string } | null {
  return queryOne(
    'SELECT updated_at FROM quote_cache WHERE symbol = ?',
    [symbol.toUpperCase()],
    (r) => ({ updatedAt: String(r[0]) }),
  )
}

/* ---------- Alerts ---------- */

function mapAlert(r: SqlValue[]): PriceAlert {
  return {
    id: Number(r[0]),
    symbol: String(r[1]),
    name: String(r[2] || ''),
    type: String(r[3]) as AlertType,
    threshold: Number(r[4]),
    enabled: Number(r[5]) === 1,
    triggeredAt: r[6] == null ? null : String(r[6]),
    createdAt: String(r[7]),
    note: String(r[8] || ''),
    snoozedUntil: r[9] == null || r[9] === '' ? null : String(r[9]),
  }
}

export function listAlerts(): PriceAlert[] {
  return queryAll(
    'SELECT id, symbol, name, type, threshold, enabled, triggered_at, created_at, note, snoozed_until FROM price_alerts ORDER BY id DESC',
    [],
    mapAlert,
  )
}

export function listEnabledAlerts(): PriceAlert[] {
  return queryAll(
    'SELECT id, symbol, name, type, threshold, enabled, triggered_at, created_at, note, snoozed_until FROM price_alerts WHERE enabled = 1 ORDER BY id DESC',
    [],
    mapAlert,
  )
}

export function addAlert(input: {
  symbol: string
  name?: string
  type: AlertType
  threshold: number
  note?: string
}): PriceAlert {
  const symbol = input.symbol.toUpperCase()
  if (!Number.isFinite(input.threshold)) throw new Error('阈值无效')
  run(
    `INSERT INTO price_alerts (symbol, name, type, threshold, enabled, triggered_at, created_at, note)
     VALUES (?, ?, ?, ?, 1, NULL, ?, ?)`,
    [symbol, input.name || symbol, input.type, input.threshold, new Date().toISOString(), input.note || ''],
  )
  const a = queryOne('SELECT id, symbol, name, type, threshold, enabled, triggered_at, created_at, note, snoozed_until FROM price_alerts ORDER BY id DESC LIMIT 1', [], mapAlert)
  if (!a) throw new Error('创建提醒失败')
  return a
}

export function setAlertEnabled(id: number, enabled: boolean) {
  run('UPDATE price_alerts SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id])
}

export function markAlertTriggered(id: number) {
  run('UPDATE price_alerts SET triggered_at = ?, enabled = 0 WHERE id = ?', [new Date().toISOString(), id])
}

export function deleteAlert(id: number) {
  run('DELETE FROM price_alerts WHERE id = ?', [id])
}

export function snoozeAlert(id: number, minutes: number) {
  const until = new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString()
  // 稍后：保持 enabled，但在 until 前不触发；若已触发则重新启用监听
  run(
    'UPDATE price_alerts SET snoozed_until = ?, enabled = 1, triggered_at = NULL WHERE id = ?',
    [until, id],
  )
}

export function clearAlertSnooze(id: number) {
  run('UPDATE price_alerts SET snoozed_until = NULL WHERE id = ?', [id])
}

export function listTriggeredAlerts(limit = 20): PriceAlert[] {
  return queryAll(
    `SELECT id, symbol, name, type, threshold, enabled, triggered_at, created_at, note, snoozed_until
     FROM price_alerts WHERE triggered_at IS NOT NULL
     ORDER BY triggered_at DESC, id DESC LIMIT ?`,
    [limit],
    mapAlert,
  )
}

export function rearmAlert(id: number) {
  run(
    'UPDATE price_alerts SET enabled = 1, triggered_at = NULL, snoozed_until = NULL WHERE id = ?',
    [id],
  )
}


export function countActiveAlerts(): number {
  const row = queryOne<{ c: number }>(
    'SELECT COUNT(*) FROM price_alerts WHERE enabled = 1',
    [],
    (r) => ({ c: Number(r[0]) }),
  )
  return row?.c ?? 0
}

/* ---------- Journal / 复盘 ---------- */

function mapJournal(r: SqlValue[]): JournalNote {
  return {
    id: Number(r[0]),
    tradeId: r[1] == null ? null : Number(r[1]),
    symbol: String(r[2]),
    title: String(r[3]),
    body: String(r[4] || ''),
    createdAt: String(r[5]),
    updatedAt: String(r[6]),
  }
}

export function listJournalNotes(limit = 100): JournalNote[] {
  return queryAll(
    'SELECT id, trade_id, symbol, title, body, created_at, updated_at FROM journal_notes ORDER BY updated_at DESC, id DESC LIMIT ?',
    [limit],
    mapJournal,
  )
}

export function addJournalNote(input: {
  symbol: string
  title: string
  body?: string
  tradeId?: number | null
}): JournalNote {
  const now = new Date().toISOString()
  run(
    `INSERT INTO journal_notes (trade_id, symbol, title, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.tradeId ?? null, input.symbol.toUpperCase(), input.title.trim() || '无标题', input.body || '', now, now],
  )
  const n = queryOne(
    'SELECT id, trade_id, symbol, title, body, created_at, updated_at FROM journal_notes ORDER BY id DESC LIMIT 1',
    [],
    mapJournal,
  )
  if (!n) throw new Error('保存笔记失败')
  return n
}

export function updateJournalNote(id: number, input: { title?: string; body?: string; symbol?: string }) {
  const prev = queryOne(
    'SELECT id, trade_id, symbol, title, body, created_at, updated_at FROM journal_notes WHERE id = ?',
    [id],
    mapJournal,
  )
  if (!prev) throw new Error('笔记不存在')
  run(
    'UPDATE journal_notes SET symbol = ?, title = ?, body = ?, updated_at = ? WHERE id = ?',
    [
      (input.symbol ?? prev.symbol).toUpperCase(),
      input.title ?? prev.title,
      input.body ?? prev.body,
      new Date().toISOString(),
      id,
    ],
  )
}

export function deleteJournalNote(id: number) {
  run('DELETE FROM journal_notes WHERE id = ?', [id])
}

/** 从成交生成复盘草稿（不写入 DB，仅返回表单预填） */
export function draftJournalFromTrade(t: Trade): {
  symbol: string
  title: string
  body: string
  tradeId: number
} {
  const sideLabel = t.side === 'buy' ? '买入' : '卖出'
  const sideShort = t.side === 'buy' ? '买' : '卖'
  return {
    symbol: t.symbol,
    title: `${sideLabel} ${t.symbol} 复盘`,
    body:
      `成交：${sideShort} ${t.qty} @ ${t.price}（费用 ${t.fee}）\n` +
      `时间：${new Date(t.ts).toLocaleString('zh-CN')}\n` +
      `理由：\n情绪：\n改进：\n`,
    tradeId: t.id,
  }
}

export function getLatestTrade(): Trade | null {
  const rows = listTrades({ limit: 1 })
  return rows[0] ?? null
}

/* ---------- Reset / CSV ---------- */

export function resetPaperAccount(opts?: Partial<ResetAccountOptions>) {
  const o: ResetAccountOptions = {
    clearTrades: opts?.clearTrades ?? true,
    clearEquity: opts?.clearEquity ?? true,
    clearNotes: opts?.clearNotes ?? true,
    clearJournal: opts?.clearJournal ?? false,
    restoreCash: opts?.restoreCash ?? true,
  }
  if (o.clearTrades) run('DELETE FROM trades')
  if (o.clearEquity) run('DELETE FROM equity_snapshots')
  if (o.clearNotes) run('DELETE FROM position_notes')
  if (o.clearJournal) run('DELETE FROM journal_notes')
  if (o.restoreCash) {
    run('UPDATE paper_account SET cash = ?, created_at = ? WHERE id = 1', [
      STARTING_CASH,
      new Date().toISOString(),
    ])
  }
  const cash = getAccount().cash
  const snapCount = queryOne<{ c: number }>(
    'SELECT COUNT(*) FROM equity_snapshots',
    [],
    (r) => ({ c: Number(r[0]) }),
  )
  if (!snapCount || snapCount.c === 0) {
    run(
      'INSERT INTO equity_snapshots (ts, cash, market_value, equity) VALUES (?, ?, ?, ?)',
      [new Date().toISOString(), cash, 0, cash],
    )
  }
}


/**
 * 从成交日志重算现金：起始资金按买卖与费用回放。
 * 持仓本就由成交推导；现金若因 CSV 仅追加而产生漂移，用本函数修复。
 */
export function rebuildCashFromTrades(startingCash = STARTING_CASH): RebuildCashResult {
  const previousCash = getAccount().cash
  const trades = queryAll(
    'SELECT side, qty, price, fee FROM trades ORDER BY ts ASC, id ASC',
    [],
    (r) => ({
      side: String(r[0]) as TradeSide,
      qty: Number(r[1]),
      price: Number(r[2]),
      fee: Number(r[3]) || 0,
    }),
  )
  let cash = startingCash
  for (const t of trades) {
    const qty = Number.isFinite(t.qty) ? t.qty : 0
    const price = Number.isFinite(t.price) ? t.price : 0
    const fee = Number.isFinite(t.fee) ? t.fee : 0
    if (t.side === 'buy') {
      cash -= qty * price + fee
    } else {
      cash += qty * price - fee
    }
  }
  // 允许负现金（异常导入），但写入有限值
  if (!Number.isFinite(cash)) cash = startingCash
  run('UPDATE paper_account SET cash = ? WHERE id = 1', [cash])
  return {
    previousCash,
    newCash: cash,
    tradeCount: trades.length,
    drift: cash - previousCash,
  }
}

/** 导入成交 CSV（表头：symbol,name,side,qty,price,fee,ts） */
export function importTradesCsv(csv: string, opts?: ImportTradesOptions): number {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) throw new Error('CSV 无数据行')
  const header = lines[0].toLowerCase().split(',').map((h) => h.trim())
  const idx = (name: string) => header.indexOf(name)
  const need = ['symbol', 'side', 'qty', 'price']
  for (const n of need) {
    if (idx(n) < 0) throw new Error(`缺少列: ${n}`)
  }
  let count = 0
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i])
    const symbol = String(cols[idx('symbol')] || '').toUpperCase()
    const name = idx('name') >= 0 ? String(cols[idx('name')] || symbol) : symbol
    const side = String(cols[idx('side')] || '').toLowerCase() as TradeSide
    const qty = Number(cols[idx('qty')])
    const price = Number(cols[idx('price')])
    const fee = idx('fee') >= 0 ? Number(cols[idx('fee')] || 0) : 0
    const ts = idx('ts') >= 0 ? String(cols[idx('ts')] || new Date().toISOString()) : new Date().toISOString()
    if (!symbol || (side !== 'buy' && side !== 'sell') || !Number.isFinite(qty) || !Number.isFinite(price)) continue
    run(
      'INSERT INTO trades (symbol, name, side, qty, price, fee, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [symbol, name, side, qty, price, fee || 0, ts],
    )
    count++
  }
  if (opts?.rebuildCash) {
    rebuildCashFromTrades()
  }
  return count
}

export function exportTradesCsv(): string {
  const trades = listTrades({ limit: 5000 })
  const rows = ['symbol,name,side,qty,price,fee,ts']
  for (const t of trades) {
    rows.push(
      [t.symbol, csvEscape(t.name), t.side, t.qty, t.price, t.fee, t.ts].join(','),
    )
  }
  return rows.join('\n')
}

export function exportPositionsCsv(priceMap: Record<string, number> = {}): string {
  const positions = listPositions()
  const rows = ['symbol,name,qty,avgCost,lastPrice,marketValue,pnl,pnlPercent']
  for (const p of positions) {
    const last = Number.isFinite(priceMap[p.symbol]) ? priceMap[p.symbol]! : (Number.isFinite(p.avgCost) ? p.avgCost : 0)
    const qty = Number.isFinite(p.qty) ? p.qty : 0
    const avg = Number.isFinite(p.avgCost) ? p.avgCost : 0
    const mv = last * qty
    const pnl = (last - avg) * qty
    const pct = avg ? ((last - avg) / avg) * 100 : 0
    const safePct = Number.isFinite(pct) ? pct : 0
    const safePnl = Number.isFinite(pnl) ? pnl : 0
    const safeMv = Number.isFinite(mv) ? mv : 0
    rows.push(
      [p.symbol, csvEscape(p.name), qty, avg, last, safeMv, safePnl, safePct.toFixed(2)].join(','),
    )
  }
  return rows.join('\n')
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') inQ = false
      else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

export { STARTING_CASH }

/* ---------- Backup restore ---------- */

export interface ReplaceWorkstationPayload {
  watchlist: WatchlistItem[]
  alerts: PriceAlert[]
  account: PaperAccount
  trades: Trade[]
  equity: EquitySnapshot[]
  positionNotes: PositionNote[]
  journal: JournalNote[]
  settings: AppSettings & { notifyEnabled?: boolean }
}

/** 用备份覆盖核心业务表（保留 quote_cache；settings 按备份写入） */
export function replaceWorkstationData(payload: ReplaceWorkstationPayload): void {
  if (!db) throw new Error('数据库未初始化')
  // 清空业务表（保留 quote_cache）
  ;[
    'DELETE FROM watchlist',
    'DELETE FROM price_alerts',
    'DELETE FROM trades',
    'DELETE FROM equity_snapshots',
    'DELETE FROM position_notes',
    'DELETE FROM journal_notes',
    'DELETE FROM paper_account',
  ].forEach((sql) => run(sql))

  const acc = payload.account
  run('INSERT INTO paper_account (id, cash, currency, created_at) VALUES (1, ?, ?, ?)', [
    Number(acc.cash) || STARTING_CASH,
    acc.currency || 'CNY',
    acc.createdAt || new Date().toISOString(),
  ])

  for (const w of payload.watchlist || []) {
    run(
      `INSERT INTO watchlist (id, symbol, name, market, sort_order, added_at, tag)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        w.id,
        String(w.symbol).toUpperCase(),
        w.name || w.symbol,
        w.market,
        w.sortOrder ?? 0,
        w.addedAt || new Date().toISOString(),
        w.tag || '',
      ],
    )
  }

  for (const t of payload.trades || []) {
    run(
      'INSERT INTO trades (id, symbol, name, side, qty, price, fee, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        t.id,
        String(t.symbol).toUpperCase(),
        t.name || t.symbol,
        t.side,
        t.qty,
        t.price,
        t.fee ?? 0,
        t.ts || new Date().toISOString(),
      ],
    )
  }

  for (const e of payload.equity || []) {
    run(
      'INSERT INTO equity_snapshots (id, ts, cash, market_value, equity) VALUES (?, ?, ?, ?, ?)',
      [e.id, e.ts, e.cash, e.marketValue, e.equity],
    )
  }

  for (const n of payload.positionNotes || []) {
    run(
      `INSERT INTO position_notes (symbol, stop_loss, take_profit, note, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        String(n.symbol).toUpperCase(),
        n.stopLoss,
        n.takeProfit,
        n.note || '',
        n.updatedAt || new Date().toISOString(),
      ],
    )
  }

  for (const a of payload.alerts || []) {
    run(
      `INSERT INTO price_alerts
        (id, symbol, name, type, threshold, enabled, triggered_at, created_at, note, snoozed_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        a.id,
        String(a.symbol).toUpperCase(),
        a.name || a.symbol,
        a.type,
        a.threshold,
        a.enabled ? 1 : 0,
        a.triggeredAt,
        a.createdAt || new Date().toISOString(),
        a.note || '',
        a.snoozedUntil,
      ],
    )
  }

  for (const j of payload.journal || []) {
    run(
      `INSERT INTO journal_notes (id, trade_id, symbol, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        j.id,
        j.tradeId,
        j.symbol || '',
        j.title || '',
        j.body || '',
        j.createdAt || new Date().toISOString(),
        j.updatedAt || new Date().toISOString(),
      ],
    )
  }

  const s = payload.settings
  if (s.quoteProvider) setSetting('quoteProvider', s.quoteProvider)
  if (s.refreshIntervalSec != null) setSetting('refreshIntervalSec', String(s.refreshIntervalSec))
  setSetting('coachDismissed', s.coachDismissed ? '1' : '0')
  if (s.muteStartHour != null) setSetting('muteStartHour', String(s.muteStartHour))
  if (s.muteEndHour != null) setSetting('muteEndHour', String(s.muteEndHour))
  if (s.volumeLookback != null) setSetting('volumeLookback', String(s.volumeLookback))
  if (s.defaultRvolAlert != null) setSetting('defaultRvolAlert', String(s.defaultRvolAlert))
  if (s.notifyEnabled != null) setSetting('notifyEnabled', s.notifyEnabled ? '1' : '0')
}
