// Minimal PostgreSQL script splitter: statements with their leading comments.
// Handles '...' strings, "..." identifiers, -- and /* */ comments and $tag$ quoting.

export interface Stmt {
  /** statement text without comments */
  code: string
  /** comment lines directly before the statement (since the previous statement) */
  comments: string[]
  line: number
}

export function splitSql(sql: string): Stmt[] {
  const out: Stmt[] = []
  let code = ''
  let comments: string[] = []
  let line = 1
  let startLine = 1
  let i = 0
  const n = sql.length
  const flush = () => {
    if (code.trim()) out.push({ code: code.trim(), comments, line: startLine })
    code = ''
    comments = []
  }
  while (i < n) {
    const ch = sql[i]
    if (ch === '\n') line++
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      const text = sql.slice(i, end < 0 ? n : end)
      if (!code.trim()) comments.push(text)
      i = end < 0 ? n : end
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      const text = sql.slice(i, end < 0 ? n : end + 2)
      if (!code.trim()) comments.push(text)
      line += (text.match(/\n/g) ?? []).length
      i = end < 0 ? n : end + 2
      continue
    }
    if (!code.trim() && !/\s/.test(ch)) startLine = line
    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      const s = sql.slice(i, j + 1)
      line += (s.match(/\n/g) ?? []).length
      code += s
      i = j + 1
      continue
    }
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$[A-Za-z_]*\$/)
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length)
        const s = sql.slice(i, end < 0 ? n : end + m[0].length)
        line += (s.match(/\n/g) ?? []).length
        code += s
        i = end < 0 ? n : end + m[0].length
        continue
      }
    }
    if (ch === ';') {
      flush()
      i++
      continue
    }
    code += ch
    i++
  }
  flush()
  return out
}

/** Statement text with string literals and quoted identifiers blanked, for keyword matching. */
export function stripLiterals(code: string): string {
  return code.replace(/'(?:[^']|'')*'/g, "''").replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
}

export type DropKind = 'TABLE' | 'COLUMN' | 'TYPE'

export function dropsIn(code: string): DropKind[] {
  const s = stripLiterals(code).replace(/"(?:[^"]|"")*"/g, 'X')
  const out: DropKind[] = []
  if (/^\s*DROP\s+TABLE\b/i.test(s)) out.push('TABLE')
  if (/^\s*DROP\s+TYPE\b/i.test(s)) out.push('TYPE')
  if (/^\s*ALTER\s+TABLE\b/i.test(s)) {
    const re = /\bDROP\s+(?!CONSTRAINT\b|DEFAULT\b|NOT\b|IDENTITY\b|EXPRESSION\b)(COLUMN\b)?/gi
    if (re.test(s)) out.push('COLUMN')
  }
  return out
}

export function mappingAnnotations(comments: string[]): string[] {
  const refs: string[] = []
  for (const c of comments) {
    const m = c.match(/^--\s*mapping:\s*([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)/)
    if (m) refs.push(m[1])
  }
  return refs
}
