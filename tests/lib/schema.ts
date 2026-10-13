// Prisma schema → normalized structure, via @mrleebo/prisma-ast (pure JS, keeps comments).

import { getSchema } from '@mrleebo/prisma-ast'

export interface PRelation {
  name?: string
  fields?: string[]
  references?: string[]
  onDelete?: string
}

export interface PField {
  name: string
  type: string
  list: boolean
  optional: boolean
  id: boolean
  unique: boolean
  default?: string
  map?: string
  native?: string
  updatedAt: boolean
  relation?: PRelation
  /** true when `type` is another model */
  isRelation: boolean
  docs: string[]
}

export interface PModel {
  name: string
  dbName: string
  fields: PField[]
  compoundId?: string[]
  uniques: string[][]
  indexes: string[][]
  map?: string
  /** normalized model-level attributes, sorted */
  attrs: string[]
}

export interface PSchema {
  models: Map<string, PModel>
  enums: Map<string, string[]>
}

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

function valueToString(v: Any): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v.type === 'function') return `${v.name}(${(v.params ?? []).map(valueToString).join(', ')})`
  if (v.type === 'array') return `[${(v.args ?? []).map(valueToString).join(', ')}]`
  if (v.type === 'keyValue') return `${v.key}: ${valueToString(v.value)}`
  if (v.type === 'attributeArgument') return valueToString(v.value)
  return JSON.stringify(v)
}

const unquote = (s: string) => (/^".*"$/.test(s) ? JSON.parse(s) : s)

function listArg(attr: Any): string[] {
  for (const a of attr.args ?? []) {
    const v = a.value
    if (v?.type === 'array') return v.args.map((x: Any) => valueToString(x))
    if (v?.type === 'keyValue' && v.key === 'fields' && v.value?.type === 'array') return v.value.args.map((x: Any) => valueToString(x))
  }
  return []
}

export function parseSchema(text: string): PSchema {
  const ast = getSchema(text)
  const models = new Map<string, PModel>()
  const enums = new Map<string, string[]>()
  for (const b of ast.list as Any[]) {
    if (b.type === 'enum') {
      enums.set(b.name, (b.enumerators ?? []).filter((e: Any) => e.type === 'enumerator').map((e: Any) => e.name))
    }
  }
  const modelNames = new Set((ast.list as Any[]).filter((b) => b.type === 'model').map((b) => b.name))
  for (const b of ast.list as Any[]) {
    if (b.type !== 'model') continue
    const m: PModel = { name: b.name, dbName: b.name, fields: [], uniques: [], indexes: [], attrs: [] }
    let docs: string[] = []
    for (const p of b.properties as Any[]) {
      if (p.type === 'comment') {
        if (String(p.text).startsWith('///')) docs.push(String(p.text).replace(/^\/\/\/\s?/, ''))
        continue
      }
      if (p.type === 'field') {
        const f: PField = {
          name: p.name,
          type: typeof p.fieldType === 'string' ? p.fieldType : valueToString(p.fieldType),
          list: !!p.array,
          optional: !!p.optional,
          id: false,
          unique: false,
          updatedAt: false,
          isRelation: false,
          docs,
        }
        docs = []
        for (const a of (p.attributes ?? []) as Any[]) {
          if (a.group === 'db') {
            f.native = `${a.name}${a.args?.length ? `(${a.args.map((x: Any) => valueToString(x)).join(',')})` : ''}`
            continue
          }
          switch (a.name) {
            case 'id':
              f.id = true
              break
            case 'unique':
              f.unique = true
              break
            case 'updatedAt':
              f.updatedAt = true
              break
            case 'default':
              f.default = valueToString(a.args?.[0])
              break
            case 'map':
              f.map = unquote(valueToString(a.args?.[0]))
              break
            case 'relation': {
              const rel: PRelation = {}
              for (const arg of a.args ?? []) {
                const v = arg.value
                if (typeof v === 'string') rel.name = unquote(v)
                else if (v?.type === 'keyValue') {
                  if (v.key === 'name') rel.name = unquote(valueToString(v.value))
                  if (v.key === 'fields') rel.fields = v.value.args.map((x: Any) => valueToString(x))
                  if (v.key === 'references') rel.references = v.value.args.map((x: Any) => valueToString(x))
                  if (v.key === 'onDelete') rel.onDelete = valueToString(v.value)
                }
              }
              f.relation = rel
              break
            }
          }
        }
        f.isRelation = modelNames.has(f.type)
        m.fields.push(f)
        continue
      }
      if (p.type === 'attribute' && p.kind === 'object') {
        docs = []
        if (p.name === 'map') {
          const mapped: string = unquote(valueToString(p.args?.[0]))
          m.map = mapped
          m.dbName = mapped
        } else if (p.name === 'id') m.compoundId = listArg(p)
        else if (p.name === 'unique') m.uniques.push(listArg(p))
        else if (p.name === 'index') m.indexes.push(listArg(p))
        m.attrs.push(`@@${p.name}(${(p.args ?? []).map((x: Any) => valueToString(x)).join(', ')})`)
      }
    }
    m.attrs.sort()
    models.set(m.name, m)
  }
  return { models, enums }
}

export function scalarFieldsOf(m: PModel): PField[] {
  return m.fields.filter((f) => !f.isRelation)
}
export function forwardRelationsOf(m: PModel): PField[] {
  return m.fields.filter((f) => f.isRelation && f.relation?.fields?.length)
}
export function colName(f: PField): string {
  return f.map ?? f.name
}
export function pkOf(m: PModel): string[] {
  if (m.compoundId) return m.compoundId
  return m.fields.filter((f) => f.id).map((f) => f.name)
}
