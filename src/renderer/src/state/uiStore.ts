import { create } from 'zustand'

export interface ChangelogRequest {
  objectName: string
  /** resolve(desc) → run with changelog; resolve('') → run without; resolve(null) → cancel run */
  resolve: (desc: string | null) => void
}

export interface SearchScope {
  connId?: string
  database?: string
  /** free-text prefill for the query box */
  query?: string
}

interface UiState {
  changelogRequest: ChangelogRequest | null
  /** Ask the user for an update description before running module DDL. */
  askChangelog: (objectName: string) => Promise<string | null>
  answerChangelog: (desc: string | null) => void

  /** Global search dialog (Ctrl+Shift+F); null = closed. */
  searchScope: SearchScope | null
  openSearch: (scope?: SearchScope) => void
  closeSearch: () => void
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
  },

  searchScope: null,
  openSearch: (scope) => set({ searchScope: scope ?? {} }),
  closeSearch: () => set({ searchScope: null })
}))
