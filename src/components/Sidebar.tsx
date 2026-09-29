import { useEffect, useState } from 'react'

export type PageKey =
  | 'watchlist'
  | 'volume'
  | 'screener'
  | 'portfolio'
  | 'brief'
  | 'journal'
  | 'settings'

const NAV: Array<{ key: PageKey; label: string; icon: string; hint: string }> = [
  { key: 'watchlist', label: '盯盘', icon: '◎', hint: '自选 · K线 · 提醒' },
  { key: 'volume', label: '量监', icon: '▦', hint: 'RVOL · 放量' },
  { key: 'screener', label: '选股', icon: '▣', hint: '涨跌幅排名' },
  { key: 'portfolio', label: '模拟', icon: '▤', hint: '纸上交易 · CSV' },
  { key: 'brief', label: '日报', icon: '☰', hint: '简报 · 持仓关联' },
  { key: 'journal', label: '复盘', icon: '✎', hint: '交易笔记' },
  { key: 'settings', label: '设置', icon: '⚙', hint: '健康 · 快捷键' },
]

interface Props {
  current: PageKey
  onNavigate: (p: PageKey) => void
  alertCount?: number
  onShowShortcuts?: () => void
}

export function Sidebar({ current, onNavigate, alertCount = 0, onShowShortcuts }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 窄屏切页后自动收起抽屉
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
          {item.icon}
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

  return (
    <>
      {/* 桌面 / 平板侧栏 */}
      <aside className={`sidebar desktop-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-mark">股</div>
          {!collapsed && (
            <div className="brand-text">
              <h1>股票工作台</h1>
              <p>v0.7.1 · 本地优先</p>
            </div>
          )}
          <button
            type="button"
            className="collapse-btn"
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
        {navButtons()}
        {!collapsed && (
          <div className="sidebar-footer">
            <button type="button" className="btn btn-xs sidebar-hint-btn" onClick={onShowShortcuts}>
              快捷键 ?
            </button>
            <div style={{ marginTop: 8 }}>数据仅供学习，不构成投资建议。</div>
          </div>
        )}
      </aside>

      {/* 手机顶栏 + 抽屉 */}
      <header className="mobile-topbar">
        <button
          type="button"
          className="btn btn-xs mobile-menu-btn touch-target"
          aria-label="打开菜单"
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
        <div className="mobile-topbar-title">
          <span className="brand-mark sm">股</span>
          <span>{NAV.find((n) => n.key === current)?.label || '股票工作台'}</span>
        </div>
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
                <p>v0.7.1 · 本地优先</p>
              </div>
              <button
                type="button"
                className="collapse-btn"
                aria-label="关闭"
                onClick={() => setDrawerOpen(false)}
              >
                ✕
              </button>
            </div>
            {navButtons()}
            <div className="sidebar-footer">
              <div>数据仅供学习，不构成投资建议。</div>
            </div>
          </nav>
        </div>
      )}

      {/* 手机底部 Tab */}
      <nav className="mobile-tabbar" aria-label="主导航">
        {navButtons({ mobileTab: true })}
      </nav>
    </>
  )
}
