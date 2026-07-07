import { useState } from 'react'
import Modal from '../common/Modal'
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
    <Modal
      title={`Log this change${request.objectName ? ` — ${request.objectName}` : ''}`}
      width={480}
      onClose={() => answer(null)}
      footer={
        <>
          <button onClick={() => answer(null)} title="Don't execute">
            Cancel
          </button>
          <button onClick={() => answer('')} title="Execute without touching the header">
            Run without logging
          </button>
          <button className="primary" disabled={!desc.trim()} onClick={submit} title="Ctrl+Enter">
            Log &amp; Run
          </button>
        </>
      }
    >
      <div className="hint">
        Recorded in the object header: <b style={{ color: 'var(--text)' }}>{author || '(set your name in Settings)'}</b> —{' '}
        {today()}
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
      <div className="hint">
        Tip: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to Log &amp; Run.
      </div>
    </Modal>
  )
}
