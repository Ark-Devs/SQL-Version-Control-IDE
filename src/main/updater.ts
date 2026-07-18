import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'

export interface UpdateInfo {
  version: string
  url: string
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // every 6 hours while running

/** "1.2.3" vs "1.2.4" → negative when a < b */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function repoSlug(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
    return typeof pkg.updateRepo === 'string' && pkg.updateRepo.includes('/') ? pkg.updateRepo : null
  } catch {
    return null
  }
}

async function fetchLatest(slug: string): Promise<UpdateInfo | null> {
  const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ArkSQL' },
    signal: AbortSignal.timeout(10000)
  })
  if (!res.ok) return null
  const data = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean }
  if (!data.tag_name || data.draft || data.prerelease) return null
  const version = data.tag_name.replace(/^v/i, '')
  if (compareVersions(app.getVersion(), version) >= 0) return null
  return { version, url: data.html_url ?? `https://github.com/${slug}/releases` }
}

/**
 * Periodically checks GitHub Releases for a newer version and notifies every
 * window. Silent on any failure — updates are never worth an error dialog.
 */
export function startUpdateChecker(): void {
  const slug = repoSlug()
  if (!slug) return // no updateRepo configured in package.json

  const check = async (): Promise<void> => {
    try {
      const update = await fetchLatest(slug)
      if (update) {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('update:available', update)
        }
      }
    } catch {
      /* offline / rate-limited — try again next interval */
    }
  }

  setTimeout(() => void check(), 8000) // let the app settle first
  setInterval(() => void check(), CHECK_INTERVAL_MS)
}
