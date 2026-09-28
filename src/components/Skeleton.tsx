interface Props {
  rows?: number
  height?: number
  className?: string
}

/** 简易加载骨架，保持简单 UX */
export function Skeleton({ rows = 4, height = 14, className = '' }: Props) {
  return (
    <div className={`skeleton-stack ${className}`} aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton-bar"
          style={{
            height,
            width: `${88 - (i % 3) * 12}%`,
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-table" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-table-row">
          <div className="skeleton-bar" style={{ width: '28%', height: 12 }} />
          <div className="skeleton-bar" style={{ width: '18%', height: 12 }} />
          <div className="skeleton-bar" style={{ width: '18%', height: 12 }} />
          <div className="skeleton-bar" style={{ width: '14%', height: 12 }} />
        </div>
      ))}
    </div>
  )
}
