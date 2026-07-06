import { contextBridge, ipcRenderer } from 'electron'

export interface BackendInfo {
  port: number
  token: string
  ready: boolean
}

const api = {
  getBackendInfo: (): Promise<BackendInfo> => ipcRenderer.invoke('backend:info'),
  pickFolder: (title: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickFolder', title),
  onBackendReady: (cb: (info: BackendInfo) => void): void => {
    ipcRenderer.on('backend:ready', (_e, info: BackendInfo) => cb(info))
  },
  onBackendError: (cb: (err: string) => void): void => {
    ipcRenderer.on('backend:error', (_e, err: string) => cb(err))
  }
}

export type PreloadApi = typeof api

contextBridge.exposeInMainWorld('svcide', api)
