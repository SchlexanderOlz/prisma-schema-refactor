// Loading a skill output dir and resolving source refs through its mapping.yaml.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Decisions, FieldMap, Mapping, ModelMap } from './contract.ts'
import { DecisionsZ, MappingZ } from './contract.ts'
import type { PField, PModel, PSchema } from './schema.ts'
import { colName, parseSchema } from './schema.ts'

export interface Output {
  dir: string
  schemaPath: string
  schema?: PSchema
  schemaError?: string
  mapping?: Mapping
  mappingError?: string
  decisions?: Decisions
  decisionsError?: string
  migrationDirs: string[]
  migrations: { name: string; sql: string }[]
}

function loadYaml<T>(path: string, z: { safeParse: (x: unknown) => { success: boolean; data?: T; error?: { issues: { path: PropertyKey[]; message: string }[] } } }): { value?: T; error?: string } {
  if (!existsSync(path)) return { error: `missing ${path}` }
  let raw: unknown
  try {
    raw = parseYaml(readFileSync(path, 'utf8'))
  } catch (e) {
    return { error: `YAML parse error: ${(e as Error).message}` }
  }
  const r = z.safeParse(raw)
  if (!r.success) return { error: r.error!.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  return { value: r.data }
}

export function loadOutput(dir: string): Output {
  const o: Output = { dir, schemaPath: join(dir, 'schema.prisma'), migrationDirs: [], migrations: [] }
  if (!existsSync(o.schemaPath)) o.schemaError = 'schema.prisma missing'
  else {
    try {
      o.schema = parseSchema(readFileSync(o.schemaPath, 'utf8'))
    } catch (e) {
      o.schemaError = `schema parse error: ${(e as Error).message.split('\n')[0]}`
    }
  }
  const m = loadYaml<Mapping>(join(dir, 'mapping.yaml'), MappingZ)
  o.mapping = m.value
  o.mappingError = m.error
  const d = loadYaml<Decisions>(join(dir, 'decisions.yaml'), DecisionsZ)
  o.decisions = d.value
  o.decisionsError = d.error
  const mdir = join(dir, 'migrations')
  if (existsSync(mdir)) {
    for (const name of readdirSync(mdir).sort()) {
      const p = join(mdir, name)
      if (statSync(p).isDirectory() && existsSync(join(p, 'migration.sql'))) {
        o.migrationDirs.push(p)
        o.migrations.push({ name, sql: readFileSync(join(p, 'migration.sql'), 'utf8') })
      }
    }
  }
  return o
}

export class Resolver {
  readonly models = new Map<string, ModelMap>()
  readonly messy: PSchema
  readonly out: PSchema | undefined
  readonly mapping: Mapping | undefined
  constructor(messy: PSchema, out: PSchema | undefined, mapping: Mapping | undefined) {
    this.messy = messy
    this.out = out
    this.mapping = mapping
    for (const mm of mapping?.models ?? []) if (!this.models.has(mm.source)) this.models.set(mm.source, mm)
  }
  modelMap(src: string): ModelMap | undefined {
    return this.models.get(src)
  }
  fieldMap(ref: string): FieldMap | undefined {
    const [m, f] = ref.split('.')
    return this.models.get(m)?.fields.find((x) => x.source === f)
  }
  targetModel(src: string): string | null {
    const mm = this.models.get(src)
    if (!mm || mm.action === 'drop' || !mm.target) return null
    return mm.target
  }
  targetField(ref: string): { model: string; field: string } | null {
    const fm = this.fieldMap(ref)
    if (!fm?.target) return null
    const i = fm.target.lastIndexOf('.')
    if (i < 0) return null
    return { model: fm.target.slice(0, i), field: fm.target.slice(i + 1) }
  }
  outModel(name: string | null | undefined): PModel | undefined {
    return name ? this.out?.models.get(name) : undefined
  }
  outField(model: string, field: string): PField | undefined {
    return this.outModel(model)?.fields.find((f) => f.name === field)
  }
  /** Output model a source ref (`Model` or `Model.field`) ends up in. */
  outModelOfRef(ref: string): PModel | undefined {
    if (ref.includes('.')) {
      const t = this.targetField(ref)
      return this.outModel(t?.model)
    }
    return this.outModel(this.targetModel(ref))
  }
  table(src: string): string | null {
    return this.outModel(this.targetModel(src))?.dbName ?? null
  }
  column(ref: string): string | null {
    const t = this.targetField(ref)
    const f = t && this.outField(t.model, t.field)
    return f ? colName(f) : null
  }
  /** Table of the model a field ref was moved/exploded into. */
  fieldTable(ref: string): string | null {
    const t = this.targetField(ref)
    return this.outModel(t?.model)?.dbName ?? null
  }
  /** Physical table of an output model looked up by its Prisma name. */
  outTable(name: string): string | null {
    return this.outModel(name)?.dbName ?? null
  }
  /** Alternative spellings of a source ref after mapping (for matching decisions refs). */
  aliases(ref: string): string[] {
    const out = new Set([ref])
    if (ref.includes('.')) {
      const t = this.targetField(ref)
      if (t) {
        out.add(`${t.model}.${t.field}`)
      }
    } else {
      const t = this.targetModel(ref)
      if (t) out.add(t)
    }
    return [...out]
  }
}

export const qi = (s: string) => `"${s.replace(/"/g, '""')}"`
