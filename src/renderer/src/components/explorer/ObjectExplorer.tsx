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

/**
 * SSMS-style deep tree:
 * connection → database → Tables (Columns/Keys/Constraints/Triggers/Indexes),
 * Views, Synonyms, Programmability (procs+params, functions, db triggers,
 * types, sequences), Security (users, roles, schemas).
 */
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

  const f = filter.trim().toLowerCase()

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

  const isOpen = (key: string): boolean => expanded.has(key)

  // ---------- shared row ----------
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
      title?: string
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
      title={opts.title}
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
      <span style={{ width: 12, display: 'inline-block', fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>
        {opts.expandable ? (isOpen(key) ? '▼' : '▶') : ''}
      </span>
      {icon}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  )

  const leafList = (
    parentKey: string,
    depth: number,
    items: { key: string; icon: React.ReactNode; label: React.ReactNode; title?: string; onDoubleClick?: () => void }[] | null | undefined,
    emptyText = '(none)'
  ): React.JSX.Element[] => {
    if (items === null) return [row(`${parentKey}|loading`, depth, null, 'Loading…', { dim: true })]
    if (!items || items.length === 0) return [row(`${parentKey}|empty`, depth, null, emptyText, { dim: true })]
    return items.map((it) =>
      row(it.key, depth, it.icon, it.label, { title: it.title, onDoubleClick: it.onDoubleClick })
    )
  }

  // ---------- actions ----------
  const openDefinition = async (connId: string, db: string, schema: string, name: string): Promise<void> => {
    const tabs = useTabs.getState()
    try {
      const def = await explorerApi.definition(connId, db, schema, name)
      tabs.openTab({
        title: `${schema}.${name}`,
        connId,
        database: db,
        content: def.encrypted
          ? `-- ${schema}.${name} is encrypted (WITH ENCRYPTION); its source cannot be scripted.`
          : def.definition
      })
    } catch (err) {
      tabs.openTab({ title: `${schema}.${name}`, connId, database: db, content: `-- Failed to load definition: ${err}` })
    }
  }

  const selectTop1000 = (connId: string, db: string, obj: ObjectInfo): void => {
    const sql = `SELECT TOP (1000) * FROM [${obj.schema}].[${obj.name}]`
    const id = useTabs.getState().openTab({ title: `${obj.schema}.${obj.name}`, connId, database: db, content: sql })
    void useTabs.getState().run(id)
  }

  const newObjectItems = (connId: string, db: string): MenuItem[] => [
    { label: 'New Stored Procedure…', onClick: () => setNewObject({ connId, database: db, kind: 'proc' }) },
    { label: 'New Scalar Function…', onClick: () => setNewObject({ connId, database: db, kind: 'scalar' }) },
    { label: 'New Table-valued Function…', onClick: () => setNewObject({ connId, database: db, kind: 'tvf' }) },
    { label: 'New View…', onClick: () => setNewObject({ connId, database: db, kind: 'view' }) }
  ]

  // ---------- table / view node ----------
  const renderRelation = (connId: string, db: string, obj: ObjectInfo, depth: number): React.JSX.Element => {
    const objKey = `${connId}|${db}|obj|${obj.schema}.${obj.name}`
    const detailKey = `${connId}|${db}|${obj.schema}|${obj.name}`
    const isTable = obj.type === 'table'
    const status = (drift[`${connId}|${db}`] ?? {})[`${obj.schema}.${obj.name}`]

    const label = status ? (
      <span
        style={{ color: status === 'new' ? 'var(--success)' : 'var(--warning)' }}
        title={status === 'new' ? 'New — not in the repo baseline' : 'Modified since the repo baseline'}
      >
        {obj.schema}.{obj.name} ●
      </span>
    ) : (
      `${obj.schema}.${obj.name}`
    )

    const children: React.JSX.Element[] = []
    if (isOpen(objKey)) {
      // Columns
      const colKey = `${objKey}|columns`
      const cols = explorer.columns[detailKey]
      children.push(
        <div key={colKey}>
          {row(colKey, depth + 1, Icons.folder, `Columns${cols ? ` (${cols.length})` : ''}`, {
            expandable: true,
            onExpand: () => void expand(colKey, () => explorer.loadColumns(connId, db, obj.schema, obj.name))
          })}
          {isOpen(colKey) &&
            leafList(
              colKey,
              depth + 2,
              cols === null
                ? null
                : cols?.map((c) => ({
                    key: `${colKey}|${c.name}`,
                    icon: c.identity ? Icons.key : Icons.column,
                    label: (
                      <span>
                        {c.name}{' '}
                        <span style={{ color: 'var(--text-dim)' }}>
                          ({c.type}, {c.nullable ? 'null' : 'not null'}
                          {c.identity ? ', identity' : ''}{c.computed ? ', computed' : ''})
                        </span>
                      </span>
                    )
                  }))
            )}
        </div>
      )

      const detail = explorer.details[detailKey]
      const loadDetail = (): Promise<void> => explorer.loadDetail(connId, db, obj.schema, obj.name)

      if (isTable) {
        // Keys
        const keysKey = `${objKey}|keys`
        children.push(
          <div key={keysKey}>
            {row(keysKey, depth + 1, Icons.folder, `Keys${detail ? ` (${detail.keys?.length ?? 0})` : ''}`, {
              expandable: true,
              onExpand: () => void expand(keysKey, loadDetail)
            })}
            {isOpen(keysKey) &&
              leafList(
                keysKey,
                depth + 2,
                detail === null
                  ? null
                  : detail?.keys?.map((k) => ({
                      key: `${keysKey}|${k.name}`,
                      icon: k.kind === 'FK' ? Icons.fk : Icons.key,
                      label: (
                        <span>
                          {k.name} <span style={{ color: 'var(--text-dim)' }}>({k.kind}: {k.detail})</span>
                        </span>
                      )
                    })) ?? []
              )}
          </div>
        )
        // Constraints
        const consKey = `${objKey}|constraints`
        children.push(
          <div key={consKey}>
            {row(consKey, depth + 1, Icons.folder, `Constraints${detail ? ` (${detail.constraints?.length ?? 0})` : ''}`, {
              expandable: true,
              onExpand: () => void expand(consKey, loadDetail)
            })}
            {isOpen(consKey) &&
              leafList(
                consKey,
                depth + 2,
                detail === null
                  ? null
                  : detail?.constraints?.map((c) => ({
                      key: `${consKey}|${c.name}`,
                      icon: Icons.constraint,
                      label: (
                        <span>
                          {c.name} <span style={{ color: 'var(--text-dim)' }}>({c.kind} {c.definition})</span>
                        </span>
                      ),
                      title: c.definition
                    })) ?? []
              )}
          </div>
        )
      }

      // Triggers (tables and views)
      const trgKey = `${objKey}|triggers`
      children.push(
        <div key={trgKey}>
          {row(trgKey, depth + 1, Icons.folder, `Triggers${detail ? ` (${detail.triggers?.length ?? 0})` : ''}`, {
            expandable: true,
            onExpand: () => void expand(trgKey, loadDetail)
          })}
          {isOpen(trgKey) &&
            leafList(
              trgKey,
              depth + 2,
              detail === null
                ? null
                : detail?.triggers?.map((t) => ({
                    key: `${trgKey}|${t.name}`,
                    icon: Icons.trigger,
                    label: (
                      <span>
                        {t.name}
                        {t.disabled && <span style={{ color: 'var(--error)' }}> (disabled)</span>}
                      </span>
                    ),
                    onDoubleClick: () => void openDefinition(connId, db, obj.schema, t.name)
                  })) ?? []
            )}
        </div>
      )

      // Indexes
      const idxKey = `${objKey}|indexes`
      const idx = explorer.indexes[detailKey]
      children.push(
        <div key={idxKey}>
          {row(idxKey, depth + 1, Icons.folder, `Indexes${idx ? ` (${idx.length})` : ''}`, {
            expandable: true,
            onExpand: () => void expand(idxKey, () => explorer.loadIndexes(connId, db, obj.schema, obj.name))
          })}
          {isOpen(idxKey) &&
            leafList(
              idxKey,
              depth + 2,
              idx === null
                ? null
                : idx?.map((i) => ({
                    key: `${idxKey}|${i.name}`,
                    icon: Icons.index,
                    label: (
                      <span>
                        {i.name}{' '}
                        <span style={{ color: 'var(--text-dim)' }}>
                          ({i.primary ? 'PK, ' : ''}{i.unique ? 'unique, ' : ''}{i.type.toLowerCase()}: {i.columns.join(', ')})
                        </span>
                      </span>
                    )
                  }))
            )}
        </div>
      )
    }

    return (
      <div key={objKey}>
        {row(objKey, depth, Icons[obj.type as keyof typeof Icons] ?? Icons.table, label, {
          expandable: true,
          onExpand: () => toggle(objKey),
          onDoubleClick: obj.type === 'view' ? () => void openDefinition(connId, db, obj.schema, obj.name) : () => selectTop1000(connId, db, obj),
          onContextMenu: (e) => {
            const items: MenuItem[] = [
              { label: 'Select Top 1000 Rows', onClick: () => selectTop1000(connId, db, obj) }
            ]
            if (obj.type === 'view') {
              items.push({ label: 'Script as CREATE OR ALTER', onClick: () => void openDefinition(connId, db, obj.schema, obj.name) })
            }
            setMenu({ x: e.clientX, y: e.clientY, items })
          }
        })}
        {children}
      </div>
    )
  }

  // ---------- programmable object node (proc/function with parameters) ----------
  const renderModule = (connId: string, db: string, obj: ObjectInfo, depth: number): React.JSX.Element => {
    const objKey = `${connId}|${db}|obj|${obj.schema}.${obj.name}`
    const status = (drift[`${connId}|${db}`] ?? {})[`${obj.schema}.${obj.name}`]
    const extras = explorer.extras[`${connId}|${db}`]
    const params = extras?.params?.[`${obj.schema}.${obj.name}`] ?? []

    const label = status ? (
      <span
        style={{ color: status === 'new' ? 'var(--success)' : 'var(--warning)' }}
        title={status === 'new' ? 'New — not in the repo baseline' : 'Modified since the repo baseline'}
      >
        {obj.schema}.{obj.name} ●
      </span>
    ) : (
      `${obj.schema}.${obj.name}`
    )

    return (
      <div key={objKey}>
        {row(objKey, depth, Icons[obj.type as keyof typeof Icons] ?? Icons.proc, label, {
          expandable: params.length > 0,
          onExpand: () => toggle(objKey),
          onDoubleClick: () => void openDefinition(connId, db, obj.schema, obj.name),
          onContextMenu: (e) =>
            setMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                { label: 'Script as CREATE OR ALTER', onClick: () => void openDefinition(connId, db, obj.schema, obj.name) },
                ...(obj.type === 'proc'
                  ? [{
                      label: 'Execute…',
                      onClick: () => {
                        const args = params.map((p) => `${p.name} = ?`).join(', ')
                        useTabs.getState().openTab({
                          title: `exec ${obj.name}`,
                          connId,
                          database: db,
                          content: `EXEC [${obj.schema}].[${obj.name}]${args ? ' ' + args : ''}`
                        })
                      }
                    }]
                  : [])
              ]
            })
        })}
        {isOpen(objKey) &&
          params.map((p) =>
            row(`${objKey}|param|${p.name}`, depth + 1, Icons.param, (
              <span>
                {p.name} <span style={{ color: 'var(--text-dim)' }}>({p.type}{p.output ? ', output' : ''})</span>
              </span>
            ))
          )}
      </div>
    )
  }

  // ---------- generic folder of objects ----------
  const objectFolder = (
    connId: string,
    db: string,
    depth: number,
    label: string,
    type: ObjectType,
    render: (o: ObjectInfo, d: number) => React.JSX.Element,
    extraMenu?: MenuItem[]
  ): React.JSX.Element | null => {
    const objs = explorer.objects[`${connId}|${db}`]
    if (!objs) return null
    const folderKey = `${connId}|${db}|folder|${type}`
    let items = objs.filter((o) => o.type === type)
    if (f) items = items.filter((o) => `${o.schema}.${o.name}`.toLowerCase().includes(f))
    if (f && items.length === 0) return null
    return (
      <div key={folderKey}>
        {row(folderKey, depth, Icons.folder, `${label} (${items.length})`, {
          expandable: true,
          onExpand: () => toggle(folderKey),
          onContextMenu: extraMenu ? (e) => setMenu({ x: e.clientX, y: e.clientY, items: extraMenu }) : undefined
        })}
        {(isOpen(folderKey) || f !== '') && items.map((o) => render(o, depth + 1))}
      </div>
    )
  }

  // ---------- database node ----------
  const renderDatabase = (p: Profile, db: string, depth: number): React.JSX.Element => {
    const dbKey = `${p.id}|db|${db}`
    const key = `${p.id}|${db}`
    const objs = explorer.objects[key]
    const extras = explorer.extras[key]

    const body: React.JSX.Element[] = []
    if (isOpen(dbKey)) {
      if (objs === null) {
        body.push(row(`${key}|loading`, depth + 1, null, 'Loading…', { dim: true }))
      } else if (objs) {
        const tablesFolder = objectFolder(p.id, db, depth + 1, 'Tables', 'table', (o, d) => renderRelation(p.id, db, o, d))
        const viewsFolder = objectFolder(p.id, db, depth + 1, 'Views', 'view', (o, d) => renderRelation(p.id, db, o, d), newObjectItems(p.id, db))
        if (tablesFolder) body.push(tablesFolder)
        if (viewsFolder) body.push(viewsFolder)

        // Synonyms
        if (!f || extras?.synonyms?.some((s) => `${s.schema}.${s.name}`.toLowerCase().includes(f))) {
          const synKey = `${key}|folder|synonyms`
          let syns = extras?.synonyms ?? (extras === null ? null : [])
          if (f && syns) syns = syns.filter((s) => `${s.schema}.${s.name}`.toLowerCase().includes(f))
          body.push(
            <div key={synKey}>
              {row(synKey, depth + 1, Icons.folder, `Synonyms${extras?.synonyms ? ` (${extras.synonyms.length})` : ''}`, {
                expandable: true,
                onExpand: () => toggle(synKey)
              })}
              {(isOpen(synKey) || f !== '') &&
                leafList(
                  synKey,
                  depth + 2,
                  syns?.map((s) => ({
                    key: `${synKey}|${s.schema}.${s.name}`,
                    icon: Icons.synonym,
                    label: (
                      <span>
                        {s.schema}.{s.name} <span style={{ color: 'var(--text-dim)' }}>→ {s.base}</span>
                      </span>
                    ),
                    title: s.base
                  }))
                )}
            </div>
          )
        }

        // Programmability
        const progKey = `${key}|folder|prog`
        const progChildren: React.JSX.Element[] = []
        if (isOpen(progKey) || f !== '') {
          const procs = objectFolder(p.id, db, depth + 2, 'Stored Procedures', 'proc', (o, d) => renderModule(p.id, db, o, d), newObjectItems(p.id, db))
          if (procs) progChildren.push(procs)

          const fnKey = `${key}|folder|functions`
          const tvfs = objectFolder(p.id, db, depth + 3, 'Table-valued Functions', 'tvf', (o, d) => renderModule(p.id, db, o, d))
          const scalars = objectFolder(p.id, db, depth + 3, 'Scalar Functions', 'scalar', (o, d) => renderModule(p.id, db, o, d))
          if (tvfs || scalars) {
            progChildren.push(
              <div key={fnKey}>
                {row(fnKey, depth + 2, Icons.folder, 'Functions', { expandable: true, onExpand: () => toggle(fnKey) })}
                {(isOpen(fnKey) || f !== '') && (
                  <>
                    {tvfs}
                    {scalars}
                  </>
                )}
              </div>
            )
          }

          if (!f) {
            // Database triggers
            const dtKey = `${key}|folder|dbtriggers`
            progChildren.push(
              <div key={dtKey}>
                {row(dtKey, depth + 2, Icons.folder, `Database Triggers${extras?.dbTriggers ? ` (${extras.dbTriggers.length})` : ''}`, {
                  expandable: true,
                  onExpand: () => toggle(dtKey)
                })}
                {isOpen(dtKey) &&
                  leafList(
                    dtKey,
                    depth + 3,
                    extras === null
                      ? null
                      : extras?.dbTriggers?.map((t) => ({
                          key: `${dtKey}|${t.name}`,
                          icon: Icons.trigger,
                          label: (
                            <span>
                              {t.name}
                              {t.disabled && <span style={{ color: 'var(--error)' }}> (disabled)</span>}
                            </span>
                          )
                        })) ?? []
                  )}
              </div>
            )

            // Types
            const tyKey = `${key}|folder|types`
            progChildren.push(
              <div key={tyKey}>
                {row(tyKey, depth + 2, Icons.folder, 'Types', { expandable: true, onExpand: () => toggle(tyKey) })}
                {isOpen(tyKey) && (
                  <>
                    {row(`${tyKey}|data`, depth + 3, Icons.folder, `User-Defined Data Types (${extras?.dataTypes?.length ?? 0})`, {
                      expandable: true,
                      onExpand: () => toggle(`${tyKey}|data`)
                    })}
                    {isOpen(`${tyKey}|data`) &&
                      leafList(
                        `${tyKey}|data`,
                        depth + 4,
                        extras?.dataTypes?.map((t) => ({
                          key: `${tyKey}|data|${t.schema}.${t.name}`,
                          icon: Icons.type,
                          label: (
                            <span>
                              {t.schema}.{t.name} <span style={{ color: 'var(--text-dim)' }}>({t.baseType}{t.nullable ? ', null' : ''})</span>
                            </span>
                          )
                        }))
                      )}
                    {row(`${tyKey}|table`, depth + 3, Icons.folder, `User-Defined Table Types (${extras?.tableTypes?.length ?? 0})`, {
                      expandable: true,
                      onExpand: () => toggle(`${tyKey}|table`)
                    })}
                    {isOpen(`${tyKey}|table`) &&
                      leafList(
                        `${tyKey}|table`,
                        depth + 4,
                        extras?.tableTypes?.map((t) => ({
                          key: `${tyKey}|table|${t.schema}.${t.name}`,
                          icon: Icons.type,
                          label: `${t.schema}.${t.name}`
                        }))
                      )}
                  </>
                )}
              </div>
            )

            // Sequences
            const sqKey = `${key}|folder|sequences`
            progChildren.push(
              <div key={sqKey}>
                {row(sqKey, depth + 2, Icons.folder, `Sequences${extras?.sequences ? ` (${extras.sequences.length})` : ''}`, {
                  expandable: true,
                  onExpand: () => toggle(sqKey)
                })}
                {isOpen(sqKey) &&
                  leafList(
                    sqKey,
                    depth + 3,
                    extras === null
                      ? null
                      : extras?.sequences?.map((s) => ({
                          key: `${sqKey}|${s.schema}.${s.name}`,
                          icon: Icons.sequence,
                          label: (
                            <span>
                              {s.schema}.{s.name}{' '}
                              <span style={{ color: 'var(--text-dim)' }}>
                                ({s.type}, start {s.start}, step {s.increment}, current {s.current})
                              </span>
                            </span>
                          )
                        })) ?? []
                  )}
              </div>
            )
          }
        }
        body.push(
          <div key={progKey}>
            {!f && row(progKey, depth + 1, Icons.folder, 'Programmability', { expandable: true, onExpand: () => toggle(progKey) })}
            {progChildren}
          </div>
        )

        // Security
        if (!f) {
          const secKey = `${key}|folder|security`
          body.push(
            <div key={secKey}>
              {row(secKey, depth + 1, Icons.folder, 'Security', { expandable: true, onExpand: () => toggle(secKey) })}
              {isOpen(secKey) && (
                <>
                  {row(`${secKey}|users`, depth + 2, Icons.folder, `Users (${extras?.users?.length ?? 0})`, {
                    expandable: true,
                    onExpand: () => toggle(`${secKey}|users`)
                  })}
                  {isOpen(`${secKey}|users`) &&
                    leafList(
                      `${secKey}|users`,
                      depth + 3,
                      extras?.users?.map((u) => ({
                        key: `${secKey}|users|${u.name}`,
                        icon: Icons.user,
                        label: (
                          <span>
                            {u.name} <span style={{ color: 'var(--text-dim)' }}>({u.type.toLowerCase().replace(/_/g, ' ')})</span>
                          </span>
                        )
                      }))
                    )}
                  {row(`${secKey}|roles`, depth + 2, Icons.folder, `Roles (${extras?.roles?.length ?? 0})`, {
                    expandable: true,
                    onExpand: () => toggle(`${secKey}|roles`)
                  })}
                  {isOpen(`${secKey}|roles`) &&
                    leafList(
                      `${secKey}|roles`,
                      depth + 3,
                      extras?.roles?.map((r) => ({ key: `${secKey}|roles|${r.name}`, icon: Icons.role, label: r.name }))
                    )}
                  {row(`${secKey}|schemas`, depth + 2, Icons.folder, `Schemas (${extras?.schemas?.length ?? 0})`, {
                    expandable: true,
                    onExpand: () => toggle(`${secKey}|schemas`)
                  })}
                  {isOpen(`${secKey}|schemas`) &&
                    leafList(
                      `${secKey}|schemas`,
                      depth + 3,
                      extras?.schemas?.map((s) => ({ key: `${secKey}|schemas|${s}`, icon: Icons.schema, label: s }))
                    )}
                </>
              )}
            </div>
          )
        }
      }
    }

    return (
      <div key={dbKey}>
        {row(dbKey, depth, Icons.database, db, {
          expandable: true,
          onExpand: () =>
            void expand(dbKey, async () => {
              await Promise.all([explorer.loadObjects(p.id, db), explorer.loadExtras(p.id, db)])
              if (repoOpen) void useGit.getState().loadDrift(p.id, db)
            }),
          onContextMenu: (e) =>
            setMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                { label: 'New Query', onClick: () => useTabs.getState().openTab({ connId: p.id, database: db }) },
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
        {body}
      </div>
    )
  }

  // ---------- connection node ----------
  const renderConnection = (p: Profile): React.JSX.Element => {
    const connKey = `conn|${p.id}`
    const dbs = explorer.databases[p.id]
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
        {isOpen(connKey) &&
          (dbs === null
            ? [row(`${p.id}|loading`, 1, null, 'Connecting…', { dim: true })]
            : dbs
              ? dbs.map((db) => renderDatabase(p, db, 1))
              : loadErr[connKey]
                ? [row(`${p.id}|err`, 1, null, loadErr[connKey], { dim: true })]
                : [])}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', borderRight: '1px solid var(--border)' }}>
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
        <span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Object Explorer</span>
        <button title="Add connection" style={{ padding: '1px 8px' }} onClick={onAddConnection}>
          +
        </button>
      </div>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4, flexShrink: 0 }}>
        <input
          placeholder="🔍 Filter objects…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, fontSize: 12, padding: '3px 8px' }}
          title="Filter tables/views/procs/functions/synonyms by name (within expanded databases)"
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
            <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={onAddConnection}>
              Add a connection…
            </a>
          </div>
        )}
        {profiles.map(renderConnection)}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {newObject && <NewObjectDialog target={newObject} onClose={() => setNewObject(null)} />}
    </div>
  )
}
