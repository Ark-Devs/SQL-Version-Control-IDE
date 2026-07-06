import { useRef } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { monaco } from './monacoSetup'
import { useTabs } from '../../state/tabsStore'

interface Props {
  tabId: string
  content: string
}

/**
 * Monaco editor bound to one tab. F5 / Ctrl+E runs the selection if there is
 * one, otherwise the whole buffer (SSMS behaviour).
 */
export default function SqlEditor({ tabId, content }: Props): React.JSX.Element {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  const runSelectionOrAll = (): void => {
    const ed = editorRef.current
    if (!ed) return
    const sel = ed.getSelection()
    const model = ed.getModel()
    let sql: string | undefined
    if (sel && model && !sel.isEmpty()) {
      sql = model.getValueInRange(sel)
    }
    void useTabs.getState().run(tabId, sql)
  }

  const onMount: OnMount = (ed) => {
    editorRef.current = ed
    ed.addCommand(monaco.KeyCode.F5, runSelectionOrAll)
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, runSelectionOrAll)
  }

  return (
    <Editor
      language="sql"
      theme="ssms-dark"
      value={content}
      onChange={(v) => useTabs.getState().updateContent(tabId, v ?? '')}
      onMount={onMount}
      options={{
        fontFamily: 'Consolas, monospace',
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderWhitespace: 'none',
        wordWrap: 'off',
        tabSize: 4,
        fixedOverflowWidgets: true
      }}
    />
  )
}
