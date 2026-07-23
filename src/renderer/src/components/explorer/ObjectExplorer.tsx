import { useEffect, useState } from 'react'
import { ChevronRight, Plus, Search, X } from 'lucide-react'
import { useConnections } from '../../state/connectionsStore'
import { useExplorer } from '../../state/explorerStore'
import { useGit } from '../../state/gitStore'
import { useTabs } from '../../state/tabsStore'
import { useUi } from '../../state/uiStore'
import { explorerApi } from '../../api/endpoints'
import type { ObjectStatusEntry } from '../../api/git'
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
  const objectStatus = useGit((s) => s.objectStatus)
  const repoConnId = useGit((s) => s.info.manifest?.sourceConnId)
  const repoDatabases = useGit((s) => s.info.databases)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [loadErr, setLoadErr] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('')
  const [newObject, setNewObject] = useState<NewObjectTarget | null>(null)

  const f = filter.trim().toLowerCase()

  // ---------- repo-scoped browsing ----------
  // While a repo is open, the explorer shows only its connection and the
  // databases the repo tracks, instead of every saved connection.
  useEffect(() => {
    if (!repoOpen || !repoConnId) return
    const connKey = `conn|${repoConnId}`
    setExpanded((prev) => (prev.has(connKey) ? prev : new Set(prev).add(connKey)))
    void explorer.loadDatabases(repoConnId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoOpen, repoConnId])

  const visibleProfiles = repoOpen && repoConnId ? profiles.filter((p) => p.id === repoConnId) : profiles

  // ---------- git-status coloring (VS Code style M/A/D) ----------
  // Only applies to databases the open repo actually tracks; every other
  // connection/database renders exactly as before.
  const isTracked = (connId: string, db: string): boolean =>
    !!repoOpen && repoConnId === connId && !!repoDatabases?.includes(db)

  const vcColor = (state: ObjectStatusEntry['state']): string =>
    state === 'added' ? 'var(--success)' : state === 'modified' ? 'var(--warning)' : 'var(--error)'

  const vcLetter = (state: ObjectStatusEntry['state']): string =>
    state === 'added' ? 'A' : state === 'modified' ? 'M' : 'D'

  const vcBadge = (state: ObjectStatusEntry['state']): React.JSX.Element => (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 600,
        color: vcColor(state),
        marginLeft: 6,
        flexShrink: 0
      }}
    >
      {vcLetter(state)}
    </span>
  )

  const countBadge = (n: number): React.JSX.Element | null =>
    n > 0 ? (
      <span className="badge" style={{ marginLeft: 6 }}>
        {n}
      </span>
    ) : null

  /** Objects git reports as deleted for one database + object type — rendered
   *  as ghost rows in their proper folder even though the live DB no longer
   *  has them. */
  const ghostsFor = (db: string, type: ObjectType): { schema: string; name: string; path: string }[] => {
    const out: { schema: string; name: string; path: string }[] = []
    for (const [key, entry] of Object.entries(objectStatus)) {
      if (entry.state !== 'deleted' || entry.type !== type) continue
      const [database, schema, name] = key.split('|')
      if (database !== db) continue
      out.push({ schema, name, path: entry.path })
    }
    return out
  }

  /** Count of added/modified/deleted objects of one type in a tracked database. */
  const changedCountFor = (connId: string, db: string, type: ObjectType): number => {
    if (!isTracked(connId, db)) return 0
    const objs = explorer.objects[`${connId}|${db}`] ?? []
    const changed = objs.filter((o) => o.type === type && objectStatus[`${db}|${o.schema}|${o.name}`]).length
    return changed + ghostsFor(db, type).length
  }

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
      className="tree-row"
      onClick={opts.expandable ? opts.onExpand : undefined}
      onDoubleClick={opts.onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault()
        opts.onContextMenu?.(e)
      }}
      title={opts.title}
      style={{
        paddingLeft: 6 + depth * 14,
        color: opts.dim ? 'var(--text-dim)' : undefined
      }}
    >
      <span className={`chevron${opts.expandable && isOpen(key) ? ' open' : ''}`}>
        {opts.expandable ? <ChevronRight size={12} /> : null}
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

  // ---------- ghost row for an object git says was deleted from the DB ----------
  const renderGhost = (
    type: ObjectType,
    ghost: { schema: string; name: string; path: string },
    depth: number
  ): React.JSX.Element => {
    const key = `ghost|${ghost.path}`
    const label = (
      <span
        style={{
          color: 'var(--error)',
          textDecoration: 'line-through',
          display: 'inline-flex',
          alignItems: 'center'
        }}
      >
        {ghost.schema}.{ghost.name}
        {vcBadge('deleted')}
      </span>
    )
    return row(key, depth, Icons[type as keyof typeof Icons] ?? Icons.table, label, {
      title: 'Deleted in database — file still in repo'
    })
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

    const vc = isTracked(connId, db) ? objectStatus[`${db}|${obj.schema}|${obj.name}`] : undefined

    const label = vc ? (
      <span
        style={{ color: vcColor(vc.state), display: 'inline-flex', alignItems: 'center' }}
        title={vc.state === 'added' ? 'Added — new file not yet committed' : 'Modified — uncommitted change to this file'}
      >
        {obj.schema}.{obj.name}
        {vcBadge(vc.state)}
      </span>
    ) : status ? (
      <span
        style={{ color: status === 'new' ? 'var(--success)' : 'var(--warning)', display: 'inline-flex', alignItems: 'center' }}
        title={status === 'new' ? 'New — not in the repo baseline' : 'Modified since the repo baseline'}
      >
        {obj.schema}.{obj.name}
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            marginLeft: 6,
            borderRadius: 999,
            background: 'currentColor',
            flexShrink: 0
          }}
        />
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
            if (obj.type === 'table') {
              items.push({
                label: 'Design',
                onClick: () =>
                  useTabs.getState().openTab({
                    title: `design: ${obj.schema}.${obj.name}`,
                    kind: 'design',
                    designTarget: { connId, database: db, schema: obj.schema, name: obj.name }
                  })
              })
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

    const vc = isTracked(connId, db) ? objectStatus[`${db}|${obj.schema}|${obj.name}`] : undefined

    const label = vc ? (
      <span
        style={{ color: vcColor(vc.state), display: 'inline-flex', alignItems: 'center' }}
        title={vc.state === 'added' ? 'Added — new file not yet committed' : 'Modified — uncommitted change to this file'}
      >
        {obj.schema}.{obj.name}
        {vcBadge(vc.state)}
      </span>
    ) : status ? (
      <span
        style={{ color: status === 'new' ? 'var(--success)' : 'var(--warning)', display: 'inline-flex', alignItems: 'center' }}
        title={status === 'new' ? 'New — not in the repo baseline' : 'Modified since the repo baseline'}
      >
        {obj.schema}.{obj.name}
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            marginLeft: 6,
            borderRadius: 999,
            background: 'currentColor',
            flexShrink: 0
          }}
        />
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

    const tracked = isTracked(connId, db)
    let ghosts = tracked ? ghostsFor(db, type) : []
    if (f) ghosts = ghosts.filter((g) => `${g.schema}.${g.name}`.toLowerCase().includes(f))

    if (f && items.length === 0 && ghosts.length === 0) return null
    const changedCount = tracked ? changedCountFor(connId, db, type) : 0

    const searchItem: MenuItem = { label: 'Search here…', onClick: () => useUi.getState().openSearch({ connId, database: db }) }
    const menuItems: MenuItem[] = extraMenu
      ? [...extraMenu, { separator: true, label: '', onClick: () => undefined }, searchItem]
      : [searchItem]
    return (
      <div key={folderKey}>
        {row(
          folderKey,
          depth,
          Icons.folder,
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            {label} ({items.length})
            {countBadge(changedCount)}
          </span>,
          {
            expandable: true,
            onExpand: () => toggle(folderKey),
            onContextMenu: (e) => setMenu({ x: e.clientX, y: e.clientY, items: menuItems })
          }
        )}
        {(isOpen(folderKey) || f !== '') && (
          <>
            {items.map((o) => render(o, depth + 1))}
            {ghosts.map((g) => renderGhost(type, g, depth + 1))}
          </>
        )}
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
            const fnChanged = changedCountFor(p.id, db, 'tvf') + changedCountFor(p.id, db, 'scalar')
            progChildren.push(
              <div key={fnKey}>
                {row(
                  fnKey,
                  depth + 2,
                  Icons.folder,
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Functions
                    {countBadge(fnChanged)}
                  </span>,
                  { expandable: true, onExpand: () => toggle(fnKey) }
                )}
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
        const progChanged =
          changedCountFor(p.id, db, 'proc') + changedCountFor(p.id, db, 'tvf') + changedCountFor(p.id, db, 'scalar')
        body.push(
          <div key={progKey}>
            {!f &&
              row(
                progKey,
                depth + 1,
                Icons.folder,
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  Programmability
                  {countBadge(progChanged)}
                </span>,
                { expandable: true, onExpand: () => toggle(progKey) }
              )}
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

    const dbChanged = isTracked(p.id, db)
      ? (['table', 'view', 'proc', 'tvf', 'scalar'] as ObjectType[]).reduce(
          (sum, t) => sum + changedCountFor(p.id, db, t),
          0
        )
      : 0

    return (
      <div key={dbKey}>
        {row(
          dbKey,
          depth,
          Icons.database,
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            {db}
            {countBadge(dbChanged)}
          </span>,
          {
            expandable: true,
            onExpand: () =>
              void expand(dbKey, async () => {
                await Promise.all([explorer.loadObjects(p.id, db), explorer.loadExtras(p.id, db)])
                // drift only makes sense for databases the repo tracks —
                // untracked ones have no baseline files and would light up
                // entirely as false "modified"/"new"
                if (isTracked(p.id, db)) void useGit.getState().loadDrift(p.id, db)
              }),
            onContextMenu: (e) =>
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  { label: 'New Query', onClick: () => useTabs.getState().openTab({ connId: p.id, database: db }) },
                  ...newObjectItems(p.id, db),
                  { separator: true, label: '', onClick: () => undefined },
                  { label: `Search in ${db}…`, onClick: () => useUi.getState().openSearch({ connId: p.id, database: db }) },
                  {
                    label: 'Refresh',
                    onClick: () => {
                      void explorer.refreshDatabase(p.id, db)
                      if (isTracked(p.id, db)) void useGit.getState().loadDrift(p.id, db)
                      if (repoOpen) void useGit.getState().loadObjectStatus()
                    }
                  }
                ]
              })
          }
        )}
        {body}
      </div>
    )
  }

  // ---------- connection node ----------
  const renderConnection = (p: Profile): React.JSX.Element => {
    const connKey = `conn|${p.id}`
    const scoped = repoOpen && repoConnId === p.id && repoDatabases
    const dbs = scoped ? explorer.databases[p.id]?.filter((d) => repoDatabases!.includes(d)) : explorer.databases[p.id]
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
        <span className="section-label" title={repoOpen ? 'Showing only the open repo’s connection and databases' : undefined}>
          Object Explorer{repoOpen ? ' — repo' : ''}
        </span>
        <button className="icon" title="Add connection" onClick={onAddConnection}>
          <Plus size={16} />
        </button>
      </div>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4, flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={13}
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}
          />
          <input
            placeholder="Filter objects…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: '100%', fontSize: 12, padding: '3px 8px 3px 26px' }}
            title="Filter tables/views/procs/functions/synonyms by name (within expanded databases)"
          />
        </div>
        {filter && (
          <button className="icon" onClick={() => setFilter('')} title="Clear filter">
            <X size={14} />
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
        {profiles.length > 0 && repoOpen && visibleProfiles.length === 0 && (
          <div style={{ padding: 12, color: 'var(--text-dim)' }}>
            This repo's source connection isn't in your saved connections anymore.
          </div>
        )}
        {visibleProfiles.map(renderConnection)}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {newObject && <NewObjectDialog target={newObject} onClose={() => setNewObject(null)} />}
    </div>
  )
}
