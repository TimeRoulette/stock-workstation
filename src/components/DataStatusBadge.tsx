import type { DataStatusSummary } from '../utils/dataStatus'
import { isPagesHost } from '../utils/dataStatus'
import { DATA_KIND_HINT, PAGES_QUOTE_HINT } from '../utils/dataStatusLabels'

interface Props {
  status: DataStatusSummary
  compact?: boolean
}

export function DataStatusBadge({ status, compact }: Props) {
  const pages = isPagesHost()
  const tip = [status.detail, DATA_KIND_HINT[status.kind], pages ? PAGES_QUOTE_HINT : '']
    .filter(Boolean)
    .join(' ')
  return (
    <span
      className={`data-status-badge data-status-${status.kind}${compact ? ' compact' : ''}`}
      title={tip}
      role="status"
      aria-label={`数据状态：${status.label}。${tip}`}
    >
      <span className="data-status-dot" aria-hidden />
      <span className="data-status-label">{status.label}</span>
      {!compact && pages && (
        <span className="data-status-pages" title={PAGES_QUOTE_HINT}>
          公开站·桌面更准
        </span>
      )}
    </span>
  )
}
