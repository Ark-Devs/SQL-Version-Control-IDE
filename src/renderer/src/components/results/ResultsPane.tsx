import { useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2, TriangleAlert } from 'lucide-react'
import type { QuerySnapshot, ResultSet } from '../../api/types'

interface Props {
  snapshot: QuerySnapshot
  running: boolean
}

export default function ResultsPane({ snapshot, running }: Props): React.JSX.Element {
  const sets = snapshot.sets ?? []
  const messages = snapshot.messages ?? []
  const hasErrors = messages.some((m) => m.kind === 'error')
  const [view, setView] = useState<'results' | 'messages'>('results')
  const [setIdx, setSetIdx] = useState(0)

  // auto-switch to messages when there are no result sets
  const effectiveView = sets.length === 0 ? 'messages' : view
  const activeSet = sets[Math.min(setIdx, sets.length - 1)]

  const tabBtn = (label: React.ReactNode, active: boolean, onClick: () => void): React.JSX.Element => (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '6px 14px',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--text-bright)' : 'var(--text-dim)'
      }}
    >
      {label}
    </div>
  )

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border)'
      }}
    >
      <div style={{ display: 'flex', background: 'var(--bg-panel-alt)', flexShrink: 0, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
        {tabBtn(`Results${sets.length > 1 ? ` (${sets.length})` : ''}`, effectiveView === 'results', () => setView('results'))}
        {tabBtn(
          hasErrors ? (
            <>
              Messages <TriangleAlert size={12} color="var(--error)" />
            </>
          ) : (
            'Messages'
          ),
          effectiveView === 'messages',
          () => setView('messages')
        )}
        {running && (
          <span style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warning)', fontSize: 12 }}>
            <Loader2 size={13} className="spin" />
            Executing…
          </span>
        )}
        <div style={{ flex: 1 }} />
        {sets.length > 1 && effectiveView === 'results' && (
          <select
            value={setIdx}
            onChange={(e) => setSetIdx(Number(e.target.value))}
            style={{ marginRight: 8, padding: '1px 4px', fontSize: 12 }}
          >
            {sets.map((s, i) => (
              <option key={i} value={i}>
                Result {i + 1} ({s.rows?.length ?? 0} rows)
              </option>
            ))}
          </select>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {effectiveView === 'results' && activeSet ? (
          <Grid set={activeSet} />
        ) : effectiveView === 'results' ? (
          <div style={{ padding: 12, color: 'var(--text-dim)' }}>
            {running ? 'Waiting for results…' : 'No result sets.'}
          </div>
        ) : (
          <div style={{ height: '100%', overflow: 'auto', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 12, userSelect: 'text' }}>
            {messages.length === 0 && !snapshot.error && (
              <span style={{ color: 'var(--text-dim)' }}>
                {running ? 'Executing…' : 'Commands completed successfully.'}
              </span>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  color: m.kind === 'error' ? 'var(--error)' : m.kind === 'rowcount' ? 'var(--text-dim)' : 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  marginBottom: 2
                }}
              >
                {m.text}
              </div>
            ))}
            {snapshot.error && <div style={{ color: 'var(--error)' }}>{snapshot.error}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function Grid({ set }: { set: ResultSet }): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const rows = set.rows ?? []
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 20
  })

  const colWidth = 160

  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `50px ${set.columns.map(() => `minmax(${colWidth}px, max-content)`).join(' ')}`,
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: 'var(--grid-header)',
          borderBottom: '1px solid var(--grid-line)',
          width: 'fit-content',
          minWidth: '100%'
        }}
      >
        <div style={headerCell} />
        {set.columns.map((c, i) => (
          <div key={i} style={headerCell} title={c.type}>
            {c.name || '(no name)'}
          </div>
        ))}
      </div>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: 'fit-content', minWidth: '100%' }}>
        {virtualizer.getVirtualItems().map((vr) => {
          const row = rows[vr.index]
          return (
            <div
              key={vr.index}
              style={{
                position: 'absolute',
                top: 0,
                transform: `translateY(${vr.start}px)`,
                display: 'grid',
                gridTemplateColumns: `50px ${set.columns.map(() => `minmax(${colWidth}px, max-content)`).join(' ')}`,
                borderBottom: '1px solid var(--grid-line)',
                background: vr.index % 2 ? 'var(--grid-stripe)' : 'transparent',
                width: '100%'
              }}
            >
              <div style={{ ...cell, color: 'var(--text-faint)', textAlign: 'right' }}>{vr.index + 1}</div>
              {row.map((v, ci) => (
                <div key={ci} style={{ ...cell, color: v === null ? 'var(--text-faint)' : 'var(--text)', fontStyle: v === null ? 'italic' : 'normal' }}>
                  {v === null ? 'NULL' : String(v)}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {set.truncated && (
        <div className="hint" style={{ padding: '6px 8px', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <TriangleAlert size={13} />
          Result truncated at 10,000 rows.
        </div>
      )}
    </div>
  )
}

const headerCell: React.CSSProperties = {
  padding: '4px 8px',
  fontWeight: 600,
  fontSize: 11.5,
  background: 'var(--grid-header)',
  borderRight: '1px solid var(--grid-line)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}

const cell: React.CSSProperties = {
  padding: '2px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  borderRight: '1px solid var(--grid-line)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  userSelect: 'text',
  maxWidth: 400
}
