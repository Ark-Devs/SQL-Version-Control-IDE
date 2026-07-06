import { useState } from 'react'
import { useSettings } from '../../state/settingsStore'

export default function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { settings, save } = useSettings()
  const [authorName, setAuthorName] = useState(settings.authorName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 900 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={{ width: 420, background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
        <div style={{ padding: '8px 14px', background: 'var(--bg-titlebar)', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
          <span>Settings</span>
          <span style={{ cursor: 'pointer' }} onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-dim)' }}>Author name</span>
            <input
              autoFocus
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Shown in SP/function headers"
            />
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Used for the <code>-- Author:</code> and <code>-- Updated by:</code> lines in object headers.
          </div>
          {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose}>Cancel</button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
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
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
