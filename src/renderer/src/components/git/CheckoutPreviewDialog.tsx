import { useEffect, useMemo, useState } from 'react'
import { GitBranch, TriangleAlert } from 'lucide-react'
import type { CompareObject } from '../../api/compare'
import { useGit } from '../../state/gitStore'
import { openCompareTab } from '../../state/tabsStore'
import Modal from '../common/Modal'

// Structural table changes aren't applied through this pipeline — the deploy
// runner only CREATE OR ALTERs procs/views/functions, and an object the branch
// no longer has ("onlyOnTarget") would mean dropping it, which nothing here does.
const isApplyable = (o: CompareObject): boolean =>
  o.type !== 'table' && (o.state === 'missingOnTarget' || o.state === 'different')

/**
 * Shown after a branch switch when the branch differs from the live databases
 * it's bound to. Checkout only ever swaps files; applying to a database is
 * always this separate, explicit, previewed step — never automatic.
 */
export default function CheckoutPreviewDialog(): React.JSX.Element | null {
  const preview = useGit((s) => s.checkoutPreview)
  const busy = useGit((s) => s.busy === 'apply-checkout')
  // `?? []` must not live inside the selector: a fresh array on every call
  // makes useSyncExternalStore see a "changed" snapshot every render and spin
  // forever. Select the possibly-undefined value, default it after.
  const rawSources = useGit((s) => s.info.manifest?.sources)
  const sources = rawSources ?? []
  const [checked, setChecked] = useState<Set<string> | null>(null)

  const aliasLabel = useMemo(() => {
    const m = new Map(sources.map((s) => [s.alias, s.database === s.alias ? s.database : `${s.database} (${s.alias})`]))
    return (alias: string): string => m.get(alias) ?? alias
  }, [sources])

  // A fresh preview (new checkout, or objects dropped after a partial apply)
  // should default back to "everything applyable selected", not carry over a
  // stale selection from whatever was previewed before.
  useEffect(() => setChecked(null), [preview])

  if (!preview) return null

  const applyableObjects = preview.objects.filter(isApplyable)
  // default to "everything applyable" the first time this preview is shown;
  // reset when a fresh preview (different object set) arrives
  const selected = checked ?? new Set(applyableObjects.map((o) => o.path))

  const toggle = (path: string): void => {
    setChecked((prev) => {
      const next = new Set(prev ?? selected)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const grouped = new Map<string, CompareObject[]>()
  for (const o of preview.objects) {
    const list = grouped.get(o.alias) ?? []
    list.push(o)
    grouped.set(o.alias, list)
  }

  return (
    <Modal
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <GitBranch size={15} /> This branch differs from its live databases
        </span>
      }
      width={560}
      locked={busy}
      onClose={() => useGit.getState().dismissCheckoutPreview()}
      footer={
        <>
          <button onClick={() => useGit.getState().dismissCheckoutPreview()} disabled={busy}>
            Not now
          </button>
          <button
            onClick={() => openCompareTab()}
            disabled={busy}
            title="Review full SQL diffs before applying"
          >
            Review in Schema Compare…
          </button>
          <button
            className="primary"
            disabled={busy || selected.size === 0}
            onClick={() => void useGit.getState().applyCheckoutPreview([...selected])}
          >
            {busy ? 'Applying…' : `Apply ${selected.size} to database${selected.size === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>
        Checkout only swapped the repo files. The database{sources.length === 1 ? '' : 's'} this branch is bound to
        {sources.length === 1 ? ' hasn’t' : ' haven’t'} changed — here’s what applying it would do.
      </p>
      {preview.warnings.length > 0 && (
        <div className="hint" style={{ display: 'flex', gap: 6, color: 'var(--warning)', fontSize: 12 }}>
          <TriangleAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{preview.warnings.join('; ')}</span>
        </div>
      )}
      <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
        {[...grouped.entries()].map(([alias, objects]) => (
          <div key={alias}>
            <div
              className="section-label"
              style={{ padding: '5px 10px', background: 'var(--bg-panel-alt)', borderBottom: '1px solid var(--border)' }}
            >
              {aliasLabel(alias)}
            </div>
            {objects.map((o) => {
              const applyable = isApplyable(o)
              return (
                <label
                  key={o.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 10px',
                    fontSize: 12,
                    opacity: applyable ? 1 : 0.5,
                    cursor: applyable ? 'pointer' : 'default'
                  }}
                  title={applyable ? undefined : 'Not applied automatically — review manually in Schema Compare'}
                >
                  <input
                    type="checkbox"
                    disabled={!applyable}
                    checked={applyable && selected.has(o.path)}
                    onChange={() => toggle(o.path)}
                  />
                  <span style={{ color: 'var(--text-dim)', width: 44, fontSize: 10, textTransform: 'uppercase' }}>{o.type}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.schema}.{o.name}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color:
                        o.state === 'missingOnTarget'
                          ? 'var(--success)'
                          : o.state === 'different'
                            ? 'var(--warning)'
                            : 'var(--error)'
                    }}
                  >
                    {o.state === 'missingOnTarget' ? 'new' : o.state === 'different' ? 'changed' : 'only in database'}
                  </span>
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </Modal>
  )
}
