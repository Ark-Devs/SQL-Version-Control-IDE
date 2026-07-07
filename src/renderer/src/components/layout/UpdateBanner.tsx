import { useEffect, useState } from 'react'
import { Rocket, X } from 'lucide-react'

interface UpdateInfo {
  version: string
  url: string
}

/** Slim banner shown once the main process reports an available update. */
export default function UpdateBanner(): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.svcide.onUpdateAvailable((i) => setInfo(i))
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
