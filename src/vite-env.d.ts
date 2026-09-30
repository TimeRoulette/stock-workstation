/// <reference types="vite/client" />

interface Window {
  stockWorkstation?: {
    platform: string
    isElectron: boolean
    requestNotificationPermission?: () => Promise<NotificationPermission>
    showNotification?: (payload: {
      title: string
      body: string
      tag?: string
    }) => Promise<void>
    setOpenAtLogin?: (enabled: boolean) => Promise<{ ok: boolean; openAtLogin?: boolean; error?: string }>
    getOpenAtLogin?: () => Promise<{ openAtLogin: boolean }>
    setMinimizeToTray?: (enabled: boolean) => Promise<{ ok: boolean; minimizeToTray: boolean }>
    getLlmKey?: () => Promise<{ key: string }>
    setLlmKey?: (key: string) => Promise<{ ok: boolean; error?: string }>
  }
}
