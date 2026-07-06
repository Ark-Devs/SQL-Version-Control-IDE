import { useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import { deployApi, type DeployPlan, type DeployResult } from '../../api/deploy'
import { useConnections } from '../../state/connectionsStore'
import { useExplorer } from '../../state/explorerStore'
import { useGit } from '../../state/gitStore'

/**
 * Deploy wizard: pick a branch + target, review the planned scripts, execute.
 * Free-form: any branch can go to any saved connection/database.
 */
export default function DeployWizard({ onClose }: { onClose: () => void }): React.JSX.Element {
  const git = useGit()
  const profiles = useConnections((s) => s.profiles)
  const explorer = useExplorer()

  const [ref, setRef] = useState(git.info.branch ?? '')
  const [connId, setConnId] = useState('')
  const [database, setDatabase] = useState('')
  const [plan, setPlan] = useState<DeployPlan | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [result, setResult] = useState<DeployResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const databases = connId ? explorer.databases[connId] : undefined
  const steps = plan?.steps ?? []
  const previewStep = steps.find((s) => s.path === previewPath)

  const targetLabel = useMemo(() => {
    const p = profiles.find((x) => x.id === connId)
    return p ? `${p.name} / ${database}` : ''
  }, [profiles, connId, database])

  const buildPlan = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const pl = await deployApi.plan(ref, [], connId, database)
      setPlan(pl)
      setChecked(new Set((pl.steps ?? []).map((s) => s.path)))
      setPreviewPath(pl.steps?.[0]?.path ?? null)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const execute = async (): Promise<void> => {
    if (!plan) return
    const selectedPaths = [...checked]
    setBusy(true)
    setError('')
    try {
      // re-plan with only the selected objects so the backend executes exactly those
      const finalPlan = await deployApi.plan(plan.ref, selectedPaths, plan.targetConnId, plan.targetDb)
      const res = await deployApi.execute(finalPlan.id)
      setResult(res)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', zIndex: 900 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div style={{ width: '88vw', height: '84vh', background: 'var(--bg-panel)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 14px', background: 'var(--bg-titlebar)', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
          <span>Deploy database objects</span>
          <span style={{ cursor: 'pointer' }} onClick={onClose}>
            ✕
          </span>
        </div>

        {/* source / target row */}
        <div style={{ display: 'flex', gap: 8, padding: 10, alignItems: 'center', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span>Deploy branch</span>
          <select value={ref} onChange={(e) => setRef(e.target.value)}>
            {git.branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
          <span>to</span>
          <select
            value={connId}
            onChange={(e) => {
              setConnId(e.target.value)
              setDatabase('')
              if (e.target.value) void explorer.loadDatabases(e.target.value)
            }}
          >
            <option value="">(target connection)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={database} onChange={(e) => setDatabase(e.target.value)} disabled={!connId}>
            <option value="">(target database)</option>
            {(databases ?? []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button className="primary" disabled={!ref || !connId || !database || busy} onClick={() => void buildPlan()}>
            {busy && !plan ? 'Planning…' : 'Build Plan'}
          </button>
        </div>

        {/* plan review */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ width: 340, borderRight: '1px solid var(--border)', overflow: 'auto', flexShrink: 0 }}>
            {plan?.warnings?.map((wrn, i) => (
              <div key={i} style={{ padding: '4px 10px', color: 'var(--warning)', fontSize: 11 }}>
                ⚠ {wrn}
              </div>
            ))}
            {steps.map((s) => (
              <div
                key={s.path}
                onClick={() => setPreviewPath(s.path)}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  padding: '3px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                  background: previewPath === s.path ? 'var(--bg-selected)' : 'transparent'
                }}
              >
                <input
                  type="checkbox"
                  checked={checked.has(s.path)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() =>
                    setChecked((prev) => {
                      const next = new Set(prev)
                      if (next.has(s.path)) next.delete(s.path)
                      else next.add(s.path)
                      return next
                    })
                  }
                />
                <span style={{ color: 'var(--text-dim)', width: 42, fontSize: 10, textTransform: 'uppercase' }}>{s.type}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.schema}.{s.name}
                </span>
              </div>
            ))}
            {plan && steps.length === 0 && (
              <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 12 }}>No deployable objects at this ref.</div>
            )}
            {!plan && <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 12 }}>Build a plan to see the objects that will be deployed.</div>}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {result ? (
              <div style={{ overflow: 'auto', padding: 12, fontSize: 13, userSelect: 'text' }}>
                <h3 style={{ marginTop: 0, color: result.committed ? 'var(--success)' : 'var(--error)' }}>
                  {result.committed
                    ? `✓ Deployed to ${targetLabel} in ${(result.elapsedMs / 1000).toFixed(2)}s`
                    : `✗ Deployment rolled back — ${result.error}`}
                </h3>
                {(result.steps ?? []).map((s) => (
                  <div key={s.path} style={{ padding: '3px 0', color: s.ok ? 'var(--text)' : 'var(--error)' }}>
                    {s.ok ? '✓' : '✗'} {s.object}
                    {s.error && <div style={{ fontSize: 12, paddingLeft: 18, fontFamily: 'var(--font-mono)' }}>{s.error}</div>}
                  </div>
                ))}
              </div>
            ) : previewStep ? (
              <Editor
                language="sql"
                theme="ssms-dark"
                value={previewStep.sql}
                options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, automaticLayout: true, scrollBeyondLastLine: false }}
              />
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-dim)' }}>Script preview</div>
            )}
          </div>
        </div>

        <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          {error && <span style={{ color: 'var(--error)', fontSize: 12, flex: 1, userSelect: 'text' }}>{error}</span>}
          {!error && <span style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)' }}>{plan ? `${checked.size} of ${steps.length} objects selected — runs in a single transaction, rolls back entirely on failure.` : ''}</span>}
          <button onClick={onClose} disabled={busy}>
            Close
          </button>
          <button className="primary" disabled={!plan || checked.size === 0 || busy || !!result} onClick={() => void execute()}>
            {busy && plan ? 'Deploying…' : `Deploy to ${targetLabel || 'target'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
