const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('stockWorkstation', {
  platform: process.platform,
  isElectron: true,
  requestNotificationPermission: () => ipcRenderer.invoke('sw:notify-permission'),
  showNotification: (payload) => ipcRenderer.invoke('sw:notify-show', payload),
})
