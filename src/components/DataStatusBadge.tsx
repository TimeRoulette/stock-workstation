import type { DataStatusSummary } from '../utils/dataStatus'
import { isPagesHost } from '../utils/dataStatus'

interface Props {
  status: DataStatusSummary
  compact?: boolean
}

export function DataStatusBadge({ status, compact }: Props) {
  const pages = isPagesHost()
  return (
    <span
      className={`data-status-badge data-status-${status.kind}${compact ? ' compact' : ''}`}
      title={status.detail}
      role="status"
      aria-label={`数据状态：${status.label}。${status.detail}`}
    >
      <span className="data-status-dot" aria-hidden />
      <span className="data-status-label">{status.label}</span>
      {!compact && pages && <span className="data-status-pages">公开站</span>}
    </span>
  )
}
