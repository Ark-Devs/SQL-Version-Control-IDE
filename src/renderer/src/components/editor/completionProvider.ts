import { monaco } from './monacoSetup'
import { get } from '../../api/client'
import { useTabs } from '../../state/tabsStore'

interface AcColumn {
  n: string
  t: string
}
interface AcTable {
  s: string
  n: string
  v?: boolean
  cols: AcColumn[]
}
interface AcProc {
  s: string
  n: string
  params?: AcColumn[]
}
interface AcData {
  tables: AcTable[] | null
  procs: AcProc[] | null
  funcs: AcProc[] | null
}

const cache = new Map<string, AcData>()
const pending = new Map<string, Promise<AcData>>()

async function getData(connId: string, db: string, refresh = false): Promise<AcData> {
  const key = `${connId}|${db}`
  if (!refresh && cache.has(key)) return cache.get(key)!
  if (!refresh && pending.has(key)) return pending.get(key)!
  const p = get<AcData>(
    `/meta/${encodeURIComponent(connId)}/${encodeURIComponent(db)}/autocomplete${refresh ? '?refresh=1' : ''}`
  )
    .then((d) => {
      cache.set(key, d)
      pending.delete(key)
      return d
    })
    .catch((err) => {
      pending.delete(key)
      throw err
    })
  pending.set(key, p)
  return p
}

/** Prefetch schema metadata so completions are instant once the user types. */
export function prefetchAutocomplete(connId: string, db: string): void {
  void getData(connId, db).catch(() => undefined)
}

export function invalidateAutocomplete(connId: string, db: string): void {
  cache.delete(`${connId}|${db}`)
}

const KEYWORDS = (
  'SELECT FROM WHERE GROUP BY HAVING ORDER INNER LEFT RIGHT FULL OUTER JOIN ON AS AND OR NOT NULL ' +
  'INSERT INTO VALUES UPDATE SET DELETE TOP DISTINCT UNION ALL EXISTS IN LIKE BETWEEN IS CASE WHEN ' +
  'THEN ELSE END BEGIN DECLARE EXEC EXECUTE CREATE OR ALTER PROCEDURE FUNCTION VIEW TABLE TRIGGER ' +
  'INDEX DROP TRUNCATE WITH CTE OVER PARTITION ROW_NUMBER COUNT SUM AVG MIN MAX GETDATE CAST CONVERT ' +
  'ISNULL COALESCE NULLIF TRY_CONVERT IIF STRING_AGG OFFSET FETCH NEXT ROWS ONLY WHILE IF RETURN ' +
  'TRANSACTION COMMIT ROLLBACK PRINT RAISERROR THROW MERGE OUTPUT'
).split(' ')

/** The statement chunk before the cursor (from the last GO or semicolon). */
function statementBefore(model: import('monaco-editor').editor.ITextModel, position: import('monaco-editor').Position): string {
  const text = model.getValueInRange({
    startLineNumber: Math.max(1, position.lineNumber - 80),
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  })
  const parts = text.split(/;|^\s*GO\s*$/im)
  return parts[parts.length - 1]
}

/** alias → table map from FROM/JOIN clauses. */
function aliasMap(stmt: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /\b(?:from|join|update|into)\s+(\[?[\w]+\]?(?:\s*\.\s*\[?[\w]+\]?)?)(?:\s+(?:as\s+)?(?!on\b|where\b|inner\b|left\b|right\b|full\b|join\b|group\b|order\b|set\b|values\b)(\w+))?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(stmt))) {
    const table = m[1].replace(/[[\]\s]/g, '')
    if (m[2]) out.set(m[2].toLowerCase(), table)
    const bare = table.split('.').pop()!
    out.set(bare.toLowerCase(), table)
  }
  return out
}

function findTable(data: AcData, ref: string): AcTable | undefined {
  const parts = ref.toLowerCase().split('.')
  const name = parts[parts.length - 1]
  const schema = parts.length > 1 ? parts[parts.length - 2] : undefined
  return (data.tables ?? []).find(
    (t) => t.n.toLowerCase() === name && (!schema || t.s.toLowerCase() === schema)
  )
}

export function registerSqlCompletions(): void {
  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems: async (model, position) => {
      const { tabs, activeId } = useTabs.getState()
      const tab = tabs.find((t) => t.id === activeId)

      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn
      )

      const kw = KEYWORDS.map((k) => ({
        label: k,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: k,
        range,
        sortText: 'z' + k
      }))

      if (!tab?.connId || !tab.database) {
        return { suggestions: kw }
      }

      let data: AcData
      try {
        data = await getData(tab.connId, tab.database)
      } catch {
        return { suggestions: kw }
      }

      const stmt = statementBefore(model, position)
      const lineBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1)

      // alias. or table.  →  column list
      const dotMatch = /(\[?[\w]+\]?)\.\s*(\w*)$/.exec(lineBefore)
      if (dotMatch) {
        const ref = dotMatch[1].replace(/[[\]]/g, '')
        const aliases = aliasMap(stmt)
        const tableRef = aliases.get(ref.toLowerCase()) ?? ref
        const table = findTable(data, tableRef)
        if (table) {
          return {
            suggestions: table.cols.map((c) => ({
              label: { label: c.n, detail: `  ${c.t}` },
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: c.n,
              range,
              sortText: 'a' + c.n
            }))
          }
        }
        // schema. → objects in that schema
        const inSchema = (data.tables ?? []).filter((t) => t.s.toLowerCase() === ref.toLowerCase())
        if (inSchema.length > 0) {
          return {
            suggestions: inSchema.map((t) => ({
              label: t.n,
              kind: t.v
                ? monaco.languages.CompletionItemKind.Interface
                : monaco.languages.CompletionItemKind.Class,
              insertText: `[${t.n}]`,
              range,
              sortText: 'a' + t.n
            }))
          }
        }
        return { suggestions: [] }
      }

      const tail = stmt.toLowerCase()
      const suggestions: import('monaco-editor').languages.CompletionItem[] = []

      // after EXEC → procedures with a parameter snippet
      if (/\bexec(ute)?\s+[\w[\].]*$/.test(tail)) {
        for (const p of data.procs ?? []) {
          const params = (p.params ?? []).map((pp, i) => `${pp.n} = \${${i + 1}:${pp.t}}`).join(', ')
          suggestions.push({
            label: `${p.s}.${p.n}`,
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: `[${p.s}].[${p.n}]${params ? ' ' + params : ''}`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: 'a' + p.n
          })
        }
        return { suggestions }
      }

      // after FROM/JOIN/INTO/UPDATE → tables and views
      const tableContext = /\b(from|join|into|update|delete\s+from)\s+[\w[\].]*$/.test(tail)
      for (const t of data.tables ?? []) {
        suggestions.push({
          label: { label: `${t.s}.${t.n}`, detail: t.v ? '  view' : '  table' },
          kind: t.v
            ? monaco.languages.CompletionItemKind.Interface
            : monaco.languages.CompletionItemKind.Class,
          insertText: t.s === 'dbo' ? `[${t.n}]` : `[${t.s}].[${t.n}]`,
          range,
          sortText: (tableContext ? 'a' : 'm') + t.n
        })
      }
      for (const f of data.funcs ?? []) {
        suggestions.push({
          label: `${f.s}.${f.n}`,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `[${f.s}].[${f.n}]`,
          range,
          sortText: 'n' + f.n
        })
      }
      if (!tableContext) {
        // columns of every table in the current FROM clause
        const aliases = aliasMap(stmt)
        const seen = new Set<string>()
        for (const ref of aliases.values()) {
          const t = findTable(data, ref)
          if (!t || seen.has(`${t.s}.${t.n}`)) continue
          seen.add(`${t.s}.${t.n}`)
          for (const c of t.cols) {
            suggestions.push({
              label: { label: c.n, detail: `  ${c.t} — ${t.n}` },
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: c.n,
              range,
              sortText: 'b' + c.n
            })
          }
        }
        suggestions.push(...kw)
      }
      return { suggestions }
    }
  })
}
