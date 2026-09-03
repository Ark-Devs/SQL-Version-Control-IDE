import { create } from 'zustand'

export interface ChangelogRequest {
  objectName: string
  /** resolve(desc) → run with changelog; resolve('') → run without; resolve(null) → cancel run */
  resolve: (desc: string | null) => void
}

/** Sidebar/results geometry, persisted with the workspace session. */
export interface Layout {
  explorerWidth: number
  resultsHeight: number
  sidebarTab: 'explorer' | 'git'
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

  /**
   * Set by App.tsx when the native app menu sends a command that needs a
   * Shell-level dialog or sidebar switch (e.g. 'connections', 'settings',
   * 'view-git'). Shell.tsx consumes it once and clears it back to null.
   */
  menuRequest: string | null
  setMenuRequest: (request: string | null) => void

  layout: Layout
  setLayout: (patch: Partial<Layout>) => void
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
  closeSearch: () => set({ searchScope: null }),

  menuRequest: null,
  setMenuRequest: (request) => set({ menuRequest: request }),

  layout: { explorerWidth: 300, resultsHeight: 260, sidebarTab: 'explorer' },
  setLayout: (patch) => set((s) => ({ layout: { ...s.layout, ...patch } }))
}))
