import { get, post, put, del } from './client'
import type {
  ColumnInfo,
  DatabaseInfo,
  DbExtras,
  Definition,
  IndexInfo,
  ObjectInfo,
  Profile,
  ProfileDraft,
  QuerySnapshot,
  TableDetail,
  TestResult
} from './types'

const enc = encodeURIComponent

export const connectionsApi = {
  list: () => get<Profile[]>('/connections'),
  create: (p: ProfileDraft) => post<Profile>('/connections', p),
  update: (p: ProfileDraft & { id: string }) => put<Profile>(`/connections/${enc(p.id)}`, p),
  remove: (id: string) => del<{ deleted: boolean }>(`/connections/${enc(id)}`),
  test: (p: ProfileDraft) => post<TestResult>('/connections/test', p)
}

export const explorerApi = {
  databases: (connId: string) => get<DatabaseInfo[]>(`/explorer/${enc(connId)}/databases`),
  objects: (connId: string, db: string) =>
    get<ObjectInfo[] | null>(`/explorer/${enc(connId)}/${enc(db)}/objects`),
  columns: (connId: string, db: string, schema: string, name: string) =>
    get<ColumnInfo[] | null>(
      `/explorer/${enc(connId)}/${enc(db)}/tables/${enc(schema)}/${enc(name)}/columns`
    ),
  indexes: (connId: string, db: string, schema: string, name: string) =>
    get<IndexInfo[] | null>(
      `/explorer/${enc(connId)}/${enc(db)}/tables/${enc(schema)}/${enc(name)}/indexes`
    ),
  definition: (connId: string, db: string, schema: string, name: string) =>
    get<Definition>(
      `/explorer/${enc(connId)}/${enc(db)}/objects/${enc(schema)}/${enc(name)}/definition`
    ),
  extras: (connId: string, db: string) => get<DbExtras>(`/explorer/${enc(connId)}/${enc(db)}/extras`),
  tableDetail: (connId: string, db: string, schema: string, name: string) =>
    get<TableDetail>(
      `/explorer/${enc(connId)}/${enc(db)}/tables/${enc(schema)}/${enc(name)}/detail`
    )
}

export const queryApi = {
  execute: (connId: string, database: string, sql: string) =>
    post<{ executionId: string }>('/query/execute', { connId, database, sql }),
  results: (id: string) => get<QuerySnapshot>(`/query/${enc(id)}/results`),
  cancel: (id: string) => post<{ cancelled: boolean }>(`/query/${enc(id)}/cancel`),
  release: (id: string) => post<{ released: boolean }>(`/query/${enc(id)}/release`)
}
