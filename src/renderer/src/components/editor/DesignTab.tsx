import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { Table2 } from 'lucide-react'
import { explorerApi } from '../../api/endpoints'
import type { ColumnInfo, IndexInfo, TableConstraintInfo, TableDetail } from '../../api/types'
import type { Tab } from '../../state/tabsStore'

interface DesignData {
  columns: ColumnInfo[]
  detail: TableDetail
  indexes: IndexInfo[]
  script: string
}

/** Best-effort match of a DEFAULT constraint to the column it applies to (definition looks like "col = expr"). */
function defaultForColumn(col: string, constraints: TableConstraintInfo[] | null | undefined): string | undefined {
  if (!constraints) return undefined
  const escaped = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^\\[?${escaped}\\]?\\s*=`, 'i')
  return constraints.find((c) => c.kind === 'DEFAULT' && re.test(c.definition.trim()))?.definition
}

/** SSMS "Design" style read-only view of a table: columns, keys, indexes, checks, and the CREATE script. */
export default function DesignTab({ tab }: { tab: Tab }): React.JSX.Element {
  const target = tab.designTarget
  const [data, setData] = useState<DesignData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!target) return
    setData(null)
    setError(null)
    const { connId, database, schema, name } = target
    Promise.all([
      explorerApi.columns(connId, database, schema, name),
      explorerApi.tableDetail(connId, database, schema, name),
      explorerApi.indexes(connId, database, schema, name),
      explorerApi.tableScript(connId, database, schema, name)
    ])
      .then(([columns, detail, indexes, script]) => {
        if (cancelled) return
        setData({
          columns: columns ?? [],
          detail: detail ?? { keys: [], constraints: [], triggers: [] },
          indexes: indexes ?? [],
          script: script.sql
        })
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [target?.connId, target?.database, target?.schema, target?.name])

  if (!target) {
    return <div style={{ padding: 12, color: 'var(--error)' }}>No table selected for design view.</div>
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel-alt)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
      >
        <Table2 size={14} color="#22d3ee" style={{ flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-bright)' }}>
          {target.schema}.{target.name}
        </span>
        <span className="badge">{target.database}</span>
      </div>

      {error ? (
        <div style={{ padding: 12, color: 'var(--error)' }}>Failed to load table design: {error}</div>
      ) : !data ? (
        <div style={{ padding: 12, color: 'var(--text-dim)' }}>Loading…</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: '0 1 55%', minHeight: 0, overflow: 'auto', borderBottom: '1px solid var(--border)' }}>
            <ColumnsGrid columns={data.columns} constraints={data.detail.constraints} />
            <Section title="Keys">
              {(data.detail.keys ?? []).length === 0 ? (
                <EmptyRow />
              ) : (
                (data.detail.keys ?? []).map((k) => (
                  <div key={k.name} style={rowStyle}>
                    <div style={cell}>{k.name}</div>
                    <div style={cell}>{k.kind}</div>
                    <div style={{ ...cell, whiteSpace: 'normal' }}>{k.detail}</div>
                  </div>
                ))
              )}
            </Section>
            <Section title="Indexes">
              {data.indexes.length === 0 ? (
                <EmptyRow />
              ) : (
                data.indexes.map((i) => (
                  <div key={i.name} style={rowStyle}>
                    <div style={cell}>{i.name}</div>
                    <div style={cell}>
                      {i.primary ? 'PK, ' : ''}
                      {i.unique ? 'unique, ' : ''}
                      {i.type}
                    </div>
                    <div style={{ ...cell, whiteSpace: 'normal' }}>{i.columns.join(', ')}</div>
                  </div>
                ))
              )}
            </Section>
            <Section title="Check Constraints">
              {(data.detail.constraints ?? []).filter((c) => c.kind === 'CHECK').length === 0 ? (
                <EmptyRow />
              ) : (
                (data.detail.constraints ?? [])
                  .filter((c) => c.kind === 'CHECK')
                  .map((c) => (
                    <div key={c.name} style={rowStyle}>
                      <div style={cell}>{c.name}</div>
                      <div style={{ ...cell, whiteSpace: 'normal', flex: 2 }}>{c.definition}</div>
                    </div>
                  ))
              )}
            </Section>
          </div>
          <div style={{ flex: '0 1 45%', minHeight: 0 }}>
            <Editor
              language="sql"
              theme="ssms-dark"
              value={data.script}
              options={{
                readOnly: true,
                fontFamily: 'Consolas, monospace',
                fontSize: 13,
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div
        className="section-label"
        style={{
          padding: '5px 10px',
          background: 'var(--bg-panel-alt)',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)'
        }}
      >
        {title}
      </div>
      <div>{children}</div>
    </div>
  )
}

function EmptyRow(): React.JSX.Element {
  return <div style={{ padding: '4px 10px', fontSize: 12, color: 'var(--text-faint)' }}>(none)</div>
}

function ColumnsGrid({
  columns,
  constraints
}: {
  columns: ColumnInfo[]
  constraints: TableConstraintInfo[] | null | undefined
}): React.JSX.Element {
  return (
    <div>
      <div style={rowStyle}>
        <div style={headerCell}>Name</div>
        <div style={headerCell}>Type</div>
        <div style={{ ...headerCell, flex: '0 0 90px', textAlign: 'center' }}>Nullable</div>
        <div style={{ ...headerCell, flex: '0 0 90px', textAlign: 'center' }}>Identity</div>
        <div style={{ ...headerCell, flex: 2 }}>Default</div>
      </div>
      {columns.length === 0 ? (
        <EmptyRow />
      ) : (
        columns.map((c, i) => {
          const def = defaultForColumn(c.name, constraints)
          return (
            <div key={c.name} style={{ ...rowStyle, background: i % 2 ? 'var(--bg-panel)' : 'var(--bg-app)' }}>
              <div style={cell}>{c.name}</div>
              <div style={cell}>{c.type}</div>
              <div style={{ ...cell, flex: '0 0 90px', textAlign: 'center', color: c.nullable ? 'var(--success)' : 'var(--text-dim)' }}>
                {c.nullable ? '✓' : '✗'}
              </div>
              <div style={{ ...cell, flex: '0 0 90px', textAlign: 'center', color: c.identity ? 'var(--success)' : 'var(--text-dim)' }}>
                {c.identity ? '✓' : '✗'}
              </div>
              <div style={{ ...cell, flex: 2, color: def ? 'var(--text)' : 'var(--text-dim)' }}>{def ?? ''}</div>
            </div>
          )
        })
      )}
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid var(--grid-line)'
}

const headerCell: React.CSSProperties = {
  flex: 1,
  padding: '3px 10px',
  fontWeight: 600,
  fontSize: 12,
  background: 'var(--grid-header)',
  borderRight: '1px solid var(--grid-line)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}

const cell: React.CSSProperties = {
  flex: 1,
  padding: '2px 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  borderRight: '1px solid var(--grid-line)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}
