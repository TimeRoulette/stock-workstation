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
  }
}
