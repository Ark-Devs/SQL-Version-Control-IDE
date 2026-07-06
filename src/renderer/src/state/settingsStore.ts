import { create } from 'zustand'
import { get, put } from '../api/client'

export interface AppSettings {
  authorName: string
}

interface SettingsState {
  settings: AppSettings
  load: () => Promise<void>
  save: (s: AppSettings) => Promise<void>
}

export const useSettings = create<SettingsState>((set) => ({
  settings: { authorName: '' },

  load: async () => {
    const s = await get<AppSettings>('/settings')
    set({ settings: s })
  },

  save: async (s) => {
    await put<AppSettings>('/settings', s)
    set({ settings: s })
  }
}))
