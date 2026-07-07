import { useEffect, useState } from 'react'
import { gitApi } from '../../api/git'
import { githubApi, type GitHubUser } from '../../api/github'
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

  const [ghUser, setGhUser] = useState<GitHubUser | null>(null)
  const [ghShowInput, setGhShowInput] = useState(false)
  const [ghToken, setGhToken] = useState('')
  const [ghBusy, setGhBusy] = useState(false)
  const [ghMsg, setGhMsg] = useState('')
  const [ghErr, setGhErr] = useState('')

  useEffect(() => {
    if (!git.info.open) return
    githubApi
      .user()
      .then(setGhUser)
      .catch(() => setGhUser({ signedIn: false }))
  }, [git.info.open])

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

  const ghSignIn = (): void => {
    window.open('https://github.com/settings/tokens/new?scopes=repo&description=SQL+VC+IDE')
    setGhShowInput(true)
    setGhMsg('')
    setGhErr('')
  }

  const ghVerify = async (): Promise<void> => {
    setGhBusy(true)
    setGhErr('')
    setGhMsg('')
    try {
      const res = await githubApi.login(ghToken.trim())
      if (res.signedIn) {
        setGhUser(res)
        setGhShowInput(false)
        setGhToken('')
        setGhMsg(`Signed in as @${res.login}.`)
      } else {
        setGhErr('Sign-in failed.')
      }
    } catch (e) {
      setGhErr(String(e))
    } finally {
      setGhBusy(false)
    }
  }

  const ghSignOut = async (): Promise<void> => {
    setGhBusy(true)
    setGhErr('')
    setGhMsg('')
    try {
      await githubApi.logout()
      setGhUser({ signedIn: false })
    } catch (e) {
      setGhErr(String(e))
    } finally {
      setGhBusy(false)
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
          <div style={{ border: '1px solid var(--border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              GitHub Account
            </div>
            {ghUser?.signedIn ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span>GitHub: @{ghUser.login}</span>
                <span
                  style={{ color: 'var(--text-dim)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => void ghSignOut()}
                >
                  Sign out
                </span>
              </div>
            ) : (
              <>
                <button disabled={ghBusy} onClick={ghSignIn}>
                  Sign in with GitHub
                </button>
                {ghShowInput && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      Paste the token generated in the browser tab that just opened:
                    </div>
                    <input
                      type="password"
                      placeholder="ghp_…"
                      value={ghToken}
                      onChange={(e) => setGhToken(e.target.value)}
                      style={{ fontSize: 12 }}
                    />
                    <button disabled={!ghToken.trim() || ghBusy} onClick={() => void ghVerify()}>
                      {ghBusy ? 'Verifying…' : 'Verify'}
                    </button>
                  </div>
                )}
              </>
            )}
            {ghMsg && <div style={{ fontSize: 11, color: 'var(--success)' }}>{ghMsg}</div>}
            {ghErr && <div style={{ fontSize: 11, color: 'var(--error)', userSelect: 'text' }}>{ghErr}</div>}
          </div>

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
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {ghUser?.signedIn
              ? 'Signed in to GitHub — pushes/pulls to github.com use your GitHub sign-in automatically, no PAT needed.'
              : 'PAT (Azure DevOps / other hosts) — needed once per remote; kept in Windows Credential Manager.'}
          </div>
          <input
            type="password"
            placeholder="PAT (Azure DevOps / other hosts)"
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
