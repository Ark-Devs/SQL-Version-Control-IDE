import { useEffect, useState } from 'react'
import { gitApi } from '../../api/git'
import { useGit } from '../../state/gitStore'

/** Remote (GitHub/Azure DevOps) configuration + push/pull controls. */
export default function RemoteSection(): React.JSX.Element {
  const git = useGit()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!git.info.open) return
    gitApi
      .remotes()
      .then((rs) => {
        const origin = rs?.find((r) => r.name === 'origin')
        if (origin) {
          setUrl(origin.url)
          setSaved(true)
        }
      })
      .catch(() => undefined)
  }, [git.info.open, git.info.path])

  const run = async (label: string, fn: () => Promise<string>): Promise<void> => {
    setBusy(label)
    setMsg('')
    setErr('')
    try {
      setMsg(await fn())
      setToken('')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-dim)', cursor: 'pointer' }}
      >
        {expanded ? '▼' : '▶'} Remote (GitHub / Azure DevOps)
      </div>
      {expanded && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            placeholder="https://github.com/org/repo.git"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setSaved(false)
            }}
            style={{ fontSize: 12 }}
          />
          {!saved && (
            <button
              disabled={!url.trim() || busy !== null}
              onClick={() =>
                void run('save', async () => {
                  await gitApi.setRemote('origin', url.trim())
                  setSaved(true)
                  return 'Remote saved.'
                })
              }
            >
              Save Remote
            </button>
          )}
          <input
            type="password"
            placeholder="Personal Access Token (stored on success)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ fontSize: 12 }}
            title="Needed once per remote; kept in Windows Credential Manager"
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ flex: 1 }}
              disabled={!saved || busy !== null}
              onClick={() =>
                void run('push', async () => {
                  await gitApi.push('origin', token)
                  return 'Pushed current branch.'
                })
              }
            >
              {busy === 'push' ? 'Pushing…' : '↑ Push'}
            </button>
            <button
              style={{ flex: 1 }}
              disabled={!saved || busy !== null}
              onClick={() =>
                void run('pull', async () => {
                  const res = await gitApi.pull('origin', token)
                  await useGit.getState().refresh()
                  if (res.status === 'conflicts') {
                    return 'Pull needs conflict resolution — use Merge dialog.'
                  }
                  return `Pull complete (${res.status}).`
                })
              }
            >
              {busy === 'pull' ? 'Pulling…' : '↓ Pull'}
            </button>
          </div>
          {msg && <div style={{ fontSize: 11, color: 'var(--success)' }}>{msg}</div>}
          {err && <div style={{ fontSize: 11, color: 'var(--error)', userSelect: 'text' }}>{err}</div>}
        </div>
      )}
    </div>
  )
}
