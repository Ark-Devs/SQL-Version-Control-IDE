import { Database, FilePlus2, Play, Plug, Server, Settings, Square } from 'lucide-react'
import { useConnections } from '../../state/connectionsStore'
import { useExplorer } from '../../state/explorerStore'
import { useTabs } from '../../state/tabsStore'

interface Props {
  onManageConnections: () => void
  onOpenSettings: () => void
}

function Separator(): React.JSX.Element {
  return <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px', flexShrink: 0 }} />
}

export default function Toolbar({ onManageConnections, onOpenSettings }: Props): React.JSX.Element {
  const profiles = useConnections((s) => s.profiles)
  const { tabs, activeId } = useTabs()
  const activeTab = tabs.find((t) => t.id === activeId)
  const databases = useExplorer((s) => (activeTab?.connId ? s.databases[activeTab.connId] : undefined))

  const running = !!activeTab?.execution?.running

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 38,
        padding: '0 8px',
        background: 'var(--bg-panel-alt)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0
      }}
    >
      <button className="icon" onClick={() => useTabs.getState().openTab()} title="New query tab (Ctrl+N)">
        <FilePlus2 size={16} />
      </button>

      <Separator />

      <button
        className="primary"
        disabled={!activeTab || !activeTab.connId || running}
        onClick={() => activeTab && void useTabs.getState().run(activeTab.id)}
        title="Execute (F5)"
      >
        <Play size={14} />
        Execute
      </button>
      <button
        className="icon"
        disabled={!running}
        onClick={() => activeTab && void useTabs.getState().cancel(activeTab.id)}
        title="Cancel executing query"
      >
        <Square size={14} />
      </button>

      <Separator />

      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Server size={13} color="var(--text-dim)" />
        <select
          value={activeTab?.connId ?? ''}
          disabled={!activeTab}
          onChange={(e) => {
            if (!activeTab) return
            const p = profiles.find((x) => x.id === e.target.value)
            useTabs.getState().setTabConnection(activeTab.id, p?.id, p?.database)
            if (p) void useExplorer.getState().loadDatabases(p.id)
          }}
          style={{ minWidth: 160 }}
          title="Connection for this tab"
        >
          <option value="">(no connection)</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Database size={13} color="var(--text-dim)" />
        <select
          value={activeTab?.database ?? ''}
          disabled={!activeTab?.connId}
          onChange={(e) =>
            activeTab &&
            useTabs.getState().setTabConnection(activeTab.id, activeTab.connId, e.target.value || undefined)
          }
          style={{ minWidth: 140 }}
          title="Database for this tab"
        >
          <option value="">(default)</option>
          {(databases ?? []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div style={{ flex: 1 }} />
      <button onClick={onManageConnections}>
        <Plug size={14} />
        Connections
      </button>
      <button className="icon" onClick={onOpenSettings} title="Settings (author name)">
        <Settings size={16} />
      </button>
    </div>
  )
}
