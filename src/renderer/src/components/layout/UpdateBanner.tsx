import { useEffect, useState } from 'react'
import { Rocket, X } from 'lucide-react'
import { get } from '../../api/client'

interface UpdateInfo {
  version: string
  url: string
}

/**
 * Slim banner shown when an update is available. Two sources:
 * - the main process's anonymous GitHub check (public repos)
 * - the backend check, which attaches the stored GitHub sign-in token so
 *   private repos work too
 */
export default function UpdateBanner(): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.svcide.onUpdateAvailable((i) => setInfo(i))

    const checkViaBackend = async (): Promise<void> => {
      try {
        const app = await window.svcide.getAppInfo()
        if (!app.updateRepo) return
        const res = await get<{ available: boolean; version?: string; url?: string }>(
          `/updates/check?repo=${encodeURIComponent(app.updateRepo)}&current=${encodeURIComponent(app.version)}`
        )
        if (res.available && res.version && res.url) {
          setInfo({ version: res.version, url: res.url })
        }
      } catch {
        /* backend not ready or offline — the IPC path may still fire */
      }
    }
    // backend needs a moment to be ready on cold start
    const t = setTimeout(() => void checkViaBackend(), 4000)
    const interval = setInterval(() => void checkViaBackend(), 6 * 60 * 60 * 1000)
    return () => {
      clearTimeout(t)
      clearInterval(interval)
    }
  }, [])

  if (!info || dismissed) return null

  return (
    <div
      style={{
        height: 28,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        background: 'var(--accent-muted)',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
        color: 'var(--text)'
      }}
    >
      <Rocket size={14} color="var(--accent)" />
      <span>Version {info.version} is available</span>
      <button className="ghost" onClick={() => window.open(info.url)} style={{ padding: '2px 8px', color: 'var(--accent)' }}>
        Download
      </button>
      <div style={{ flex: 1 }} />
      <button className="icon" onClick={() => setDismissed(true)} title="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}
