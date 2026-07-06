/**
 * SSMS-style object headers:
 *
 * -- =============================================
 * -- Author:      Jane
 * -- Create date: 2026-07-07
 * -- Description: initial version
 * -- Update date: 2026-07-09   Updated by: Bob
 * -- Update desc: fixed rounding
 * -- =============================================
 */

const SEPARATOR = '-- ============================================='

export function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** True when the script alters a programmable module (deserves a changelog). */
export function isModuleDdl(sql: string): boolean {
  return /\bcreate\s+(or\s+alter\s+)?(proc|procedure|function|view|trigger)\b/i.test(sql)
}

/** Best-effort object name from the DDL header, for the dialog title. */
export function moduleName(sql: string): string {
  const m = /\bcreate\s+(?:or\s+alter\s+)?(?:proc|procedure|function|view|trigger)\s+([[\]\w.]+)/i.exec(sql)
  return m ? m[1].replace(/[[\]]/g, '') : ''
}

function headerBlock(author: string, date: string, desc: string): string {
  return [
    SEPARATOR,
    `-- Author:      ${author}`,
    `-- Create date: ${date}`,
    `-- Description: ${desc}`,
    SEPARATOR
  ].join('\n')
}

/**
 * Inject a changelog into a module script:
 * - if an SSMS-style header block already exists above the CREATE line, append
 *   an update entry before its closing separator;
 * - otherwise insert a fresh header block above the CREATE line.
 */
export function injectChangelog(sql: string, author: string, desc: string): string {
  const date = today()
  const lines = sql.split('\n')

  // find the CREATE [OR ALTER] line (first occurrence outside the header comment)
  let createIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*create\s+(or\s+alter\s+)?(proc|procedure|function|view|trigger)\b/i.test(lines[i])) {
      createIdx = i
      break
    }
  }
  if (createIdx < 0) return sql

  // look for a header block in the comment region above the CREATE line
  const sepIdx: number[] = []
  for (let i = 0; i < createIdx; i++) {
    if (/^\s*--\s*=+\s*$/.test(lines[i])) sepIdx.push(i)
  }
  const hasBlock =
    sepIdx.length >= 2 &&
    lines
      .slice(sepIdx[sepIdx.length - 2], sepIdx[sepIdx.length - 1])
      .some((l) => /--\s*(Author|Create date)\s*:/i.test(l))

  if (hasBlock) {
    const closing = sepIdx[sepIdx.length - 1]
    const entry = [`-- Update date: ${date}   Updated by: ${author}`, `-- Update desc: ${desc}`]
    lines.splice(closing, 0, ...entry)
    return lines.join('\n')
  }

  lines.splice(createIdx, 0, headerBlock(author, date, desc))
  return lines.join('\n')
}

/** Templates for new objects (already carry the header block). */
export function procTemplate(author: string, name: string, desc: string): string {
  return `${headerBlock(author, today(), desc)}
CREATE OR ALTER PROCEDURE ${name}
    -- @Param1 INT
AS
BEGIN
    SET NOCOUNT ON;

    -- body

END
`
}

export function scalarFunctionTemplate(author: string, name: string, desc: string): string {
  return `${headerBlock(author, today(), desc)}
CREATE OR ALTER FUNCTION ${name}
(
    @Param1 INT
)
RETURNS INT
AS
BEGIN
    RETURN @Param1

END
`
}

export function tvfTemplate(author: string, name: string, desc: string): string {
  return `${headerBlock(author, today(), desc)}
CREATE OR ALTER FUNCTION ${name}
(
    @Param1 INT
)
RETURNS TABLE
AS
RETURN
(
    SELECT @Param1 AS Value
)
`
}

export function viewTemplate(author: string, name: string, desc: string): string {
  return `${headerBlock(author, today(), desc)}
CREATE OR ALTER VIEW ${name}
AS
SELECT 1 AS Placeholder
`
}
