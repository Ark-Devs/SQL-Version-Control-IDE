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

  const item = (content: React.ReactNode): React.JSX.Element => (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '0 10px',
        height: '100%',
        borderRight: '1px solid rgba(255,255,255,0.2)'
      }}
    >
      {content}
    </span>
  )

  return (
    <div
      style={{
        height: 24,
        background: exec?.running ? '#b35900' : 'var(--statusbar)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        fontSize: 12,
        flexShrink: 0
      }}
    >
      {item(exec?.running ? 'Executing…' : 'Ready')}
      <BranchBar />
      {profile &&
        item(
          <>
            <Server size={12} />
            {profile.name} ({profile.server})
          </>
        )}
      {activeTab?.database &&
        item(
          <>
            <Database size={12} />
            {activeTab.database}
          </>
        )}
      <div style={{ flex: 1 }} />
      {exec?.snapshot && !exec.running && item(`${totalRows} rows`)}
      {exec?.snapshot && item(`${(exec.snapshot.elapsedMs / 1000).toFixed(2)}s`)}
    </div>
  )
}
