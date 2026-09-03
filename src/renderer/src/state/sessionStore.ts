import { get, put } from '../api/client'
import { useExplorer } from './explorerStore'
import { useGit } from './gitStore'
import { useTabs, type Tab } from './tabsStore'
import { useUi, type Layout } from './uiStore'

/**
 * Workspace session: what the user had open when the app was last closed.
 * Saved to %APPDATA%\SqlVcIde\session.json by the backend (which keeps it
 * opaque — this file owns the shape) and restored on the next launch.
 */

/** Bumped when a change makes older saved sessions unusable; those are dropped. */
const SESSION_VERSION = 1

/** At most one save per interval, always writing the newest state. */
const SAVE_INTERVAL_MS = 700

/** A tab as stored on disk: everything but the live execution handle, which
 *  belongs to a backend process that is gone by the next launch. */
export type PersistedTab = Omit<Tab, 'execution'>

export interface WorkspaceSession {
  version: number
  tabs: PersistedTab[]
  activeId: string | null
  counter: number
  layout: Layout
  /** expanded Object Explorer node keys */
  explorerExpanded: string[]
  /** repository to reopen on launch */
  repoPath?: string
}

let started = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Last repository we know of. Kept even when reopening it failed at launch —
 *  a network share may be back next time, and there is no "close repo" action
 *  whose absence we would be papering over. */
let lastRepoPath: string | undefined

function currentRepoPath(): string | undefined {
  const info = useGit.getState().info
  if (info.open && info.path) lastRepoPath = info.path
  return lastRepoPath
}

function snapshot(): WorkspaceSession {
  const tabs = useTabs.getState()
  return {
    version: SESSION_VERSION,
    tabs: tabs.tabs.map(({ execution: _execution, ...rest }) => rest),
    activeId: tabs.activeId,
    counter: tabs.counter,
    layout: useUi.getState().layout,
    explorerExpanded: [...useExplorer.getState().expanded],
    repoPath: currentRepoPath()
  }
}

async function writeSession(): Promise<void> {
  try {
    await put('/session', snapshot())
  } catch (err) {
    console.warn('workspace session not saved:', err)
  }
}

/** Queue a save. Coalesces bursts (typing, query polling, drag-resizing) into
 *  one write per interval rather than pushing the write ever further out. */
function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void writeSession()
  }, SAVE_INTERVAL_MS)
}

/** Save now — the app is closing. Resolves once the write has landed. */
export async function flushSession(): Promise<void> {
  if (!started) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await writeSession()
}

/** Same rule the explorer uses: drift only makes sense for databases the open
 *  repo actually tracks — untracked ones have no baseline to compare against. */
function isTracked(connId: string, db: string): boolean {
  const info = useGit.getState().info
  return !!info.open && info.manifest?.sourceConnId === connId && !!info.databases?.includes(db)
}

const OBJ_MARKER = '|obj|'

/**
 * Refetch the metadata behind one restored object folder, keyed
 * `<connId>|<db>|obj|<schema>.<name>|<folder>` (see ObjectExplorer).
 */
async function loadObjectFolder(key: string): Promise<void> {
  const at = key.indexOf(OBJ_MARKER)
  if (at < 0) return
  const head = key.slice(0, at)
  const sep = head.indexOf('|')
  if (sep < 0) return
  const connId = head.slice(0, sep)
  const db = head.slice(sep + 1)

  const [qualified, folder] = key.slice(at + OBJ_MARKER.length).split('|')
  const dot = qualified?.indexOf('.') ?? -1
  if (dot < 0) return
  const schema = qualified.slice(0, dot)
  const name = qualified.slice(dot + 1)

  const explorer = useExplorer.getState()
  switch (folder) {
    case 'columns':
      return explorer.loadColumns(connId, db, schema, name)
    case 'indexes':
      return explorer.loadIndexes(connId, db, schema, name)
    case 'keys':
    case 'constraints':
    case 'triggers':
      return explorer.loadDetail(connId, db, schema, name)
    default:
      return
  }
}

/**
 * Refill the explorer caches behind restored expanded nodes — the tree renders
 * from those caches, which start empty, so an expanded node with nothing loaded
 * would just look broken. Outer levels first, since the inner ones only render
 * underneath them. Failures are ignored: a server that is unreachable now
 * behaves exactly as a failed manual expand does.
 */
async function reloadExpanded(keys: string[]): Promise<void> {
  const conns = keys.filter((k) => k.startsWith('conn|')).map((k) => k.slice('conn|'.length))
  await Promise.allSettled(conns.map((id) => useExplorer.getState().loadDatabases(id)))

  const databases = keys
    .map((k) => k.split('|'))
    .filter((parts) => parts.length >= 3 && parts[1] === 'db')
    .map((parts) => ({ connId: parts[0], db: parts.slice(2).join('|') }))
  await Promise.allSettled(
    databases.map(async ({ connId, db }) => {
      const explorer = useExplorer.getState()
      await Promise.all([explorer.loadObjects(connId, db), explorer.loadExtras(connId, db)])
      if (isTracked(connId, db)) void useGit.getState().loadDrift(connId, db)
    })
  )

  await Promise.allSettled(keys.map((k) => loadObjectFolder(k)))
}

/** Everything that needs the backend: reopening the repo, refilling the tree. */
async function rehydrateFromServer(s: WorkspaceSession): Promise<void> {
  if (s.repoPath) {
    try {
      await useGit.getState().openRepo(s.repoPath)
    } catch {
      /* repo moved or deleted since last run — start with none open */
    }
  }
  await reloadExpanded(s.explorerExpanded ?? [])
}

function applySession(s: WorkspaceSession): void {
  lastRepoPath = s.repoPath
  useTabs.getState().hydrate(s.tabs ?? [], s.activeId ?? null, s.counter ?? 0)
  if (s.layout) useUi.getState().setLayout(s.layout)
  useExplorer.getState().setExpandedNodes(s.explorerExpanded ?? [])
  // Server round-trips (repo open, object metadata) run behind the first paint
  // so the restored tabs are usable immediately.
  void rehydrateFromServer(s)
}

/** Load the saved workspace, if any. Never throws — a bad session must not
 *  keep the app from starting. */
export async function restoreSession(): Promise<void> {
  let saved: WorkspaceSession | null = null
  try {
    saved = await get<WorkspaceSession | null>('/session')
  } catch (err) {
    console.warn('workspace session not loaded:', err)
    return
  }
  if (!saved || saved.version !== SESSION_VERSION) return
  try {
    applySession(saved)
  } catch (err) {
    console.warn('workspace session could not be applied:', err)
  }
}

/** Start mirroring workspace changes to disk. Call after restoreSession(), so
 *  an empty startup state never overwrites the saved one. */
export function startSessionPersistence(): void {
  if (started) return
  started = true

  useTabs.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs || s.activeId !== prev.activeId || s.counter !== prev.counter) {
      scheduleSave()
    }
  })
  useUi.subscribe((s, prev) => {
    if (s.layout !== prev.layout) scheduleSave()
  })
  useExplorer.subscribe((s, prev) => {
    if (s.expanded !== prev.expanded) scheduleSave()
  })
  useGit.subscribe((s, prev) => {
    if (s.info.open !== prev.info.open || s.info.path !== prev.info.path) scheduleSave()
  })
}
