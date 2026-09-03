import { create } from 'zustand'
import { queryApi } from '../api/endpoints'
import { gitApi } from '../api/git'
import type { QuerySnapshot } from '../api/types'
import { injectChangelog, isModuleDdl, moduleName } from '../utils/changelog'
import { detectDdlObjects } from '../utils/ddl'
import { useGit } from './gitStore'
import { useSettings } from './settingsStore'
import { useUi } from './uiStore'

export interface ExecutionState {
  id: string
  running: boolean
  snapshot: QuerySnapshot | null
}

export interface Tab {
  id: string
  title: string
  kind?: 'sql' | 'diff' | 'design' | 'compare'
  connId?: string
  database?: string
  content: string
  dirty: boolean
  execution?: ExecutionState
  /** repo-relative path when the tab was opened from the git repo */
  repoPath?: string
  /** diff tabs: original (left) content; `content` is the modified (right) side */
  diffOriginal?: string
  diffLabels?: { original: string; modified: string }
  /** where this tab's content came from, e.g. a "new object" template (colors the tab title green) */
  origin?: 'template'
  /** design tabs: the table being inspected (read-only SSMS-Design-like view) */
  designTarget?: { connId: string; database: string; schema: string; name: string }
}

interface TabsState {
  tabs: Tab[]
  activeId: string | null
  counter: number

  openTab: (partial?: Partial<Omit<Tab, 'id' | 'dirty'>>) => string
  /** Replace every tab from a saved workspace session (see sessionStore). */
  hydrate: (tabs: Tab[], activeId: string | null, counter: number) => void
  closeTab: (id: string) => void
  setActive: (id: string) => void
  updateContent: (id: string, content: string) => void
  setTabConnection: (id: string, connId: string | undefined, database: string | undefined) => void
  markSaved: (id: string) => void

  run: (id: string, sqlOverride?: string) => Promise<void>
  cancel: (id: string) => Promise<void>
}

const POLL_MS = 250

/**
 * Live mirror: after a successful execution against a repo-tracked database,
 * re-script any objects touched by DDL into the repo worktree so git status
 * always reflects the database. Best-effort and fully non-blocking — failures
 * only warn, never disturb the query UX.
 */
async function mirrorExecutedDdl(tab: Tab, sql: string, snap: QuerySnapshot): Promise<void> {
  try {
    if (!useSettings.getState().settings.mirrorOnExecute) return
    if (snap.messages?.some((m) => m.kind === 'error')) return
    const git = useGit.getState()
    const man = git.info.manifest
    if (!git.info.open || !man || man.sourceConnId !== tab.connId) return
    const database = tab.database ?? ''
    if (!database || !man.databases?.includes(database)) return

    const objects = detectDdlObjects(sql)
    if (objects.length === 0) return
    for (const o of objects) {
      try {
        await gitApi.syncObject(database, o.schema, o.name)
      } catch (err) {
        console.warn(`live mirror: sync-object failed for ${o.schema}.${o.name}:`, err)
      }
    }
    await useGit.getState().loadObjectStatus()
    void useGit.getState().refresh()
  } catch (err) {
    console.warn('live mirror skipped:', err)
  }
}

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
        kind: partial?.kind ?? 'sql',
        connId: partial?.connId,
        database: partial?.database,
        content: partial?.content ?? '',
        repoPath: partial?.repoPath,
        diffOriginal: partial?.diffOriginal,
        diffLabels: partial?.diffLabels,
        origin: partial?.origin,
        designTarget: partial?.designTarget,
        dirty: false
      }
      set((s) => ({ tabs: [...s.tabs, tab], activeId: id, counter: n }))
      return id
    },

    hydrate: (tabs, activeId, counter) => {
      // ids are `tab-<n>`; never hand a restored tab's id back out to a new one
      const highest = tabs.reduce((max, t) => Math.max(max, Number(t.id.slice(4)) || 0), 0)
      set({
        tabs,
        activeId: tabs.some((t) => t.id === activeId) ? activeId : (tabs.at(-1)?.id ?? null),
        counter: Math.max(counter, highest)
      })
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
      let sql = (sqlOverride ?? tab.content).trim()
      if (!sql) return

      // module DDL → offer to record author/date/description in the header
      if (isModuleDdl(sql)) {
        const desc = await useUi.getState().askChangelog(moduleName(sql))
        if (desc === null) return // cancelled
        if (desc !== '') {
          const author = useSettings.getState().settings.authorName || 'unknown'
          sql = injectChangelog(sql, author, desc)
          if (sqlOverride === undefined) {
            // whole-buffer run: reflect the injected header in the editor
            patchTab(id, { content: sql })
          }
        }
      }

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
        if (snap.done) {
          void mirrorExecutedDdl(cur, sql, snap)
          return
        }
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
    },

    cancel: async (id) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (tab?.execution?.running) await queryApi.cancel(tab.execution.id)
    }
  }
})

/**
 * Open the single schema-compare tab, focusing the existing one if present.
 * Compare state lives inside the CompareTab component, so one tab is enough.
 */
export function openCompareTab(): void {
  const tabs = useTabs.getState()
  const existing = tabs.tabs.find((t) => t.kind === 'compare')
  if (existing) {
    tabs.setActive(existing.id)
    return
  }
  tabs.openTab({ kind: 'compare', title: 'Schema Compare' })
}
