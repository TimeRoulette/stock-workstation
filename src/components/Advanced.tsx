import { useState, type ReactNode } from 'react'

interface Props {
  title?: string
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}

/** Collapsible「高级」section — keeps power without cluttering common paths */
export function Advanced({ title = '高级', defaultOpen = false, children, className = '' }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`advanced-block ${className}`}>
      <button type="button" className="advanced-toggle" onClick={() => setOpen((o) => !o)}>
        <span>{open ? '▾' : '▸'}</span> {title}
      </button>
      {open && <div className="advanced-body">{children}</div>}
    </div>
  )
}
