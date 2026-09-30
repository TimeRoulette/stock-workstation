/**
 * 尽量保证「同一应用一个标签」：
 * - 命名窗口 stock-workstation（可控入口）
 * - BroadcastChannel + localStorage 心跳检测重复实例
 * 浏览器从任意外链打开无法 100% 强制合并（安全限制）。
 */

export const APP_WINDOW_NAME = 'stock-workstation'
const LOCK_KEY = 'sw-instance-lock'
const CHANNEL = 'sw-instance'
const HEARTBEAT_MS = 2000
const STALE_MS = 6000

export type DuplicateAction = 'primary' | 'duplicate'

export interface SingleInstanceResult {
  role: DuplicateAction
  /** 若为 duplicate，可尝试聚焦主实例 */
  tryFocusPrimary: () => boolean
}

function now() {
  return Date.now()
}

function readLock(): { id: string; ts: number } | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as { id?: string; ts?: number }
    if (!o?.id || !o.ts) return null
    return { id: o.id, ts: o.ts }
  } catch {
    return null
  }
}

function writeLock(id: string) {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ id, ts: now() }))
  } catch {
    /* */
  }
}

function clearLock(id: string) {
  try {
    const cur = readLock()
    if (cur?.id === id) localStorage.removeItem(LOCK_KEY)
  } catch {
    /* */
  }
}

/** 从可控入口打开本应用时用命名窗口复用 */
export function openAppWindow(url?: string): WindowProxy | null {
  const href = url || (typeof window !== 'undefined' ? window.location.href : './')
  try {
    const w = window.open(href, APP_WINDOW_NAME)
    if (w) {
      try {
        w.focus()
      } catch {
        /* */
      }
    }
    return w
  } catch {
    return null
  }
}

/**
 * 启动时调用：若已有活跃实例则本页为 duplicate。
 * primary 会维持心跳；duplicate 可 tryFocusPrimary。
 */
export function claimSingleInstance(): SingleInstanceResult {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `sw-${now()}-${Math.random().toString(36).slice(2, 8)}`

  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL)
  } catch {
    channel = null
  }

  const lock = readLock()
  const hasFresh = !!(lock && now() - lock.ts < STALE_MS && lock.id)

  const tryFocusPrimary = (): boolean => {
    // 1) 命名窗口
    try {
      const w = window.open('', APP_WINDOW_NAME)
      if (w && w !== window && !w.closed) {
        w.focus()
        channel?.postMessage({ type: 'focus-request', from: id })
        return true
      }
    } catch {
      /* */
    }
    // 2) 广播请主实例自 focus
    try {
      channel?.postMessage({ type: 'focus-request', from: id })
      return true
    } catch {
      return false
    }
  }

  if (hasFresh && lock!.id !== id) {
    // 可能是重复标签
    return { role: 'duplicate', tryFocusPrimary }
  }

  // 成为 primary
  writeLock(id)
  try {
    if (typeof window !== 'undefined' && window.name !== APP_WINDOW_NAME) {
      window.name = APP_WINDOW_NAME
    }
  } catch {
    /* */
  }

  const beat = () => writeLock(id)
  const timer = window.setInterval(beat, HEARTBEAT_MS)

  channel?.addEventListener('message', (ev) => {
    const data = ev.data as { type?: string } | null
    if (data?.type === 'focus-request') {
      try {
        window.focus()
      } catch {
        /* */
      }
    }
  })

  window.addEventListener('beforeunload', () => {
    window.clearInterval(timer)
    clearLock(id)
    try {
      channel?.close()
    } catch {
      /* */
    }
  })

  // 可见时刷新心跳
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') beat()
  })

  return { role: 'primary', tryFocusPrimary }
}

/** 注册 Service Worker（PWA） */
export async function registerServiceWorker(): Promise<'ok' | 'skipped' | 'error'> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'skipped'
  try {
    const base = import.meta.env.BASE_URL || './'
    const swUrl = new URL('sw.js', base).pathname.endsWith('sw.js')
      ? new URL('sw.js', window.location.href.replace(/\/?$/, '/')).href.replace(/\/[^/]*$/, '/sw.js')
      : `${base}sw.js`
    // Prefer relative to current page for project Pages
    const rel = new URL('sw.js', window.location.href).href
    await navigator.serviceWorker.register(rel)
    return 'ok'
  } catch {
    try {
      const base = import.meta.env.BASE_URL || './'
      await navigator.serviceWorker.register(`${base}sw.js`)
      return 'ok'
    } catch {
      return 'error'
    }
  }
}
