import { create } from 'zustand'
import { gitApi, type BranchInfo, type FileChange, type MergeConflict, type RepoInfo } from '../api/git'

interface GitState {
  info: RepoInfo
  changes: FileChange[]
  branches: BranchInfo[]
  conflicts: MergeConflict[] | null
  busy: string | null
  error: string

  refresh: () => Promise<void>
  openRepo: (path: string) => Promise<void>
  initRepo: (path: string, connId: string, database: string) => Promise<void>
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

  const reload = async (): Promise<void> => {
    const info = await gitApi.info()
    if (!info.open) {
      set({ info, changes: [], branches: [] })
      return
    }
    const [changes, branches] = await Promise.all([gitApi.changes(), gitApi.branches()])
    set({ info, changes: changes ?? [], branches: branches ?? [] })
  }

  return {
    info: { open: false },
    changes: [],
    branches: [],
    conflicts: null,
    busy: null,
    error: '',

    refresh: () => wrap('refresh', reload),

    openRepo: (path) =>
      wrap('open', async () => {
        await gitApi.open(path)
        await reload()
      }),

    initRepo: (path, connId, database) =>
      wrap('init', async () => {
        await gitApi.init(path, connId, database)
        await reload()
      }),

    sync: () =>
      wrap('sync', async () => {
        const res = await gitApi.sync()
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
      }),

    createBranch: (name, switchTo) =>
      wrap('branch', async () => {
        await gitApi.createBranch(name)
        if (switchTo) await gitApi.checkout(name)
        await reload()
      }),

    merge: (from) =>
      wrap('merge', async () => {
        const res = await gitApi.merge(from)
        if (res.status === 'conflicts') {
          set({ conflicts: res.conflicts ?? [] })
          return 'conflicts'
        }
        await reload()
        return res.status
      }),

    resolveConflicts: (resolutions) =>
      wrap('resolve', async () => {
        await gitApi.resolve(resolutions)
        set({ conflicts: null })
        await reload()
      }),

    abortMerge: () =>
      wrap('abort', async () => {
        await gitApi.abortMerge()
        set({ conflicts: null })
      })
  }
})
