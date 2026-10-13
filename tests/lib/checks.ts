// Case checks from fixtures/expected.json, evaluated against an output dir.
// Every source ref is resolved through the output's mapping.yaml, so naming choices don't matter.

import type pg from 'pg'
import type { Decisions } from './contract.ts'
import type { Resolver } from './output.ts'
import { qi } from './output.ts'
import type { PField, PModel, PSchema } from './schema.ts'
import { colName, forwardRelationsOf, pkOf, scalarFieldsOf } from './schema.ts'

export interface Check {
  type: string
  metric?: string
  negate?: boolean
  [k: string]: unknown
}
export interface Case {
  id: string
  kind: 'mess' | 'trap' | 'ambiguity'
  rule: string
  description: string
  metrics: string[]
  models: string[]
  checks: Check[]
  anyOf: Check[][] | null
}
export interface Expected {
  version: 1
  fixtureHash: string
  cases: Case[]
  cleanModels: string[]
  metricCoverage: Record<string, string[]>
}

export interface CheckResult {
  type: string
  metric?: string
  pass: boolean
  detail: string
}
export interface CaseResult {
  id: string
  kind: string
  rule: string
  metrics: string[]
  pass: boolean
  /** index of the passing anyOf group, 'checks' when the main list passed, null when failed */
  branch: string | null
  checks: CheckResult[]
  anyOf: CheckResult[][] | null
}

export interface CheckEnv {
  res: Resolver
  decisions?: Decisions
  ev: pg.Client | null
  tpl: pg.Client | null
}

type R = { pass: boolean; detail: string }
const ok = (detail = 'ok'): R => ({ pass: true, detail })
const no = (detail: string): R => ({ pass: false, detail })

function resolveField(env: CheckEnv, ref: string): { m: PModel; f: PField } | string {
  const fm = env.res.fieldMap(ref)
  if (!fm) return `${ref} not in mapping`
  const t = env.res.targetField(ref)
  if (!t) return `${ref} mapped as ${fm.action} without target`
  const m = env.res.outModel(t.model)
  const f = m?.fields.find((x) => x.name === t.field)
  if (!m || !f) return `${ref} -> ${t.model}.${t.field} not in schema.prisma`
  return { m, f }
}

const norm = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')

function isUniqueSet(m: PModel, fields: string[]): boolean {
  const set = [...fields].sort().join(',')
  if (fields.length === 1) {
    const f = m.fields.find((x) => x.name === fields[0])
    if (f?.unique || f?.id) return true
  }
  const cands = [...m.uniques, ...(m.compoundId ? [m.compoundId] : [])]
  return cands.some((u) => [...u].sort().join(',') === set)
}

function leadsIndex(m: PModel, field: string): boolean {
  const f = m.fields.find((x) => x.name === field)
  if (f?.unique || f?.id) return true
  return [...m.indexes, ...m.uniques, ...(m.compoundId ? [m.compoundId] : [])].some((ix) => ix[0] === field)
}

function refMatches(env: CheckEnv, ambRef: string, wanted: string[]): boolean {
  const forms = new Set(wanted.flatMap((w) => env.res.aliases(w)))
  for (const w of forms) {
    if (ambRef === w || ambRef.startsWith(`${w}.`) || w.startsWith(`${ambRef}.`)) return true
  }
  return false
}

async function scalar(c: pg.Client, sql: string): Promise<number> {
  const r = await c.query(sql)
  const v = r.rows[0] ? Object.values(r.rows[0])[0] : null
  return Number(v)
}

function substitute(env: CheckEnv, sql: string): string {
  return sql.replace(/\{\{([TCFM]):([\w.]+)\}\}/g, (_, kind: string, ref: string) => {
    let v: string | null = null
    if (kind === 'T') v = env.res.table(ref)
    else if (kind === 'C') v = env.res.column(ref)
    else if (kind === 'F') v = env.res.fieldTable(ref)
    else if (kind === 'M') v = env.res.outTable(ref)
    if (!v) throw new Error(`cannot resolve {{${kind}:${ref}}} through mapping.yaml`)
    return qi(v)
  })
}

async function evalCheck(env: CheckEnv, c: Check): Promise<R> {
  const res = env.res
  switch (c.type) {
    case 'merged': {
      const a = res.targetModel(c.a as string)
      const b = res.targetModel(c.b as string)
      return a && a === b && res.outModel(a) ? ok() : no(`${c.a} -> ${a ?? '∅'}, ${c.b} -> ${b ?? '∅'}`)
    }
    case 'not_merged': {
      const a = res.targetModel(c.a as string)
      const b = res.targetModel(c.b as string)
      return a && b && a !== b && res.outModel(a) && res.outModel(b) ? ok() : no(`${c.a} -> ${a ?? '∅'}, ${c.b} -> ${b ?? '∅'}`)
    }
    case 'model_kept': {
      const mm = res.modelMap(c.model as string)
      return mm && (mm.action === 'keep' || mm.action === 'rename') && res.outModel(mm.target) ? ok() : no(`${c.model} mapped as ${mm?.action ?? 'missing'}`)
    }
    case 'field_type': {
      const r = resolveField(env, c.ref as string)
      if (typeof r === 'string') return no(r)
      const nt = c.nativeType as string | undefined
      const good = r.f.type === c.fieldType && (!nt || (r.f.native ?? '').startsWith(nt))
      return good ? ok() : no(`${r.m.name}.${r.f.name} is ${r.f.type}${r.f.native ? ` @db.${r.f.native}` : ''}, want ${c.fieldType}${nt ? ` @db.${nt}*` : ''}`)
    }
    case 'field_required': {
      const r = resolveField(env, c.ref as string)
      if (typeof r === 'string') return no(r)
      return !r.f.optional && !r.f.list ? ok() : no(`${r.m.name}.${r.f.name} is optional`)
    }
    case 'enum_field': {
      const r = resolveField(env, c.ref as string)
      if (typeof r === 'string') return no(r)
      const vals = res.out?.enums.get(r.f.type)
      if (!vals) return no(`${r.m.name}.${r.f.name} is ${r.f.type}, not an enum`)
      const have = new Set(vals.map(norm))
      const missing = (c.valuesSuperset as string[]).filter((v) => !have.has(norm(v)))
      return missing.length ? no(`enum ${r.f.type} lacks ${missing.join(', ')}`) : ok()
    }
    case 'unique': {
      const refs = c.refs as string[]
      const rs = refs.map((x) => resolveField(env, x))
      const bad = rs.find((x) => typeof x === 'string')
      if (bad) return no(bad as string)
      const ms = new Set(rs.map((x) => (x as { m: PModel }).m.name))
      if (ms.size !== 1) return no(`refs land in different models: ${[...ms].join(', ')}`)
      const m = (rs[0] as { m: PModel }).m
      const fields = rs.map((x) => (x as { f: PField }).f.name)
      return isUniqueSet(m, fields) ? ok(`${m.name}(${fields.join(', ')}) unique`) : no(`${m.name}(${fields.join(', ')}) not unique`)
    }
    case 'fk': {
      const r = resolveField(env, c.from as string)
      if (typeof r === 'string') return no(r)
      const to = res.targetModel(c.to as string)
      const rel = forwardRelationsOf(r.m).find((x) => x.relation!.fields!.length === 1 && x.relation!.fields![0] === r.f.name)
      if (!rel) return no(`${r.m.name}.${r.f.name} has no @relation`)
      return rel.type === to ? ok() : no(`${r.m.name}.${r.f.name} references ${rel.type}, want ${to}`)
    }
    case 'index_on': {
      const r = resolveField(env, c.ref as string)
      if (typeof r === 'string') return no(r)
      return leadsIndex(r.m, r.f.name) ? ok() : no(`${r.m.name}.${r.f.name} has no index`)
    }
    case 'field_removed': {
      const fm = res.fieldMap(c.ref as string)
      return fm?.action === 'derive_away' ? ok() : no(`${c.ref} mapped as ${fm?.action ?? 'missing'}`)
    }
    case 'child_model': {
      const of = res.targetModel(c.of as string)
      const fms = (c.fieldsFrom as string[]).map((x) => [x, res.fieldMap(x), res.targetField(x)] as const)
      const notExplode = fms.filter(([, fm]) => fm?.action !== 'explode')
      if (notExplode.length) return no(`${notExplode.map(([x, fm]) => `${x} mapped as ${fm?.action ?? 'missing'}`).join('; ')}`)
      const models = new Set(fms.map(([, , t]) => t?.model))
      if (models.size !== 1) return no(`exploded into several models: ${[...models].join(', ')}`)
      const C = res.outModel([...models][0])
      if (!C) return no('child model not in schema.prisma')
      if (C.name === of) return no('exploded into the parent model itself')
      return forwardRelationsOf(C).some((f) => f.type === of) ? ok(`child ${C.name}`) : no(`${C.name} has no relation to ${of}`)
    }
    case 'join_between': {
      const a = res.targetModel(c.a as string)
      const b = res.targetModel(c.b as string)
      if (!a || !b) return no(`${c.a} -> ${a}, ${c.b} -> ${b}`)
      for (const m of res.out!.models.values()) {
        if (m.name === a || m.name === b) continue
        const types = new Set(forwardRelationsOf(m).map((f) => f.type))
        if (types.has(a) && types.has(b)) return ok(`explicit join ${m.name}`)
      }
      const A = res.outModel(a)!
      const B = res.outModel(b)!
      const implicitA = A.fields.some((f) => f.type === b && f.list && !f.relation?.fields)
      const implicitB = B.fields.some((f) => f.type === a && f.list && !f.relation?.fields)
      return implicitA && implicitB ? ok('implicit m:n') : no(`no join between ${a} and ${b}`)
    }
    case 'snapshot_kept': {
      const ref = c.ref as string
      const fm = res.fieldMap(ref)
      if (fm?.action !== 'copy') return no(`${ref} mapped as ${fm?.action ?? 'missing'}`)
      const r = resolveField(env, ref)
      if (typeof r === 'string') return no(r)
      if (!r.f.docs.some((d) => d.includes('@snapshot'))) return no(`${r.m.name}.${r.f.name} lacks /// @snapshot`)
      const snaps = env.decisions?.snapshots ?? []
      if (!snaps.some((s) => s.refs.some((x) => refMatches(env, x, [ref]) && x.includes('.')))) return no(`no SNAP entry for ${ref}`)
      if (!env.ev || !env.tpl) return no('database unavailable')
      const sm = res.messy.models.get(ref.split('.')[0])!
      const sf = sm.fields.find((f) => f.name === ref.split('.')[1])!
      const spk = colName(sm.fields.find((f) => f.name === pkOf(sm)[0])!)
      const tpk = colName(r.m.fields.find((f) => f.name === pkOf(r.m)[0])!)
      const a = (await env.tpl.query(`SELECT md5(string_agg(md5(${qi(colName(sf))}::text), ',' ORDER BY ${qi(spk)})) AS h FROM ${qi(sm.dbName)}`)).rows[0].h
      const b = (await env.ev.query(`SELECT md5(string_agg(md5(${qi(colName(r.f))}::text), ',' ORDER BY ${qi(tpk)})) AS h FROM ${qi(r.m.dbName)}`)).rows[0].h
      return a === b ? ok() : no(`${ref} values changed`)
    }
    case 'json_kept': {
      const ref = c.ref as string
      const fm = res.fieldMap(ref)
      if (fm?.action !== 'copy') return no(`${ref} mapped as ${fm?.action ?? 'missing'}`)
      const r = resolveField(env, ref)
      if (typeof r === 'string') return no(r)
      return r.f.type === 'Json' ? ok() : no(`${r.m.name}.${r.f.name} is ${r.f.type}`)
    }
    case 'ambiguity_logged': {
      const wanted = c.refsAny as string[]
      const hit = (env.decisions?.ambiguities ?? []).find((a) => a.refs.some((x) => refMatches(env, x, wanted)))
      return hit ? ok(hit.id) : no(`no ambiguity mentions ${wanted.join(' / ')}`)
    }
    case 'physical_name_unchanged': {
      const ref = c.ref as string
      if (ref.includes('.')) {
        const [m, f] = ref.split('.')
        const sf = res.messy.models.get(m)?.fields.find((x) => x.name === f)
        const r = resolveField(env, ref)
        if (typeof r === 'string' || !sf) return no(typeof r === 'string' ? r : `${ref} unknown`)
        return colName(r.f) === colName(sf) ? ok() : no(`column ${colName(sf)} became ${colName(r.f)}`)
      }
      const sm = res.messy.models.get(ref)
      const om = res.outModel(res.targetModel(ref))
      if (!sm || !om) return no(`${ref} not mapped to an output model`)
      return om.dbName === sm.dbName ? ok() : no(`table ${sm.dbName} became ${om.dbName}`)
    }
    case 'naming': {
      const ref = c.ref as string
      if (ref.includes('.')) {
        const r = resolveField(env, ref)
        if (typeof r === 'string') return no(r)
        return /^[a-z][A-Za-z0-9]*$/.test(r.f.name) ? ok(r.f.name) : no(`field ${r.f.name} is not camelCase`)
      }
      const t = res.targetModel(ref)
      if (!t) return no(`${ref} not mapped`)
      const pascal = /^[A-Z][A-Za-z0-9]*$/.test(t)
      const singular = !/[^s]s$/.test(t)
      return pascal && singular ? ok(t) : no(`model ${t} is not PascalCase singular`)
    }
    case 'dedupe_documented': {
      const mm = res.modelMap(c.model as string)
      return mm?.dedupe ? ok() : no(`${c.model} has no dedupe rule`)
    }
    case 'quarantined': {
      if (!env.ev) return no('database unavailable')
      const t = res.outTable('QuarantinedRow')
      if (!t) return no('QuarantinedRow model missing')
      const n = await scalar(env.ev, `SELECT count(*) FROM ${qi(t)} WHERE "sourceModel" = '${String(c.source).replace(/'/g, "''")}' AND "reason" = '${String(c.reason).replace(/'/g, "''")}'`)
      return n === c.rows ? ok() : no(`${n} ${c.reason} rows quarantined from ${c.source}, want ${c.rows}`)
    }
    case 'data_sql': {
      if (!env.ev) return no('database unavailable')
      const sql = substitute(env, c.sql as string)
      const n = await scalar(env.ev, sql)
      return n === c.equals ? ok() : no(`got ${n}, want ${c.equals}`)
    }
  }
  return no(`unknown check type ${c.type}`)
}

async function runCheck(env: CheckEnv, c: Check): Promise<CheckResult> {
  let r: R
  try {
    r = await evalCheck(env, c)
  } catch (e) {
    r = no(`error: ${(e as Error).message.split('\n')[0]}`)
  }
  if (c.negate) r = r.pass ? no(`negated: ${r.detail}`) : ok(`negated: ${r.detail}`)
  return { type: c.type, metric: c.metric, pass: r.pass, detail: r.detail }
}

export async function runCase(env: CheckEnv, k: Case): Promise<CaseResult> {
  const checks: CheckResult[] = []
  for (const c of k.checks) checks.push(await runCheck(env, c))
  let anyOf: CheckResult[][] | null = null
  let branch: string | null = checks.length && checks.every((c) => c.pass) ? 'checks' : null
  if (k.anyOf) {
    anyOf = []
    for (const [i, grp] of k.anyOf.entries()) {
      const rs: CheckResult[] = []
      for (const c of grp) rs.push(await runCheck(env, c))
      anyOf.push(rs)
      if (branch === null && rs.every((r) => r.pass)) branch = `anyOf[${i}]`
    }
  }
  return { id: k.id, kind: k.kind, rule: k.rule, metrics: k.metrics, pass: branch !== null, branch, checks, anyOf }
}

// ---------------------------------------------------------------------------
// S2 — restraint: clean models structurally identical to gold
// ---------------------------------------------------------------------------
export function modelSignature(m: PModel): string[] {
  const sig: string[] = []
  for (const f of scalarFieldsOf(m).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    sig.push(
      `field ${f.name}: ${f.type}${f.list ? '[]' : f.optional ? '?' : ''}` +
        `${f.native ? ` @db.${f.native.replace(/\s+/g, '')}` : ''}${f.default !== undefined ? ` @default(${f.default})` : ''}` +
        `${f.id ? ' @id' : ''}${f.unique ? ' @unique' : ''}${f.map ? ` @map(${f.map})` : ''}`,
    )
  }
  for (const f of forwardRelationsOf(m)) {
    sig.push(`relation [${f.relation!.fields!.join(',')}] -> [${(f.relation!.references ?? []).join(',')}] onDelete ${f.relation!.onDelete ?? 'default'}`)
  }
  sig.sort()
  sig.push(...m.attrs.map((a) => `attr ${a.replace(/\s+/g, '')}`))
  return sig
}

export function compareCleanModel(res: Resolver, gold: PSchema, goldRes: Resolver, name: string): { pass: boolean; diff: string[] } {
  const om = res.outModel(res.modelMap(name) ? res.targetModel(name) : name)
  const gm = gold.models.get(goldRes.targetModel(name) ?? name)
  if (!gm) return { pass: false, diff: ['not in gold'] }
  if (!om) return { pass: false, diff: [`not present in output (mapped as ${res.modelMap(name)?.action ?? 'missing'})`] }
  const a = new Set(modelSignature(om))
  const b = new Set(modelSignature(gm))
  const diff = [...[...b].filter((x) => !a.has(x)).map((x) => `- ${x}`), ...[...a].filter((x) => !b.has(x)).map((x) => `+ ${x}`)]
  if (om.name !== gm.name) diff.push(`model name ${om.name} ≠ ${gm.name}`)
  return { pass: diff.length === 0, diff }
}
