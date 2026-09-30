/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string
  readonly VITE_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface CapacitorHttpPlugin {
  request?: (opts: Record<string, unknown>) => Promise<{
    status?: number
    data?: unknown
    headers?: Record<string, string>
    url?: string
  }>
  get?: (opts: Record<string, unknown>) => Promise<{
    status?: number
    data?: unknown
    headers?: Record<string, string>
  }>
}

interface Window {
  Capacitor?: {
    isNativePlatform?: () => boolean
    getPlatform?: () => string
    Plugins?: {
      CapacitorHttp?: CapacitorHttpPlugin
      App?: { getInfo?: () => Promise<{ version?: string; build?: string; name?: string }> }
      Browser?: { open?: (opts: { url: string }) => Promise<void> }
    }
  }
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
