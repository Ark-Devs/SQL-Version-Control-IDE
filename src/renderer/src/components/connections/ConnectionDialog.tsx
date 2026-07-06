import { useEffect, useState } from 'react'
import { connectionsApi } from '../../api/endpoints'
import { useConnections } from '../../state/connectionsStore'
import { useExplorer } from '../../state/explorerStore'
import type { Profile, ProfileDraft, TestResult } from '../../api/types'

interface Props {
  editing: Profile | null
  onClose: () => void
}

const empty: ProfileDraft = {
  name: '',
  server: '',
  authMode: 'windows',
  protocol: '',
  username: '',
  database: '',
  encrypt: true,
  trustServerCertificate: true,
  password: ''
}

export default function ConnectionDialog({ editing, onClose }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<ProfileDraft>(empty)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setDraft(editing ? { ...editing, password: '' } : empty)
    setTestResult(null)
    setError('')
  }, [editing])

  const patch = (p: Partial<ProfileDraft>): void => {
    setDraft((d) => ({ ...d, ...p }))
    setTestResult(null)
  }

  const test = async (): Promise<void> => {
    setBusy('test')
    setTestResult(null)
    try {
      setTestResult(await connectionsApi.test(draft))
    } catch (err) {
      setTestResult({ ok: false, error: String(err) })
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    setBusy('save')
    setError('')
    try {
      await useConnections.getState().save(draft)
      if (draft.id) useExplorer.getState().forgetConnection(draft.id)
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(null)
    }
  }

  const field = (label: string, input: React.ReactNode): React.JSX.Element => (
    <label style={{ display: 'grid', gridTemplateColumns: '130px 1fr', alignItems: 'center', gap: 8 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      {input}
    </label>
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 900
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 460,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.6)'
        }}
      >
        <div
          style={{
            padding: '8px 14px',
            background: 'var(--bg-titlebar)',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between'
          }}
        >
          <span>{editing ? 'Edit Connection' : 'New Connection'}</span>
          <span style={{ cursor: 'pointer' }} onClick={onClose}>
            ✕
          </span>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {field(
            'Name',
            <input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Test Server"
              autoFocus
            />
          )}
          {field(
            'Server',
            <input
              value={draft.server}
              onChange={(e) => patch({ server: e.target.value })}
              placeholder={String.raw`host, host,1433 or host\INSTANCE`}
            />
          )}
          {field(
            'Authentication',
            <select
              value={draft.authMode}
              onChange={(e) => patch({ authMode: e.target.value as 'windows' | 'sql' })}
            >
              <option value="windows">Windows Authentication</option>
              <option value="sql">SQL Server Authentication</option>
            </select>
          )}
          {field(
            'Network protocol',
            <select
              value={draft.protocol ?? ''}
              onChange={(e) => patch({ protocol: e.target.value as '' | 'np' | 'lpc' })}
            >
              <option value="">TCP/IP (default)</option>
              <option value="lpc">Shared Memory (local server)</option>
              <option value="np">Named Pipes</option>
            </select>
          )}
          {draft.authMode === 'sql' && (
            <>
              {field(
                'Login',
                <input value={draft.username ?? ''} onChange={(e) => patch({ username: e.target.value })} />
              )}
              {field(
                'Password',
                <input
                  type="password"
                  value={draft.password ?? ''}
                  onChange={(e) => patch({ password: e.target.value })}
                  placeholder={editing ? '(unchanged)' : ''}
                />
              )}
            </>
          )}
          {field(
            'Default database',
            <input
              value={draft.database ?? ''}
              onChange={(e) => patch({ database: e.target.value })}
              placeholder="(default)"
            />
          )}
          <div style={{ display: 'flex', gap: 18, paddingLeft: 138 }}>
            <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={draft.encrypt}
                onChange={(e) => patch({ encrypt: e.target.checked })}
              />
              Encrypt
            </label>
            <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={draft.trustServerCertificate}
                onChange={(e) => patch({ trustServerCertificate: e.target.checked })}
              />
              Trust server certificate
            </label>
          </div>

          {testResult && (
            <div
              style={{
                padding: 8,
                fontSize: 12,
                border: '1px solid var(--border)',
                color: testResult.ok ? 'var(--success)' : 'var(--error)',
                maxHeight: 90,
                overflow: 'auto',
                userSelect: 'text'
              }}
            >
              {testResult.ok ? `✓ Connected — ${testResult.version?.split('\n')[0]}` : `✗ ${testResult.error}`}
            </div>
          )}
          {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <button onClick={() => void test()} disabled={busy !== null || !draft.server}>
              {busy === 'test' ? 'Testing…' : 'Test Connection'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose}>Cancel</button>
              <button
                className="primary"
                onClick={() => void save()}
                disabled={busy !== null || !draft.name || !draft.server}
              >
                {busy === 'save' ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
