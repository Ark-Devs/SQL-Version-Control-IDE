import { useState } from 'react'
import { Download, FolderOpen, Loader2, TriangleAlert } from 'lucide-react'
import Modal from '../common/Modal'
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
    <Modal
      title="Export Database → Code"
      width={560}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button onClick={onClose} disabled={busy}>
            Close
          </button>
          <button className="primary" disabled={!folder || !connId || selected.size === 0 || busy} onClick={() => void runExport()}>
            {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </>
      }
    >
      <div className="hint">
        Tip: choose your application project folder — the files land in a <b>sql/</b> subfolder and your existing
        GitHub repo tracks the changes.
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input readOnly value={folder} placeholder="(choose a folder)" style={{ flex: 1, fontSize: 12 }} title={folder} />
        <button disabled={busy} onClick={() => void chooseFolder()}>
          <FolderOpen size={14} />
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
        <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 4 }}>
          {(databases ?? [])
            .filter((d) => !SYSTEM_DBS.includes(d))
            .map((d) => (
              <label key={d} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 6px', fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(d)} onChange={() => toggleDb(d)} disabled={busy} />
                {d}
              </label>
            ))}
          {databases === null && <div className="hint" style={{ padding: 4 }}>Loading…</div>}
          {databases === undefined && <div className="hint" style={{ padding: 4 }}>No databases loaded.</div>}
        </div>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
            <span style={{ color: 'var(--success)' }}>{added.length} added</span>,{' '}
            <span style={{ color: 'var(--warning)' }}>{updated.length} updated</span>, {unchanged.length} unchanged
          </div>
          <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 4 }}>
            {added.map((f) => (
              <FileRow key={f.path} f={f} color="var(--success)" letter="A" />
            ))}
            {updated.map((f) => (
              <FileRow key={f.path} f={f} color="var(--warning)" letter="M" />
            ))}
            {unchanged.length > 0 && (
              <button className="ghost" style={{ fontSize: 11.5 }} onClick={() => setShowUnchanged((s) => !s)}>
                {showUnchanged ? 'Hide unchanged' : `Show unchanged (${unchanged.length})`}
              </button>
            )}
            {showUnchanged && unchanged.map((f) => <FileRow key={f.path} f={f} color="var(--text-faint)" letter="=" />)}
          </div>
          {(result.skippedEncrypted?.length ?? 0) > 0 && (
            <div className="hint" style={{ color: 'var(--warning)', display: 'flex', gap: 5, alignItems: 'center' }}>
              <TriangleAlert size={12} /> Skipped (encrypted): {result.skippedEncrypted!.join(', ')}
            </div>
          )}
          {(result.warnings?.length ?? 0) > 0 &&
            result.warnings!.map((w, i) => (
              <div key={i} className="hint" style={{ color: 'var(--warning)', display: 'flex', gap: 5, alignItems: 'center' }}>
                <TriangleAlert size={12} /> {w}
              </div>
            ))}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--error)', userSelect: 'text' }}>{error}</div>}
    </Modal>
  )
}

function FileRow({ f, color, letter }: { f: ExportFile; color: string; letter: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 6px', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
      <span style={{ color, width: 12, fontWeight: 700 }}>{letter}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>
        {f.path}
      </span>
    </div>
  )
}
