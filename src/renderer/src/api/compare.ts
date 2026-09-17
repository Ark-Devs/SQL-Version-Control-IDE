import { get, post } from './client'

/** Drift of one object between the repo (at a ref) and a live target database. */
export type CompareState = 'missingOnTarget' | 'different' | 'onlyOnTarget' | 'identical'

export interface CompareObject {
  /** repo-side source identity; disambiguates when two sources share a database name */
  alias: string
  database: string
  schema: string
  name: string
  type: string
  path: string
  state: CompareState
}

/** The list response is metadata-only; SQL bodies are fetched per object via
 *  `objectSql` using the result `id` (large databases would otherwise produce
 *  payloads big enough to crash the renderer). */
export interface CompareResult {
  id: string
  objects: CompareObject[] | null
  warnings: string[] | null
}

export interface CompareObjectSql {
  /** repo side in ref mode; SOURCE side in live mode */
  repoSql: string
  targetSql: string
}

export const compareApi = {
  /** Diff the repo at `ref` against the target connection's live databases.
   *  `aliases` selects which tracked sources to compare (each is scripted from
   *  the same database name on `targetConnId` — compare answers "what would
   *  deploying here change?"). */
  run: (ref: string, targetConnId: string, aliases: string[]) =>
    post<CompareResult>('/repo/compare', { ref, targetConnId, aliases }),

  /** Diff the repo at `ref` against each source's OWN bound database, instead
   *  of one explicit target — "what would checking out this branch change?". */
  runAgainstSources: (ref: string, aliases: string[] = []) =>
    post<CompareResult>('/repo/compare', { ref, aliases }),

  /**
   * Diff two live databases directly — no repository involved. In the result,
   * `repoSql` carries the SOURCE side and "missingOnTarget" means "present on
   * the source only".
   */
  live: (sourceConnId: string, sourceDb: string, targetConnId: string, targetDb: string) =>
    post<CompareResult>('/compare/live', { sourceConnId, sourceDb, targetConnId, targetDb }),

  /** Fetch one object's two SQL sides from a cached compare result. */
  objectSql: (id: string, path: string) =>
    get<CompareObjectSql>(`/compare/${encodeURIComponent(id)}/object?path=${encodeURIComponent(path)}`)
}
