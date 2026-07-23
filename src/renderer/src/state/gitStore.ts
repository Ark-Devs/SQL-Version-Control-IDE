import { create } from 'zustand'
import {
  gitApi,
  type BranchInfo,
  type DriftReport,
  type FileChange,
  type MergeConflict,
  type ObjectStatusMap,
  type RepoInfo
} from '../api/git'

interface GitState {
  info: RepoInfo
  changes: FileChange[]
  branches: BranchInfo[]
  conflicts: MergeConflict[] | null
  /** "connId|db" → drift report powering explorer badges */
  drift: Record<string, DriftReport>
  /** "database|schema|name" → git worktree VC state, across the whole repo */
  objectStatus: ObjectStatusMap
  busy: string | null
  error: string

  refresh: () => Promise<void>
  loadDrift: (connId: string, db: string) => Promise<void>
  /** recompute drift for every loaded database (after branch operations) */
  refreshDrift: () => Promise<void>
  loadObjectStatus: () => Promise<void>
  openRepo: (path: string) => Promise<void>
  initRepo: (path: string, connId: string, databases: string[]) => Promise<void>
  sync: () => Promise<string>
  commit: (message: string, paths: string[]) => Promise<void>
  discard: (paths: string[]) => Promise<void>
  checkout: (name: string) => Promise<void>
  createBranch: (name: string, switchTo: boolean) => Promise<void>
  merge: (from: string) => Promise<string>
  resolveConflicts: (resolutions: Record<string, string>) => Promise<void>
  abortMerge: () => Promise<void>
}

export const useGit = create<GitState>((set, get) => {
  const wrap = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    set({ busy: label, error: '' })
    try {
      return await fn()
    } catch (err) {
      set({ error: String(err) })
      throw err
    } finally {
      set({ busy: null })
    }
  }

  // Refetches object-status (git-derived M/A/D state). Called from reload()
  // — which already runs after sync/commit/discard/checkout/open/init — and
  // exposed standalone so the explorer can also refresh it when a database
  // node is manually refreshed.
  const reloadObjectStatus = async (): Promise<void> => {
    if (!get().info.open) {
      set({ objectStatus: {} })
      return
    }
    try {
      const res = await gitApi.objectStatus()
      set({ objectStatus: res.objects ?? {} })
    } catch {
      set({ objectStatus: {} })
    }
  }

  const reload = async (): Promise<void> => {
    const info = await gitApi.info()
    if (!info.open) {
      set({ info, changes: [], branches: [], objectStatus: {} })
      return
    }
    const [changes, branches] = await Promise.all([gitApi.changes(), gitApi.branches()])
    set({ info, changes: changes ?? [], branches: branches ?? [] })
    await reloadObjectStatus()
  }

  return {
    info: { open: false },
    changes: [],
    branches: [],
    conflicts: null,
    drift: {},
    objectStatus: {},
    busy: null,
    error: '',

    refresh: () => wrap('refresh', reload),

    // Branch operations swap the baseline files under the drift comparison, so
    // stale reports would show wrong colors (e.g. back on main, the DB is ahead
    // of main — that must appear immediately). Recompute for every database the
    // user had loaded.
    refreshDrift: async () => {
      const keys = Object.keys(get().drift)
      set({ drift: {} })
      await Promise.all(
        keys.map((k) => {
          const [connId, db] = k.split('|')
          return get().loadDrift(connId, db)
        })
      )
    },

    // fire-and-forget from the explorer; scripts the DB server-side, so no spinner
    loadDrift: async (connId, db) => {
      try {
        const report = await gitApi.drift(connId, db)
        set((s) => ({ drift: { ...s.drift, [`${connId}|${db}`]: report ?? {} } }))
      } catch {
        /* repo may not be open or db not tracked — no badges then */
      }
    },

    loadObjectStatus: () => reloadObjectStatus(),

    openRepo: (path) =>
      wrap('open', async () => {
        // the migration flag only comes back on /open; reload() (GET /info)
        // drops it, so carry it onto info after reloading.
        const opened = await gitApi.open(path)
        await reload()
        if (opened.migratedLayout) {
          set((s) => ({ info: { ...s.info, migratedLayout: true } }))
        }
      }),

    initRepo: (path, connId, databases) =>
      wrap('init', async () => {
        await gitApi.init(path, connId, databases)
        await reload()
      }),

    sync: () =>
      wrap('sync', async () => {
        const res = await gitApi.sync()
        set({ drift: {} }) // worktree now matches the DBs — badges must recompute
        await reload()
        let msg = `Synced: ${res.written} written, ${res.deleted} removed`
        if (res.encrypted?.length) msg += `, ${res.encrypted.length} encrypted skipped`
        if (res.warnings?.length) msg += ` — ${res.warnings.join('; ')}`
        return msg
      }),

    commit: (message, paths) =>
      wrap('commit', async () => {
        await gitApi.commit(message, paths)
        await reload()
      }),

    discard: (paths) =>
      wrap('discard', async () => {
        await gitApi.discard(paths)
        await reload()
      }),

    checkout: (name) =>
      wrap('checkout', async () => {
        await gitApi.checkout(name)
        await reload()
        void get().refreshDrift()
      }),

    createBranch: (name, switchTo) =>
      wrap('branch', async () => {
        await gitApi.createBranch(name)
        if (switchTo) await gitApi.checkout(name)
        await reload()
        if (switchTo) void get().refreshDrift()
      }),

    merge: (from) =>
      wrap('merge', async () => {
        const res = await gitApi.merge(from)
        if (res.status === 'conflicts') {
          set({ conflicts: res.conflicts ?? [] })
          return 'conflicts'
        }
        await reload()
        void get().refreshDrift()
        return res.status
      }),

    resolveConflicts: (resolutions) =>
      wrap('resolve', async () => {
        await gitApi.resolve(resolutions)
        set({ conflicts: null })
        await reload()
        void get().refreshDrift()
      }),

    abortMerge: () =>
      wrap('abort', async () => {
        await gitApi.abortMerge()
        set({ conflicts: null })
      })
  }
})
