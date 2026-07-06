import { useState } from 'react'
import { useUi } from '../../state/uiStore'
import { useSettings } from '../../state/settingsStore'
import { today } from '../../utils/changelog'

/**
 * Shown before executing CREATE [OR ALTER] on a proc/function/view/trigger.
 * The description lands in the object's SSMS-style header (Author / Create
 * date / Description, plus Update date/by/desc lines on later edits).
 */
export default function ChangelogDialog(): React.JSX.Element | null {
  const request = useUi((s) => s.changelogRequest)
  const answer = useUi((s) => s.answerChangelog)
  const author = useSettings((s) => s.settings.authorName)
  const [desc, setDesc] = useState('')

  if (!request) return null

  const submit = (): void => {
    answer(desc.trim())
    setDesc('')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 950 }}>
      <div style={{ width: 480, background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
        <div style={{ padding: '8px 14px', background: 'var(--bg-titlebar)', fontWeight: 600 }}>
          Log this change{request.objectName ? ` — ${request.objectName}` : ''}
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Recorded in the object header: <b>{author || '(set your name in Settings ⚙)'}</b> — {today()}
          </div>
          <textarea
            autoFocus
            rows={3}
            placeholder="What changed and why? (like a commit message)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey && desc.trim()) submit()
              if (e.key === 'Escape') answer(null)
            }}
            style={{ resize: 'vertical', fontFamily: 'var(--font-ui)' }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => answer(null)} title="Don't execute">
              Cancel
            </button>
            <button onClick={() => answer('')} title="Execute without touching the header">
              Run without logging
            </button>
            <button className="primary" disabled={!desc.trim()} onClick={submit} title="Ctrl+Enter">
              Log &amp; Run
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
