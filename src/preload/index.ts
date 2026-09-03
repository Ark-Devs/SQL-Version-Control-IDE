import { contextBridge, ipcRenderer } from 'electron'

export interface BackendInfo {
  port: number
  token: string
  ready: boolean
}

/** Contextual flags the renderer reports so the app menu can grey out items correctly. */
export interface MenuState {
  hasTab: boolean
  running: boolean
  repoOpen: boolean
  connected: boolean
}

const api = {
  getBackendInfo: (): Promise<BackendInfo> => ipcRenderer.invoke('backend:info'),
  getAppInfo: (): Promise<{ version: string; updateRepo: string }> =>
    ipcRenderer.invoke('app:info'),
  pickFolder: (title: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickFolder', title),
  onBackendReady: (cb: (info: BackendInfo) => void): void => {
    ipcRenderer.on('backend:ready', (_e, info: BackendInfo) => cb(info))
  },
  onBackendError: (cb: (err: string) => void): void => {
    ipcRenderer.on('backend:error', (_e, err: string) => cb(err))
  },
  onUpdateAvailable: (cb: (info: { version: string; url: string }) => void): void => {
    ipcRenderer.on('update:available', (_e, info: { version: string; url: string }) => cb(info))
  },
  /** Subscribe to commands sent by the native application menu. */
  onMenuCommand: (cb: (command: string) => void): void => {
    ipcRenderer.on('menu:command', (_e, command: string) => cb(command))
  },
  /** Main asks for a final workspace save before the window closes. */
  onFlushSession: (cb: () => void): void => {
    ipcRenderer.on('session:flush', () => cb())
  },
  /** Tell main the workspace has been saved and it may proceed with the close. */
  sessionFlushed: (): void => {
    ipcRenderer.send('session:flushed')
  },
  /** Push current app state to main so it can enable/disable menu items. */
  setMenuState: (state: MenuState): void => {
    ipcRenderer.send('menu:state', state)
  }
}

export type PreloadApi = typeof api

contextBridge.exposeInMainWorld('svcide', api)
