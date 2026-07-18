import { useEffect, useState } from 'react'
import { Check, Download, FolderOpen, GitMerge, RefreshCw, Rocket } from 'lucide-react'
import { useGit } from '../../state/gitStore'
import { useConnections } from '../../state/connectionsStore'
import { useExplorer } from '../../state/explorerStore'
import { useTabs } from '../../state/tabsStore'
import { gitApi, type FileChange } from '../../api/git'
import ContextMenu, { MenuItem } from '../common/ContextMenu'
import HistoryDialog from './HistoryDialog'
import MergeDialog from './MergeDialog'
import RemoteSection from './RemoteSection'
import DeployWizard from '../deploy/DeployWizard'
import ExportDialog from './ExportDialog'

export default function GitPanel(): React.JSX.Element {
  const git = useGit()
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [statusMsg, setStatusMsg] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [historyPath, setHistoryPath] = useState<string | null>(null)
  const [showMerge, setShowMerge] = useState(false)
  const [showDeploy, setShowDeploy] = useState(false)
  const [showExport, setShowExport] = useState(false)

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

  // Baseline (first-time) sync: run the normal sync, then pre-fill the commit
  // message so the user can review and commit the freshly scripted SQL/ tree.
  const runBaselineSync = async (): Promise<void> => {
    try {
      const summary = await git.sync()
      setStatusMsg(summary)
      const server = useGit.getState().info.manifest?.sourceServer
      setMessage(`Baseline sync from ${server || 'database'}`)
    } catch {
      /* stored */
    }
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
        <button
          onClick={() => setShowExport(true)}
          title="Script procs/functions/views into your application project's sql/ folder"
        >
          <Download size={14} /> Export to Code…
        </button>
        {git.error && <div style={{ color: 'var(--error)', fontSize: 12, userSelect: 'text' }}>{git.error}</div>}
        {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      </div>
    )
  }

  const stateColor = { added: 'var(--success)', modified: 'var(--warning)', deleted: 'var(--error)' }
  const stateLetter = { added: 'A', modified: 'M', deleted: 'D' }

  const dbList = git.info.databases ?? git.info.manifest?.databases ?? []
  // Deterministic first-sync: repo open + manifest has databases + no SQL/ folder.
  const firstSync = dbList.length > 0 && git.info.sqlFolderExists === false
  const mono = { fontFamily: 'var(--font-mono)', fontSize: '0.92em' }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {git.info.migratedLayout && (
        <div
          style={{
            margin: '10px 10px 0',
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent-2-muted)',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            fontSize: 11.5,
            color: 'var(--text)',
            lineHeight: 1.5
          }}
        >
          Repository layout was migrated from <span style={mono}>DB/</span> to <span style={mono}>SQL/</span> — review and
          commit the change.
        </div>
      )}

      {firstSync && (
        <div
          style={{
            margin: '10px 10px 0',
            padding: 12,
            borderRadius: 'var(--radius)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--accent-2)',
            boxShadow: '0 0 16px rgba(167, 139, 250, 0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <span
            className="badge"
            style={{
              alignSelf: 'flex-start',
              background: 'var(--accent-2-muted)',
              borderColor: 'rgba(167, 139, 250, 0.35)',
              color: 'var(--accent-2)'
            }}
          >
            FIRST SYNC
          </span>
          <div style={{ fontSize: 12.5, color: 'var(--text-bright)', lineHeight: 1.5 }}>
            This repository has no <span style={mono}>SQL/</span> folder yet. Sync now to script all objects from{' '}
            <span style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{dbList.join(', ')}</span> into{' '}
            <span style={mono}>SQL/</span>?
          </div>
          <button className="primary" disabled={git.busy !== null} onClick={() => void runBaselineSync()}>
            <RefreshCw size={13} className={git.busy === 'sync' ? 'spin' : undefined} />
            {git.busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}

      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', userSelect: 'text' }} title={git.info.path}>
          {(git.info.manifest?.databases ?? []).join(', ')} → {git.info.path?.split(/[\\/]/).slice(-1)[0]}
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
            <RefreshCw size={13} className={git.busy === 'sync' ? 'spin' : undefined} />
            {git.busy === 'sync' ? 'Syncing…' : 'Sync from Database'}
          </button>
          <button className="icon" disabled={git.busy !== null} onClick={() => void git.refresh()} title="Refresh status">
            <RefreshCw size={14} />
          </button>
          <button disabled={git.busy !== null} onClick={() => setShowMerge(true)} title="Merge another branch into the current one">
            <GitMerge size={13} /> Merge…
          </button>
        </div>
        <button
          className="primary"
          disabled={git.busy !== null}
          onClick={() => setShowDeploy(true)}
          title="Deploy a branch's objects to any server (CREATE OR ALTER in a transaction)"
        >
          <Rocket size={13} /> Deploy…
        </button>
        <button
          disabled={git.busy !== null}
          onClick={() => setShowExport(true)}
          title="Script procs/functions/views into your application project's sql/ folder"
        >
          <Download size={13} /> Export to Code…
        </button>
        {statusMsg && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{statusMsg}</div>}
        {git.error && <div style={{ fontSize: 11, color: 'var(--error)', userSelect: 'text' }}>{git.error}</div>}
      </div>

      <div className="section-label" style={{ padding: '8px 10px 4px' }}>
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

      <RemoteSection />

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
          <Check size={14} />
          {git.busy === 'commit' ? 'Committing…' : `Commit ${selected.size} file(s)`}
        </button>
      </div>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {historyPath && <HistoryDialog path={historyPath} onClose={() => setHistoryPath(null)} />}
      {showMerge && <MergeDialog onClose={() => setShowMerge(false)} />}
      {showDeploy && <DeployWizard onClose={() => setShowDeploy(false)} />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  )
}

/**
 * Form to create a system repo from a connection + one or more databases
 * (e.g. HIS = Hospital + Pharmacy + Chan on one server).
 */
function NewRepoForm(): React.JSX.Element {
  const profiles = useConnections((s) => s.profiles)
  const explorer = useExplorer()
  const [connId, setConnId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const databases = connId ? explorer.databases[connId] : undefined
  const system = ['master', 'model', 'msdb', 'tempdb']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--border)', padding: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>New repo from database(s)</div>
      <select
        value={connId}
        onChange={(e) => {
          setConnId(e.target.value)
          setSelected(new Set())
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
      {connId && (
        <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--border)', padding: 4 }}>
          {(databases ?? []).filter((d) => !system.includes(d)).map((d) => (
            <label key={d} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 4px', fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.has(d)}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(d)) next.delete(d)
                    else next.add(d)
                    return next
                  })
                }
              />
              {d}
            </label>
          ))}
          {databases === null && <div style={{ padding: 4, color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>}
        </div>
      )}
      <button
        className="primary"
        disabled={!connId || selected.size === 0}
        title="One repo can track a whole system across several databases"
        onClick={async () => {
          const path = await window.svcide.pickFolder('Choose an empty folder for the repository')
          if (!path) return
          try {
            await useGit.getState().initRepo(path, connId, [...selected])
            await useGit.getState().sync()
          } catch {
            /* error stored in gitStore */
          }
        }}
      >
        Create Repo ({selected.size} database{selected.size === 1 ? '' : 's'})…
      </button>
    </div>
  )
}
