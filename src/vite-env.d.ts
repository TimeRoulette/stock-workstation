/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string
  readonly VITE_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

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
    httpFetch?: (payload: {
      url: string
      method?: string
      headers?: Record<string, string>
      timeoutMs?: number
    }) => Promise<{
      ok: boolean
      status?: number
      contentType?: string
      bodyText?: string | null
      bodyBase64?: string | null
      headers?: Record<string, string>
      error?: string
    }>
  }
}
