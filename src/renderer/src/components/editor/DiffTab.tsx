import { DiffEditor } from '@monaco-editor/react'
import type { Tab } from '../../state/tabsStore'

/** Read-only side-by-side diff (Monaco DiffEditor). */
export default function DiffTab({ tab }: { tab: Tab }): React.JSX.Element {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {tab.diffLabels && (
        <div
          style={{
            display: 'flex',
            fontSize: 11,
            color: 'var(--text-dim)',
            background: 'var(--bg-panel-alt)',
            borderBottom: '1px solid var(--border)'
          }}
        >
          <span style={{ flex: 1, padding: '3px 10px' }}>{tab.diffLabels.original}</span>
          <span style={{ flex: 1, padding: '3px 10px' }}>{tab.diffLabels.modified}</span>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditor
          language="sql"
          theme="ssms-dark"
          original={tab.diffOriginal ?? ''}
          modified={tab.content}
          options={{
            readOnly: true,
            renderSideBySide: true,
            fontFamily: 'Consolas, monospace',
            fontSize: 13,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false
          }}
        />
      </div>
    </div>
  )
}
