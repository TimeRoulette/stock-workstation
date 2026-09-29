import { useCallback, useEffect, useState } from 'react'
import { CoachMarks } from './components/CoachMarks'
import { Sidebar, type PageKey } from './components/Sidebar'
import { ShortcutsHint } from './components/ShortcutsHint'
import { ToastHost } from './components/ToastHost'
import { WatchlistPage } from './pages/WatchlistPage'
import { VolumePage } from './pages/VolumePage'
import { ScreenerPage } from './pages/ScreenerPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { BriefPage } from './pages/BriefPage'
import { JournalPage } from './pages/JournalPage'
import { SettingsPage } from './pages/SettingsPage'
import * as db from './services/db'
import { quoteService } from './services/quotes'
import type { AppSettings, ToastItem } from './types'

const PAGE_BY_KEY: Record<string, PageKey> = {
  '1': 'watchlist',
  '2': 'volume',
  '3': 'screener',
  '4': 'portfolio',
  '5': 'brief',
  '6': 'journal',
  '7': 'settings',
}

const PAGE_LABEL: Record<PageKey, string> = {
  watchlist: '盯盘',
  volume: '量监',
  screener: '选股',
  portfolio: '模拟',
  brief: '日报',
  journal: '复盘',
  settings: '设置',
}

const HISTORY_MAX = 20

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [page, setPage] = useState<PageKey>('watchlist')
  const [history, setHistory] = useState<PageKey[]>([])
  const [settings, setSettings] = useState<AppSettings>({
    quoteProvider: 'auto',
    refreshIntervalSec: 30,
    theme: 'dark',
    locale: 'zh-CN',
    coachDismissed: false,
    muteStartHour: 23,
    muteEndHour: 7,
    volumeLookback: 20,
    defaultRvolAlert: 2,
  })
  const [bootError, setBootError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [alertCount, setAlertCount] = useState(0)
  const [showCoach, setShowCoach] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [focusSymbol, setFocusSymbol] = useState<string | null>(null)
  const [portfolioSymbol, setPortfolioSymbol] = useState<string | null>(null)

  const refreshAlertCount = useCallback(() => {
    try {
      setAlertCount(db.countActiveAlerts())
    } catch {
      setAlertCount(0)
    }
  }, [])

  const pushToast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts((prev) => [...prev.slice(-4), { ...t, id }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id))
    }, 6000)
  }, [])

  /** 导航：push 当前页到历史栈；底部 Tab / 侧栏 / 快捷键共用，不破坏 Tab 高亮 */
  const navigate = useCallback((next: PageKey) => {
    setPage((prev) => {
      if (prev === next) return prev
      setHistory((h) => [...h.slice(-(HISTORY_MAX - 1)), prev])
      return next
    })
  }, [])

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      setPage(prev)
      return h.slice(0, -1)
    })
  }, [])

  const canGoBack = history.length > 0
  const backLabel = canGoBack ? PAGE_LABEL[history[history.length - 1]] : ''

  useEffect(() => {
    db.initDb()
      .then(() => {
        const s = db.getSettings()
        setSettings(s)
        quoteService.setMode(s.quoteProvider)
        setShowCoach(!s.coachDismissed)
        refreshAlertCount()
        setReady(true)
      })
      .catch((e) => {
        setBootError(e instanceof Error ? e.message : '数据库初始化失败')
      })
  }, [refreshAlertCount])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (showCoach || showShortcuts) {
        if (e.key === 'Escape') {
          if (showShortcuts) setShowShortcuts(false)
          else if (showCoach) dismissCoach()
        }
        return
      }
      if (isTypingTarget(e.target)) return

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setShowShortcuts((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        if (canGoBack) {
          goBack()
          return
        }
        setShowShortcuts(false)
        return
      }
      if (PAGE_BY_KEY[e.key]) {
        navigate(PAGE_BY_KEY[e.key])
        return
      }
      if (e.key === 'n' || e.key === 'N') {
        navigate('watchlist')
        setTimeout(() => window.dispatchEvent(new Event('sw:focus-add')), 50)
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        window.dispatchEvent(new Event('sw:refresh-quotes'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCoach, showShortcuts, canGoBack, goBack, navigate])

  const dismissCoach = () => {
    db.setSetting('coachDismissed', '1')
    setSettings((s) => ({ ...s, coachDismissed: true }))
    setShowCoach(false)
  }


  if (bootError) {
    return (
      <div className="loading boot-error">
        <div>
          <h3>启动失败</h3>
          <p>{bootError}</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            刷新重试
          </button>
        </div>
      </div>
    )
  }

  if (!ready) {
    return <div className="loading">正在初始化本地数据库…</div>
  }

  return (
    <div className="app-shell">
      <Sidebar
        current={page}
        onNavigate={navigate}
        alertCount={alertCount}
        onShowShortcuts={() => setShowShortcuts(true)}
      />
      <main className="main">
        {canGoBack && (
          <div className="main-backbar">
            <button type="button" className="btn back-btn touch-target" onClick={goBack} title={`返回${backLabel}`}>
              ← 返回{backLabel ? ` ${backLabel}` : ''}
            </button>
          </div>
        )}
        {page === 'watchlist' && (
          <WatchlistPage
            refreshSec={settings.refreshIntervalSec}
            onToast={pushToast}
            onAlertsChange={refreshAlertCount}
            focusSymbol={focusSymbol}
            volumeLookback={settings.volumeLookback}
            defaultRvolAlert={settings.defaultRvolAlert}
          />
        )}
        {page === 'volume' && (
          <VolumePage
            onToast={pushToast}
            onAlertsChange={refreshAlertCount}
            onFocusSymbol={(sym) => {
              setFocusSymbol(sym)
              navigate('watchlist')
            }}
          />
        )}
        {page === 'screener' && (
          <ScreenerPage
            onToast={pushToast}
            onFocusSymbol={(sym) => {
              setFocusSymbol(sym)
              navigate('watchlist')
            }}
          />
        )}
        {page === 'portfolio' && (
          <PortfolioPage
            refreshSec={settings.refreshIntervalSec}
            onToast={pushToast}
            prefillSymbol={portfolioSymbol}
          />
        )}
        {page === 'brief' && (
          <BriefPage
            onOpenSymbol={(sym, target) => {
              if (target === 'portfolio') {
                setPortfolioSymbol(sym)
                navigate('portfolio')
              } else {
                setFocusSymbol(sym)
                navigate('watchlist')
              }
            }}
          />
        )}
        {page === 'journal' && (
          <JournalPage />
        )}
        {page === 'settings' && (
          <SettingsPage
            settings={settings}
            onChange={setSettings}
            onShowCoach={() => setShowCoach(true)}
            onShowShortcuts={() => setShowShortcuts(true)}
          />
        )}
      </main>
      <ToastHost toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      {showCoach && <CoachMarks onDismiss={dismissCoach} />}
      <ShortcutsHint open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  )
}
