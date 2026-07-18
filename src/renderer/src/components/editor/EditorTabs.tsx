import { useState } from 'react'
import { ArrowLeftRight, FileCode2, GitCompare, Table2, X } from 'lucide-react'
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

function TabIcon({ kind }: { kind: Tab['kind'] }): React.JSX.Element {
  if (kind === 'compare') return <ArrowLeftRight size={13} />
  if (kind === 'diff') return <GitCompare size={13} />
  if (kind === 'design') return <Table2 size={13} />
  return <FileCode2 size={13} />
}

function EditorTab({ t, active }: { t: Tab; active: boolean }): React.JSX.Element {
  const { setActive, closeTab } = useTabs()
  const [hover, setHover] = useState(false)
  const { color, title } = tabColor(t, active)

  return (
    <div
      onClick={() => setActive(t.id)}
      onMouseDown={(e) => {
        if (e.button === 1) closeTab(t.id) // middle-click closes
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 34,
        padding: '0 8px 0 12px',
        cursor: 'pointer',
        borderRight: '1px solid var(--border)',
        background: active ? 'var(--bg-app)' : 'transparent',
        boxShadow: active
          ? 'inset 0 2px 0 var(--accent), inset 0 12px 14px -12px rgba(34, 211, 238, 0.35)'
          : undefined,
        color,
        whiteSpace: 'nowrap',
        fontSize: 12,
        flexShrink: 0,
        transition: 'color 0.12s var(--ease)'
      }}
      title={title}
    >
      <span style={{ display: 'inline-flex', color: active ? 'var(--accent)' : 'var(--text-dim)' }}>
        <TabIcon kind={t.kind} />
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {t.dirty && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'currentColor',
              flexShrink: 0
            }}
          />
        )}
        {t.title}
      </span>
      <span
        onClick={(e) => {
          e.stopPropagation()
          closeTab(t.id)
        }}
        title="Close"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-dim)',
          visibility: active || hover ? 'visible' : 'hidden'
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-active)'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--text-bright)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'
        }}
      >
        <X size={12} />
      </span>
    </div>
  )
}

export default function EditorTabs(): React.JSX.Element {
  const { tabs, activeId } = useTabs()

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
        <EditorTab key={t.id} t={t} active={t.id === activeId} />
      ))}
    </div>
  )
}
