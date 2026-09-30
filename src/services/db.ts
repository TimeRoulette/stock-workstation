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
  JournalNoteInput,
  ResetAccountOptions,
  RebuildCashResult,
  ImportTradesOptions,
  PendingOrder,
  PendingOrderStatus,
  LiveTrade,
  LiveTradeInput,
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
  migratePendingOrders()
  migratePendingFilledQty()
  migratePositionNoteAlerts()
  migrateJournalTemplate()
  migrateLiveTrades()
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

/** v0.10: 限价挂单队列 */
function migratePendingOrders() {
  if (!db) return
  try {
    db.run(`CREATE TABLE IF NOT EXISTS pending_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      limit_price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      filled_trade_id INTEGER,
      note TEXT NOT NULL DEFAULT ''
    )`)
    scheduleSave()
  } catch (e) {
    console.warn('migratePendingOrders', e)
  }
}


/** v0.12: 挂单部分成交数量 */
function migratePendingFilledQty() {
  if (!db) return
  try {
    const info = db.exec('PRAGMA table_info(pending_orders)')
    const cols = new Set((info[0]?.values || []).map((r: SqlValue[]) => String(r[1])))
    if (!cols.has('filled_qty')) {
      db.run('ALTER TABLE pending_orders ADD COLUMN filled_qty REAL NOT NULL DEFAULT 0')
      scheduleSave()
    }
  } catch (e) {
    console.warn('migratePendingFilledQty', e)
  }
}


/** v0.10: 止损触及提醒 / 演示自动平仓 */
function migratePositionNoteAlerts() {
  if (!db) return
  try {
    const info = db.exec('PRAGMA table_info(position_notes)')
    const cols = (info[0]?.values || []).map((r) => String(r[1]))
    if (!cols.includes('alert_on_touch')) {
      db.run('ALTER TABLE position_notes ADD COLUMN alert_on_touch INTEGER NOT NULL DEFAULT 0')
    }
    if (!cols.includes('auto_close_on_touch')) {
      db.run('ALTER TABLE position_notes ADD COLUMN auto_close_on_touch INTEGER NOT NULL DEFAULT 0')
    }
    scheduleSave()
  } catch (e) {
    console.warn('migratePositionNoteAlerts', e)
  }
}

/** v0.10: 复盘模板字段 */
function migrateJournalTemplate() {
  if (!db) return
  try {
    const info = db.exec('PRAGMA table_info(journal_notes)')
    const cols = (info[0]?.values || []).map((r) => String(r[1]))
    const adds: Array<[string, string]> = [
      ['plan', "ALTER TABLE journal_notes ADD COLUMN plan TEXT NOT NULL DEFAULT ''"],
      ['emotion', 'ALTER TABLE journal_notes ADD COLUMN emotion INTEGER NOT NULL DEFAULT 0'],
      ['deviation', "ALTER TABLE journal_notes ADD COLUMN deviation TEXT NOT NULL DEFAULT ''"],
      ['lesson', "ALTER TABLE journal_notes ADD COLUMN lesson TEXT NOT NULL DEFAULT ''"],
      ['tags', "ALTER TABLE journal_notes ADD COLUMN tags TEXT NOT NULL DEFAULT ''"],
    ]
    for (const [col, sql] of adds) {
      if (!cols.includes(col)) db.run(sql)
    }
    scheduleSave()
  } catch (e) {
    console.warn('migrateJournalTemplate', e)
  }
}


/** v0.11: 实盘成交（与模拟 trades 隔离） */
function migrateLiveTrades() {
  if (!db) return
  try {
    db.run(`CREATE TABLE IF NOT EXISTS live_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`)
    scheduleSave()
  } catch (e) {
    console.warn('migrateLiveTrades', e)
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
  if (getSetting('electronOpenAtLogin') == null) setSetting('electronOpenAtLogin', '0')
  if (getSetting('electronMinimizeToTray') == null) setSetting('electronMinimizeToTray', '0')
  if (getSetting('llmSummaryEnabled') == null) setSetting('llmSummaryEnabled', '0')
  if (getSetting('quoteProxyUrl') == null) setSetting('quoteProxyUrl', '')
  if (getSetting('paperFeeRate') == null) setSetting('paperFeeRate', '0.0003')
  if (getSetting('paperStampTaxRate') == null) setSetting('paperStampTaxRate', '0.0005')
  if (getSetting('riskMaxPositionPct') == null) setSetting('riskMaxPositionPct', '0.35')
  if (getSetting('riskDailyLossPct') == null) setSetting('riskDailyLossPct', '0.03')

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
  return {
    quoteProvider: (getSetting('quoteProvider') as QuoteProviderMode) || 'auto',
    refreshIntervalSec: Number(getSetting('refreshIntervalSec') || 30),
    theme: (getSetting('theme') as 'light' | 'dark') || 'dark',
    locale: 'zh-CN',
    coachDismissed: getSetting('coachDismissed') === '1',
    muteStartHour: Number(getSetting('muteStartHour') ?? 23),
    muteEndHour: Number(getSetting('muteEndHour') ?? 7),
    volumeLookback: Number(getSetting('volumeLookback') || 20),
    defaultRvolAlert: Number(getSetting('defaultRvolAlert') || 2),
    notifyEnabled: getSetting('notifyEnabled') === '1',
    electronOpenAtLogin: getSetting('electronOpenAtLogin') === '1',
    electronMinimizeToTray: getSetting('electronMinimizeToTray') === '1',
    llmSummaryEnabled: getSetting('llmSummaryEnabled') === '1',
    quoteProxyUrl: getSetting('quoteProxyUrl') || '',
    paperFeeRate: Number(getSetting('paperFeeRate') ?? 0.0003),
    paperStampTaxRate: Number(getSetting('paperStampTaxRate') ?? 0.0005),
    riskMaxPositionPct: Number(getSetting('riskMaxPositionPct') ?? 0.35),
    riskDailyLossPct: Number(getSetting('riskDailyLossPct') ?? 0.03),
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
  const feeRate = Math.max(0, Number(getSetting('paperFeeRate') ?? 0.0003) || 0)
  const stampRate = Math.max(0, Number(getSetting('paperStampTaxRate') ?? 0.0005) || 0)
  const notional = input.qty * input.price
  const commission = feeRate > 0 ? Math.max(0.01, notional * feeRate) : 0
  const stamp = input.side === 'sell' && stampRate > 0 ? notional * stampRate : 0
  const fee = +(commission + stamp).toFixed(4)
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

function mapPositionNote(r: SqlValue[]): PositionNote {
  return {
    symbol: String(r[0]),
    stopLoss: r[1] == null ? null : Number(r[1]),
    takeProfit: r[2] == null ? null : Number(r[2]),
    note: String(r[3] || ''),
    updatedAt: String(r[4]),
    alertOnTouch: Number(r[5] ?? 0) === 1,
    autoCloseOnTouch: Number(r[6] ?? 0) === 1,
  }
}

export function getPositionNote(symbol: string): PositionNote | null {
  return queryOne(
    `SELECT symbol, stop_loss, take_profit, note, updated_at,
            COALESCE(alert_on_touch, 0), COALESCE(auto_close_on_touch, 0)
     FROM position_notes WHERE symbol = ?`,
    [symbol.toUpperCase()],
    mapPositionNote,
  )
}

export function listPositionNotes(): PositionNote[] {
  return queryAll(
    `SELECT symbol, stop_loss, take_profit, note, updated_at,
            COALESCE(alert_on_touch, 0), COALESCE(auto_close_on_touch, 0)
     FROM position_notes`,
    [],
    mapPositionNote,
  )
}

export function upsertPositionNote(
  symbol: string,
  input: {
    stopLoss?: number | null
    takeProfit?: number | null
    note?: string
    alertOnTouch?: boolean
    autoCloseOnTouch?: boolean
  },
) {
  const sym = symbol.toUpperCase()
  const prev = getPositionNote(sym)
  const stopLoss = input.stopLoss !== undefined ? input.stopLoss : prev?.stopLoss ?? null
  const takeProfit = input.takeProfit !== undefined ? input.takeProfit : prev?.takeProfit ?? null
  const note = input.note !== undefined ? input.note : prev?.note ?? ''
  const alertOnTouch =
    input.alertOnTouch !== undefined ? input.alertOnTouch : prev?.alertOnTouch ?? false
  const autoCloseOnTouch =
    input.autoCloseOnTouch !== undefined ? input.autoCloseOnTouch : prev?.autoCloseOnTouch ?? false
  run(
    `INSERT OR REPLACE INTO position_notes
      (symbol, stop_loss, take_profit, note, updated_at, alert_on_touch, auto_close_on_touch)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      sym,
      stopLoss,
      takeProfit,
      note,
      new Date().toISOString(),
      alertOnTouch ? 1 : 0,
      autoCloseOnTouch ? 1 : 0,
    ],
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

const JOURNAL_SELECT =
  `SELECT id, trade_id, symbol, title, body, created_at, updated_at,
          COALESCE(plan, ''), COALESCE(emotion, 0), COALESCE(deviation, ''),
          COALESCE(lesson, ''), COALESCE(tags, '')
   FROM journal_notes`

function mapJournal(r: SqlValue[]): JournalNote {
  return {
    id: Number(r[0]),
    tradeId: r[1] == null ? null : Number(r[1]),
    symbol: String(r[2]),
    title: String(r[3]),
    body: String(r[4] || ''),
    createdAt: String(r[5]),
    updatedAt: String(r[6]),
    plan: String(r[7] || ''),
    emotion: Number(r[8] || 0),
    deviation: String(r[9] || ''),
    lesson: String(r[10] || ''),
    tags: String(r[11] || ''),
  }
}

export function listJournalNotes(limit = 100): JournalNote[] {
  return queryAll(
    JOURNAL_SELECT + ' ORDER BY updated_at DESC, id DESC LIMIT ?',
    [limit],
    mapJournal,
  )
}

export function addJournalNote(input: JournalNoteInput): JournalNote {
  const now = new Date().toISOString()
  const emotion = Math.max(0, Math.min(5, Math.floor(Number(input.emotion) || 0)))
  run(
    `INSERT INTO journal_notes
      (trade_id, symbol, title, body, created_at, updated_at, plan, emotion, deviation, lesson, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tradeId ?? null,
      input.symbol.toUpperCase(),
      input.title.trim() || '无标题',
      input.body || '',
      now,
      now,
      input.plan || '',
      emotion,
      input.deviation || '',
      input.lesson || '',
      input.tags || '',
    ],
  )
  const n = queryOne(JOURNAL_SELECT + ' ORDER BY id DESC LIMIT 1', [], mapJournal)
  if (!n) throw new Error('保存笔记失败')
  return n
}

export function updateJournalNote(
  id: number,
  input: Partial<JournalNoteInput> & { title?: string; body?: string; symbol?: string },
) {
  const prev = queryOne(JOURNAL_SELECT + ' WHERE id = ?', [id], mapJournal)
  if (!prev) throw new Error('笔记不存在')
  const emotionRaw = input.emotion !== undefined ? Number(input.emotion) : prev.emotion
  const emotion = Math.max(0, Math.min(5, Math.floor(emotionRaw || 0)))
  run(
    `UPDATE journal_notes SET symbol = ?, title = ?, body = ?, updated_at = ?,
      plan = ?, emotion = ?, deviation = ?, lesson = ?, tags = ?, trade_id = ?
     WHERE id = ?`,
    [
      (input.symbol ?? prev.symbol).toUpperCase(),
      input.title ?? prev.title,
      input.body ?? prev.body,
      new Date().toISOString(),
      input.plan !== undefined ? input.plan : prev.plan,
      emotion,
      input.deviation !== undefined ? input.deviation : prev.deviation,
      input.lesson !== undefined ? input.lesson : prev.lesson,
      input.tags !== undefined ? input.tags : prev.tags,
      input.tradeId !== undefined ? input.tradeId : prev.tradeId,
      id,
    ],
  )
}

export function deleteJournalNote(id: number) {
  run('DELETE FROM journal_notes WHERE id = ?', [id])
}

/** 从成交生成复盘草稿（不写入 DB，仅返回表单预填） */
export function draftJournalFromTrade(t: Trade): JournalNoteInput & { tradeId: number } {
  const sideLabel = t.side === 'buy' ? '买入' : '卖出'
  const sideShort = t.side === 'buy' ? '买' : '卖'
  return {
    symbol: t.symbol,
    title: `${sideLabel} ${t.symbol} 复盘`,
    body: `成交：${sideShort} ${t.qty} @ ${t.price}（费用 ${t.fee}）\n时间：${new Date(t.ts).toLocaleString('zh-CN')}`,
    tradeId: t.id,
    plan: '',
    emotion: 3,
    deviation: '',
    lesson: '',
    tags: '',
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
  if (o.clearTrades) {
    run('DELETE FROM trades')
    run("DELETE FROM pending_orders")
  }
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
  pendingOrders?: PendingOrder[]
  liveTrades?: LiveTrade[]
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
    'DELETE FROM pending_orders',
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
      `INSERT INTO position_notes
        (symbol, stop_loss, take_profit, note, updated_at, alert_on_touch, auto_close_on_touch)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(n.symbol).toUpperCase(),
        n.stopLoss,
        n.takeProfit,
        n.note || '',
        n.updatedAt || new Date().toISOString(),
        n.alertOnTouch ? 1 : 0,
        n.autoCloseOnTouch ? 1 : 0,
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
      `INSERT INTO journal_notes
        (id, trade_id, symbol, title, body, created_at, updated_at, plan, emotion, deviation, lesson, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        j.id,
        j.tradeId,
        j.symbol || '',
        j.title || '',
        j.body || '',
        j.createdAt || new Date().toISOString(),
        j.updatedAt || new Date().toISOString(),
        j.plan || '',
        j.emotion || 0,
        j.deviation || '',
        j.lesson || '',
        j.tags || '',
      ],
    )
  }

  for (const o of payload.pendingOrders || []) {
    run(
      `INSERT INTO pending_orders
        (id, symbol, name, side, qty, limit_price, status, created_at, updated_at, filled_trade_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        o.id,
        String(o.symbol).toUpperCase(),
        o.name || o.symbol,
        o.side,
        o.qty,
        o.limitPrice,
        o.status || 'pending',
        o.createdAt || new Date().toISOString(),
        o.updatedAt || new Date().toISOString(),
        o.filledTradeId,
        o.note || '',
      ],
    )
  }


  for (const t of payload.liveTrades || []) {
    run(
      `INSERT INTO live_trades (id, ts, symbol, name, side, qty, price, fee, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        t.id,
        t.ts,
        String(t.symbol).toUpperCase(),
        t.name || t.symbol,
        t.side,
        t.qty,
        t.price,
        t.fee ?? 0,
        t.note || '',
        t.createdAt || t.ts,
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
  if (s.electronOpenAtLogin != null) setSetting('electronOpenAtLogin', s.electronOpenAtLogin ? '1' : '0')
  if (s.electronMinimizeToTray != null) setSetting('electronMinimizeToTray', s.electronMinimizeToTray ? '1' : '0')
  if (s.llmSummaryEnabled != null) setSetting('llmSummaryEnabled', s.llmSummaryEnabled ? '1' : '0')
  if (s.quoteProxyUrl != null) setSetting('quoteProxyUrl', String(s.quoteProxyUrl))
  if (s.paperFeeRate != null) setSetting('paperFeeRate', String(s.paperFeeRate))
  if (s.paperStampTaxRate != null) setSetting('paperStampTaxRate', String(s.paperStampTaxRate))
  if (s.riskMaxPositionPct != null) setSetting('riskMaxPositionPct', String(s.riskMaxPositionPct))
  if (s.riskDailyLossPct != null) setSetting('riskDailyLossPct', String(s.riskDailyLossPct))
}


/* ---------- Pending limit orders (v0.10) ---------- */

function mapPending(r: SqlValue[]): PendingOrder {
  return {
    id: Number(r[0]),
    symbol: String(r[1]),
    name: String(r[2]),
    side: String(r[3]) as TradeSide,
    qty: Number(r[4]),
    limitPrice: Number(r[5]),
    status: String(r[6]) as PendingOrderStatus,
    createdAt: String(r[7]),
    updatedAt: String(r[8]),
    filledTradeId: r[9] == null ? null : Number(r[9]),
    note: String(r[10] || ''),
    filledQty: Number(r[11] || 0),
  }
}

const PENDING_SELECT =
  `SELECT id, symbol, name, side, qty, limit_price, status, created_at, updated_at, filled_trade_id, note, COALESCE(filled_qty, 0)
   FROM pending_orders`

export function listPendingOrders(status: PendingOrderStatus | 'all' = 'pending'): PendingOrder[] {
  if (status === 'all') {
    return queryAll(PENDING_SELECT + ' ORDER BY id DESC', [], mapPending)
  }
  return queryAll(PENDING_SELECT + ' WHERE status = ? ORDER BY id DESC', [status], mapPending)
}

export function placePendingOrder(input: {
  symbol: string
  name: string
  side: TradeSide
  qty: number
  limitPrice: number
  note?: string
}): PendingOrder {
  if (!Number.isFinite(input.qty) || input.qty <= 0) throw new Error('数量必须大于 0')
  if (!Number.isFinite(input.limitPrice) || input.limitPrice <= 0) throw new Error('限价必须大于 0')
  const now = new Date().toISOString()
  const symbol = input.symbol.toUpperCase()
  run(
    `INSERT INTO pending_orders
      (symbol, name, side, qty, limit_price, status, created_at, updated_at, filled_trade_id, note)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, ?)`,
    [symbol, input.name, input.side, input.qty, input.limitPrice, now, now, input.note || ''],
  )
  const o = queryOne(PENDING_SELECT + ' ORDER BY id DESC LIMIT 1', [], mapPending)
  if (!o) throw new Error('挂单失败')
  return o
}

export function cancelPendingOrder(id: number) {
  const o = queryOne(PENDING_SELECT + ' WHERE id = ?', [id], mapPending)
  if (!o) throw new Error('挂单不存在')
  if (o.status !== 'pending' && o.status !== 'partial') throw new Error('仅待成交/部分成交挂单可取消')
  run(`UPDATE pending_orders SET status = 'cancelled', updated_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    id,
  ])
}


export function amendPendingOrder(
  id: number,
  patch: { qty?: number; limitPrice?: number },
): PendingOrder {
  const o = queryOne(PENDING_SELECT + ' WHERE id = ?', [id], mapPending)
  if (!o) throw new Error('挂单不存在')
  if (o.status !== 'pending' && o.status !== 'partial') throw new Error('仅待成交/部分成交挂单可改单')
  const qty = patch.qty != null ? patch.qty : o.qty
  const limitPrice = patch.limitPrice != null ? patch.limitPrice : o.limitPrice
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('数量必须大于 0')
  if (qty < o.filledQty) throw new Error('数量不能小于已成交数量')
  if (!Number.isFinite(limitPrice) || limitPrice <= 0) throw new Error('限价必须大于 0')
  const remain = qty - o.filledQty
  if (remain <= 0) throw new Error('剩余可成交数量须大于 0')
  run(
    `UPDATE pending_orders SET qty = ?, limit_price = ?, updated_at = ?, status = CASE WHEN filled_qty > 0 THEN 'partial' ELSE 'pending' END WHERE id = ?`,
    [qty, limitPrice, new Date().toISOString(), id],
  )
  const updated = queryOne(PENDING_SELECT + ' WHERE id = ?', [id], mapPending)
  if (!updated) throw new Error('改单失败')
  return updated
}

/**
 * 行情刷新时撮合待成交限价单。
 * 演示规则（非券商撮合）：买限价 last<=limit；卖限价 last>=limit；成交价用限价。
 * 支持部分成交：现金/持仓不足时尽量成交可成交数量，剩余继续挂着。
 */
export function matchPendingOrders(
  priceMap: Record<string, number>,
): Array<{ order: PendingOrder; trade: Trade; partial: boolean }> {
  const pending = [
    ...listPendingOrders('pending'),
    ...listPendingOrders('partial'),
  ]
  const filled: Array<{ order: PendingOrder; trade: Trade; partial: boolean }> = []
  for (const o of pending) {
    const last = priceMap[o.symbol]
    if (!Number.isFinite(last)) continue
    const hit =
      (o.side === 'buy' && last! <= o.limitPrice) || (o.side === 'sell' && last! >= o.limitPrice)
    if (!hit) continue
    const remain = Math.max(0, o.qty - (o.filledQty || 0))
    if (remain <= 0) continue
    const tryQty = [remain]
    try {
      const account = getAccount()
      const feeRate = Math.max(0, Number(getSetting('paperFeeRate') ?? 0.0003) || 0)
      const unit = o.limitPrice * (1 + feeRate) || o.limitPrice
      if (o.side === 'buy' && unit > 0) {
        let maxBuy = Math.floor(account.cash / unit)
        if (maxBuy >= 100) maxBuy = Math.floor(maxBuy / 100) * 100
        if (maxBuy > 0 && maxBuy < remain) tryQty.push(maxBuy)
      }
      if (o.side === 'sell') {
        const pos = listPositions().find((p) => p.symbol === o.symbol)
        const maxSell = pos ? Math.floor(pos.qty) : 0
        if (maxSell > 0 && maxSell < remain) tryQty.push(maxSell)
      }
    } catch {
      /* */
    }
    const candidates = [...new Set(tryQty.filter((q) => q > 0))].sort((a, b) => b - a)
    let done = false
    for (const qty of candidates) {
      try {
        const trade = placeTrade({
          symbol: o.symbol,
          name: o.name,
          side: o.side,
          qty,
          price: o.limitPrice,
        })
        const newFilled = (o.filledQty || 0) + qty
        const fully = newFilled + 1e-9 >= o.qty
        run(
          `UPDATE pending_orders SET status = ?, updated_at = ?, filled_trade_id = ?, filled_qty = ? WHERE id = ?`,
          [fully ? 'filled' : 'partial', new Date().toISOString(), trade.id, newFilled, o.id],
        )
        filled.push({
          order: {
            ...o,
            status: fully ? 'filled' : 'partial',
            filledTradeId: trade.id,
            filledQty: newFilled,
          },
          trade,
          partial: !fully,
        })
        done = true
        break
      } catch (e) {
        console.warn('matchPendingOrder try', o.id, qty, e)
      }
    }
    if (!done) console.warn('matchPendingOrder skip', o.id)
  }
  return filled
}

export interface StopTouchEvent {
  symbol: string
  name: string
  kind: 'stop' | 'take'
  price: number
  threshold: number
  autoClosed: boolean
  trade?: Trade
}

/**
 * 止损/止盈触及：提醒可选；自动平仓为演示规则（按最新价市价卖出全部持仓）。
 */
export function evaluateStopTouches(
  quotes: Record<string, { price: number; name?: string }>,
): StopTouchEvent[] {
  const events: StopTouchEvent[] = []
  const positions = listPositions()
  for (const p of positions) {
    const q = quotes[p.symbol]
    if (!q || !Number.isFinite(q.price)) continue
    const note = getPositionNote(p.symbol)
    if (!note) continue
    if (!note.alertOnTouch && !note.autoCloseOnTouch) continue
    const last = q.price
    let kind: 'stop' | 'take' | null = null
    let threshold = 0
    if (note.stopLoss != null && Number.isFinite(note.stopLoss) && last <= note.stopLoss) {
      kind = 'stop'
      threshold = note.stopLoss
    } else if (
      note.takeProfit != null &&
      Number.isFinite(note.takeProfit) &&
      last >= note.takeProfit
    ) {
      kind = 'take'
      threshold = note.takeProfit
    }
    if (!kind) continue

    let trade: Trade | undefined
    let autoClosed = false
    if (note.autoCloseOnTouch && p.qty > 0) {
      try {
        trade = placeTrade({
          symbol: p.symbol,
          name: q.name || p.name,
          side: 'sell',
          qty: p.qty,
          price: last,
        })
        autoClosed = true
        // 平仓后关闭自动，避免重复
        upsertPositionNote(p.symbol, { autoCloseOnTouch: false, alertOnTouch: note.alertOnTouch })
      } catch (e) {
        console.warn('autoClose failed', p.symbol, e)
      }
    } else if (note.alertOnTouch) {
      // 仅提醒一次：临时关掉 alert，避免刷屏（用户可再开）
      upsertPositionNote(p.symbol, { alertOnTouch: false, autoCloseOnTouch: note.autoCloseOnTouch })
    }

    if (note.alertOnTouch || autoClosed) {
      events.push({
        symbol: p.symbol,
        name: q.name || p.name,
        kind,
        price: last,
        threshold,
        autoClosed,
        trade,
      })
    }
  }
  return events
}

export function exportJournalMarkdown(notes: JournalNote[] = listJournalNotes(5000)): string {
  const lines: string[] = ['# 复盘笔记导出', '', `导出时间：${new Date().toLocaleString('zh-CN')}`, '']
  for (const n of notes) {
    lines.push(`## ${n.title}`)
    lines.push('')
    lines.push(`- 代码：${n.symbol}`)
    if (n.tradeId != null) lines.push(`- 关联成交：#${n.tradeId}`)
    if (n.emotion) lines.push(`- 情绪：${n.emotion}/5`)
    if (n.tags) lines.push(`- 标签：${n.tags}`)
    lines.push(`- 更新：${new Date(n.updatedAt).toLocaleString('zh-CN')}`)
    lines.push('')
    if (n.plan) {
      lines.push('### 计划')
      lines.push(n.plan)
      lines.push('')
    }
    if (n.deviation) {
      lines.push('### 执行偏差')
      lines.push(n.deviation)
      lines.push('')
    }
    if (n.lesson) {
      lines.push('### 教训')
      lines.push(n.lesson)
      lines.push('')
    }
    if (n.body) {
      lines.push('### 正文')
      lines.push(n.body)
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }
  return lines.join('\n')
}

export function exportJournalCsv(notes: JournalNote[] = listJournalNotes(5000)): string {
  const rows = [
    'id,symbol,title,tradeId,emotion,tags,plan,deviation,lesson,body,createdAt,updatedAt',
  ]
  for (const n of notes) {
    rows.push(
      [
        n.id,
        n.symbol,
        csvEscape(n.title),
        n.tradeId ?? '',
        n.emotion,
        csvEscape(n.tags),
        csvEscape(n.plan),
        csvEscape(n.deviation),
        csvEscape(n.lesson),
        csvEscape(n.body),
        n.createdAt,
        n.updatedAt,
      ].join(','),
    )
  }
  return rows.join('\n')
}


/* ---------- Live trades (v0.11 实盘，与模拟隔离) ---------- */

function mapLiveTrade(r: SqlValue[]): LiveTrade {
  return {
    id: Number(r[0]),
    ts: String(r[1]),
    symbol: String(r[2]),
    name: String(r[3]),
    side: String(r[4]) as TradeSide,
    qty: Number(r[5]),
    price: Number(r[6]),
    fee: Number(r[7] || 0),
    note: String(r[8] || ''),
    createdAt: String(r[9]),
  }
}

const LIVE_SELECT =
  `SELECT id, ts, symbol, name, side, qty, price, fee, note, created_at FROM live_trades`

export function listLiveTrades(limit = 5000): LiveTrade[] {
  return queryAll(LIVE_SELECT + ' ORDER BY ts DESC, id DESC LIMIT ?', [limit], mapLiveTrade)
}

export function addLiveTrade(input: LiveTradeInput): LiveTrade {
  if (!Number.isFinite(input.qty) || input.qty <= 0) throw new Error('数量必须大于 0')
  if (!Number.isFinite(input.price) || input.price <= 0) throw new Error('价格必须大于 0')
  const now = new Date().toISOString()
  const symbol = input.symbol.toUpperCase()
  run(
    `INSERT INTO live_trades (ts, symbol, name, side, qty, price, fee, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ts || now,
      symbol,
      input.name || symbol,
      input.side,
      input.qty,
      input.price,
      input.fee ?? 0,
      input.note || '',
      now,
    ],
  )
  const row = queryOne(LIVE_SELECT + ' ORDER BY id DESC LIMIT 1', [], mapLiveTrade)
  if (!row) throw new Error('写入实盘成交失败')
  return row
}

export function deleteLiveTrade(id: number) {
  run('DELETE FROM live_trades WHERE id = ?', [id])
}

export function clearLiveTrades() {
  run('DELETE FROM live_trades')
}

export function exportLiveTradesCsv(trades: LiveTrade[] = listLiveTrades(10000)): string {
  const rows = ['date,symbol,name,side,qty,price,fee,note']
  for (const t of trades) {
    rows.push(
      [
        t.ts,
        t.symbol,
        csvEscape(t.name),
        t.side,
        t.qty,
        t.price,
        t.fee,
        csvEscape(t.note),
      ].join(','),
    )
  }
  return rows.join('\n')
}

export function addLiveTradesBulk(inputs: LiveTradeInput[]): number {
  let n = 0
  for (const input of inputs) {
    addLiveTrade(input)
    n++
  }
  return n
}

/* ---------- Live corporate-action notes (v0.12 手动备注) ---------- */

export function getLiveCorpNote(symbol: string): string {
  return getSetting(`liveCorp:${symbol.toUpperCase()}`) || ''
}

export function setLiveCorpNote(symbol: string, note: string) {
  setSetting(`liveCorp:${symbol.toUpperCase()}`, note.slice(0, 500))
}

export function listLiveCorpNotes(): Array<{ symbol: string; note: string }> {
  try {
    return queryAll(
      `SELECT key, value FROM settings WHERE key LIKE 'liveCorp:%'`,
      [],
      (r) => ({ symbol: String(r[0]).replace(/^liveCorp:/, ''), note: String(r[1] || '') }),
    ).filter((r) => r.note)
  } catch {
    return []
  }
}
