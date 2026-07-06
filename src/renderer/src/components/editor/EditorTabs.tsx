import { useTabs } from '../../state/tabsStore'

export default function EditorTabs(): React.JSX.Element {
  const { tabs, activeId, setActive, closeTab } = useTabs()

  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--bg-panel-alt)',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
        flexShrink: 0
      }}
    >
      {tabs.map((t) => (
        <div
          key={t.id}
          onClick={() => setActive(t.id)}
          onMouseDown={(e) => {
            if (e.button === 1) closeTab(t.id) // middle-click closes
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            cursor: 'pointer',
            borderRight: '1px solid var(--border)',
            background: t.id === activeId ? 'var(--bg-app)' : 'transparent',
            color: t.id === activeId ? 'var(--text-bright)' : 'var(--text-dim)',
            whiteSpace: 'nowrap',
            fontSize: 12
          }}
          title={t.title}
        >
          <span>
            {t.dirty ? '● ' : ''}
            {t.title}
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
            style={{ opacity: 0.6, padding: '0 2px' }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.opacity = '1')}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.opacity = '0.6')}
          >
            ✕
          </span>
        </div>
      ))}
    </div>
  )
}
