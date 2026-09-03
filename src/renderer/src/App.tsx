import { useEffect, useState } from 'react'
import { get, initApi } from './api/client'
import { gitApi } from './api/git'
import { useConnections } from './state/connectionsStore'
import { useGit } from './state/gitStore'
import { flushSession, restoreSession, startSessionPersistence } from './state/sessionStore'
import { useSettings } from './state/settingsStore'
import { openCompareTab, useTabs } from './state/tabsStore'
import { useUi } from './state/uiStore'
import ErrorBoundary from './components/common/ErrorBoundary'
import Shell from './components/layout/Shell'
import SearchDialog from './components/search/SearchDialog'
import './components/editor/monacoSetup'
import { registerSqlCompletions } from './components/editor/completionProvider'

registerSqlCompletions()

type BackendState = 'connecting' | 'connected' | 'error'

const CHANGELOG_URL = 'https://github.com/Ark-Devs/SQL-Version-Control-IDE/releases'

/** Manual "Check for Updates…" — mirrors UpdateBanner's backend-backed check. */
async function checkForUpdatesManually(): Promise<void> {
  try {
    const appInfo = await window.svcide.getAppInfo()
    if (!appInfo.updateRepo) {
      alert('No update repository is configured for this build.')
      return
    }
    const res = await get<{ available: boolean; version?: string; url?: string }>(
      `/updates/check?repo=${encodeURIComponent(appInfo.updateRepo)}&current=${encodeURIComponent(appInfo.version)}`
    )
    if (res.available && res.version && res.url) {
      if (confirm(`Version ${res.version} is available. Open the download page?`)) window.open(res.url)
    } else {
      alert("You're up to date.")
    }
  } catch (err) {
    alert(`Update check failed: ${err}`)
  }
}

export default function App(): React.JSX.Element {
  const [backend, setBackend] = useState<BackendState>('connecting')
  const [backendError, setBackendError] = useState('')

  useEffect(() => {
    initApi()
      .then(async () => {
        await useConnections.getState().load()
        await useSettings.getState().load().catch(() => undefined)
        // restore first, then start persisting — an empty startup state must
        // never overwrite the saved workspace
        await restoreSession()
        startSessionPersistence()
        setBackend('connected')
      })
      .catch((err) => {
        setBackend('error')
        setBackendError(String(err))
      })
  }, [])

  // The main process asks for one last workspace save before the window closes,
  // and waits for the ack — so a close never loses the final keystrokes.
  useEffect(() => {
    window.svcide.onFlushSession(() => {
      void flushSession().finally(() => window.svcide.sessionFlushed())
    })
  }, [])

  // Subscribe once to commands from the native application menu (src/main/menu.ts).
  // Ctrl+N / Ctrl+Shift+F / F5 etc. are now menu accelerators, not DOM keydown
  // listeners, so there's no double-firing.
  useEffect(() => {
    window.svcide.onMenuCommand((cmd) => {
      const tabsState = useTabs.getState()
      const activeTab = tabsState.tabs.find((t) => t.id === tabsState.activeId)

      switch (cmd) {
        case 'new-query':
          tabsState.openTab()
          break
        case 'close-tab':
          if (tabsState.activeId) tabsState.closeTab(tabsState.activeId)
          break
        case 'execute':
          if (activeTab) void tabsState.run(activeTab.id)
          break
        case 'cancel':
          if (activeTab) void tabsState.cancel(activeTab.id)
          break
        case 'global-search':
          useUi.getState().openSearch({ connId: activeTab?.connId, database: activeTab?.database })
          break
        case 'repo-open':
          void (async () => {
            const path = await window.svcide.pickFolder('Open existing repository folder')
            if (!path) return
            try {
              await useGit.getState().openRepo(path)
            } catch {
              /* error already stored in gitStore */
            }
          })()
          break
        case 'git-sync':
          useGit
            .getState()
            .sync()
            .catch(() => undefined) // error already stored in gitStore
          break
        case 'git-push':
          void gitApi
            .push('origin', '')
            .then(() => useGit.getState().refresh())
            .catch((err) => alert(String(err)))
          break
        case 'git-pull':
          void gitApi
            .pull('origin', '')
            .then(() => useGit.getState().refresh())
            .catch((err) => alert(String(err)))
          break
        case 'git-fetch':
          void gitApi
            .fetch('origin', '')
            .then(() => useGit.getState().refresh())
            .catch((err) => alert(String(err)))
          break
        case 'schema-compare':
          openCompareTab()
          break
        case 'check-updates':
          void checkForUpdatesManually()
          break
        case 'changelog':
          window.open(CHANGELOG_URL)
          break
        // Commands that need a Shell-level dialog or sidebar switch rather than
        // a plain store action — handed off via uiStore, consumed by Shell.tsx.
        case 'connections':
        case 'settings':
        case 'view-explorer':
        case 'view-git':
        case 'git-commit':
        case 'git-history':
          useUi.getState().setMenuRequest(cmd)
          break
        default:
          break
      }
    })
  }, [])

  // Report contextual state to main so it can grey out menu items.
  const menuActiveTab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId))
  const menuRepoOpen = useGit((s) => s.info.open)
  useEffect(() => {
    window.svcide.setMenuState({
      hasTab: !!menuActiveTab,
      running: !!menuActiveTab?.execution?.running,
      repoOpen: menuRepoOpen,
      connected: !!menuActiveTab?.connId
    })
  }, [menuActiveTab, menuRepoOpen])

  if (backend !== 'connected') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ color: 'var(--text-bright)' }}>ArkSQL</h2>
          {backend === 'connecting' ? (
            <p>Starting backend…</p>
          ) : (
            <p style={{ color: 'var(--error)', maxWidth: 500, userSelect: 'text' }}>{backendError}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <Shell />
      <SearchDialog />
    </ErrorBoundary>
  )
}
