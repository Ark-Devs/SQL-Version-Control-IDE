import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, TriangleAlert } from 'lucide-react'
import Modal from '../common/Modal'
import { searchApi, type SearchHit, type SearchResult } from '../../api/search'
import { explorerApi } from '../../api/endpoints'
import { useConnections } from '../../state/connectionsStore'
import { useExplorer } from '../../state/explorerStore'
import { useTabs } from '../../state/tabsStore'
import { useUi } from '../../state/uiStore'

const typeColor: Record<SearchHit['type'], string> = {
  table: '#6ea1d8',
  view: '#8ec7eb',
  proc: '#d8a45c',
  tvf: '#b18ce0',
  scalar: '#b18ce0',
  trigger: '#e07f7f'
}

/**
 * Global search (Ctrl+Shift+F): object names and T-SQL definitions across
 * all databases on a connection. Mounted unconditionally; renders only while
 * uiStore.searchScope is set.
 */
export default function SearchDialog(): React.JSX.Element | null {
  const scope = useUi((s) => s.searchScope)
  const close = useUi((s) => s.closeSearch)
  const profiles = useConnections((s) => s.profiles)

  const [connId, setConnId] = useState('')
  const [database, setDatabase] = useState('')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const databases = useExplorer((s) => (connId ? s.databases[connId] : undefined))

  // adopt the scope every time the dialog opens
  useEffect(() => {
    if (!scope) return
    const cid = scope.connId ?? useConnections.getState().profiles[0]?.id ?? ''
    setConnId(cid)
    setDatabase(scope.database ?? '')
    setQuery(scope.query ?? '')
    setResult(null)
    setError('')
    if (cid) void useExplorer.getState().loadDatabases(cid)
    setTimeout(() => inputRef.current?.focus(), 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  if (!scope) return null

  const run = async (): Promise<void> => {
    if (!connId || query.trim().length < 2) return
    setBusy(true)
    setError('')
    try {
      setResult(await searchApi.search(connId, query.trim(), database || undefined))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const openHit = async (hit: SearchHit): Promise<void> => {
    const tabs = useTabs.getState()
    if (hit.type === 'table') {
      tabs.openTab({
        title: `${hit.schema}.${hit.name}`,
        connId,
        database: hit.database,
        content: `SELECT TOP (1000) * FROM [${hit.schema}].[${hit.name}]`
      })
    } else {
      try {
        const def = await explorerApi.definition(connId, hit.database, hit.schema, hit.name)
        tabs.openTab({
          title: `${hit.schema}.${hit.name}`,
          connId,
          database: hit.database,
          content: def.encrypted
            ? `-- ${hit.schema}.${hit.name} is encrypted (WITH ENCRYPTION); its source cannot be scripted.`
            : def.definition
        })
      } catch (err) {
        tabs.openTab({
          title: `${hit.schema}.${hit.name}`,
          connId,
          database: hit.database,
          content: `-- Failed to load definition: ${err}`
        })
      }
    }
    close()
  }

  const hits = result?.results ?? []

  return (
    <Modal title="Search" width={720} onClose={close}>
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={connId} onChange={(e) => {
          setConnId(e.target.value)
          setDatabase('')
          if (e.target.value) void useExplorer.getState().loadDatabases(e.target.value)
        }} style={{ width: 160 }}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={database} onChange={(e) => setDatabase(e.target.value)} style={{ width: 150 }}>
          <option value="">All databases</option>
          {(databases ?? []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
          placeholder="Object name or code fragment (min 2 chars)…"
          style={{ flex: 1 }}
        />
        <button className="primary" disabled={busy || !connId || query.trim().length < 2} onClick={() => void run()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
          Search
        </button>
      </div>

      <div style={{ maxHeight: '52vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {busy && !result && <div className="hint">Searching…</div>}
        {result && hits.length === 0 && <div className="hint">No matches.</div>}
        {hits.map((h, i) => (
          <div
            key={`${h.database}.${h.schema}.${h.name}.${i}`}
            onClick={() => void openHit(h)}
            style={{ padding: '5px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                className="badge"
                style={{ color: typeColor[h.type], textTransform: 'uppercase', fontSize: 9.5, minWidth: 44, textAlign: 'center' }}
              >
                {h.type}
              </span>
              <span style={{ fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-dim)' }}>{h.database}.</span>
                <b>{h.schema}.{h.name}</b>
              </span>
              {h.match === 'definition' && <span className="badge">in code</span>}
            </div>
            {h.snippet && (
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  paddingLeft: 52,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={h.snippet}
              >
                {h.snippet}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {result && (
          <span className="hint">
            {hits.length} result{hits.length === 1 ? '' : 's'}
            {result.truncated ? ' (truncated at 200 — refine the query)' : ''}
          </span>
        )}
        {result?.errors?.map((e, i) => (
          <span key={i} className="hint" style={{ color: 'var(--warning)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <TriangleAlert size={12} /> {e}
          </span>
        ))}
        {error && <span style={{ color: 'var(--error)', fontSize: 12 }}>{error}</span>}
        <span className="hint" style={{ marginLeft: 'auto' }}>
          <kbd>Enter</kbd> search · <kbd>Esc</kbd> close
        </span>
      </div>
    </Modal>
  )
}
