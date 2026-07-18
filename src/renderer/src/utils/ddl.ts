/**
 * Crude DDL detection for the "live mirror": after a successful execution we
 * scan the batch for CREATE/ALTER/DROP statements so the affected object can be
 * re-scripted from the database into the repo.
 *
 * This is deliberately best-effort — it drives an idempotent re-script, so a
 * false positive costs one wasted round trip and a false negative just means
 * the file updates on the next explicit Sync. It is NOT a SQL parser.
 */

export interface DdlObject {
  schema: string
  name: string
}

// A single identifier part: a bracket-quoted [name with anything] or a bare
// run of identifier characters (letters, digits, _, and SQL's @ # $).
const NAME = '(?:\\[[^\\]]+\\]|[\\w@#$]+)'

// CREATE [OR ALTER] | ALTER | DROP  <kind>  <name>[.<name>]
const DDL_RE = new RegExp(
  `\\b(?:create(?:\\s+or\\s+alter)?|alter|drop)\\s+` +
    `(?:proc(?:edure)?|function|view|trigger|table)\\s+` +
    `(${NAME})(?:\\s*\\.\\s*(${NAME}))?`,
  'gi'
)

/** Strip -- line comments and /* *\/ block comments (crudely — ignores strings). */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

function unquote(part: string): string {
  return part.startsWith('[') && part.endsWith(']') ? part.slice(1, -1) : part
}

/**
 * Return the distinct objects targeted by DDL statements in `sql`. Names may be
 * `[schema].[name]`, `schema.name`, `[name]`, or `name`; an unqualified object
 * defaults to schema `dbo`. Case-insensitive; handles multiple statements per
 * batch. De-duplicated case-insensitively on schema+name.
 */
export function detectDdlObjects(sql: string): DdlObject[] {
  const cleaned = stripComments(sql)
  const seen = new Set<string>()
  const out: DdlObject[] = []
  for (const m of cleaned.matchAll(DDL_RE)) {
    const first = unquote(m[1])
    const second = m[2] ? unquote(m[2]) : ''
    const schema = second ? first : 'dbo'
    const name = second || first
    if (!name) continue
    const key = `${schema.toLowerCase()}|${name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ schema, name })
  }
  return out
}
