import { create } from 'zustand'
import { queryApi } from '../api/endpoints'
import type { QuerySnapshot } from '../api/types'

export interface ExecutionState {
  id: string
  running: boolean
  snapshot: QuerySnapshot | null
}

export interface Tab {
  id: string
  title: string
  connId?: string
  database?: string
  content: string
  dirty: boolean
  execution?: ExecutionState
  /** repo-relative path when the tab was opened from the git repo */
  repoPath?: string
}

interface TabsState {
  tabs: Tab[]
  activeId: string | null
  counter: number

  openTab: (partial?: Partial<Omit<Tab, 'id' | 'dirty'>>) => string
  closeTab: (id: string) => void
  setActive: (id: string) => void
  updateContent: (id: string, content: string) => void
  setTabConnection: (id: string, connId: string | undefined, database: string | undefined) => void
  markSaved: (id: string) => void

  run: (id: string, sqlOverride?: string) => Promise<void>
  cancel: (id: string) => Promise<void>
}

const POLL_MS = 250

export const useTabs = create<TabsState>((set, get) => {
  const patchTab = (id: string, patch: Partial<Tab>): void => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  }

  return {
    tabs: [],
    activeId: null,
    counter: 0,

    openTab: (partial) => {
      const n = get().counter + 1
      const id = `tab-${n}`
      const tab: Tab = {
        id,
        title: partial?.title ?? `SQLQuery${n}.sql`,
        connId: partial?.connId,
        database: partial?.database,
        content: partial?.content ?? '',
        repoPath: partial?.repoPath,
        dirty: false
      }
      set((s) => ({ tabs: [...s.tabs, tab], activeId: id, counter: n }))
      return id
    },

    closeTab: (id) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (tab?.execution?.id) void queryApi.release(tab.execution.id)
      set((s) => {
        const tabs = s.tabs.filter((t) => t.id !== id)
        let activeId = s.activeId
        if (activeId === id) {
          const idx = s.tabs.findIndex((t) => t.id === id)
          activeId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
        }
        return { tabs, activeId }
      })
    },

    setActive: (id) => set({ activeId: id }),

    updateContent: (id, content) => patchTab(id, { content, dirty: true }),

    setTabConnection: (id, connId, database) => patchTab(id, { connId, database }),

    markSaved: (id) => patchTab(id, { dirty: false }),

    run: async (id, sqlOverride) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab || !tab.connId || tab.execution?.running) return
      const sql = (sqlOverride ?? tab.content).trim()
      if (!sql) return

      // release previous execution of this tab
      if (tab.execution?.id) void queryApi.release(tab.execution.id)

      const { executionId } = await queryApi.execute(tab.connId, tab.database ?? '', sql)
      patchTab(id, { execution: { id: executionId, running: true, snapshot: null } })

      for (;;) {
        let snap: QuerySnapshot
        try {
          snap = await queryApi.results(executionId)
        } catch (err) {
          patchTab(id, {
            execution: {
              id: executionId,
              running: false,
              snapshot: {
                done: true,
                sets: [],
                messages: [{ kind: 'error', text: String(err) }],
                elapsedMs: 0
              }
            }
          })
          return
        }
        // tab may have been closed or re-run meanwhile
        const cur = get().tabs.find((t) => t.id === id)
        if (!cur || cur.execution?.id !== executionId) return
        patchTab(id, { execution: { id: executionId, running: !snap.done, snapshot: snap } })
        if (snap.done) return
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
    },

    cancel: async (id) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (tab?.execution?.running) await queryApi.cancel(tab.execution.id)
    }
  }
})
