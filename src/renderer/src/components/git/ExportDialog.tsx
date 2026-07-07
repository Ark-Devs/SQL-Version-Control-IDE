import { useState } from 'react'
import { exporterApi, type ExportFile, type ExportResult } from '../../api/exporter'
import { useConnections } from '../../state/connectionsStore'
import { useExplorer } from '../../state/explorerStore'

const SYSTEM_DBS = ['master', 'model', 'msdb', 'tempdb']

/**
 * Scripts procs/functions/views from a live database into a `sql/` subfolder of an
 * application project, so the app's own git repo can track SQL like code.
 */
export default function ExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const profiles = useConnections((s) => s.profiles)
  const [folder, setFolder] = useState('')
  const [connId, setConnId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ExportResult | null>(null)
  const [showUnchanged, setShowUnchanged] = useState(false)

  const databases = useExplorer((s) => (connId ? s.databases[connId] : undefined))

  const chooseFolder = async (): Promise<void> => {
    const path = await window.svcide.pickFolder('Choose your application project folder')
    if (path) setFolder(path)
  }

  const chooseConn = (id: string): void => {
    setConnId(id)
    setSelected(new Set())
    setResult(null)
    setError('')
    if (id) void useExplorer.getState().loadDatabases(id)
  }

  const toggleDb = (db: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(db)) next.delete(db)
      else next.add(db)
      return next
    })
  }

  const runExport = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await exporterApi.export(folder, connId, [...selected])
      setResult(res)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const files = result?.files ?? []
  const added = files.filter((f) => f.status === 'added')
  const updated = files.filter((f) => f.status === 'updated')
  const unchanged = files.filter((f) => f.status === 'unchanged')

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 900 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div style={{ width: 560, maxHeight: '80vh', background: 'var(--bg-panel)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 14px', background: 'var(--bg-titlebar)', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
          <span>Export Database → Code</span>
          <span style={{ cursor: 'pointer' }} onClick={() => !busy && onClose()}>
            ✕
          </span>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Tip: choose your application project folder — the files land in a sql/ subfolder and your existing GitHub
            repo tracks the changes.
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input readOnly value={folder} placeholder="(choose a folder)" style={{ flex: 1, fontSize: 12 }} title={folder} />
            <button disabled={busy} onClick={() => void chooseFolder()}>
              Browse…
            </button>
          </div>

          <select value={connId} onChange={(e) => chooseConn(e.target.value)} disabled={busy}>
            <option value="">(choose connection)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {connId && (
            <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--border)', padding: 4 }}>
              {(databases ?? [])
                .filter((d) => !SYSTEM_DBS.includes(d))
                .map((d) => (
                  <label key={d} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 4px', fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.has(d)} onChange={() => toggleDb(d)} disabled={busy} />
                    {d}
                  </label>
                ))}
              {databases === null && <div style={{ padding: 4, color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>}
              {databases === undefined && (
                <div style={{ padding: 4, color: 'var(--text-dim)', fontSize: 12 }}>No databases loaded.</div>
              )}
            </div>
          )}

          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {added.length} added, {updated.length} updated, {unchanged.length} unchanged
              </div>
              <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', padding: 4 }}>
                {added.map((f) => (
                  <FileRow key={f.path} f={f} color="var(--success)" letter="A" />
                ))}
                {updated.map((f) => (
                  <FileRow key={f.path} f={f} color="var(--warning)" letter="M" />
                ))}
                {unchanged.length > 0 && (
                  <div
                    style={{ fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer', padding: '4px 2px', textDecoration: 'underline' }}
                    onClick={() => setShowUnchanged((s) => !s)}
                  >
                    {showUnchanged ? 'Hide unchanged' : `Show unchanged (${unchanged.length})`}
                  </div>
                )}
                {showUnchanged && unchanged.map((f) => <FileRow key={f.path} f={f} color="var(--text-dim)" letter="=" />)}
              </div>
              {(result.skippedEncrypted?.length ?? 0) > 0 && (
                <div style={{ fontSize: 11, color: 'var(--warning)' }}>
                  Skipped (encrypted): {result.skippedEncrypted!.join(', ')}
                </div>
              )}
              {(result.warnings?.length ?? 0) > 0 && (
                <div style={{ fontSize: 11, color: 'var(--warning)' }}>
                  {result.warnings!.map((w, i) => (
                    <div key={i}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <div style={{ fontSize: 12, color: 'var(--error)', userSelect: 'text' }}>{error}</div>}
        </div>

        <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}>
            Close
          </button>
          <button className="primary" disabled={!folder || !connId || selected.size === 0 || busy} onClick={() => void runExport()}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FileRow({ f, color, letter }: { f: ExportFile; color: string; letter: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 4px', fontSize: 12 }}>
      <span style={{ color, width: 12, fontWeight: 700 }}>{letter}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>
        {f.path}
      </span>
    </div>
  )
}
