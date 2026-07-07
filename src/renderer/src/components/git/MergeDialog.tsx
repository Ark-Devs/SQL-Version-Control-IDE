import { useState } from 'react'
import { GitMerge, X } from 'lucide-react'
import { DiffEditor } from '@monaco-editor/react'
import { useGit } from '../../state/gitStore'

/** Pick a branch to merge; resolve file conflicts by choosing a side. */
export default function MergeDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const git = useGit()
  const [from, setFrom] = useState('')
  const [result, setResult] = useState('')
  const [choices, setChoices] = useState<Record<string, 'ours' | 'theirs'>>({})
  const [preview, setPreview] = useState<string | null>(null)

  const current = git.branches.find((b) => b.current)?.name
  const others = git.branches.filter((b) => !b.current)
  const conflicts = git.conflicts

  const doMerge = async (): Promise<void> => {
    try {
      const status = await git.merge(from)
      if (status !== 'conflicts') {
        setResult(status === 'up-to-date' ? 'Already up to date.' : `Merge complete (${status}).`)
      }
    } catch {
      /* error in store */
    }
  }

  const doResolve = async (): Promise<void> => {
    if (!conflicts) return
    const resolutions: Record<string, string> = {}
    for (const c of conflicts) {
      resolutions[c.path] = choices[c.path] === 'theirs' ? c.theirs : c.ours
    }
    try {
      await git.resolveConflicts(resolutions)
      setResult('Merge complete with resolved conflicts.')
    } catch {
      /* stored */
    }
  }

  const previewConflict = conflicts?.find((c) => c.path === preview)

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !conflicts) onClose()
      }}
    >
      <div
        style={{
          width: preview ? '90vw' : 560,
          maxHeight: '85vh',
          background: 'var(--bg-panel)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-modal)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <GitMerge size={15} /> Merge into {current}
          </span>
          <button className="icon" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
          {!conflicts && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>Merge branch</span>
                <select value={from} onChange={(e) => setFrom(e.target.value)} style={{ flex: 1 }}>
                  <option value="">(choose branch)</option>
                  {others.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <span>into {current}</span>
              </div>
              <button className="primary" disabled={!from || git.busy !== null} onClick={() => void doMerge()}>
                {git.busy === 'merge' ? 'Merging…' : 'Merge'}
              </button>
            </>
          )}

          {conflicts && (
            <>
              <div style={{ color: 'var(--warning)', fontSize: 13 }}>
                Both branches changed these objects. Pick which version to keep:
              </div>
              {conflicts.map((c) => (
                <div key={c.path} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.path}>
                    {c.path}
                  </span>
                  <label style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="radio"
                      name={c.path}
                      checked={(choices[c.path] ?? 'ours') === 'ours'}
                      onChange={() => setChoices((ch) => ({ ...ch, [c.path]: 'ours' }))}
                    />
                    Keep {current}
                  </label>
                  <label style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="radio"
                      name={c.path}
                      checked={choices[c.path] === 'theirs'}
                      onChange={() => setChoices((ch) => ({ ...ch, [c.path]: 'theirs' }))}
                    />
                    Take incoming
                  </label>
                  <button onClick={() => setPreview(preview === c.path ? null : c.path)}>
                    {preview === c.path ? 'Hide' : 'Compare'}
                  </button>
                </div>
              ))}

              {previewConflict && (
                <div style={{ height: '45vh', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', fontSize: 11, color: 'var(--text-dim)', background: 'var(--bg-panel-alt)' }}>
                    <span style={{ flex: 1, padding: '3px 10px' }}>{current} (keep)</span>
                    <span style={{ flex: 1, padding: '3px 10px' }}>incoming (take)</span>
                  </div>
                  <DiffEditor
                    language="sql"
                    theme="ssms-dark"
                    original={previewConflict.ours}
                    modified={previewConflict.theirs}
                    options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, automaticLayout: true }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={async () => {
                    await git.abortMerge()
                    onClose()
                  }}
                >
                  Abort Merge
                </button>
                <button className="primary" disabled={git.busy !== null} onClick={() => void doResolve()}>
                  {git.busy === 'resolve' ? 'Resolving…' : 'Complete Merge'}
                </button>
              </div>
            </>
          )}

          {result && <div style={{ color: 'var(--success)', fontSize: 12 }}>{result}</div>}
          {git.error && <div style={{ color: 'var(--error)', fontSize: 12, userSelect: 'text' }}>{git.error}</div>}
        </div>
      </div>
    </div>
  )
}
