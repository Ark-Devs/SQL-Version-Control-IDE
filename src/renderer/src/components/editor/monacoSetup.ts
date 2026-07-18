import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// Bundle monaco locally (no CDN — the app must work offline) and give it a worker.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

loader.config({ monaco })

// Deep-space neon theme: violet keywords, cyan builtins, matches app tokens
monaco.editor.defineTheme('ssms-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword.sql', foreground: 'A78BFA' },
    { token: 'string.sql', foreground: 'F9A8D4' },
    { token: 'comment.sql', foreground: '4C586D', fontStyle: 'italic' },
    { token: 'number.sql', foreground: 'FBBF24' },
    { token: 'operator.sql', foreground: '7E8BA1' },
    { token: 'predefined.sql', foreground: '22D3EE' },
    { token: 'identifier.sql', foreground: 'CBD6E5' },
    { token: 'delimiter.sql', foreground: '7E8BA1' }
  ],
  colors: {
    'editor.background': '#07090e',
    'editor.foreground': '#cbd6e5',
    'editor.lineHighlightBackground': '#0d1118',
    'editorLineNumber.foreground': '#3a4556',
    'editorLineNumber.activeForeground': '#7e8ba1',
    'editor.selectionBackground': '#164e5f',
    'editorCursor.foreground': '#22d3ee',
    'editorIndentGuide.background1': '#141a26',
    'editorIndentGuide.activeBackground1': '#273349',
    'editorWidget.background': '#121724',
    'editorWidget.border': '#273349',
    'editorSuggestWidget.selectedBackground': '#164e5f',
    'list.hoverBackground': '#121a28',
    'scrollbarSlider.background': '#94b7ff24',
    'scrollbarSlider.hoverBackground': '#94b7ff47'
  }
})

export { monaco }
