const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('stockWorkstation', {
  platform: process.platform,
  isElectron: true,
})
