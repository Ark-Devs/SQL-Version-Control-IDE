import { create } from 'zustand'
import { connectionsApi } from '../api/endpoints'
import type { Profile, ProfileDraft } from '../api/types'

interface ConnectionsState {
  profiles: Profile[]
  loaded: boolean
  load: () => Promise<void>
  save: (draft: ProfileDraft) => Promise<Profile>
  remove: (id: string) => Promise<void>
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  profiles: [],
  loaded: false,

  load: async () => {
    const profiles = await connectionsApi.list()
    set({ profiles: profiles ?? [], loaded: true })
  },

  save: async (draft) => {
    const saved = draft.id
      ? await connectionsApi.update(draft as ProfileDraft & { id: string })
      : await connectionsApi.create(draft)
    await get().load()
    return saved
  },

  remove: async (id) => {
    await connectionsApi.remove(id)
    await get().load()
  }
}))
