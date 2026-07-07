import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import Modal from '../common/Modal'
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
    <Modal
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <History size={15} /> History — {path.split('/').pop()}
        </span>
      }
      width={640}
      onClose={onClose}
    >
      <div className="hint" style={{ userSelect: 'text' }}>{path}</div>
      <div style={{ maxHeight: '55vh', overflow: 'auto', margin: '0 -16px' }}>
        {error && <div style={{ padding: '4px 16px', color: 'var(--error)' }}>{error}</div>}
        {entries === null && !error && <div className="hint" style={{ padding: '4px 16px' }}>Loading…</div>}
        {entries?.length === 0 && <div className="hint" style={{ padding: '4px 16px' }}>No commits touch this file.</div>}
        {entries?.map((e) => (
          <div
            key={e.hash}
            onClick={() => void openDiff(e)}
            style={{ padding: '7px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
            onMouseEnter={(ev) => ((ev.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
            onMouseLeave={(ev) => ((ev.currentTarget as HTMLElement).style.background = 'transparent')}
            title="Click to diff this version against the working copy"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5 }}>
              <span style={{ fontWeight: 600 }}>{e.message.split('\n')[0]}</span>
              <span className="badge" style={{ fontFamily: 'var(--font-mono)' }}>{e.hash.slice(0, 7)}</span>
            </div>
            <div className="hint">
              {e.author} — {e.date}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
