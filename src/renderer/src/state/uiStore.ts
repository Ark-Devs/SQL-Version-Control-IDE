import { create } from 'zustand'

export interface ChangelogRequest {
  objectName: string
  /** resolve(desc) → run with changelog; resolve('') → run without; resolve(null) → cancel run */
  resolve: (desc: string | null) => void
}

interface UiState {
  changelogRequest: ChangelogRequest | null
  /** Ask the user for an update description before running module DDL. */
  askChangelog: (objectName: string) => Promise<string | null>
  answerChangelog: (desc: string | null) => void
}

export const useUi = create<UiState>((set, get) => ({
  changelogRequest: null,

  askChangelog: (objectName) =>
    new Promise<string | null>((resolve) => {
      set({ changelogRequest: { objectName, resolve } })
    }),

  answerChangelog: (desc) => {
    get().changelogRequest?.resolve(desc)
    set({ changelogRequest: null })
  }
}))
