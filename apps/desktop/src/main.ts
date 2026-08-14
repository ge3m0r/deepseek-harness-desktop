/** Electron host for the existing loopback DeepSeek Harness Web application. */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { DesktopBackend } from './backend.ts'

const backend = new DesktopBackend()
let mainWindow: BrowserWindow | undefined
let quitting = false

function createWindow(url: string): BrowserWindow {
  const allowedOrigin = new URL(url).origin
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    minHeight: 620,
    show: false,
    title: 'DeepSeek Harness',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const parsed = new URL(target)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(parsed.href)
    } catch {
      // Electron can report an invalid target only for malformed page input; deny it below.
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin !== allowedOrigin) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  window.once('ready-to-show', () => { window.show() })
  void window.loadURL(url)
  return window
}

async function launch(): Promise<void> {
  const url = await backend.start()
  if (quitting) return
  mainWindow = createWindow(url)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void backend.stop().finally(() => { app.quit() })
  })
  app.on('window-all-closed', () => { app.quit() })
  app.whenReady().then(async () => {
    app.setName('DeepSeek Harness')
    app.on('web-contents-created', (_event, contents) => {
      contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
    })
    await launch()
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('DeepSeek Harness failed to start', message)
    app.quit()
  })
}
