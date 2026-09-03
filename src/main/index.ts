import { app, BrowserWindow, dialog, ipcMain, shell, type Event } from 'electron'
import { join } from 'path'
import { startBackend, stopBackend, getBackendInfo } from './backend'
import { setupMenu } from './menu'
import { startUpdateChecker } from './updater'

let mainWindow: BrowserWindow | null = null

/** How long to wait for the renderer to write its workspace before closing. */
const SESSION_FLUSH_TIMEOUT_MS = 2000

/** Ask the renderer to save its workspace session while it is still alive. */
function flushSession(): Promise<void> {
  const win = mainWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout
    const done = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener('session:flushed', done)
      resolve()
    }
    ipcMain.once('session:flushed', done)
    timer = setTimeout(done, SESSION_FLUSH_TIMEOUT_MS)
    win.webContents.send('session:flush')
  })
}

let shuttingDown = false

/**
 * Both the window's X and an app quit funnel through here: save the workspace
 * while the renderer is alive, then stop the backend, then quit for real.
 */
function beginShutdown(e: Event): void {
  if (shuttingDown) return
  e.preventDefault()
  shuttingDown = true
  void flushSession()
    .catch(() => undefined)
    .then(() => stopBackend())
    .catch(() => undefined)
    .finally(() => app.quit())
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#1e1e1e',
    title: 'ArkSQL',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', beginShutdown)

  // If the renderer process dies (OOM, GPU fault…), reload instead of leaving
  // a dead black window the user cannot recover from.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') {
      console.error('renderer gone:', details.reason, '— reloading')
      mainWindow?.webContents.reload()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  ipcMain.handle('backend:info', () => getBackendInfo())

  ipcMain.handle('app:info', () => {
    try {
      // updateRepo lives in package.json next to the app entry
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require(join(app.getAppPath(), 'package.json'))
      return { version: app.getVersion(), updateRepo: pkg.updateRepo ?? '' }
    } catch {
      return { version: app.getVersion(), updateRepo: '' }
    }
  })

  ipcMain.handle('dialog:pickFolder', async (_e, title: string) => {
    const res = await dialog.showOpenDialog({
      title,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  setupMenu()
  createWindow()
  startUpdateChecker()

  try {
    await startBackend()
    // Notify renderer in case it loaded before the backend finished starting
    mainWindow?.webContents.send('backend:ready', getBackendInfo())
  } catch (err) {
    mainWindow?.webContents.send('backend:error', String(err))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', beginShutdown)
