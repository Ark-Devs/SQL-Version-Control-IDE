import type { Tab } from '../../state/tabsStore'
import { useTabs } from '../../state/tabsStore'

/** VS Code-style tab title coloring: errors > dirty > template origin > default. */
function tabColor(t: Tab, active: boolean): { color: string; title: string } {
  const hasError = !!t.execution?.snapshot?.done && !!t.execution.snapshot.messages?.some((m) => m.kind === 'error')
  if (hasError) return { color: 'var(--error)', title: 'Last execution had errors' }
  if (t.dirty) return { color: 'var(--warning)', title: 'Unsaved changes' }
  if (t.origin === 'template') return { color: 'var(--success)', title: 'Created from a new-object template' }
  return { color: active ? 'var(--text-bright)' : 'var(--text-dim)', title: t.title }
}

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
      {tabs.map((t) => {
        const active = t.id === activeId
        const { color, title } = tabColor(t, active)
        return (
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
              background: active ? 'var(--bg-app)' : 'transparent',
              color,
              whiteSpace: 'nowrap',
              fontSize: 12
            }}
            title={title}
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
        )
      })}
    </div>
  )
}
