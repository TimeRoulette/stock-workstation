import { useEffect, useState } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { DataStatusBadge } from './DataStatusBadge'
import { Icons } from './Icon'
import type { ThemeMode } from '../utils/theme'
import type { DataStatusSummary } from '../utils/dataStatus'

export type PageKey =
  | 'watchlist'
  | 'volume'
  | 'screener'
  | 'portfolio'
  | 'brief'
  | 'journal'
  | 'settings'

const NAV: Array<{
  key: PageKey
  label: string
  Icon: (typeof Icons)['watchlist']
  hint: string
}> = [
  { key: 'watchlist', label: '盯盘', Icon: Icons.watchlist, hint: '自选 · K线 · 提醒' },
  { key: 'volume', label: '量监', Icon: Icons.volume, hint: 'RVOL · 放量' },
  { key: 'screener', label: '选股', Icon: Icons.screener, hint: '涨跌幅排名' },
  { key: 'portfolio', label: '模拟', Icon: Icons.portfolio, hint: '纸上交易 · CSV' },
  { key: 'brief', label: '日报', Icon: Icons.brief, hint: '简报 · 持仓关联' },
  { key: 'journal', label: '复盘', Icon: Icons.journal, hint: '交易笔记' },
  { key: 'settings', label: '设置', Icon: Icons.settings, hint: '健康 · 快捷键' },
]

interface Props {
  current: PageKey
  onNavigate: (p: PageKey) => void
  alertCount?: number
  onShowShortcuts?: () => void
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
  dataStatus?: DataStatusSummary | null
}

export function Sidebar({
  current,
  onNavigate,
  alertCount = 0,
  onShowShortcuts,
  theme,
  onThemeChange,
  dataStatus,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    setDrawerOpen(false)
  }, [current])

  const navButtons = (opts?: { mobileTab?: boolean }) =>
    NAV.map((item) => (
      <button
        key={item.key}
        type="button"
        className={`nav-btn ${current === item.key ? 'active' : ''} ${opts?.mobileTab ? 'nav-tab' : ''}`}
        onClick={() => onNavigate(item.key)}
        title={item.hint}
      >
        <span className="nav-icon">
          <item.Icon />
          {item.key === 'watchlist' && alertCount > 0 && (
            <span className="nav-badge">{alertCount > 9 ? '9+' : alertCount}</span>
          )}
        </span>
        {!opts?.mobileTab && !collapsed && (
          <span className="nav-text">
            <span className="nav-label">{item.label}</span>
            <span className="nav-hint">{item.hint}</span>
          </span>
        )}
        {opts?.mobileTab && <span className="nav-tab-label">{item.label}</span>}
      </button>
    ))

  const statusSlot = dataStatus ? <DataStatusBadge status={dataStatus} compact={collapsed} /> : null

  return (
    <>
      <aside className={`sidebar desktop-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-mark">股</div>
          {!collapsed && (
            <div className="brand-text">
              <h1>股票工作台</h1>
              <p>v0.10.0 · 本地优先</p>
            </div>
          )}
          <button
            type="button"
            className="collapse-btn"
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <Icons.chevronRight /> : <Icons.chevronLeft />}
          </button>
        </div>
        {statusSlot && <div className="sidebar-status">{statusSlot}</div>}
        {navButtons()}
        <div className="sidebar-theme-row">
          <ThemeToggle theme={theme} onChange={onThemeChange} />
        </div>
        {!collapsed && (
          <div className="sidebar-footer">
            <button type="button" className="btn btn-xs sidebar-hint-btn" onClick={onShowShortcuts}>
              快捷键 ?
            </button>
            <div style={{ marginTop: 8 }}>数据仅供学习，不构成投资建议。</div>
          </div>
        )}
      </aside>

      <header className="mobile-topbar">
        <button
          type="button"
          className="btn btn-xs mobile-menu-btn touch-target"
          aria-label="打开菜单"
          onClick={() => setDrawerOpen(true)}
        >
          <Icons.menu />
        </button>
        <div className="mobile-topbar-title">
          <span className="brand-mark sm">股</span>
          <span>{NAV.find((n) => n.key === current)?.label || '股票工作台'}</span>
        </div>
        {dataStatus && <DataStatusBadge status={dataStatus} compact />}
        <ThemeToggle theme={theme} onChange={onThemeChange} />
        <button
          type="button"
          className="btn btn-xs touch-target"
          aria-label="快捷键"
          onClick={onShowShortcuts}
        >
          ?
        </button>
      </header>

      {drawerOpen && (
        <div
          className="mobile-drawer-backdrop"
          role="presentation"
          onClick={() => setDrawerOpen(false)}
        >
          <nav
            className="mobile-drawer"
            role="dialog"
            aria-label="导航"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="brand">
              <div className="brand-mark">股</div>
              <div className="brand-text">
                <h1>股票工作台</h1>
                <p>v0.10.0 · 本地优先</p>
              </div>
              <button
                type="button"
                className="collapse-btn"
                aria-label="关闭"
                onClick={() => setDrawerOpen(false)}
              >
                <Icons.close />
              </button>
            </div>
            {dataStatus && (
              <div className="sidebar-status" style={{ padding: '0 12px 8px' }}>
                <DataStatusBadge status={dataStatus} />
              </div>
            )}
            {navButtons()}
            <div className="sidebar-theme-row">
              <ThemeToggle theme={theme} onChange={onThemeChange} />
            </div>
            <div className="sidebar-footer">
              <div>数据仅供学习，不构成投资建议。</div>
            </div>
          </nav>
        </div>
      )}

      <nav className="mobile-tabbar" aria-label="主导航">
        {navButtons({ mobileTab: true })}
      </nav>
    </>
  )
}
