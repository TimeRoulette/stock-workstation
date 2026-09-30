import * as db from './db'

export type NotifyPermission = NotificationPermission | 'unsupported'

export function getNotifyPermission(): NotifyPermission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export function isNotifyEnabledSetting(): boolean {
  try {
    return db.getSetting('notifyEnabled') === '1'
  } catch {
    return false
  }
}

export function setNotifyEnabledSetting(on: boolean) {
  db.setSetting('notifyEnabled', on ? '1' : '0')
}

/** 请求浏览器/Electron 通知权限；返回最终状态 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    // Electron 可走主进程；失败则回退标准 API
    const api = window.stockWorkstation
    if (api?.isElectron && typeof api.requestNotificationPermission === 'function') {
      const r = await api.requestNotificationPermission()
      if (r === 'granted' || r === 'denied' || r === 'default') return r
    }
  } catch {
    /* fall through */
  }
  try {
    const r = await Notification.requestPermission()
    return r
  } catch {
    return 'denied'
  }
}

export interface NotifyPayload {
  title: string
  body: string
  tag?: string
}

/**
 * 发出系统通知。尊重：设置开关、权限、免打扰。
 * mute 时返回 'muted'；未开权限返回 'denied'。
 */
export async function sendSystemNotification(
  payload: NotifyPayload,
  opts?: { ignoreMute?: boolean; force?: boolean },
): Promise<'ok' | 'muted' | 'disabled' | 'denied' | 'unsupported'> {
  if (!opts?.force && !isNotifyEnabledSetting()) return 'disabled'
  if (!opts?.ignoreMute) {
    try {
      if (db.isInMuteHours()) return 'muted'
    } catch {
      /* */
    }
  }
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'granted') return 'denied'

  try {
    const api = window.stockWorkstation
    if (api?.isElectron && typeof api.showNotification === 'function') {
      await api.showNotification({ title: payload.title, body: payload.body, tag: payload.tag })
      return 'ok'
    }
  } catch {
    /* fall through to Notification API */
  }

  try {
    const n = new Notification(payload.title, {
      body: payload.body,
      tag: payload.tag || 'stock-workstation',
      silent: false,
    })
    n.onclick = () => {
      try {
        window.focus()
        n.close()
      } catch {
        /* */
      }
    }
    return 'ok'
  } catch {
    return 'unsupported'
  }
}

/** 告警触发时：Toast 之外尝试系统通知（免打扰已由 evaluateAlerts 处理，此处再尊重设置） */
export function notifyAlertFired(message: string) {
  void sendSystemNotification({
    title: '股票工作台 · 提醒',
    body: message,
    tag: `alert-${Date.now()}`,
  })
}
