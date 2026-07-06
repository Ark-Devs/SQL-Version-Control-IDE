import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// Bundle monaco locally (no CDN — the app must work offline) and give it a worker.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

loader.config({ monaco })

// SSMS-flavoured dark theme
monaco.editor.defineTheme('ssms-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword.sql', foreground: '569CD6' },
    { token: 'string.sql', foreground: 'D69D85' },
    { token: 'comment.sql', foreground: '57A64A' },
    { token: 'number.sql', foreground: 'B5CEA8' },
    { token: 'operator.sql', foreground: 'C8C8C8' },
    { token: 'predefined.sql', foreground: 'C586C0' },
    { token: 'identifier.sql', foreground: 'D4D4D4' },
    { token: 'delimiter.sql', foreground: 'DCDCDC' }
  ],
  colors: {
    'editor.background': '#1e1e1e',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#2a2a2a',
    'editorLineNumber.foreground': '#5a5a5a',
    'editorLineNumber.activeForeground': '#c6c6c6',
    'editor.selectionBackground': '#264f78'
  }
})

export { monaco }
