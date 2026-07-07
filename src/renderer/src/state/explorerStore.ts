import { create } from 'zustand'
import { explorerApi } from '../api/endpoints'
import type { ColumnInfo, DbExtras, IndexInfo, ObjectInfo, TableDetail } from '../api/types'

interface ExplorerState {
  /** connId → database names (undefined = not loaded, null = loading) */
  databases: Record<string, string[] | null | undefined>
  /** "connId|db" → objects */
  objects: Record<string, ObjectInfo[] | null | undefined>
  /** "connId|db" → deep-tree metadata (synonyms, types, users, params, …) */
  extras: Record<string, DbExtras | null | undefined>
  /** "connId|db|schema|name" → columns */
  columns: Record<string, ColumnInfo[] | null | undefined>
  indexes: Record<string, IndexInfo[] | null | undefined>
  /** "connId|db|schema|name" → keys/constraints/triggers */
  details: Record<string, TableDetail | null | undefined>
  errors: Record<string, string>

  loadDatabases: (connId: string) => Promise<void>
  loadObjects: (connId: string, db: string) => Promise<void>
  loadExtras: (connId: string, db: string) => Promise<void>
  loadColumns: (connId: string, db: string, schema: string, name: string) => Promise<void>
  loadIndexes: (connId: string, db: string, schema: string, name: string) => Promise<void>
  loadDetail: (connId: string, db: string, schema: string, name: string) => Promise<void>
  refreshDatabase: (connId: string, db: string) => Promise<void>
  forgetConnection: (connId: string) => void
}

export const useExplorer = create<ExplorerState>((set, get) => ({
  databases: {},
  objects: {},
  extras: {},
  columns: {},
  indexes: {},
  details: {},
  errors: {},

  loadDatabases: async (connId) => {
    if (get().databases[connId] !== undefined) return
    set((s) => ({ databases: { ...s.databases, [connId]: null } }))
    try {
      const dbs = await explorerApi.databases(connId)
      set((s) => ({
        databases: { ...s.databases, [connId]: (dbs ?? []).map((d) => d.name) }
      }))
    } catch (err) {
      set((s) => ({
        databases: { ...s.databases, [connId]: undefined },
        errors: { ...s.errors, [connId]: String(err) }
      }))
      throw err
    }
  },

  loadObjects: async (connId, db) => {
    const key = `${connId}|${db}`
    if (get().objects[key] !== undefined) return
    set((s) => ({ objects: { ...s.objects, [key]: null } }))
    try {
      const objs = await explorerApi.objects(connId, db)
      set((s) => ({ objects: { ...s.objects, [key]: objs ?? [] } }))
    } catch (err) {
      set((s) => ({
        objects: { ...s.objects, [key]: undefined },
        errors: { ...s.errors, [key]: String(err) }
      }))
      throw err
    }
  },

  loadExtras: async (connId, db) => {
    const key = `${connId}|${db}`
    if (get().extras[key] !== undefined) return
    set((s) => ({ extras: { ...s.extras, [key]: null } }))
    try {
      const ex = await explorerApi.extras(connId, db)
      set((s) => ({ extras: { ...s.extras, [key]: ex } }))
    } catch (err) {
      set((s) => ({
        extras: { ...s.extras, [key]: undefined },
        errors: { ...s.errors, [key]: String(err) }
      }))
    }
  },

  loadDetail: async (connId, db, schema, name) => {
    const key = `${connId}|${db}|${schema}|${name}`
    if (get().details[key] !== undefined) return
    set((s) => ({ details: { ...s.details, [key]: null } }))
    try {
      const detail = await explorerApi.tableDetail(connId, db, schema, name)
      set((s) => ({ details: { ...s.details, [key]: detail } }))
    } catch {
      set((s) => ({ details: { ...s.details, [key]: undefined } }))
    }
  },

  loadColumns: async (connId, db, schema, name) => {
    const key = `${connId}|${db}|${schema}|${name}`
    if (get().columns[key] !== undefined) return
    set((s) => ({ columns: { ...s.columns, [key]: null } }))
    const cols = await explorerApi.columns(connId, db, schema, name)
    set((s) => ({ columns: { ...s.columns, [key]: cols ?? [] } }))
  },

  loadIndexes: async (connId, db, schema, name) => {
    const key = `${connId}|${db}|${schema}|${name}`
    if (get().indexes[key] !== undefined) return
    set((s) => ({ indexes: { ...s.indexes, [key]: null } }))
    const idx = await explorerApi.indexes(connId, db, schema, name)
    set((s) => ({ indexes: { ...s.indexes, [key]: idx ?? [] } }))
  },

  refreshDatabase: async (connId, db) => {
    const key = `${connId}|${db}`
    set((s) => {
      const objects = { ...s.objects }
      delete objects[key]
      const extras = { ...s.extras }
      delete extras[key]
      const columns = { ...s.columns }
      const indexes = { ...s.indexes }
      const details = { ...s.details }
      for (const k of Object.keys(columns)) if (k.startsWith(key + '|')) delete columns[k]
      for (const k of Object.keys(indexes)) if (k.startsWith(key + '|')) delete indexes[k]
      for (const k of Object.keys(details)) if (k.startsWith(key + '|')) delete details[k]
      return { objects, extras, columns, indexes, details }
    })
    await Promise.all([get().loadObjects(connId, db), get().loadExtras(connId, db)])
  },

  forgetConnection: (connId) => {
    set((s) => {
      const scrub = <T>(rec: Record<string, T>): Record<string, T> => {
        const out = { ...rec }
        for (const k of Object.keys(out)) if (k === connId || k.startsWith(connId + '|')) delete out[k]
        return out
      }
      return {
        databases: scrub(s.databases),
        objects: scrub(s.objects),
        extras: scrub(s.extras),
        columns: scrub(s.columns),
        indexes: scrub(s.indexes),
        details: scrub(s.details),
        errors: scrub(s.errors)
      }
    })
  }
}))
