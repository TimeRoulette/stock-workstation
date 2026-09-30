import { useState, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 折叠时一行摘要 */
  summary?: string
  defaultOpen?: boolean
  className?: string
}

/** 新手/长提示默认折叠，可展开 */
export function CollapsibleTip({
  children,
  summary = '说明（点击展开）',
  defaultOpen = false,
  className = '',
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`tip-banner collapsible ${open ? 'open' : 'collapsed'} ${className}`.trim()}>
      <button type="button" className="tip-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="tip-chevron">{open ? '▾' : '▸'}</span>
        <span className="tip-summary">{open ? '收起说明' : summary}</span>
      </button>
      {open && <div className="tip-body">{children}</div>}
    </div>
  )
}
