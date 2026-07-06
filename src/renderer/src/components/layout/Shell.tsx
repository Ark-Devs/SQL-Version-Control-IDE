import { useCallback, useRef, useState } from 'react'
import ObjectExplorer from '../explorer/ObjectExplorer'
import EditorTabs from '../editor/EditorTabs'
import SqlEditor from '../editor/SqlEditor'
import DiffTab from '../editor/DiffTab'
import ResultsPane from '../results/ResultsPane'
import ConnectionDialog from '../connections/ConnectionDialog'
import GitPanel from '../git/GitPanel'
import Toolbar from './Toolbar'
import StatusBar from './StatusBar'
import { useTabs } from '../../state/tabsStore'
import type { Profile } from '../../api/types'

export default function Shell(): React.JSX.Element {
  const { tabs, activeId } = useTabs()
  const activeTab = tabs.find((t) => t.id === activeId)

  const [dialog, setDialog] = useState<{ open: boolean; editing: Profile | null }>({
    open: false,
    editing: null
  })
  const [explorerWidth, setExplorerWidth] = useState(300)
  const [resultsHeight, setResultsHeight] = useState(260)
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'git'>('explorer')

  const dragging = useRef<'explorer' | 'results' | null>(null)

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (dragging.current === 'explorer') {
      setExplorerWidth(Math.max(180, Math.min(600, e.clientX)))
    } else if (dragging.current === 'results') {
      setResultsHeight(Math.max(100, Math.min(window.innerHeight - 220, window.innerHeight - e.clientY - 24)))
    }
  }, [])

  const stopDrag = useCallback(() => {
    dragging.current = null
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', stopDrag)
    document.body.style.cursor = ''
  }, [onMouseMove])

  const startDrag = (what: 'explorer' | 'results') => (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = what
    document.body.style.cursor = what === 'explorer' ? 'col-resize' : 'row-resize'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', stopDrag)
  }

  const showResults = !!activeTab?.execution

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar onManageConnections={() => setDialog({ open: true, editing: null })} />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: explorerWidth, flexShrink: 0, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', borderRight: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
            {(['explorer', 'git'] as const).map((t) => (
              <div
                key={t}
                onClick={() => setSidebarTab(t)}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '6px 0',
                  cursor: 'pointer',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  background: sidebarTab === t ? 'var(--bg-panel)' : 'var(--bg-panel-alt)',
                  color: sidebarTab === t ? 'var(--text-bright)' : 'var(--text-dim)',
                  borderBottom: sidebarTab === t ? '2px solid var(--accent)' : '2px solid transparent'
                }}
              >
                {t === 'explorer' ? 'Explorer' : 'Git'}
              </div>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: sidebarTab === 'explorer' ? 'block' : 'none' }}>
            <ObjectExplorer
              onAddConnection={() => setDialog({ open: true, editing: null })}
              onEditConnection={(p) => setDialog({ open: true, editing: p })}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: sidebarTab === 'git' ? 'block' : 'none' }}>
            <GitPanel />
          </div>
        </div>
        <div onMouseDown={startDrag('explorer')} style={{ width: 4, cursor: 'col-resize', flexShrink: 0, background: 'transparent' }} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <EditorTabs />
          <div style={{ flex: 1, minHeight: 0 }}>
            {activeTab?.kind === 'diff' ? (
              <DiffTab key={activeTab.id} tab={activeTab} />
            ) : activeTab ? (
              <SqlEditor key={activeTab.id} tabId={activeTab.id} content={activeTab.content} />
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-dim)' }}>
                <div style={{ textAlign: 'center' }}>
                  <p>No query open.</p>
                  <button onClick={() => useTabs.getState().openTab()}>New Query (Ctrl+N)</button>
                </div>
              </div>
            )}
          </div>
          {showResults && activeTab?.execution && (
            <>
              <div onMouseDown={startDrag('results')} style={{ height: 4, cursor: 'row-resize', flexShrink: 0 }} />
              <div style={{ height: resultsHeight, flexShrink: 0 }}>
                <ResultsPane
                  snapshot={
                    activeTab.execution.snapshot ?? { done: false, sets: [], messages: [], elapsedMs: 0 }
                  }
                  running={activeTab.execution.running}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <StatusBar />

      {dialog.open && (
        <ConnectionDialog editing={dialog.editing} onClose={() => setDialog({ open: false, editing: null })} />
      )}
    </div>
  )
}
