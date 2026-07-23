import { post } from './client'

/** Drift of one object between the repo (at a ref) and a live target database. */
export type CompareState = 'missingOnTarget' | 'different' | 'onlyOnTarget' | 'identical'

export interface CompareObject {
  database: string
  schema: string
  name: string
  type: string
  path: string
  state: CompareState
  /** populated only for non-identical objects */
  repoSql?: string
  targetSql?: string
}

export interface CompareResult {
  objects: CompareObject[] | null
  warnings: string[] | null
}

export const compareApi = {
  /** Diff the repo at `ref` against the target connection's live databases. */
  run: (ref: string, targetConnId: string, databases: string[]) =>
    post<CompareResult>('/repo/compare', { ref, targetConnId, databases }),

  /**
   * Diff two live databases directly — no repository involved. In the result,
   * `repoSql` carries the SOURCE side and "missingOnTarget" means "present on
   * the source only".
   */
  live: (sourceConnId: string, sourceDb: string, targetConnId: string, targetDb: string) =>
    post<CompareResult>('/compare/live', { sourceConnId, sourceDb, targetConnId, targetDb })
}
