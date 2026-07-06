import { useState } from 'react'
import { useConnections } from '../../state/connectionsStore'
import { useExplorer } from '../../state/explorerStore'
import { useGit } from '../../state/gitStore'
import { useTabs } from '../../state/tabsStore'
import { explorerApi } from '../../api/endpoints'
import type { ObjectInfo, ObjectType, Profile } from '../../api/types'
import ContextMenu, { MenuItem } from '../common/ContextMenu'
import NewObjectDialog, { NewObjectTarget } from './NewObjectDialog'
import { Icons } from './icons'

interface Props {
  onAddConnection: () => void
  onEditConnection: (p: Profile) => void
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

const OBJECT_FOLDERS: { label: string; type: ObjectType }[] = [
  { label: 'Tables', type: 'table' },
  { label: 'Views', type: 'view' },
  { label: 'Stored Procedures', type: 'proc' },
  { label: 'Table-valued Functions', type: 'tvf' },
  { label: 'Scalar Functions', type: 'scalar' }
]

export default function ObjectExplorer({ onAddConnection, onEditConnection }: Props): React.JSX.Element {
  const profiles = useConnections((s) => s.profiles)
  const explorer = useExplorer()
  const drift = useGit((s) => s.drift)
  const repoOpen = useGit((s) => s.info.open)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [loadErr, setLoadErr] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('')
  const [newObject, setNewObject] = useState<NewObjectTarget | null>(null)

  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const expand = async (key: string, loader?: () => Promise<void>): Promise<void> => {
    if (!expanded.has(key) && loader) {
      try {
        await loader()
        setLoadErr((e) => ({ ...e, [key]: '' }))
      } catch (err) {
        setLoadErr((e) => ({ ...e, [key]: String(err) }))
      }
    }
    toggle(key)
  }

  const openDefinition = async (connId: string, db: string, obj: ObjectInfo): Promise<void> => {
    const tabs = useTabs.getState()
    try {
      const def = await explorerApi.definition(connId, db, obj.schema, obj.name)
      tabs.openTab({
        title: `${obj.schema}.${obj.name}`,
        connId,
        database: db,
        content: def.encrypted
          ? `-- ${obj.schema}.${obj.name} is encrypted (WITH ENCRYPTION); its source cannot be scripted.`
          : def.definition
      })
    } catch (err) {
      tabs.openTab({ title: `${obj.schema}.${obj.name}`, connId, database: db, content: `-- Failed to load definition: ${err}` })
    }
  }

  const selectTop1000 = (connId: string, db: string, obj: ObjectInfo): void => {
    const sql = `SELECT TOP (1000) * FROM [${obj.schema}].[${obj.name}]`
    const id = useTabs.getState().openTab({ title: `${obj.schema}.${obj.name}`, connId, database: db, content: sql })
    void useTabs.getState().run(id)
  }

  const row = (
    key: string,
    depth: number,
    icon: React.ReactNode,
    label: React.ReactNode,
    opts: {
      expandable?: boolean
      onExpand?: () => void
      onDoubleClick?: () => void
      onContextMenu?: (e: React.MouseEvent) => void
      dim?: boolean
    } = {}
  ): React.JSX.Element => (
    <div
      key={key}
      onClick={opts.expandable ? opts.onExpand : undefined}
      onDoubleClick={opts.onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault()
        opts.onContextMenu?.(e)
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '2px 4px',
        paddingLeft: 6 + depth * 14,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        color: opts.dim ? 'var(--text-dim)' : 'var(--text)',
        fontSize: 12.5
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      <span style={{ width: 12, display: 'inline-block', fontSize: 9, color: 'var(--text-dim)' }}>
        {opts.expandable ? (expanded.has(key) ? '▼' : '▶') : ''}
      </span>
      {icon}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  )

  const newObjectItems = (connId: string, db: string): MenuItem[] => [
    { label: 'New Stored Procedure…', onClick: () => setNewObject({ connId, database: db, kind: 'proc' }) },
    { label: 'New Scalar Function…', onClick: () => setNewObject({ connId, database: db, kind: 'scalar' }) },
    { label: 'New Table-valued Function…', onClick: () => setNewObject({ connId, database: db, kind: 'tvf' }) },
    { label: 'New View…', onClick: () => setNewObject({ connId, database: db, kind: 'view' }) }
  ]

  const renderObjects = (connId: string, db: string, depth: number): React.JSX.Element[] => {
    const objs = explorer.objects[`${connId}|${db}`]
    if (objs === null) return [row(`${connId}|${db}|loading`, depth, null, 'Loading…', { dim: true })]
    if (!objs) return []
    const dbDrift = drift[`${connId}|${db}`] ?? {}
    const f = filter.trim().toLowerCase()

    return OBJECT_FOLDERS.map((folder) => {
      const folderKey = `${connId}|${db}|folder|${folder.type}`
      let items = objs.filter((o) => o.type === folder.type)
      if (f) items = items.filter((o) => `${o.schema}.${o.name}`.toLowerCase().includes(f))
      if (f && items.length === 0) return <div key={folderKey} />
      const children: React.JSX.Element[] = []
      if (expanded.has(folderKey) || f) {
        for (const obj of items) {
          const objKey = `${connId}|${db}|obj|${obj.schema}.${obj.name}`
          const isTable = folder.type === 'table' || folder.type === 'view'
          const status = dbDrift[`${obj.schema}.${obj.name}`]
          children.push(
            row(
              objKey,
              depth + 1,
              Icons[obj.type as keyof typeof Icons] ?? Icons.table,
              status ? (
                <span style={{ color: status === 'new' ? 'var(--success)' : 'var(--warning)' }} title={status === 'new' ? 'New — not in the repo baseline' : 'Modified since the repo baseline'}>
                  {obj.schema}.{obj.name} {status === 'new' ? '●' : '●'}
                </span>
              ) : (
                `${obj.schema}.${obj.name}`
              ),
              {
                expandable: isTable,
                onExpand: () =>
                  void expand(objKey, () => explorer.loadColumns(connId, db, obj.schema, obj.name)),
                onDoubleClick:
                  folder.type === 'table' || folder.type === 'view'
                    ? () => selectTop1000(connId, db, obj)
                    : () => void openDefinition(connId, db, obj),
                onContextMenu: (e) => {
                  const items: MenuItem[] = []
                  if (folder.type === 'table' || folder.type === 'view') {
                    items.push({ label: 'Select Top 1000 Rows', onClick: () => selectTop1000(connId, db, obj) })
                  }
                  if (folder.type !== 'table') {
                    items.push({ label: 'Script as CREATE OR ALTER', onClick: () => void openDefinition(connId, db, obj) })
                  }
                  setMenu({ x: e.clientX, y: e.clientY, items })
                }
              }
            )
          )
          if (isTable && expanded.has(objKey)) {
            const cols = explorer.columns[`${connId}|${db}|${obj.schema}|${obj.name}`]
            if (cols === null) {
              children.push(row(`${objKey}|loading`, depth + 2, null, 'Loading…', { dim: true }))
            } else {
              for (const c of cols ?? []) {
                children.push(
                  row(
                    `${objKey}|col|${c.name}`,
                    depth + 2,
                    c.identity ? Icons.key : Icons.column,
                    <span>
                      {c.name} <span style={{ color: 'var(--text-dim)' }}>({c.type}, {c.nullable ? 'null' : 'not null'})</span>
                    </span>
                  )
                )
              }
            }
          }
        }
      }
      return (
        <div key={folderKey}>
          {row(folderKey, depth, Icons.folder, `${folder.label} (${items.length})`, {
            expandable: true,
            onExpand: () => toggle(folderKey),
            onContextMenu:
              folder.type !== 'table'
                ? (e) => setMenu({ x: e.clientX, y: e.clientY, items: newObjectItems(connId, db) })
                : undefined
          })}
          {children}
        </div>
      )
    })
  }

  const renderDatabases = (p: Profile, depth: number): React.JSX.Element[] => {
    const dbs = explorer.databases[p.id]
    if (dbs === null) return [row(`${p.id}|loading`, depth, null, 'Connecting…', { dim: true })]
    if (!dbs) {
      const err = loadErr[`conn|${p.id}`]
      return err ? [row(`${p.id}|err`, depth, null, err, { dim: true })] : []
    }
    return dbs.map((db) => {
      const dbKey = `${p.id}|db|${db}`
      return (
        <div key={dbKey}>
          {row(dbKey, depth, Icons.database, db, {
            expandable: true,
            onExpand: () =>
              void expand(dbKey, async () => {
                await explorer.loadObjects(p.id, db)
                if (repoOpen) void useGit.getState().loadDrift(p.id, db)
              }),
            onContextMenu: (e) =>
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    label: 'New Query',
                    onClick: () => useTabs.getState().openTab({ connId: p.id, database: db })
                  },
                  ...newObjectItems(p.id, db),
                  {
                    label: 'Refresh',
                    onClick: () => {
                      void explorer.refreshDatabase(p.id, db)
                      if (repoOpen) void useGit.getState().loadDrift(p.id, db)
                    }
                  }
                ]
              })
          })}
          {expanded.has(dbKey) && renderObjects(p.id, db, depth + 1)}
        </div>
      )
    })
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)'
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel-alt)',
          flexShrink: 0
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Object Explorer
        </span>
        <button title="Add connection" style={{ padding: '1px 8px' }} onClick={onAddConnection}>
          +
        </button>
      </div>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
        <input
          placeholder="🔍 Filter objects…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, fontSize: 12, padding: '3px 8px' }}
          title="Filter tables/views/procs/functions by name (within expanded databases)"
        />
        {filter && (
          <button style={{ padding: '1px 8px' }} onClick={() => setFilter('')} title="Clear filter">
            ✕
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'auto', paddingTop: 4 }}>
        {profiles.length === 0 && (
          <div style={{ padding: 12, color: 'var(--text-dim)' }}>
            No connections yet.
            <br />
            <a
              style={{ color: 'var(--accent)', cursor: 'pointer' }}
              onClick={onAddConnection}
            >
              Add a connection…
            </a>
          </div>
        )}
        {profiles.map((p) => {
          const connKey = `conn|${p.id}`
          return (
            <div key={connKey}>
              {row(connKey, 0, Icons.server, `${p.name} (${p.server})`, {
                expandable: true,
                onExpand: () => void expand(connKey, () => explorer.loadDatabases(p.id)),
                onContextMenu: (e) =>
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      { label: 'New Query', onClick: () => useTabs.getState().openTab({ connId: p.id, database: p.database }) },
                      { label: 'Edit Connection…', onClick: () => onEditConnection(p) },
                      { separator: true, label: '', onClick: () => undefined },
                      {
                        label: 'Delete Connection',
                        onClick: () => {
                          if (confirm(`Delete connection "${p.name}"?`)) {
                            void useConnections.getState().remove(p.id)
                            useExplorer.getState().forgetConnection(p.id)
                          }
                        }
                      }
                    ]
                  })
              })}
              {expanded.has(connKey) && renderDatabases(p, 1)}
            </div>
          )
        })}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {newObject && <NewObjectDialog target={newObject} onClose={() => setNewObject(null)} />}
    </div>
  )
}
