import { useState } from 'react'
import Modal from '../common/Modal'
import { useSettings } from '../../state/settingsStore'

export default function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { settings, save } = useSettings()
  const [authorName, setAuthorName] = useState(settings.authorName)
  const [mirrorOnExecute, setMirrorOnExecute] = useState(settings.mirrorOnExecute)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const doSave = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await save({ authorName: authorName.trim(), mirrorOnExecute })
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Settings"
      width={420}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy} onClick={() => void doSave()}>
            Save
          </button>
        </>
      }
    >
      <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--text-dim)' }}>Author name</span>
        <input
          autoFocus
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          placeholder="Shown in SP/function headers"
        />
      </label>
      <div className="hint">
        Used for the <code>-- Author:</code> and <code>-- Updated by:</code> lines in object headers.
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <input
          type="checkbox"
          checked={mirrorOnExecute}
          onChange={(e) => setMirrorOnExecute(e.target.checked)}
        />
        <span>Mirror executed changes into repository</span>
      </label>
      <div className="hint">
        When you run CREATE/ALTER/DROP against a tracked database, the repo files update
        automatically.
      </div>
      {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
    </Modal>
  )
}
