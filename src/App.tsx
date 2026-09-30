import { useCallback, useEffect, useRef, useState } from 'react'
import { CoachMarks } from './components/CoachMarks'
import { Sidebar, type PageKey } from './components/Sidebar'
import { ShortcutsHint } from './components/ShortcutsHint'
import { ToastHost } from './components/ToastHost'
import { WatchlistPage } from './pages/WatchlistPage'
import { VolumePage } from './pages/VolumePage'
import { ScreenerPage } from './pages/ScreenerPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { LivePage } from './pages/LivePage'
import { BriefPage } from './pages/BriefPage'
import { JournalPage } from './pages/JournalPage'
import { SettingsPage } from './pages/SettingsPage'
import * as db from './services/db'
import { quoteService } from './services/quotes'
import type { AppSettings, Quote, ToastItem } from './types'
import { useTheme } from './hooks/useTheme'
import { summarizeDataStatus, type DataStatusSummary } from './utils/dataStatus'
import { Icons } from './components/Icon'

const PAGE_BY_KEY: Record<string, PageKey> = {
  '1': 'watchlist',
  '2': 'volume',
  '3': 'screener',
  '4': 'portfolio',
  '5': 'live',
  '6': 'brief',
  '7': 'journal',
  '8': 'settings',
}

const PAGE_LABEL: Record<PageKey, string> = {
  watchlist: '盯盘',
  volume: '量监',
  screener: '选股',
  portfolio: '模拟',
  live: '实盘',
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

interface AppProps {
  instanceRole?: 'primary' | 'duplicate'
  tryFocusPrimary?: () => boolean
}

export default function App({ instanceRole = 'primary', tryFocusPrimary }: AppProps) {
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
    notifyEnabled: false,
    electronOpenAtLogin: false,
    electronMinimizeToTray: false,
    llmSummaryEnabled: false,
  })
  const [bootError, setBootError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [alertCount, setAlertCount] = useState(0)
  const [showCoach, setShowCoach] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const { theme, setTheme } = useTheme()
  const [focusSymbol, setFocusSymbol] = useState<string | null>(null)
  const [portfolioSymbol, setPortfolioSymbol] = useState<string | null>(null)
  const lastQuotesRef = useRef<Record<string, Quote>>({})
  const [dataStatus, setDataStatus] = useState<DataStatusSummary>(() =>
    summarizeDataStatus([], { providerMode: 'auto' }),
  )
  const [dupDismissed, setDupDismissed] = useState(false)

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
        setDataStatus(summarizeDataStatus([], { providerMode: s.quoteProvider }))
        setReady(true)
        // Electron：同步托盘/开机偏好到主进程
        try {
          if (window.stockWorkstation?.isElectron) {
            void window.stockWorkstation.setMinimizeToTray?.(!!s.electronMinimizeToTray)
            if (s.electronOpenAtLogin) {
              void window.stockWorkstation.setOpenAtLogin?.(true)
            }
          }
        } catch {
          /* */
        }
      })
      .catch((e) => {
        setBootError(e instanceof Error ? e.message : '数据库初始化失败')
      })
  }, [refreshAlertCount])

  useEffect(() => {
    const onQuotes = (ev: Event) => {
      const detail = (ev as CustomEvent<Record<string, Quote>>).detail || {}
      lastQuotesRef.current = detail
      setDataStatus(summarizeDataStatus(detail, { providerMode: settings.quoteProvider }))
    }
    window.addEventListener('sw:quotes-updated', onQuotes)
    return () => window.removeEventListener('sw:quotes-updated', onQuotes)
  }, [settings.quoteProvider])

  useEffect(() => {
    setDataStatus(summarizeDataStatus(lastQuotesRef.current, { providerMode: settings.quoteProvider }))
  }, [settings.quoteProvider])

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
      {instanceRole === 'duplicate' && !dupDismissed && (
        <div className="dup-banner" role="status">
          <span>检测到本应用可能已在其他标签打开。</span>
          <button
            type="button"
            className="btn btn-xs primary"
            onClick={() => {
              tryFocusPrimary?.()
            }}
          >
            尝试聚焦已有窗口
          </button>
          <button type="button" className="btn btn-xs" onClick={() => setDupDismissed(true)}>
            继续使用此页
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            安装 PWA / 用收藏夹可减少多标签；外链无法 100% 强制合并。
          </span>
        </div>
      )}
      <Sidebar
        current={page}
        onNavigate={navigate}
        alertCount={alertCount}
        onShowShortcuts={() => setShowShortcuts(true)}
        theme={theme}
        onThemeChange={(th) => {
          setTheme(th)
          setSettings((s) => ({ ...s, theme: th }))
        }}
        dataStatus={dataStatus}
      />
      <main className="main">
        {canGoBack && (
          <div className="main-backbar">
            <button type="button" className="btn back-btn touch-target" onClick={goBack} title={`返回${backLabel}`}>
              <Icons.chevronLeft /> 返回{backLabel ? ` ${backLabel}` : ''}
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
        {page === 'live' && (
          <LivePage
            refreshSec={settings.refreshIntervalSec}
            onToast={pushToast}
            onOpenJournal={(sym) => {
              setFocusSymbol(sym)
              navigate('journal')
            }}
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
        {page === 'journal' && <JournalPage />}
        {page === 'settings' && (
          <SettingsPage
            settings={{ ...settings, theme }}
            onChange={(s) => {
              setSettings(s)
              if (s.theme !== theme) setTheme(s.theme)
            }}
            onShowCoach={() => setShowCoach(true)}
            onShowShortcuts={() => setShowShortcuts(true)}
            theme={theme}
            onThemeChange={(th) => {
              setTheme(th)
              setSettings((s) => ({ ...s, theme: th }))
            }}
          />
        )}
      </main>
      <ToastHost toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      {showCoach && <CoachMarks onDismiss={dismissCoach} />}
      <ShortcutsHint open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  )
}
