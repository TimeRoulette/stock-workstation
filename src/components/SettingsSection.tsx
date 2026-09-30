import { useCallback, useEffect, useState, type ReactNode, type CSSProperties } from 'react'

const STORAGE_KEY = 'sw-settings-sections'

function readMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') return parsed as Record<string, boolean>
  } catch {
    /* */
  }
  return {}
}

function writeMap(map: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* */
  }
}

interface Props {
  id: string
  title: string
  /** 默认是否展开（无 localStorage 记录时） */
  defaultOpen?: boolean
  children: ReactNode
  /** 标题右侧附加（如图标/按钮，勿再包一层 button 作为父级） */
  trailing?: ReactNode
  className?: string
  style?: CSSProperties
}

/** 设置页可折叠区块；展开状态写入 localStorage */
export function SettingsSection({
  id,
  title,
  defaultOpen = false,
  children,
  trailing,
  className = '',
  style,
}: Props) {
  const [open, setOpen] = useState(() => {
    const map = readMap()
    if (Object.prototype.hasOwnProperty.call(map, id)) return !!map[id]
    return defaultOpen
  })

  useEffect(() => {
    const map = readMap()
    map[id] = open
    writeMap(map)
  }, [id, open])

  const toggle = useCallback(() => setOpen((o) => !o), [])

  return (
    <div
      className={`panel settings-section ${open ? 'is-open' : 'is-collapsed'} ${className}`.trim()}
      style={{ marginBottom: 16, ...style }}
    >
      <div className="panel-header settings-section-header">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={`settings-section-${id}`}
        >
          <span className="settings-section-chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          <span className="settings-section-title">{title}</span>
        </button>
        {trailing ? (
          <span
            className="settings-section-trailing"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {trailing}
          </span>
        ) : null}
      </div>
      {open && (
        <div className="panel-body" id={`settings-section-${id}`}>
          {children}
        </div>
      )}
    </div>
  )
}
