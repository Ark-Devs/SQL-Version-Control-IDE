import { useEffect, useMemo, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { ArrowLeftRight, CheckCircle2, Rocket, TriangleAlert, X, XCircle } from 'lucide-react'
import { compareApi, type CompareObject, type CompareState } from '../../api/compare'
import { deployApi, type DeployPlan, type DeployResult } from '../../api/deploy'
import { useConnections } from '../../state/connectionsStore'
import { useGit } from '../../state/gitStore'

/** Per-state color + label. Version-control accent (violet) frames the feature. */
const STATE_META: Record<Exclude<CompareState, 'identical'>, { color: string; label: string }> = {
  missingOnTarget: { color: 'var(--success)', label: 'not on target' },
  different: { color: 'var(--warning)', label: 'different' },
  onlyOnTarget: { color: 'var(--error)', label: 'only on target' }
}

const isDeployable = (o: CompareObject): boolean =>
  o.type !== 'table' && (o.state === 'missingOnTarget' || o.state === 'different')

/**
 * Schema Compare tab: diff the repo (at a ref) against a live target connection,
 * then deploy the objects you select. All state is local to the tab.
 */
export default function CompareTab(): React.JSX.Element {
  const manifestDbs = useGit((s) => s.info.manifest?.databases ?? [])
  const profiles = useConnections((s) => s.profiles)

  const [ref, setRef] = useState('HEAD')
  const [connId, setConnId] = useState('')
  const [dbs, setDbs] = useState<Set<string>>(() => new Set(manifestDbs))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [objects, setObjects] = useState<CompareObject[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [deploying, setDeploying] = useState(false)

  // Manifest databases can arrive after the tab is created; seed the selection
  // once when the list first becomes available. `seeded` starts true when the
  // manifest was already present at mount, so unchecking every database later
  // does not trigger a re-seed.
  const [seeded, setSeeded] = useState(manifestDbs.length > 0)
  if (!seeded && manifestDbs.length > 0) {
    setDbs(new Set(manifestDbs))
    setSeeded(true)
  }

  const targetLabel = useMemo(() => profiles.find((p) => p.id === connId)?.name ?? '', [profiles, connId])

  const drift = useMemo(() => (objects ?? []).filter((o) => o.state !== 'identical'), [objects])
  const identicalCount = (objects ?? []).length - drift.length

  // group non-identical objects by database, preserving encounter order
  const grouped = useMemo(() => {
    const map = new Map<string, CompareObject[]>()
    for (const o of drift) {
      const list = map.get(o.database) ?? []
      list.push(o)
      map.set(o.database, list)
    }
    return [...map.entries()]
  }, [drift])

  const selected = useMemo(() => drift.find((o) => o.path === selectedPath) ?? null, [drift, selectedPath])
  const deployablePaths = useMemo(() => drift.filter(isDeployable).map((o) => o.path), [drift])

  const runCompare = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const res = await compareApi.run(ref.trim() || 'HEAD', connId, [...dbs])
      const objs = res.objects ?? []
      setObjects(objs)
      setWarnings(res.warnings ?? [])
      const deployable = objs.filter((o) => o.state !== 'identical').filter(isDeployable)
      setChecked(new Set(deployable.map((o) => o.path)))
      const firstDrift = objs.find((o) => o.state !== 'identical')
      setSelectedPath(firstDrift?.path ?? null)
    } catch (err) {
      setError(String(err))
      setObjects(null)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (path: string): void =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const label = (dbCount: number): string =>
    `${dbCount} database${dbCount === 1 ? '' : 's'}`

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* control bar */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel-alt)'
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent-2)', fontWeight: 600, fontSize: 13 }}>
          <ArrowLeftRight size={14} /> Schema Compare
        </span>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="section-label">ref</span>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="HEAD"
            title="branch, tag, or commit"
            style={{ width: 150, fontFamily: 'var(--font-mono)' }}
          />
        </label>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>branch, tag, or commit</span>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="section-label">target</span>
          <select value={connId} onChange={(e) => setConnId(e.target.value)}>
            <option value="">(target connection)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {manifestDbs.map((d) => {
            const on = dbs.has(d)
            return (
              <button
                key={d}
                onClick={() =>
                  setDbs((prev) => {
                    const next = new Set(prev)
                    if (next.has(d)) next.delete(d)
                    else next.add(d)
                    return next
                  })
                }
                style={{
                  padding: '2px 9px',
                  fontSize: 11,
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${on ? 'var(--accent-2)' : 'var(--border)'}`,
                  background: on ? 'var(--accent-2-muted)' : 'transparent',
                  color: on ? 'var(--accent-2)' : 'var(--text-dim)'
                }}
                title={on ? 'Included in compare' : 'Excluded from compare'}
              >
                {d}
              </button>
            )
          })}
        </div>

        <button
          className="primary"
          disabled={!connId || dbs.size === 0 || busy}
          onClick={() => void runCompare()}
        >
          {busy ? 'Comparing…' : 'Compare'}
        </button>
        <button
          className="primary"
          disabled={checked.size === 0 || busy}
          title="Deploy the checked objects to the target with CREATE OR ALTER"
          onClick={() => setDeploying(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Rocket size={13} /> Deploy selected ({checked.size})
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', color: 'var(--error)', fontSize: 12, userSelect: 'text' }}>{error}</div>
      )}
      {warnings.length > 0 && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
          {warnings.map((wrn, i) => (
            <div key={i} style={{ color: 'var(--warning)', fontSize: 11 }}>
              <TriangleAlert size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
              {wrn}
            </div>
          ))}
        </div>
      )}

      {/* results split */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 360, borderRight: '1px solid var(--border)', overflow: 'auto', flexShrink: 0 }}>
          {objects === null ? (
            <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 12 }}>
              Pick a target connection and databases, then Compare.
            </div>
          ) : drift.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 12 }}>
              No differences — {label(dbs.size)} match the repo at {ref.trim() || 'HEAD'}.
            </div>
          ) : (
            grouped.map(([database, rows]) => (
              <div key={database}>
                <div className="section-label" style={{ padding: '6px 10px', background: 'var(--bg-panel-alt)', borderBottom: '1px solid var(--border)' }}>
                  {database} ({rows.length})
                </div>
                {rows.map((o) => {
                  const meta = STATE_META[o.state as Exclude<CompareState, 'identical'>]
                  const deployable = isDeployable(o)
                  const active = o.path === selectedPath
                  return (
                    <div
                      key={o.path}
                      onClick={() => setSelectedPath(o.path)}
                      style={{
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                        padding: '3px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                        background: active ? 'var(--bg-selected)' : 'transparent'
                      }}
                    >
                      <input
                        type="checkbox"
                        disabled={!deployable}
                        checked={checked.has(o.path)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(o.path)}
                        title={deployable ? 'Include in deploy' : 'Not deployable (only-on-target or a table)'}
                        style={{ visibility: deployable ? 'visible' : 'hidden' }}
                      />
                      <span style={{ color: 'var(--text-dim)', width: 42, fontSize: 10, textTransform: 'uppercase', flexShrink: 0 }}>
                        {o.type}
                      </span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.schema}.{o.name}
                      </span>
                      <span style={{ color: meta.color, fontSize: 10, flexShrink: 0 }}>{meta.label}</span>
                    </div>
                  )
                })}
              </div>
            ))
          )}
          {identicalCount > 0 && (
            <div style={{ padding: '8px 10px', color: 'var(--text-faint)', fontSize: 11 }}>
              {identicalCount} identical object{identicalCount === 1 ? '' : 's'} hidden.
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {selected ? (
            <>
              <div
                style={{
                  display: 'flex',
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  background: 'var(--bg-panel-alt)',
                  borderBottom: '1px solid var(--border)'
                }}
              >
                <span style={{ flex: 1, padding: '3px 10px' }}>Target (live database)</span>
                <span style={{ flex: 1, padding: '3px 10px' }}>Repo @ {ref.trim() || 'HEAD'}</span>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <DiffEditor
                  language="sql"
                  theme="ssms-dark"
                  original={selected.targetSql ?? ''}
                  modified={selected.repoSql ?? ''}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    fontFamily: 'Consolas, monospace',
                    fontSize: 13,
                    minimap: { enabled: false },
                    automaticLayout: true,
                    scrollBeyondLastLine: false
                  }}
                />
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-dim)' }}>
              Select an object to see the diff
            </div>
          )}
        </div>
      </div>

      {deploying && (
        <DeploySelected
          gitRef={ref.trim() || 'HEAD'}
          connId={connId}
          paths={[...checked].filter((p) => deployablePaths.includes(p))}
          targetLabel={targetLabel}
          onClose={() => setDeploying(false)}
        />
      )}
    </div>
  )
}

/**
 * Compact deploy flow launched from the compare tab: plan the checked paths,
 * show warnings + steps to confirm, execute, then show per-step results.
 * Reuses the existing deploy plan/execute API (tables are excluded server-side).
 */
function DeploySelected({
  gitRef,
  connId,
  paths,
  targetLabel,
  onClose
}: {
  gitRef: string
  connId: string
  paths: string[]
  targetLabel: string
  onClose: () => void
}): React.JSX.Element {
  const [plan, setPlan] = useState<DeployPlan | null>(null)
  const [result, setResult] = useState<DeployResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // build the plan once on open
  useEffect(() => {
    void (async () => {
      setBusy(true)
      try {
        setPlan(await deployApi.plan(gitRef, paths, connId))
      } catch (err) {
        setError(String(err))
      } finally {
        setBusy(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const steps = plan?.steps ?? []

  const execute = async (): Promise<void> => {
    if (!plan) return
    setBusy(true)
    setError('')
    try {
      setResult(await deployApi.execute(plan.id))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        style={{
          width: '70vw',
          maxWidth: 820,
          height: '70vh',
          background: 'var(--bg-panel)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-modal)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Rocket size={15} /> Deploy to {targetLabel || 'target'}
          </span>
          <button className="icon" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {plan?.warnings?.map((wrn, i) => (
            <div key={i} style={{ color: 'var(--warning)', fontSize: 12, padding: '2px 0' }}>
              <TriangleAlert size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
              {wrn}
            </div>
          ))}

          {result ? (
            <div style={{ fontSize: 13, userSelect: 'text' }}>
              <h3 style={{ marginTop: 4, color: result.committed ? 'var(--success)' : 'var(--error)' }}>
                {result.committed
                  ? `Deployed to ${targetLabel} in ${(result.elapsedMs / 1000).toFixed(2)}s`
                  : `Rolled back — ${result.error}`}
              </h3>
              {(result.steps ?? []).map((s) => (
                <div key={s.path} style={{ padding: '3px 0', color: s.ok ? 'var(--text)' : 'var(--error)' }}>
                  {s.ok ? (
                    <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 4, color: 'var(--success)' }} />
                  ) : (
                    <XCircle size={13} style={{ verticalAlign: -2, marginRight: 4, color: 'var(--error)' }} />
                  )}
                  <span style={{ color: 'var(--text-dim)' }}>{s.database}.</span>
                  {s.object}
                  {s.error && (
                    <div style={{ fontSize: 12, paddingLeft: 18, fontFamily: 'var(--font-mono)' }}>{s.error}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              {steps.map((s) => (
                <div key={s.path} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-dim)', width: 42, fontSize: 10, textTransform: 'uppercase' }}>{s.type}</span>
                  <span>
                    <span style={{ color: 'var(--text-dim)' }}>{s.database}.</span>
                    {s.schema}.{s.name}
                  </span>
                </div>
              ))}
              {plan && steps.length === 0 && (
                <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>No deployable objects selected.</div>
              )}
              {!plan && !error && <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Planning…</div>}
            </div>
          )}
        </div>

        <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          {error && <span style={{ color: 'var(--error)', fontSize: 12, flex: 1, userSelect: 'text' }}>{error}</span>}
          {!error && (
            <span style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)' }}>
              {plan && !result
                ? `${steps.length} object(s) — runs per-database in a transaction, rolls back on failure.`
                : ''}
            </span>
          )}
          <button onClick={onClose} disabled={busy}>
            {result ? 'Close' : 'Cancel'}
          </button>
          <button
            className="primary"
            disabled={!plan || steps.length === 0 || busy || !!result}
            onClick={() => void execute()}
          >
            {busy && plan ? 'Deploying…' : `Deploy ${steps.length} object(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
