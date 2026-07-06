import { get, post } from './client'

export interface RepoInfo {
  open: boolean
  path?: string
  branch?: string
  manifest?: {
    sourceServer: string
    sourceConnId: string
    databases: string[]
    objects: Record<string, { database: string; schema: string; name: string; type: string }>
  }
}

/** "schema.name" → drift status vs the repo */
export type DriftReport = Record<string, 'new' | 'modified'>

export interface FileChange {
  path: string
  state: 'added' | 'modified' | 'deleted'
}

export interface BranchInfo {
  name: string
  current: boolean
}

export interface LogEntry {
  hash: string
  author: string
  email: string
  date: string
  message: string
}

export interface MergeConflict {
  path: string
  base: string
  ours: string
  theirs: string
}

export interface MergeResult {
  status: 'up-to-date' | 'fast-forward' | 'merged' | 'conflicts'
  conflicts?: MergeConflict[]
}

export interface SyncResult {
  written: number
  deleted: number
  warnings: string[] | null
  encrypted: string[] | null
}

const enc = encodeURIComponent

export const gitApi = {
  info: () => get<RepoInfo>('/repo/info'),
  init: (path: string, connId: string, databases: string[]) =>
    post<RepoInfo>('/repo/init', { path, connId, databases }),
  open: (path: string) => post<RepoInfo>('/repo/open', { path }),
  sync: () => post<SyncResult>('/repo/sync', {}),
  drift: (connId: string, db: string) =>
    get<DriftReport>(`/repo/drift/${enc(connId)}/${enc(db)}`),
  changes: () => get<FileChange[] | null>('/repo/changes'),
  commit: (message: string, paths: string[]) =>
    post<{ hash: string }>('/repo/commit', { message, paths }),
  discard: (paths: string[]) => post<{ discarded: boolean }>('/repo/discard', { paths }),
  branches: () => get<BranchInfo[]>('/repo/branches'),
  createBranch: (name: string, from?: string) => post('/repo/branches', { name, from }),
  checkout: (name: string) => post<RepoInfo>('/repo/checkout', { name }),
  merge: (from: string) => post<MergeResult>('/repo/merge', { from }),
  resolve: (resolutions: Record<string, string>) =>
    post<MergeResult>('/repo/merge/resolve', { resolutions }),
  abortMerge: () => post('/repo/merge/abort'),
  log: (path?: string, limit = 50) =>
    get<LogEntry[] | null>(`/repo/log?limit=${limit}${path ? `&path=${enc(path)}` : ''}`),
  file: (path: string, ref: string) =>
    get<{ content: string }>(`/repo/file?path=${enc(path)}&ref=${enc(ref)}`),

  remotes: () => get<{ name: string; url: string }[] | null>('/repo/remotes'),
  setRemote: (name: string, url: string) => post('/repo/remotes', { name, url }),
  push: (remote = 'origin', token = '') => post<{ pushed: boolean }>('/repo/push', { remote, token }),
  fetch: (remote = 'origin', token = '') => post<{ fetched: boolean }>('/repo/fetch', { remote, token }),
  pull: (remote = 'origin', token = '') => post<MergeResult>('/repo/pull', { remote, token })
}
