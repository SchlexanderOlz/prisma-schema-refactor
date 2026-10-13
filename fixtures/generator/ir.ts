// Intermediate representation of a Prisma schema plus its data, with printers for
// Prisma schema text, Prisma-compatible PostgreSQL DDL and seed INSERTs.

import type { Rng } from './rng.ts'

export type Value = string | number | boolean | null | object

export interface GenCtx {
  rng: Rng
  i: number
  id: number
  row: Record<string, Value>
  data: Data
  model: Model
}
export type Gen = (c: GenCtx) => Value

export interface Relation {
  fields: string[]
  references: string[]
  onDelete: 'Restrict' | 'Cascade' | 'SetNull'
}

export interface Field {
  name: string
  /** scalar name, enum name, or model name for relation fields */
  type: string
  optional?: boolean
  list?: boolean
  id?: boolean
  unique?: boolean
  default?: string
  native?: string
  map?: string
  updatedAt?: boolean
  relation?: Relation
  doc?: string
  gen?: Gen
  nullRate?: number
}

export interface Model {
  name: string
  domain: string
  rows: number
  fields: Field[]
  compoundId?: string[]
  uniques: string[][]
  indexes: string[][]
  map?: string
}

export interface EnumDef {
  name: string
  values: string[]
}

export interface Schema {
  models: Model[]
  enums: EnumDef[]
}

export type Row = Record<string, Value>
export type Data = Record<string, Row[]>

export const SCALARS = new Set(['String', 'Int', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json'])

/** Deep clone that drops functions (field generators are only needed for the clean data). */
export function clone<T>(x: T): T {
  if (Array.isArray(x)) return x.map((v) => clone(v)) as T
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x)) if (typeof v !== 'function') out[k] = clone(v)
    return out as T
  }
  return x
}

export function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1)
}
export function lcfirst(s: string): string {
  return s[0].toLowerCase() + s.slice(1)
}
export function plural(s: string): string {
  if (/[^s]s$/.test(s)) return s
  if (/[^aeiou]y$/.test(s)) return s.slice(0, -1) + 'ies'
  if (/(s|x|ch|sh)$/.test(s)) return s + 'es'
  return s + 's'
}

export function getModel(s: Schema, name: string): Model {
  const m = s.models.find((x) => x.name === name)
  if (!m) throw new Error(`no model ${name}`)
  return m
}
export function getField(m: Model, name: string): Field {
  const f = m.fields.find((x) => x.name === name)
  if (!f) throw new Error(`no field ${m.name}.${name}`)
  return f
}
export function tableName(m: Model): string {
  return m.map ?? m.name
}
export function colName(f: Field): string {
  return f.map ?? f.name
}
export function isRelationField(f: Field): boolean {
  return !!f.relation
}
export function scalarFields(m: Model): Field[] {
  return m.fields.filter((f) => !f.relation)
}
export function relationFields(m: Model): Field[] {
  return m.fields.filter((f) => f.relation)
}
export function pkFields(m: Model): string[] {
  if (m.compoundId) return m.compoundId
  return m.fields.filter((f) => f.id).map((f) => f.name)
}
export function enumNames(s: Schema): Set<string> {
  return new Set(s.enums.map((e) => e.name))
}

// ---------------------------------------------------------------------------
// Field spec parser:  'String? @unique @default(x)', 'Money', 'Date?',
// '-> Model?' (FK, Restrict), '=> Model' (FK, Cascade), '-> Model @unique' (1:1)
// ---------------------------------------------------------------------------

export function parseFieldSpec(name: string, spec: string): { scalar: Field; relation?: Field } {
  const fk = spec.match(/^(->|=>)\s*(\w+)(\?)?(.*)$/)
  if (fk) {
    const [, arrow, target, opt, rest] = fk
    if (!name.endsWith('Id')) throw new Error(`FK field ${name} must end with Id`)
    const scalar: Field = { name, type: 'Int', optional: !!opt, unique: /@unique/.test(rest) }
    const relation: Field = {
      name: name.slice(0, -2),
      type: target,
      optional: !!opt,
      relation: { fields: [name], references: ['id'], onDelete: arrow === '=>' ? 'Cascade' : 'Restrict' },
    }
    return { scalar, relation }
  }
  const m = spec.match(/^(\w+)(\(([^)]*)\))?(\?)?(.*)$/)
  if (!m) throw new Error(`bad spec ${name}: ${spec}`)
  const [, base, , args, opt, rest] = m
  const f: Field = { name, type: base, optional: !!opt }
  if (base === 'Money') {
    f.type = 'Decimal'
    f.native = 'Decimal(12, 2)'
  } else if (base === 'Decimal') {
    f.native = `Decimal(${(args ?? '12,2').split(',').map((x) => x.trim()).join(', ')})`
  } else if (base === 'Date') {
    f.type = 'DateTime'
    f.native = 'Date'
  }
  if (/@unique/.test(rest)) f.unique = true
  if (/@updatedAt/.test(rest)) f.updatedAt = true
  const d = rest.match(/@default\(((?:[^()]|\(\))*)\)/)
  if (d) f.default = d[1]
  return { scalar: f }
}

// ---------------------------------------------------------------------------
// Relations: back-relation fields and relation names are derived, never stored.
// ---------------------------------------------------------------------------

interface RelInfo {
  source: Model
  field: Field
  target: string
  name?: string
}

export function allRelations(s: Schema): RelInfo[] {
  const rels: RelInfo[] = []
  for (const m of s.models) for (const f of relationFields(m)) rels.push({ source: m, field: f, target: f.type })
  const pairCount = new Map<string, number>()
  const key = (a: string, b: string) => [a, b].sort().join('|')
  for (const r of rels) pairCount.set(key(r.source.name, r.target), (pairCount.get(key(r.source.name, r.target)) ?? 0) + 1)
  for (const r of rels) {
    if (r.source.name === r.target || (pairCount.get(key(r.source.name, r.target)) ?? 0) > 1) {
      r.name = `${r.source.name}${cap(r.field.name)}`
    }
  }
  return rels
}

function isOneToOne(r: RelInfo): boolean {
  const fkName = r.field.relation!.fields
  if (fkName.length !== 1) return false
  const fk = getField(r.source, fkName[0])
  return !!fk.unique
}

export function backRelationFields(s: Schema, m: Model, rels = allRelations(s)): { name: string; type: string; list: boolean; relName?: string }[] {
  const out: { name: string; type: string; list: boolean; relName?: string }[] = []
  for (const r of rels.filter((x) => x.target === m.name)) {
    const one = isOneToOne(r)
    let name = one ? lcfirst(r.source.name) : lcfirst(plural(r.source.name))
    if (r.name) name += `As${cap(r.field.name)}`
    out.push({ name, type: r.source.name, list: !one, relName: r.name })
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out
}

export function relationName(s: Schema, m: Model, f: Field, rels = allRelations(s)): string | undefined {
  return rels.find((r) => r.source === m && r.field === f)?.name
}

/** Models with no relation in either direction. */
export function isolatedModels(s: Schema): string[] {
  const touched = new Set<string>()
  for (const m of s.models)
    for (const f of relationFields(m)) {
      touched.add(m.name)
      touched.add(f.type)
    }
  return s.models.map((m) => m.name).filter((n) => !touched.has(n))
}

// ---------------------------------------------------------------------------
// Prisma printer
// ---------------------------------------------------------------------------

export const SCHEMA_HEADER = `generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
`

function q(s: string): string {
  return JSON.stringify(s)
}

function printField(s: Schema, m: Model, f: Field, rels: RelInfo[]): string[] {
  const lines: string[] = []
  if (f.doc) lines.push(`  /// ${f.doc}`)
  let t = f.type + (f.list ? '[]' : f.optional ? '?' : '')
  const attrs: string[] = []
  if (f.id) attrs.push('@id')
  if (f.default !== undefined) attrs.push(`@default(${f.default})`)
  if (f.unique) attrs.push('@unique')
  if (f.updatedAt) attrs.push('@updatedAt')
  if (f.map) attrs.push(`@map(${q(f.map)})`)
  if (f.native) attrs.push(`@db.${f.native}`)
  if (f.relation) {
    const rn = relationName(s, m, f, rels)
    const parts = []
    if (rn) parts.push(q(rn))
    parts.push(`fields: [${f.relation.fields.join(', ')}]`)
    parts.push(`references: [${f.relation.references.join(', ')}]`)
    parts.push(`onDelete: ${f.relation.onDelete}`)
    attrs.push(`@relation(${parts.join(', ')})`)
  }
  lines.push(`  ${f.name} ${t}${attrs.length ? ' ' + attrs.join(' ') : ''}`)
  return lines
}

export function printModel(s: Schema, m: Model, rels = allRelations(s)): string {
  const lines = [`model ${m.name} {`]
  for (const f of m.fields) lines.push(...printField(s, m, f, rels))
  for (const b of backRelationFields(s, m, rels)) {
    lines.push(`  ${b.name} ${b.type}${b.list ? '[]' : '?'}${b.relName ? ` @relation(${q(b.relName)})` : ''}`)
  }
  const block: string[] = []
  if (m.compoundId) block.push(`  @@id([${m.compoundId.join(', ')}])`)
  for (const u of m.uniques) block.push(`  @@unique([${u.join(', ')}])`)
  for (const ix of m.indexes) block.push(`  @@index([${ix.join(', ')}])`)
  if (m.map) block.push(`  @@map(${q(m.map)})`)
  if (block.length) lines.push('', ...block)
  lines.push('}')
  return lines.join('\n')
}

export function printSchema(s: Schema, extra = ''): string {
  const rels = allRelations(s)
  const parts = [SCHEMA_HEADER]
  for (const e of s.enums) parts.push(`enum ${e.name} {\n${e.values.map((v) => `  ${v}`).join('\n')}\n}\n`)
  for (const m of s.models) parts.push(printModel(s, m, rels) + '\n')
  if (extra) parts.push(extra)
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Prisma-compatible DDL (used for gold migration fragments)
// ---------------------------------------------------------------------------

export function sqlIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

export function colType(s: Schema, f: Field): string {
  if (f.id && f.default === 'autoincrement()' && f.type === 'Int') return 'SERIAL'
  if (enumNames(s).has(f.type)) return sqlIdent(f.type)
  if (f.native) {
    if (f.native === 'Date') return 'DATE'
    const d = f.native.match(/^Decimal\((\d+),\s*(\d+)\)$/)
    if (d) return `DECIMAL(${d[1]},${d[2]})`
    throw new Error(`unsupported native ${f.native}`)
  }
  switch (f.type) {
    case 'String':
      return 'TEXT'
    case 'Int':
      return 'INTEGER'
    case 'Float':
      return 'DOUBLE PRECISION'
    case 'Decimal':
      return 'DECIMAL(65,30)'
    case 'Boolean':
      return 'BOOLEAN'
    case 'DateTime':
      return 'TIMESTAMP(3)'
    case 'Json':
      return 'JSONB'
  }
  throw new Error(`unsupported type ${f.type}`)
}

export function colDefault(f: Field): string {
  if (f.default === undefined || f.default === 'autoincrement()') return ''
  if (f.default === 'now()') return ' DEFAULT CURRENT_TIMESTAMP'
  if (/^".*"$/.test(f.default)) return ` DEFAULT '${JSON.parse(f.default).replace(/'/g, "''")}'`
  if (/^[A-Z_][A-Z0-9_]*$/.test(f.default)) return ` DEFAULT '${f.default}'`
  return ` DEFAULT ${f.default}`
}

export function columnDef(s: Schema, f: Field, forceNullable = false): string {
  const notNull = !f.optional && !forceNullable ? ' NOT NULL' : ''
  return `${sqlIdent(colName(f))} ${colType(s, f)}${notNull}${colDefault(f)}`
}

export function createTableSql(s: Schema, m: Model): string {
  const cols = scalarFields(m).map((f) => `    ${columnDef(s, f)}`)
  const pk = pkFields(m).map((n) => sqlIdent(colName(getField(m, n))))
  const pkLine = `    CONSTRAINT ${sqlIdent(`${tableName(m)}_pkey`)} PRIMARY KEY (${pk.join(', ')})`
  return `CREATE TABLE ${sqlIdent(tableName(m))} (\n${cols.join(',\n')},\n\n${pkLine}\n);`
}

export function createEnumSql(e: EnumDef): string {
  return `CREATE TYPE ${sqlIdent(e.name)} AS ENUM (${e.values.map((v) => `'${v}'`).join(', ')});`
}

export function indexSql(m: Model, cols: string[], unique: boolean): string {
  const phys = cols.map((c) => colName(getField(m, c)))
  const name = `${tableName(m)}_${phys.join('_')}_${unique ? 'key' : 'idx'}`
  return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${sqlIdent(name)} ON ${sqlIdent(tableName(m))}(${phys.map(sqlIdent).join(', ')});`
}

export function fkSql(s: Schema, m: Model, relField: Field): string {
  const target = getModel(s, relField.type)
  const cols = relField.relation!.fields.map((c) => colName(getField(m, c)))
  const refs = relField.relation!.references.map((c) => colName(getField(target, c)))
  const name = `${tableName(m)}_${cols.join('_')}_fkey`
  const od = { Restrict: 'RESTRICT', Cascade: 'CASCADE', SetNull: 'SET NULL' }[relField.relation!.onDelete]
  return `ALTER TABLE ${sqlIdent(tableName(m))} ADD CONSTRAINT ${sqlIdent(name)} FOREIGN KEY (${cols.map(sqlIdent).join(', ')}) REFERENCES ${sqlIdent(tableName(target))}(${refs.map(sqlIdent).join(', ')}) ON DELETE ${od} ON UPDATE CASCADE;`
}

/** All index/unique/FK statements Prisma would emit for a freshly created table. */
export function tableConstraintsSql(s: Schema, m: Model): { indexes: string[]; fks: string[] } {
  const indexes: string[] = []
  for (const f of scalarFields(m)) if (f.unique) indexes.push(indexSql(m, [f.name], true))
  for (const u of m.uniques) indexes.push(indexSql(m, u, true))
  for (const ix of m.indexes) indexes.push(indexSql(m, ix, false))
  const fks = relationFields(m).map((f) => fkSql(s, m, f))
  return { indexes, fks }
}

// ---------------------------------------------------------------------------
// Seed SQL
// ---------------------------------------------------------------------------

export function sqlLiteral(v: Value, f: Field): string {
  if (v === null || v === undefined) return 'NULL'
  if (f.type === 'Json') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`non-finite number in ${f.name}`)
    return String(v)
  }
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
  throw new Error(`unsupported value for ${f.name}: ${JSON.stringify(v)}`)
}

/** Topological order by forward relations (self relations ignored). */
export function fkOrder(s: Schema): Model[] {
  const byName = new Map(s.models.map((m) => [m.name, m]))
  const done = new Set<string>()
  const out: Model[] = []
  const visit = (m: Model, stack: string[]) => {
    if (done.has(m.name)) return
    if (stack.includes(m.name)) throw new Error(`FK cycle: ${[...stack, m.name].join(' -> ')}`)
    for (const f of relationFields(m)) if (f.type !== m.name) visit(byName.get(f.type)!, [...stack, m.name])
    done.add(m.name)
    out.push(m)
  }
  for (const m of s.models) visit(m, [])
  return out
}

export function seedSql(s: Schema, data: Data): string {
  const out: string[] = ['-- Generated by fixtures/generator. Do not edit.', 'SET client_min_messages = warning;', '']
  for (const m of fkOrder(s)) {
    const rows = data[m.name] ?? []
    if (!rows.length) continue
    const fields = scalarFields(m)
    out.push(`INSERT INTO ${sqlIdent(tableName(m))} (${fields.map((f) => sqlIdent(colName(f))).join(', ')}) VALUES`)
    out.push(rows.map((r) => `  (${fields.map((f) => sqlLiteral(r[f.name] ?? null, f)).join(', ')})`).join(',\n') + ';')
    const idf = m.fields.find((f) => f.id && f.default === 'autoincrement()')
    if (idf) {
      out.push(
        `SELECT setval(pg_get_serial_sequence('${sqlIdent(tableName(m)).replace(/'/g, "''")}', '${colName(idf)}'), (SELECT max(${sqlIdent(colName(idf))}) FROM ${sqlIdent(tableName(m))}));`,
      )
    }
    out.push('')
  }
  return out.join('\n')
}
