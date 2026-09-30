const { app, BrowserWindow, shell, ipcMain, Notification, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged
let mainWindow = null
let tray = null
/** 用户是否选择「关闭时最小化到托盘」——由渲染进程同步 */
let minimizeToTray = false
let quitting = false

function userDataPath(...parts) {
  return path.join(app.getPath('userData'), ...parts)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: '股票工作台',
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('close', (e) => {
    if (!quitting && minimizeToTray) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function buildTray() {
  if (tray) return
  // 使用空图标占位；部分 Linux 桌面环境对 Tray 支持不完整
  let image = nativeImage.createEmpty()
  try {
    const iconPath = path.join(__dirname, '../public/icons/icon-192.png')
    if (fs.existsSync(iconPath)) {
      image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    }
  } catch {
    /* */
  }
  try {
    tray = new Tray(image.isEmpty() ? nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAHElEQVQoz2NgGAWjYBSMglEwCkbBKBgFo4D6AQBVogMFtWb6aQAAAABJRU5ErkJggg==',
    ) : image)
  } catch (err) {
    console.warn('Tray 不可用（当前桌面环境可能不支持）:', err?.message || err)
    tray = null
    return
  }
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ])
  tray.setToolTip('股票工作台')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) mainWindow.focus()
    else mainWindow.show()
  })
}

app.whenReady().then(() => {
  createWindow()
  buildTray()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('sw:notify-permission', async () => {
  if (!Notification.isSupported()) return 'denied'
  return 'granted'
})

ipcMain.handle('sw:notify-show', async (_evt, payload) => {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: payload?.title || '股票工作台',
    body: payload?.body || '',
    silent: false,
  })
  n.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  n.show()
})

/** 开机自启（Electron 官方 Login Item；部分 Linux 发行版无效，设置页会说明） */
ipcMain.handle('sw:set-open-at-login', async (_evt, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: false })
    const st = app.getLoginItemSettings()
    return { ok: true, openAtLogin: !!st.openAtLogin }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('sw:get-open-at-login', async () => {
  try {
    const st = app.getLoginItemSettings()
    return { openAtLogin: !!st.openAtLogin }
  } catch {
    return { openAtLogin: false }
  }
})

ipcMain.handle('sw:set-minimize-to-tray', async (_evt, enabled) => {
  minimizeToTray = !!enabled
  return { ok: true, minimizeToTray }
})

/** LLM API Key 仅存 Electron userData，绝不进 Pages 包 */
const LLM_KEY_FILE = 'llm-api-key.txt'

ipcMain.handle('sw:llm-get-key', async () => {
  try {
    const p = userDataPath(LLM_KEY_FILE)
    if (!fs.existsSync(p)) return { key: '' }
    return { key: fs.readFileSync(p, 'utf8').trim() }
  } catch {
    return { key: '' }
  }
})

ipcMain.handle('sw:llm-set-key', async (_evt, key) => {
  try {
    const p = userDataPath(LLM_KEY_FILE)
    const v = String(key || '').trim()
    if (!v) {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } else {
      fs.writeFileSync(p, v, { encoding: 'utf8', mode: 0o600 })
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

/** 原生 HTTP 代理：绕过渲染进程 CORS，供 Pages 以外的桌面壳拉真源 */
ipcMain.handle('sw:http-fetch', async (_evt, payload) => {
  const url = String(payload?.url || '')
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: '仅允许 http(s) URL' }
  }
  const method = String(payload?.method || 'GET').toUpperCase()
  const headers = payload?.headers && typeof payload.headers === 'object' ? payload.headers : {}
  const timeoutMs = Math.min(Math.max(Number(payload?.timeoutMs) || 7000, 1000), 30000)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      headers,
      signal: ctrl.signal,
      redirect: 'follow',
    })
    clearTimeout(timer)
    const buf = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') || ''
    // 文本优先；否则 base64
    const isText = /json|text|javascript|xml|csv|html/i.test(contentType) || buf.length < 2_000_000
    return {
      ok: res.ok,
      status: res.status,
      contentType,
      bodyText: isText ? buf.toString('utf8') : null,
      bodyBase64: isText ? null : buf.toString('base64'),
      headers: { 'content-type': contentType },
    }
  } catch (e) {
    clearTimeout(timer)
    const msg = e?.name === 'AbortError' ? `超时 ${timeoutMs}ms` : e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
})
