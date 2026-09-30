const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('stockWorkstation', {
  platform: process.platform,
  isElectron: true,
  requestNotificationPermission: () => ipcRenderer.invoke('sw:notify-permission'),
  showNotification: (payload) => ipcRenderer.invoke('sw:notify-show', payload),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('sw:set-open-at-login', enabled),
  getOpenAtLogin: () => ipcRenderer.invoke('sw:get-open-at-login'),
  setMinimizeToTray: (enabled) => ipcRenderer.invoke('sw:set-minimize-to-tray', enabled),
  getLlmKey: () => ipcRenderer.invoke('sw:llm-get-key'),
  setLlmKey: (key) => ipcRenderer.invoke('sw:llm-set-key', key),
  httpFetch: (payload) => ipcRenderer.invoke('sw:http-fetch', payload),
})
