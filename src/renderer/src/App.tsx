import { useEffect, useState } from 'react'
import { initApi } from './api/client'
import { useConnections } from './state/connectionsStore'
import { useSettings } from './state/settingsStore'
import { useTabs } from './state/tabsStore'
import { useUi } from './state/uiStore'
import Shell from './components/layout/Shell'
import SearchDialog from './components/search/SearchDialog'
import './components/editor/monacoSetup'
import { registerSqlCompletions } from './components/editor/completionProvider'

registerSqlCompletions()

type BackendState = 'connecting' | 'connected' | 'error'

export default function App(): React.JSX.Element {
  const [backend, setBackend] = useState<BackendState>('connecting')
  const [backendError, setBackendError] = useState('')

  useEffect(() => {
    initApi()
      .then(async () => {
        await useConnections.getState().load()
        await useSettings.getState().load().catch(() => undefined)
        setBackend('connected')
      })
      .catch((err) => {
        setBackend('error')
        setBackendError(String(err))
      })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        useTabs.getState().openTab()
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        const tab = useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)
        useUi.getState().openSearch({ connId: tab?.connId, database: tab?.database })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (backend !== 'connected') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ color: 'var(--text-bright)' }}>SQL Version Control IDE</h2>
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
    <>
      <Shell />
      <SearchDialog />
    </>
  )
}
