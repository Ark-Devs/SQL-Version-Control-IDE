import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { startBackend, stopBackend, getBackendInfo } from './backend'
import { setupMenu } from './menu'
import { startUpdateChecker } from './updater'

let mainWindow: BrowserWindow | null = null

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

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  void stopBackend().finally(() => app.quit())
})
