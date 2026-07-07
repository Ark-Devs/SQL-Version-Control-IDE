import { useState } from 'react'
import Modal from '../common/Modal'
import { useSettings } from '../../state/settingsStore'

export default function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { settings, save } = useSettings()
  const [authorName, setAuthorName] = useState(settings.authorName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const doSave = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await save({ authorName: authorName.trim() })
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
      {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
    </Modal>
  )
}
