import { Database, Server } from 'lucide-react'
import { useConnections } from '../../state/connectionsStore'
import { useTabs } from '../../state/tabsStore'
import BranchBar from '../git/BranchBar'

export default function StatusBar(): React.JSX.Element {
  const { tabs, activeId } = useTabs()
  const profiles = useConnections((s) => s.profiles)
  const activeTab = tabs.find((t) => t.id === activeId)
  const profile = profiles.find((p) => p.id === activeTab?.connId)

  const exec = activeTab?.execution
  const totalRows = exec?.snapshot?.sets?.reduce((n, s) => n + (s.rows?.length ?? 0), 0) ?? 0
  const hasError = !!exec?.snapshot?.done && !!exec.snapshot.messages?.some((m) => m.kind === 'error')

  const item = (content: React.ReactNode): React.JSX.Element => (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        height: '100%',
        borderRight: '1px solid var(--border)'
      }}
    >
      {content}
    </span>
  )

  return (
    <div
      style={{
        height: 26,
        background: 'var(--statusbar)',
        borderTop: '1px solid var(--border)',
        color: 'var(--text-dim)',
        display: 'flex',
        alignItems: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: 0.3,
        flexShrink: 0
      }}
    >
      {item(
        <>
          <span className={`status-dot${exec?.running ? ' busy' : hasError ? ' error' : ''}`} />
          <span style={{ color: exec?.running ? 'var(--warning)' : hasError ? 'var(--error)' : 'var(--success)' }}>
            {exec?.running ? 'Executing…' : hasError ? 'Errors' : 'Ready'}
          </span>
        </>
      )}
      <BranchBar />
      {profile &&
        item(
          <>
            <Server size={11} />
            {profile.name} ({profile.server})
          </>
        )}
      {activeTab?.database &&
        item(
          <>
            <Database size={11} />
            {activeTab.database}
          </>
        )}
      <div style={{ flex: 1 }} />
      {exec?.snapshot && !exec.running && item(<span style={{ color: 'var(--accent)' }}>{totalRows} rows</span>)}
      {exec?.snapshot && item(`${(exec.snapshot.elapsedMs / 1000).toFixed(2)}s`)}
    </div>
  )
}
