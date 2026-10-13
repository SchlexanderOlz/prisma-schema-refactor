// Shared Prisma schema reader for profile.mjs and check-output.mjs.
import { readFileSync } from 'node:fs'
import { getSchema } from '@mrleebo/prisma-ast'

function str(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v.type === 'function') return `${v.name}(${(v.params ?? []).map(str).join(', ')})`
  if (v.type === 'array') return `[${(v.args ?? []).map(str).join(', ')}]`
  if (v.type === 'keyValue') return `${v.key}: ${str(v.value)}`
  if (v.type === 'attributeArgument') return str(v.value)
  return JSON.stringify(v)
}
const unquote = (s) => (/^".*"$/.test(s) ? JSON.parse(s) : s)

function listArg(attr) {
  for (const a of attr.args ?? []) {
    const v = a.value
    if (v?.type === 'array') return v.args.map(str)
    if (v?.type === 'keyValue' && v.key === 'fields' && v.value?.type === 'array') return v.value.args.map(str)
  }
  return []
}

/**
 * @returns {{ models: Map<string, any>, enums: Map<string, string[]> }}
 * model: { name, table, fields[], compoundId?, uniques[][], indexes[][] }
 * field: { name, column, type, list, optional, id, unique, default?, native?, relation?, isRelation, docs[] }
 */
export function readSchema(path) {
  const ast = getSchema(readFileSync(path, 'utf8'))
  const enums = new Map()
  for (const b of ast.list) if (b.type === 'enum') enums.set(b.name, b.enumerators.filter((e) => e.type === 'enumerator').map((e) => e.name))
  const names = new Set(ast.list.filter((b) => b.type === 'model').map((b) => b.name))
  const models = new Map()
  for (const b of ast.list) {
    if (b.type !== 'model') continue
    const m = { name: b.name, table: b.name, fields: [], uniques: [], indexes: [] }
    let docs = []
    for (const p of b.properties) {
      if (p.type === 'comment') {
        if (p.text.startsWith('///')) docs.push(p.text.replace(/^\/\/\/\s?/, ''))
        continue
      }
      if (p.type === 'field') {
        const f = { name: p.name, column: p.name, type: typeof p.fieldType === 'string' ? p.fieldType : str(p.fieldType), list: !!p.array, optional: !!p.optional, id: false, unique: false, isRelation: false, docs }
        docs = []
        for (const a of p.attributes ?? []) {
          if (a.group === 'db') f.native = `${a.name}${a.args?.length ? `(${a.args.map(str).join(',')})` : ''}`
          else if (a.name === 'id') f.id = true
          else if (a.name === 'unique') f.unique = true
          else if (a.name === 'default') f.default = str(a.args?.[0])
          else if (a.name === 'map') f.column = unquote(str(a.args?.[0]))
          else if (a.name === 'relation') {
            f.relation = {}
            for (const arg of a.args ?? []) {
              const v = arg.value
              if (typeof v === 'string') f.relation.name = unquote(v)
              else if (v?.type === 'keyValue') {
                if (v.key === 'fields') f.relation.fields = v.value.args.map(str)
                if (v.key === 'references') f.relation.references = v.value.args.map(str)
                if (v.key === 'onDelete') f.relation.onDelete = str(v.value)
              }
            }
          }
        }
        f.isRelation = names.has(f.type)
        m.fields.push(f)
      } else if (p.type === 'attribute' && p.kind === 'object') {
        docs = []
        if (p.name === 'map') m.table = unquote(str(p.args?.[0]))
        else if (p.name === 'id') m.compoundId = listArg(p)
        else if (p.name === 'unique') m.uniques.push(listArg(p))
        else if (p.name === 'index') m.indexes.push(listArg(p))
      }
    }
    models.set(m.name, m)
  }
  return { models, enums }
}

export const scalars = (m) => m.fields.filter((f) => !f.isRelation)
export const forwardRelations = (m) => m.fields.filter((f) => f.isRelation && f.relation?.fields?.length)
export const pk = (m) => (m.compoundId ? m.compoundId : m.fields.filter((f) => f.id).map((f) => f.name))
export const field = (m, name) => m.fields.find((f) => f.name === name)
export const q = (s) => `"${String(s).replace(/"/g, '""')}"`
