#!/usr/bin/env node
// Validates a refactor output dir against reference/output-contract.md.
// Usage: node check-output.mjs --project <dir with schema.prisma> --out <out dir>
// Exit 0 when clean; exit 1 with a numbered list of problems otherwise.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { readSchema, scalars } from './schema.mjs'

const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const project = arg('project')
const out = arg('out')
if (!project || !out) {
  console.error('usage: check-output.mjs --project <dir> --out <dir>')
  process.exit(2)
}

const problems = []
const P = (s) => problems.push(s)

const FieldMap = z.object({
  source: z.string().min(1),
  action: z.enum(['copy', 'transform', 'move', 'explode', 'derive_away', 'drop']),
  target: z.string().nullable(),
  transform: z.enum(['lowercase_trim', 'cast_decimal', 'cast_datetime', 'cast_boolean', 'map_enum']).nullable().optional(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable().optional(),
  derivable_from: z.string().nullable().optional(),
  decision: z.string().nullable().optional(),
  rules: z.array(z.string()).nullable().optional(),
  reason: z.string().nullable().optional(),
})
const Mapping = z.object({
  version: z.literal(1),
  models: z.array(z.object({
    source: z.string().min(1),
    action: z.enum(['keep', 'rename', 'merge', 'drop']),
    target: z.string().nullable(),
    rules: z.array(z.string()).nullable().optional(),
    reason: z.string().nullable().optional(),
    dedupe: z.object({ key: z.array(z.string()).min(1), winner: z.enum(['oldest_created_at', 'newest_updated_at', 'most_complete']) }).nullable().optional(),
    fields: z.array(FieldMap),
  })),
  new_models: z.array(z.object({ name: z.string(), rules: z.array(z.string()).nullable().optional(), filled_from: z.array(z.string()).nullable().optional() })).nullable().optional(),
})
const Decisions = z.object({
  version: z.literal(1),
  ambiguities: z.array(z.object({ id: z.string().regex(/^AMB-\d+$/), refs: z.array(z.string()).min(1), rule: z.string().nullable().optional(), question: z.string().min(1), options: z.array(z.string()).nullable().optional(), chosen: z.string().nullable().optional() })).nullable().optional(),
  snapshots: z.array(z.object({ id: z.string().regex(/^SNAP-\d+$/), refs: z.array(z.string()).min(1), reason: z.string().nullable().optional() })).nullable().optional(),
  quarantine: z.array(z.object({ source: z.string(), reason: z.enum(['orphan_fk', 'duplicate_loser', 'dangling_token', 'unparseable']), rows: z.number().int() })).nullable().optional(),
  assumptions: z.array(z.string()).nullable().optional(),
})

function loadYaml(file, schema) {
  const p = join(out, file)
  if (!existsSync(p)) return P(`${file} is missing`)
  let raw
  try {
    raw = parseYaml(readFileSync(p, 'utf8'))
  } catch (e) {
    return P(`${file}: YAML parse error: ${e.message.split('\n')[0]}`)
  }
  const r = schema.safeParse(raw)
  if (!r.success) {
    for (const i of r.error.issues.slice(0, 15)) P(`${file}: ${i.path.join('.')}: ${i.message}`)
    return undefined
  }
  return r.data
}

const srcPath = join(project, 'schema.prisma')
const outPath = join(out, 'schema.prisma')
if (!existsSync(srcPath)) {
  console.error(`no schema.prisma in ${project}`)
  process.exit(2)
}
const src = readSchema(srcPath)
let tgt
if (!existsSync(outPath)) P('schema.prisma is missing in the output dir')
else {
  try {
    tgt = readSchema(outPath)
  } catch (e) {
    P(`schema.prisma does not parse: ${e.message.split('\n')[0]}`)
  }
}
const mapping = loadYaml('mapping.yaml', Mapping)
const decisions = loadYaml('decisions.yaml', Decisions)

// --- support models
const SUPPORT = {
  QuarantinedRow: ['id', 'sourceModel', 'sourceId', 'reason', 'payload', 'createdAt'],
  MigrationIdMap: ['id', 'sourceModel', 'sourceId', 'targetModel', 'targetId'],
}
if (tgt) {
  for (const [name, fields] of Object.entries(SUPPORT)) {
    const m = tgt.models.get(name)
    if (!m) P(`support model ${name} missing from schema.prisma`)
    else for (const f of fields) if (!m.fields.some((x) => x.name === f)) P(`support model ${name} lacks field ${f}`)
  }
}

// --- mapping completeness and origins
if (mapping && tgt) {
  const count = new Map()
  for (const mm of mapping.models) count.set(mm.source, (count.get(mm.source) ?? 0) + 1)
  for (const name of src.models.keys()) if ((count.get(name) ?? 0) !== 1) P(`source model ${name} appears ${count.get(name) ?? 0} times in mapping.yaml (must be exactly once)`)
  for (const name of count.keys()) if (!src.models.has(name)) P(`mapping.yaml lists ${name}, which is not a source model`)
  const targetedModels = new Set()
  const targetedFields = new Set()
  for (const mm of mapping.models) {
    const sm = src.models.get(mm.source)
    if (!sm) continue
    if (mm.action === 'drop') {
      if (mm.target) P(`${mm.source}: action drop needs target null`)
    } else if (!mm.target || !tgt.models.has(mm.target)) P(`${mm.source}: target model "${mm.target}" does not exist in output schema.prisma`)
    else targetedModels.add(mm.target)
    if (mm.action === 'keep' && mm.target !== mm.source) P(`${mm.source}: action keep but target is ${mm.target} (use rename or merge)`)
    if (mm.action === 'merge' && mm.target === mm.source) P(`${mm.source}: merge into itself`)
    const fc = new Map()
    for (const fm of mm.fields) fc.set(fm.source, (fc.get(fm.source) ?? 0) + 1)
    for (const f of scalars(sm)) if ((fc.get(f.name) ?? 0) !== 1) P(`${mm.source}.${f.name} appears ${fc.get(f.name) ?? 0} times (must be exactly once)`)
    for (const s of fc.keys()) if (!scalars(sm).some((f) => f.name === s)) P(`${mm.source}.${s} is not a scalar field of the source model (relation fields are excluded)`)
    for (const fm of mm.fields) {
      const ref = `${mm.source}.${fm.source}`
      if (fm.action === 'derive_away' || fm.action === 'drop') {
        if (fm.target) P(`${ref}: ${fm.action} needs target null`)
        if (fm.action === 'drop' && !fm.decision) P(`${ref}: drop needs a decision reference`)
        if (fm.action === 'derive_away' && !fm.derivable_from) P(`${ref}: derive_away needs derivable_from`)
        continue
      }
      const t = /^(\w+)\.(\w+)$/.exec(fm.target ?? '')
      if (!t) {
        P(`${ref}: target "${fm.target}" must be <Model>.<field>`)
        continue
      }
      const tm = tgt.models.get(t[1])
      if (!tm?.fields.some((f) => f.name === t[2] && !f.isRelation)) P(`${ref}: target ${fm.target} is not a scalar field in output schema.prisma`)
      else targetedFields.add(fm.target)
      if (fm.action === 'transform' && !fm.transform) P(`${ref}: transform needs a transform kind`)
      if (fm.transform === 'map_enum' && !fm.values) P(`${ref}: map_enum needs values`)
      if ((fm.action === 'copy' || fm.action === 'move') && tm) {
        const sf = sm.fields.find((f) => f.name === fm.source)
        const tf = tm.fields.find((f) => f.name === t[2])
        if (sf && tf && (sf.type !== tf.type || (sf.native ?? '') !== (tf.native ?? ''))) P(`${ref}: ${fm.action} but type changes ${sf.type}${sf.native ? '@' + sf.native : ''} -> ${tf.type}${tf.native ? '@' + tf.native : ''} (use transform)`)
      }
    }
  }
  const newModels = new Set((mapping.new_models ?? []).map((n) => n.name))
  for (const n of newModels) if (!tgt.models.has(n)) P(`new_models lists ${n}, which is not in output schema.prisma`)
  for (const [name, m] of tgt.models) {
    if (newModels.has(name)) continue
    if (!targetedModels.has(name)) {
      P(`output model ${name} has no origin: not a mapping target and not in new_models`)
      continue
    }
    for (const f of scalars(m)) if (!targetedFields.has(`${name}.${f.name}`) && !(f.id && f.default)) P(`output field ${name}.${f.name} has no origin in mapping.yaml`)
  }
}

// --- new required columns on existing tables need a database-level default
const CLIENT_ONLY = /^(cuid|uuid|nanoid|ulid)\(/
if (mapping && tgt) {
  const targetsOfExisting = new Set(mapping.models.filter((m) => m.action === 'keep' || m.action === 'rename').map((m) => m.target))
  for (const name of targetsOfExisting) {
    const tm = tgt.models.get(name)
    const sm = src.models.get(mapping.models.find((m) => m.target === name && (m.action === 'keep' || m.action === 'rename')).source)
    if (!tm || !sm) continue
    const before = new Set(scalars(sm).map((f) => f.column))
    for (const f of scalars(tm)) {
      if (before.has(f.column) || f.optional || f.list) continue
      if (f.default && CLIENT_ONLY.test(f.default)) P(`${name}.${f.name}: new required column on an existing table with a client-side default @default(${f.default}); raw SQL and other writers get no value. Use a database default (e.g. dbgenerated("gen_random_uuid()::text")).`)
    }
  }
}

// --- snapshots documented on the field
if (decisions && tgt && mapping) {
  const fieldTarget = (ref) => {
    const [m, f] = ref.split('.')
    const fm = mapping.models.find((x) => x.source === m)?.fields.find((x) => x.source === f)
    return fm?.target ?? ref
  }
  for (const s of decisions.snapshots ?? []) {
    for (const ref of s.refs) {
      const [m, f] = fieldTarget(ref).split('.')
      const tf = tgt.models.get(m)?.fields.find((x) => x.name === f)
      if (!tf) P(`${s.id}: ${ref} not found in output schema.prisma`)
      else if (!tf.docs.some((d) => d.includes('@snapshot'))) P(`${s.id}: ${m}.${f} lacks a "/// @snapshot: <reason>" doc comment`)
    }
  }
  for (const qn of decisions.quarantine ?? []) if (!src.models.has(qn.source)) P(`decisions.yaml quarantine source "${qn.source}" must be a source model name (field context belongs in the QuarantinedRow payload)`)
  const newModelNames = new Set((mapping.new_models ?? []).map((n) => n.name))
  for (const mm of mapping.models) for (const fm of mm.fields) {
    if (fm.action === 'move' && fm.target && newModelNames.has(fm.target.split('.')[0])) P(`${mm.source}.${fm.source}: values that become rows of the new model ${fm.target.split('.')[0]} are "explode", not "move"`)
  }
  const ids = new Set([...(decisions.ambiguities ?? []).map((a) => a.id), ...(decisions.snapshots ?? []).map((s) => s.id)])
  for (const mm of mapping.models) for (const fm of mm.fields) if (fm.decision && !ids.has(fm.decision)) P(`${mm.source}.${fm.source}: decision ${fm.decision} not found in decisions.yaml`)
}

// --- migration: exists, every DROP annotated
function splitSql(sql) {
  const stmts = []
  let code = ''
  let comments = []
  let line = 1
  let start = 1
  for (let i = 0; i < sql.length; ) {
    const ch = sql[i]
    if (ch === '\n') line++
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      if (!code.trim()) comments.push(sql.slice(i, end < 0 ? sql.length : end))
      i = end < 0 ? sql.length : end
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      const text = sql.slice(i, end < 0 ? sql.length : end + 2)
      line += (text.match(/\n/g) ?? []).length
      i = end < 0 ? sql.length : end + 2
      continue
    }
    if (!code.trim() && !/\s/.test(ch)) start = line
    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < sql.length && !(sql[j] === ch && sql[j + 1] !== ch)) j += sql[j] === ch ? 2 : 1
      const s = sql.slice(i, j + 1)
      line += (s.match(/\n/g) ?? []).length
      code += s
      i = j + 1
      continue
    }
    const dq = ch === '$' && /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
    if (dq) {
      const end = sql.indexOf(dq[0], i + dq[0].length)
      const s = sql.slice(i, end < 0 ? sql.length : end + dq[0].length)
      line += (s.match(/\n/g) ?? []).length
      code += s
      i = end < 0 ? sql.length : end + dq[0].length
      continue
    }
    if (ch === ';') {
      if (code.trim()) stmts.push({ code: code.trim(), comments, line: start })
      code = ''
      comments = []
      i++
      continue
    }
    code += ch
    i++
  }
  if (code.trim()) stmts.push({ code: code.trim(), comments, line: start })
  return stmts
}
const migDir = join(out, 'migrations')
const migs = existsSync(migDir) ? readdirSync(migDir).filter((d) => statSync(join(migDir, d)).isDirectory() && existsSync(join(migDir, d, 'migration.sql'))) : []
if (!migs.length) P('no migrations/<UTC timestamp>_refactor/migration.sql in the output dir')
const srcMigs = existsSync(join(project, 'migrations')) ? readdirSync(join(project, 'migrations')).filter((d) => statSync(join(project, 'migrations', d)).isDirectory()).sort() : []
for (const d of migs) {
  if (srcMigs.length && d <= srcMigs[srcMigs.length - 1]) P(`migration ${d} does not sort after the last source migration ${srcMigs[srcMigs.length - 1]}`)
  const sql = readFileSync(join(migDir, d, 'migration.sql'), 'utf8')
  for (const st of splitSql(sql)) {
    const s = st.code.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, 'X')
    const drops = []
    if (/^\s*DROP\s+TABLE\b/i.test(s)) drops.push('TABLE')
    if (/^\s*DROP\s+TYPE\b/i.test(s)) drops.push('TYPE')
    if (/^\s*ALTER\s+TABLE\b/i.test(s) && /\bDROP\s+(?!CONSTRAINT\b|DEFAULT\b|NOT\b|IDENTITY\b|EXPRESSION\b)/i.test(s)) drops.push('COLUMN')
    if (/\bNOT\s+VALID\b/i.test(s)) P(`${d}:${st.line}: NOT VALID constraint (constraints must be validated)`)
    if (/\bDISABLE\s+TRIGGER\b/i.test(s)) P(`${d}:${st.line}: DISABLE TRIGGER is not allowed`)
    if (!drops.length) continue
    const refs = st.comments.map((c) => /^--\s*mapping:\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)/.exec(c)?.[1]).filter(Boolean)
    if (!refs.length) P(`${d}:${st.line}: DROP ${drops.join('/')} without a preceding "-- mapping: <SourceModel>[.<field>] ..." comment`)
    else if (mapping && !refs.some((r) => (r.includes('.') ? mapping.models.find((m) => m.source === r.split('.')[0])?.fields.some((f) => f.source === r.split('.')[1]) : mapping.models.some((m) => m.source === r)))) {
      P(`${d}:${st.line}: annotation ${refs.join(', ')} does not name a source model/field from mapping.yaml`)
    }
  }
}

if (problems.length) {
  console.log(`check-output: ${problems.length} problem(s)`)
  problems.slice(0, 200).forEach((p, i) => console.log(`${i + 1}. ${p}`))
  if (problems.length > 200) console.log(`… ${problems.length - 200} more`)
  process.exit(1)
}
console.log('check-output: OK')
