import type { Quote } from '../types'
import * as db from './db'

/** 检查价格/成交量提醒是否触发（尊重免打扰时段与稍后）
 *  @param rvolMap 可选：symbol → RVOL，用于 type==='rvol_above'
 */
export function evaluateAlerts(
  quotes: Record<string, Quote>,
  rvolMap?: Record<string, number>,
): Array<{ alertId: number; message: string }> {
  const fired: Array<{ alertId: number; message: string }> = []
  try {
    if (db.isInMuteHours()) return fired
  } catch {
    /* */
  }
  let alerts
  try {
    alerts = db.listEnabledAlerts()
  } catch {
    return fired
  }
  const now = Date.now()
  for (const a of alerts) {
    if (a.snoozedUntil) {
      const until = new Date(a.snoozedUntil).getTime()
      if (Number.isFinite(until) && until > now) continue
    }
    let hit = false
    let detail = ''
    if (a.type === 'rvol_above') {
      const rvol = rvolMap?.[a.symbol]
      if (rvol == null || !Number.isFinite(rvol)) continue
      if (rvol >= a.threshold) {
        hit = true
        detail = `RVOL ${rvol.toFixed(2)}× ≥ ${a.threshold}×`
      }
    } else {
      const q = quotes[a.symbol]
      if (!q) continue
      if (a.type === 'above' && q.price >= a.threshold) {
        hit = true
        detail = `现价 ${q.price} ≥ ${a.threshold}`
      } else if (a.type === 'below' && q.price <= a.threshold) {
        hit = true
        detail = `现价 ${q.price} ≤ ${a.threshold}`
      } else if (a.type === 'pct_change' && Math.abs(q.changePercent) >= Math.abs(a.threshold)) {
        hit = true
        detail = `涨跌幅 ${q.changePercent}%（阈值 ±${a.threshold}%）`
      }
    }
    if (hit) {
      try {
        db.markAlertTriggered(a.id)
      } catch {
        /* */
      }
      fired.push({
        alertId: a.id,
        message: `提醒：${a.name || a.symbol} ${detail}`,
      })
    }
  }
  return fired
}
