import { useState } from 'react'
import { Check, GitBranch } from 'lucide-react'
import { useGit } from '../../state/gitStore'

/** Branch indicator + switcher that lives in the status bar. */
export default function BranchBar(): React.JSX.Element | null {
  const git = useGit()
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')

  if (!git.info.open) return null
  const current = git.info.branch ?? git.branches.find((b) => b.current)?.name ?? '?'

  return (
    <span style={{ position: 'relative' }}>
      <span
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: '0 10px',
          cursor: 'pointer',
          borderRight: '1px solid var(--border)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          height: '100%',
          color: 'var(--accent-2)'
        }}
        title="Switch branch"
      >
        <GitBranch size={12} /> {current}
      </span>
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: 0,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 -8px 28px rgba(0,0,0,0.6)',
            overflow: 'hidden',
            minWidth: 220,
            zIndex: 1000,
            color: 'var(--text)'
          }}
        >
          <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
            Switch branch
          </div>
          {git.branches.map((b) => (
            <div
              key={b.name}
              onClick={async () => {
                setOpen(false)
                if (!b.current) {
                  try {
                    await git.checkout(b.name)
                  } catch {
                    alert(useGit.getState().error || 'Checkout failed — commit or discard changes first.')
                  }
                }
              }}
              style={{ padding: '4px 12px', cursor: 'pointer', fontWeight: b.current ? 700 : 400 }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-selected)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
            >
              {b.current ? <Check size={12} style={{ marginRight: 4, verticalAlign: -1 }} /> : null}
              {b.name}
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', padding: 8, display: 'flex', gap: 6 }}>
            <input
              placeholder="new branch name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: 1, fontSize: 12 }}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  try {
                    await git.createBranch(newName.trim(), true)
                    setNewName('')
                    setOpen(false)
                  } catch {
                    /* error stored */
                  }
                }
              }}
            />
            <button
              disabled={!newName.trim() || git.busy !== null}
              onClick={async () => {
                try {
                  await git.createBranch(newName.trim(), true)
                  setNewName('')
                  setOpen(false)
                } catch {
                  /* stored */
                }
              }}
            >
              +
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
