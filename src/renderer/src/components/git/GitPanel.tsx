import { useEffect, useState } from 'react'
import { useGit } from '../../state/gitStore'
import { useConnections } from '../../state/connectionsStore'
import { useExplorer } from '../../state/explorerStore'
import { useTabs } from '../../state/tabsStore'
import { gitApi, type FileChange } from '../../api/git'
import ContextMenu, { MenuItem } from '../common/ContextMenu'
import HistoryDialog from './HistoryDialog'
import MergeDialog from './MergeDialog'

export default function GitPanel(): React.JSX.Element {
  const git = useGit()
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [statusMsg, setStatusMsg] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [historyPath, setHistoryPath] = useState<string | null>(null)
  const [showMerge, setShowMerge] = useState(false)

  useEffect(() => {
    void git.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep selection in sync with the change list
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(git.changes.map((c) => c.path))
      const next = new Set([...prev].filter((p) => valid.has(p)))
      // select everything by default when list changes
      if (next.size === 0) return valid
      return next
    })
  }, [git.changes])

  const openDiff = async (change: FileChange): Promise<void> => {
    const tabs = useTabs.getState()
    let head = ''
    let working = ''
    try {
      if (change.state !== 'added') head = (await gitApi.file(change.path, 'HEAD')).content
    } catch {
      /* not in HEAD */
    }
    try {
      if (change.state !== 'deleted') working = (await gitApi.file(change.path, 'WORKING')).content
    } catch {
      /* not on disk */
    }
    tabs.openTab({
      title: `diff: ${change.path.split('/').pop()}`,
      kind: 'diff',
      content: working,
      diffOriginal: head,
      diffLabels: { original: 'HEAD (last commit)', modified: 'Working (database)' }
    })
  }

  const toggleSel = (path: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (!git.info.open) {
    return (
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>Version Control</div>
        <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: 12 }}>
          No repository open. Create one from a database, or open an existing repo folder.
        </p>
        <NewRepoForm />
        <button
          onClick={async () => {
            const path = await window.svcide.pickFolder('Open existing repository folder')
            if (path) {
              try {
                await useGit.getState().openRepo(path)
              } catch {
                /* error already stored */
              }
            }
          }}
        >
          Open Existing Repo…
        </button>
        {git.error && <div style={{ color: 'var(--error)', fontSize: 12, userSelect: 'text' }}>{git.error}</div>}
      </div>
    )
  }

  const stateColor = { added: 'var(--success)', modified: 'var(--warning)', deleted: 'var(--error)' }
  const stateLetter = { added: 'A', modified: 'M', deleted: 'D' }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', userSelect: 'text' }} title={git.info.path}>
          {git.info.manifest?.sourceDatabase} → {git.info.path?.split(/[\\/]/).slice(-1)[0]}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ flex: 1 }}
            disabled={git.busy !== null}
            onClick={async () => {
              try {
                setStatusMsg(await git.sync())
              } catch {
                /* stored */
              }
            }}
            title="Script all objects from the source database into the repo working tree"
          >
            {git.busy === 'sync' ? 'Syncing…' : '⟳ Sync from Database'}
          </button>
          <button disabled={git.busy !== null} onClick={() => void git.refresh()} title="Refresh status">
            ↻
          </button>
          <button disabled={git.busy !== null} onClick={() => setShowMerge(true)} title="Merge another branch into the current one">
            ⑃ Merge…
          </button>
        </div>
        {statusMsg && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{statusMsg}</div>}
        {git.error && <div style={{ fontSize: 11, color: 'var(--error)', userSelect: 'text' }}>{git.error}</div>}
      </div>

      <div style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-dim)' }}>
        Changes ({git.changes.length})
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {git.changes.length === 0 && (
          <div style={{ padding: '0 12px', color: 'var(--text-dim)', fontSize: 12 }}>
            No changes — repo matches the last commit.
          </div>
        )}
        {git.changes.map((c) => (
          <div
            key={c.path}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px', cursor: 'pointer', fontSize: 12 }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
            onDoubleClick={() => void openDiff(c)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  { label: 'Show Diff', onClick: () => void openDiff(c) },
                  { label: 'History…', onClick: () => setHistoryPath(c.path) },
                  { separator: true, label: '', onClick: () => undefined },
                  {
                    label: 'Discard Changes',
                    onClick: () => {
                      if (confirm(`Discard changes to ${c.path}?`)) void git.discard([c.path])
                    }
                  }
                ]
              })
            }}
          >
            <input type="checkbox" checked={selected.has(c.path)} onChange={() => toggleSel(c.path)} onClick={(e) => e.stopPropagation()} />
            <span style={{ color: stateColor[c.state], width: 12, fontWeight: 700 }}>{stateLetter[c.state]}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.path}>
              {c.path}
            </span>
          </div>
        ))}
      </div>

      <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          placeholder="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          style={{ resize: 'vertical', fontFamily: 'var(--font-ui)' }}
        />
        <button
          className="primary"
          disabled={git.busy !== null || !message.trim() || selected.size === 0}
          onClick={async () => {
            try {
              await git.commit(message.trim(), [...selected])
              setMessage('')
              setStatusMsg('Committed.')
            } catch {
              /* stored */
            }
          }}
        >
          {git.busy === 'commit' ? 'Committing…' : `✓ Commit ${selected.size} file(s)`}
        </button>
      </div>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {historyPath && <HistoryDialog path={historyPath} onClose={() => setHistoryPath(null)} />}
      {showMerge && <MergeDialog onClose={() => setShowMerge(false)} />}
    </div>
  )
}

/** Form to create a repo from a connection + database. */
function NewRepoForm(): React.JSX.Element {
  const profiles = useConnections((s) => s.profiles)
  const explorer = useExplorer()
  const [connId, setConnId] = useState('')
  const [database, setDatabase] = useState('')
  const databases = connId ? explorer.databases[connId] : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--border)', padding: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>New repo from database</div>
      <select
        value={connId}
        onChange={(e) => {
          setConnId(e.target.value)
          setDatabase('')
          if (e.target.value) void explorer.loadDatabases(e.target.value)
        }}
      >
        <option value="">(choose connection)</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select value={database} onChange={(e) => setDatabase(e.target.value)} disabled={!connId}>
        <option value="">(choose database)</option>
        {(databases ?? []).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <button
        className="primary"
        disabled={!connId || !database}
        onClick={async () => {
          const path = await window.svcide.pickFolder('Choose an empty folder for the repository')
          if (!path) return
          try {
            await useGit.getState().initRepo(path, connId, database)
            await useGit.getState().sync()
          } catch {
            /* error stored in gitStore */
          }
        }}
      >
        Create Repo…
      </button>
    </div>
  )
}
