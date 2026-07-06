import { useState } from 'react'
import { useConnections } from '../../state/connectionsStore'
import { useExplorer } from '../../state/explorerStore'
import { useTabs } from '../../state/tabsStore'
import { explorerApi } from '../../api/endpoints'
import type { ObjectInfo, ObjectType, Profile } from '../../api/types'
import ContextMenu, { MenuItem } from '../common/ContextMenu'
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [loadErr, setLoadErr] = useState<Record<string, string>>({})

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

  const renderObjects = (connId: string, db: string, depth: number): React.JSX.Element[] => {
    const objs = explorer.objects[`${connId}|${db}`]
    if (objs === null) return [row(`${connId}|${db}|loading`, depth, null, 'Loading…', { dim: true })]
    if (!objs) return []

    return OBJECT_FOLDERS.map((folder) => {
      const folderKey = `${connId}|${db}|folder|${folder.type}`
      const items = objs.filter((o) => o.type === folder.type)
      const children: React.JSX.Element[] = []
      if (expanded.has(folderKey)) {
        for (const obj of items) {
          const objKey = `${connId}|${db}|obj|${obj.schema}.${obj.name}`
          const isTable = folder.type === 'table' || folder.type === 'view'
          children.push(
            row(
              objKey,
              depth + 1,
              Icons[obj.type as keyof typeof Icons] ?? Icons.table,
              `${obj.schema}.${obj.name}`,
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
            onExpand: () => toggle(folderKey)
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
            onExpand: () => void expand(dbKey, () => explorer.loadObjects(p.id, db)),
            onContextMenu: (e) =>
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    label: 'New Query',
                    onClick: () => useTabs.getState().openTab({ connId: p.id, database: db })
                  },
                  {
                    label: 'Refresh',
                    onClick: () => void explorer.refreshDatabase(p.id, db)
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
    </div>
  )
}
