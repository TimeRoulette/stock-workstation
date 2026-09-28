import { useState } from 'react'

export type PageKey = 'watchlist' | 'portfolio' | 'brief' | 'journal' | 'settings'

const NAV: Array<{ key: PageKey; label: string; icon: string; hint: string }> = [
  { key: 'watchlist', label: '盯盘', icon: '◎', hint: '自选 · K线 · 提醒' },
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

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand">
        <div className="brand-mark">股</div>
        {!collapsed && (
          <div className="brand-text">
            <h1>股票工作台</h1>
            <p>v0.5 · 本地优先</p>
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
      {NAV.map((item) => (
        <button
          key={item.key}
          className={`nav-btn ${current === item.key ? 'active' : ''}`}
          onClick={() => onNavigate(item.key)}
          title={item.hint}
        >
          <span className="nav-icon">
            {item.icon}
            {item.key === 'watchlist' && alertCount > 0 && (
              <span className="nav-badge">{alertCount > 9 ? '9+' : alertCount}</span>
            )}
          </span>
          {!collapsed && (
            <span className="nav-text">
              <span className="nav-label">{item.label}</span>
              <span className="nav-hint">{item.hint}</span>
            </span>
          )}
        </button>
      ))}
      {!collapsed && (
        <div className="sidebar-footer">
          <button type="button" className="btn btn-xs sidebar-hint-btn" onClick={onShowShortcuts}>
            快捷键 ?
          </button>
          <div style={{ marginTop: 8 }}>
            数据仅供学习，不构成投资建议。
          </div>
        </div>
      )}
    </aside>
  )
}
