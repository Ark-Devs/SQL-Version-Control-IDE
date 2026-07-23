import { BrowserWindow, Menu, MenuItemConstructorOptions, ipcMain, shell } from 'electron'

/** Feature/state flags the renderer reports so menu items can grey out correctly. */
export interface MenuState {
  hasTab: boolean
  running: boolean
  repoOpen: boolean
  connected: boolean
}

let state: MenuState = { hasTab: false, running: false, repoOpen: false, connected: false }

function send(command: string): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', command)
}

function buildTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        { label: 'Connect Object Explorer…', click: () => send('connections') },
        { label: 'New Query', accelerator: 'CmdOrCtrl+N', click: () => send('new-query') },
        { label: 'Open Repository Folder…', click: () => send('repo-open') },
        { label: 'Settings…', click: () => send('settings') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Search Database Objects',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => send('global-search')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Object Explorer', click: () => send('view-explorer') },
        { label: 'Git Changes', click: () => send('view-git') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Git',
      submenu: [
        { label: 'Sync from Databases', enabled: state.repoOpen, click: () => send('git-sync') },
        { label: 'Commit…', enabled: state.repoOpen, click: () => send('git-commit') },
        { type: 'separator' },
        { label: 'Push', enabled: state.repoOpen, click: () => send('git-push') },
        { label: 'Pull', enabled: state.repoOpen, click: () => send('git-pull') },
        { label: 'Fetch', enabled: state.repoOpen, click: () => send('git-fetch') },
        { type: 'separator' },
        { label: 'History…', enabled: state.repoOpen, click: () => send('git-history') },
        { type: 'separator' },
        { label: 'Open Repository…', click: () => send('repo-open') }
      ]
    },
    {
      label: 'Query',
      submenu: [
        {
          label: 'Execute',
          accelerator: 'F5',
          enabled: state.hasTab && state.connected && !state.running,
          click: () => send('execute')
        },
        { label: 'Cancel', enabled: state.running, click: () => send('cancel') }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Schema Compare…', click: () => send('schema-compare') }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          enabled: state.hasTab,
          click: () => send('close-tab')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for Updates…', click: () => send('check-updates') },
        { label: "What's New", click: () => send('changelog') },
        { type: 'separator' },
        {
          label: 'About ArkSQL',
          click: () => void shell.openExternal('https://github.com/Ark-Devs/SQL-Version-Control-IDE')
        }
      ]
    }
  ]
}

function rebuildMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()))
}

export function setupMenu(): void {
  rebuildMenu()

  // Renderer pushes contextual state (active tab / connection / repo / execution)
  // whenever it changes; rebuilding the whole menu on each update is cheap enough.
  ipcMain.on('menu:state', (_e, next: Partial<MenuState>) => {
    state = { ...state, ...next }
    rebuildMenu()
  })
}
