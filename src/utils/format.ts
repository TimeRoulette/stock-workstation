/** Safe number helpers — avoid NaN / Infinity in UI */

export function safeNum(n: unknown, fallback = 0): number {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? v : fallback
}

export function fmt(n: unknown, digits = 2): string {
  const v = safeNum(n, NaN)
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtPct(n: unknown, digits = 2): string {
  const v = safeNum(n, NaN)
  if (!Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${fmt(v, digits)}%`
}

export function fmtSigned(n: unknown, digits = 2): string {
  const v = safeNum(n, NaN)
  if (!Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${fmt(v, digits)}`
}

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return '—'
  }
}

export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return '—'
  }
}
