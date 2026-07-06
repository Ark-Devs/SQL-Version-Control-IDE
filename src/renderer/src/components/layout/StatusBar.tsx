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

  const item = (text: string): React.JSX.Element => (
    <span style={{ padding: '0 10px', borderRight: '1px solid rgba(255,255,255,0.25)' }}>{text}</span>
  )

  return (
    <div
      style={{
        height: 24,
        background: exec?.running ? '#ca5100' : 'var(--statusbar)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        fontSize: 12,
        flexShrink: 0
      }}
    >
      {item(exec?.running ? 'Executing…' : 'Ready')}
      <BranchBar />
      {profile && item(`${profile.name} (${profile.server})`)}
      {activeTab?.database && item(activeTab.database)}
      <div style={{ flex: 1 }} />
      {exec?.snapshot && !exec.running && item(`${totalRows} rows`)}
      {exec?.snapshot && item(`${(exec.snapshot.elapsedMs / 1000).toFixed(2)}s`)}
    </div>
  )
}
