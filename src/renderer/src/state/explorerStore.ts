import { create } from 'zustand'
import { explorerApi } from '../api/endpoints'
import type { ColumnInfo, IndexInfo, ObjectInfo } from '../api/types'

interface ExplorerState {
  /** connId → database names (undefined = not loaded, null = loading) */
  databases: Record<string, string[] | null | undefined>
  /** "connId|db" → objects */
  objects: Record<string, ObjectInfo[] | null | undefined>
  /** "connId|db|schema|name" → columns */
  columns: Record<string, ColumnInfo[] | null | undefined>
  indexes: Record<string, IndexInfo[] | null | undefined>
  errors: Record<string, string>

  loadDatabases: (connId: string) => Promise<void>
  loadObjects: (connId: string, db: string) => Promise<void>
  loadColumns: (connId: string, db: string, schema: string, name: string) => Promise<void>
  loadIndexes: (connId: string, db: string, schema: string, name: string) => Promise<void>
  refreshDatabase: (connId: string, db: string) => Promise<void>
  forgetConnection: (connId: string) => void
}

export const useExplorer = create<ExplorerState>((set, get) => ({
  databases: {},
  objects: {},
  columns: {},
  indexes: {},
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
      const columns = { ...s.columns }
      const indexes = { ...s.indexes }
      for (const k of Object.keys(columns)) if (k.startsWith(key + '|')) delete columns[k]
      for (const k of Object.keys(indexes)) if (k.startsWith(key + '|')) delete indexes[k]
      return { objects, columns, indexes }
    })
    await get().loadObjects(connId, db)
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
        columns: scrub(s.columns),
        indexes: scrub(s.indexes),
        errors: scrub(s.errors)
      }
    })
  }
}))
