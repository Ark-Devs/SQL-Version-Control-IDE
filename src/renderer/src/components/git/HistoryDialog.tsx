import { useEffect, useState } from 'react'
import { gitApi, type LogEntry } from '../../api/git'
import { useTabs } from '../../state/tabsStore'

interface Props {
  path: string
  onClose: () => void
}

/** Commit history of a single object file; click a commit to diff it against the working copy. */
export default function HistoryDialog({ path, onClose }: Props): React.JSX.Element {
  const [entries, setEntries] = useState<LogEntry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    gitApi
      .log(path, 100)
      .then((e) => setEntries(e ?? []))
      .catch((err) => setError(String(err)))
  }, [path])

  const openDiff = async (entry: LogEntry): Promise<void> => {
    try {
      let old = ''
      try {
        old = (await gitApi.file(path, entry.hash)).content
      } catch {
        /* file did not exist at that commit */
      }
      let working = ''
      try {
        working = (await gitApi.file(path, 'WORKING')).content
      } catch {
        /* deleted in working tree */
      }
      useTabs.getState().openTab({
        title: `${path.split('/').pop()} @ ${entry.hash.slice(0, 7)}`,
        kind: 'diff',
        content: working,
        diffOriginal: old,
        diffLabels: {
          original: `${entry.hash.slice(0, 7)} — ${entry.date} (${entry.author})`,
          modified: 'Working copy'
        }
      })
      onClose()
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 900 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={{ width: 640, maxHeight: '70vh', background: 'var(--bg-panel)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 14px', background: 'var(--bg-titlebar)', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
          <span>History — {path}</span>
          <span style={{ cursor: 'pointer' }} onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {error && <div style={{ padding: 12, color: 'var(--error)' }}>{error}</div>}
          {entries === null && !error && <div style={{ padding: 12, color: 'var(--text-dim)' }}>Loading…</div>}
          {entries?.length === 0 && <div style={{ padding: 12, color: 'var(--text-dim)' }}>No commits touch this file.</div>}
          {entries?.map((e) => (
            <div
              key={e.hash}
              onClick={() => void openDiff(e)}
              style={{ padding: '6px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
              onMouseEnter={(ev) => ((ev.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
              onMouseLeave={(ev) => ((ev.currentTarget as HTMLElement).style.background = 'transparent')}
              title="Click to diff this version against the working copy"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{e.message.split('\n')[0]}</span>
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{e.hash.slice(0, 7)}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {e.author} — {e.date}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
