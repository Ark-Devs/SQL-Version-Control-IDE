export interface Profile {
  id: string
  name: string
  server: string
  authMode: 'windows' | 'sql'
  /** '' or undefined = TCP, 'np' = named pipes, 'lpc' = shared memory (local) */
  protocol?: '' | 'np' | 'lpc'
  username?: string
  database?: string
  encrypt: boolean
  trustServerCertificate: boolean
}

/** Profile being created/edited in the dialog; password is write-only. */
export interface ProfileDraft extends Omit<Profile, 'id'> {
  id?: string
  password?: string
}

export interface TestResult {
  ok: boolean
  version?: string
  error?: string
}

export interface DatabaseInfo {
  name: string
}

export type ObjectType = 'table' | 'view' | 'proc' | 'tvf' | 'scalar' | 'trigger'

export interface ObjectInfo {
  schema: string
  name: string
  type: ObjectType
  objectId: number
  modifyDate: string
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  identity: boolean
  computed: boolean
}

export interface IndexInfo {
  name: string
  type: string
  unique: boolean
  primary: boolean
  columns: string[]
}

export interface Definition {
  definition: string
  encrypted: boolean
}

export interface ResultColumn {
  name: string
  type: string
}

export interface ResultSet {
  columns: ResultColumn[]
  rows: unknown[][]
  truncated: boolean
}

export interface QueryMessage {
  kind: 'info' | 'error' | 'rowcount'
  text: string
}

export interface QuerySnapshot {
  done: boolean
  sets: ResultSet[] | null
  messages: QueryMessage[] | null
  elapsedMs: number
  error?: string
}
