// Hard gates H4–H9 (H1–H3 are thin Prisma calls in score-core.ts).

import type pg from 'pg'
import type { Output } from './output.ts'
import { Resolver, qi } from './output.ts'
import type { PModel, PSchema } from './schema.ts'
import { colName, pkOf, scalarFieldsOf } from './schema.ts'
import { dropsIn, mappingAnnotations, splitSql } from './sql.ts'
import type { Snapshot } from './snapshot.ts'
import { diffSnapshots, snapshotDir, snapshotRepo } from './snapshot.ts'

export type Status = 'pass' | 'fail' | 'blocked'
export interface Gate {
  status: Status
  details: string[]
}
export const pass = (details: string[] = []): Gate => ({ status: 'pass', details })
export const fail = (details: string[]): Gate => ({ status: 'fail', details })
export const blocked = (by: string): Gate => ({ status: 'blocked', details: [`blocked by ${by}`] })
const verdict = (details: string[]): Gate => (details.length ? fail(details) : pass())
const cap = (xs: string[], n = 25) => (xs.length > n ? [...xs.slice(0, n), `… ${xs.length - n} more`] : xs)

// ---------------------------------------------------------------------------
// H4 — mapping completeness
// ---------------------------------------------------------------------------
export function h4(out: Output, messy: PSchema): Gate {
  if (out.mappingError) return fail([`mapping.yaml: ${out.mappingError}`])
  if (out.decisionsError) return fail([`decisions.yaml: ${out.decisionsError}`])
  if (!out.schema) return blocked('H1 (schema does not parse)')
  const d: string[] = []
  const mapping = out.mapping!
  const seen = new Map<string, number>()
  for (const mm of mapping.models) seen.set(mm.source, (seen.get(mm.source) ?? 0) + 1)
  for (const m of messy.models.keys()) {
    const n = seen.get(m) ?? 0
    if (n !== 1) d.push(`source model ${m} appears ${n} times`)
  }
  for (const s of seen.keys()) if (!messy.models.has(s)) d.push(`mapping lists unknown source model ${s}`)
  const targetedFields = new Set<string>()
  const targetedModels = new Set<string>()
  for (const mm of mapping.models) {
    const sm = messy.models.get(mm.source)
    if (!sm) continue
    if (mm.action !== 'drop') {
      if (!mm.target || !out.schema.models.has(mm.target)) d.push(`${mm.source}: target model ${mm.target} not in schema.prisma`)
      else targetedModels.add(mm.target)
    } else if (mm.target) d.push(`${mm.source}: drop must have target null`)
    const fseen = new Map<string, number>()
    for (const fm of mm.fields) fseen.set(fm.source, (fseen.get(fm.source) ?? 0) + 1)
    for (const f of scalarFieldsOf(sm)) {
      const n = fseen.get(f.name) ?? 0
      if (n !== 1) d.push(`source field ${mm.source}.${f.name} appears ${n} times`)
    }
    for (const s of fseen.keys()) if (!sm.fields.some((f) => f.name === s && !f.isRelation)) d.push(`mapping lists unknown source field ${mm.source}.${s}`)
    for (const fm of mm.fields) {
      const ref = `${mm.source}.${fm.source}`
      if (fm.action === 'derive_away' || fm.action === 'drop') {
        if (fm.target) d.push(`${ref}: ${fm.action} must have target null`)
        if (fm.action === 'drop' && !fm.decision) d.push(`${ref}: drop requires a decision reference`)
        if (fm.action === 'derive_away' && !fm.derivable_from) d.push(`${ref}: derive_away requires derivable_from`)
        continue
      }
      const t = fm.target?.match(/^(\w+)\.(\w+)$/)
      if (!t) {
        d.push(`${ref}: target "${fm.target}" is not <Model>.<field>`)
        continue
      }
      const tm = out.schema.models.get(t[1])
      const tf = tm?.fields.find((f) => f.name === t[2] && !f.isRelation)
      if (!tf) d.push(`${ref}: target ${fm.target} not in schema.prisma`)
      else targetedFields.add(fm.target!)
      if (fm.action === 'transform' && !fm.transform) d.push(`${ref}: transform without transform kind`)
    }
  }
  const newModels = new Set((mapping.new_models ?? []).map((n) => n.name))
  for (const n of newModels) if (!out.schema.models.has(n)) d.push(`new_models lists ${n}, which is not in schema.prisma`)
  for (const [name, m] of out.schema.models) {
    if (newModels.has(name)) continue
    if (!targetedModels.has(name)) {
      d.push(`target model ${name} has no origin (not a mapping target, not in new_models)`)
      continue
    }
    for (const f of scalarFieldsOf(m)) {
      if (targetedFields.has(`${name}.${f.name}`)) continue
      if (f.id && f.default) continue
      d.push(`target field ${name}.${f.name} has no origin`)
    }
  }
  return verdict(cap(d))
}

// ---------------------------------------------------------------------------
// H5 — reconciliation
// ---------------------------------------------------------------------------
interface Support {
  quarantined: Map<string, Set<string>>
  quarantineByReason: Map<string, number>
  idmap: Map<string, Map<string, { targetModel: string; targetId: string }>>
}

async function tableExists(c: pg.Client, table: string): Promise<boolean> {
  const r = await c.query('SELECT to_regclass($1) AS t', [qi(table)])
  return r.rows[0].t !== null
}

export async function loadSupport(ev: pg.Client, res: Resolver): Promise<Support> {
  const s: Support = { quarantined: new Map(), quarantineByReason: new Map(), idmap: new Map() }
  const qt = res.outTable('QuarantinedRow')
  if (qt && (await tableExists(ev, qt))) {
    const r = await ev.query(`SELECT "sourceModel" AS m, "sourceId" AS id, "reason" AS reason FROM ${qi(qt)}`)
    for (const row of r.rows) {
      if (!s.quarantined.has(row.m)) s.quarantined.set(row.m, new Set())
      s.quarantined.get(row.m)!.add(String(row.id))
      const k = `${row.m}|${row.reason}`
      s.quarantineByReason.set(k, (s.quarantineByReason.get(k) ?? 0) + 1)
    }
  }
  const it = res.outTable('MigrationIdMap')
  if (it && (await tableExists(ev, it))) {
    const r = await ev.query(`SELECT "sourceModel" AS m, "sourceId" AS id, "targetModel" AS tm, "targetId" AS tid FROM ${qi(it)}`)
    for (const row of r.rows) {
      if (!s.idmap.has(row.m)) s.idmap.set(row.m, new Map())
      s.idmap.get(row.m)!.set(String(row.id), { targetModel: row.tm, targetId: String(row.tid) })
    }
  }
  return s
}

async function ids(c: pg.Client, m: PModel): Promise<Set<string>> {
  const pk = pkOf(m)
  if (pk.length !== 1) return new Set()
  const col = colName(m.fields.find((f) => f.name === pk[0])!)
  const r = await c.query(`SELECT ${qi(col)}::text AS id FROM ${qi(m.dbName)}`)
  return new Set(r.rows.map((x) => x.id as string))
}

async function count(c: pg.Client, sql: string): Promise<number> {
  const r = await c.query(sql)
  return Number(Object.values(r.rows[0])[0])
}

function resolveOutModel(res: Resolver, name: string): PModel | undefined {
  const byName = res.out?.models.get(name)
  if (byName) return byName
  for (const m of res.out?.models.values() ?? []) if (m.dbName === name) return m
  return undefined
}

export async function h5(tpl: pg.Client, ev: pg.Client, res: Resolver, sup: Support): Promise<Gate> {
  const d: string[] = []
  const out = res.out!
  const idCache = new Map<string, Set<string>>()
  const outIds = async (m: PModel) => {
    if (!idCache.has(m.name)) idCache.set(m.name, await ids(ev, m))
    return idCache.get(m.name)!
  }
  const allowed = new Map<string, Set<string>>()
  const allow = (t: string, id: string) => {
    if (!allowed.has(t)) allowed.set(t, new Set())
    allowed.get(t)!.add(id)
  }
  for (const [src, sm] of res.messy.models) {
    const mm = res.modelMap(src)
    if (!mm || mm.action === 'drop') continue
    const T = out.models.get(mm.target ?? '')
    if (!T) continue
    const pk = pkOf(sm)
    const q = sup.quarantined.get(src) ?? new Set()
    const mapped = sup.idmap.get(src) ?? new Map()
    if (pk.length === 1) {
      const srcIds = await ids(tpl, sm)
      const tIds = await outIds(T)
      const missing: string[] = []
      for (const id of srcIds) {
        const primary = (mm.action === 'keep' || mm.action === 'rename') && tIds.has(id)
        if (primary) {
          allow(T.name, id)
          continue
        }
        const mp = mapped.get(id)
        if (mp) {
          const tm = resolveOutModel(res, mp.targetModel)
          if (tm && (await outIds(tm)).has(mp.targetId)) {
            allow(tm.name, mp.targetId)
            continue
          }
        }
        if (q.has(id)) continue
        missing.push(id)
      }
      if (missing.length) d.push(`${src}: ${missing.length}/${srcIds.size} source rows neither in ${T.name}, MigrationIdMap nor QuarantinedRow (ids ${missing.slice(0, 5).join(', ')})`)
    } else {
      const srcRows = await count(tpl, `SELECT count(*) FROM ${qi(sm.dbName)}`)
      const qn = q.size
      if (mm.action === 'keep' || mm.action === 'rename') {
        const tRows = await count(ev, `SELECT count(*) FROM ${qi(T.dbName)}`)
        if (tRows + qn !== srcRows) d.push(`${src}: ${srcRows} source rows ≠ ${tRows} in ${T.name} + ${qn} quarantined`)
      } else {
        const mv = mm.fields.find((f) => f.action === 'move' && f.target?.startsWith(`${T.name}.`))
        const tf = mv && T.fields.find((f) => `${T.name}.${f.name}` === mv.target)
        if (tf) {
          const n = await count(ev, `SELECT count(*) FROM ${qi(T.dbName)} WHERE ${qi(colName(tf))} IS NOT NULL`)
          if (n + qn !== srcRows) d.push(`${src}: ${srcRows} source rows ≠ ${n} rows carrying ${mv!.target} + ${qn} quarantined`)
        }
      }
    }
  }
  // Every target row must originate from a source row.
  for (const [src, mm] of res.models) {
    if (mm.action !== 'keep' && mm.action !== 'rename') continue
    const T = out.models.get(mm.target ?? '')
    if (!T || pkOf(T).length !== 1 || !res.messy.models.has(src)) continue
    const extra = [...(await outIds(T))].filter((id) => !allowed.get(T.name)?.has(id))
    if (extra.length) d.push(`${T.name}: ${extra.length} rows without a source row or MigrationIdMap entry (ids ${extra.slice(0, 5).join(', ')})`)
  }
  // Explode children: tokens = child rows + dangling tokens.
  const children = new Map<string, { refs: string[]; sources: Set<string> }>()
  for (const [src, mm] of res.models) {
    for (const fm of mm.fields.filter((f) => f.action === 'explode')) {
      const t = res.targetField(`${src}.${fm.source}`)
      if (!t) continue
      if (!children.has(t.model)) children.set(t.model, { refs: [], sources: new Set() })
      children.get(t.model)!.refs.push(`${src}.${fm.source}`)
      children.get(t.model)!.sources.add(src)
    }
  }
  for (const [child, { refs, sources }] of children) {
    const C = out.models.get(child)
    if (!C) continue
    let tokens = 0
    for (const ref of refs) {
      const [m, f] = ref.split('.')
      const sm = res.messy.models.get(m)!
      const sf = sm.fields.find((x) => x.name === f)!
      const col = qi(colName(sf))
      const tbl = qi(sm.dbName)
      if (sf.type === 'String') tokens += await count(tpl, `SELECT count(*) FROM ${tbl} p CROSS JOIN LATERAL regexp_split_to_table(p.${col}, '[,;|]') t WHERE p.${col} IS NOT NULL AND btrim(t) <> ''`)
      else if (sf.type === 'Json') tokens += await count(tpl, `SELECT coalesce(sum(CASE WHEN jsonb_typeof(${col}) = 'array' THEN jsonb_array_length(${col}) WHEN ${col} IS NULL OR jsonb_typeof(${col}) = 'null' THEN 0 ELSE 1 END), 0) FROM ${tbl}`)
      else tokens += await count(tpl, `SELECT count(${col}) FROM ${tbl}`)
    }
    const rows = await count(ev, `SELECT count(*) FROM ${qi(C.dbName)}`)
    let dangling = 0
    for (const s of sources) dangling += sup.quarantineByReason.get(`${s}|dangling_token`) ?? 0
    if (tokens !== rows + dangling) d.push(`${child}: ${tokens} source tokens ≠ ${rows} child rows + ${dangling} dangling tokens (from ${refs.join(', ')})`)
  }
  return verdict(cap(d))
}

// ---------------------------------------------------------------------------
// H6 — every DROP annotated
// ---------------------------------------------------------------------------
export function h6(out: Output, res: Resolver): Gate {
  if (!out.mapping) return blocked('H4 (mapping.yaml invalid)')
  if (!out.migrations.length) return fail(['no migration found under migrations/'])
  const d: string[] = []
  const exists = (ref: string) => (ref.includes('.') ? !!res.fieldMap(ref) : !!res.modelMap(ref))
  for (const mig of out.migrations) {
    for (const st of splitSql(mig.sql)) {
      const drops = dropsIn(st.code)
      if (!drops.length) continue
      const refs = mappingAnnotations(st.comments)
      if (!refs.length) d.push(`${mig.name}:${st.line}: DROP ${drops.join('/')} without "-- mapping:" annotation`)
      else if (!refs.some(exists)) d.push(`${mig.name}:${st.line}: annotation ${refs.join(', ')} does not point to a mapping entry`)
    }
  }
  return verdict(cap(d))
}

// ---------------------------------------------------------------------------
// H7 — copy/move values unchanged
// ---------------------------------------------------------------------------
export async function h7(tpl: pg.Client, ev: pg.Client, res: Resolver, sup: Support): Promise<Gate> {
  const d: string[] = []
  const out = res.out!
  for (const [src, sm] of res.messy.models) {
    const mm = res.modelMap(src)
    if (!mm || mm.action === 'drop') continue
    const pk = pkOf(sm)
    if (pk.length !== 1) continue
    const pkCol = colName(sm.fields.find((f) => f.name === pk[0])!)
    const byTarget = new Map<string, { srcCol: string; dstCol: string; ref: string }[]>()
    for (const fm of mm.fields) {
      if ((fm.action !== 'copy' && fm.action !== 'move') || fm.source === pk[0]) continue
      const t = res.targetField(`${src}.${fm.source}`)
      const sf = sm.fields.find((f) => f.name === fm.source)
      const T = t && out.models.get(t.model)
      const tf = T?.fields.find((f) => f.name === t!.field)
      if (!sf || !T || !tf) continue
      if (!byTarget.has(T.name)) byTarget.set(T.name, [])
      byTarget.get(T.name)!.push({ srcCol: colName(sf), dstCol: colName(tf), ref: `${src}.${fm.source}` })
    }
    if (!byTarget.size) continue
    const q = sup.quarantined.get(src) ?? new Set()
    const idm = sup.idmap.get(src) ?? new Map()
    for (const [tName, cols] of byTarget) {
      const T = out.models.get(tName)!
      const tpk = pkOf(T)
      if (tpk.length !== 1) continue
      const tpkCol = colName(T.fields.find((f) => f.name === tpk[0])!)
      const sameIds = tName === mm.target && (mm.action === 'keep' || mm.action === 'rename')
      const md5s = (cs: string[]) => cs.map((c, i) => `md5(${qi(c)}::text) AS c${i}`).join(', ')
      const sRows = (await tpl.query(`SELECT ${qi(pkCol)}::text AS id, ${md5s(cols.map((c) => c.srcCol))} FROM ${qi(sm.dbName)} ORDER BY ${qi(pkCol)}`)).rows
      const tRows = new Map((await ev.query(`SELECT ${qi(tpkCol)}::text AS id, ${md5s(cols.map((c) => c.dstCol))} FROM ${qi(T.dbName)}`)).rows.map((r) => [r.id as string, r]))
      let correlated = 0
      const bad = new Map<string, number>()
      for (const r of sRows) {
        if (q.has(r.id)) continue
        let tid: string | undefined
        const mp = idm.get(r.id)
        if (mp && (resolveOutModel(res, mp.targetModel)?.name === tName)) tid = mp.targetId
        else if (sameIds) tid = r.id
        if (tid === undefined) continue
        const t = tRows.get(tid)
        if (!t) continue
        correlated++
        cols.forEach((c, i) => {
          if (r[`c${i}`] !== t[`c${i}`]) bad.set(c.ref, (bad.get(c.ref) ?? 0) + 1)
        })
      }
      if (!correlated && sRows.length > q.size) d.push(`${src} -> ${tName}: cannot correlate any source row (no shared ids, no MigrationIdMap entries)`)
      for (const [ref, n] of bad) d.push(`${ref}: ${n} row(s) changed although mapped as copy/move`)
    }
  }
  return verdict(cap(d))
}

// ---------------------------------------------------------------------------
// H8 — validated constraints, enabled triggers
// ---------------------------------------------------------------------------
export async function h8(ev: pg.Client): Promise<Gate> {
  const d: string[] = []
  const nv = await ev.query(`SELECT conrelid::regclass::text AS t, conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND NOT c.convalidated`)
  for (const r of nv.rows) d.push(`constraint ${r.conname} on ${r.t} is NOT VALID`)
  const tg = await ev.query(`SELECT tgrelid::regclass::text AS t, tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'`)
  for (const r of tg.rows) d.push(`trigger ${r.tgname} on ${r.t} is disabled`)
  return verdict(d)
}

// ---------------------------------------------------------------------------
// H9 — nothing changed outside the output dir
// ---------------------------------------------------------------------------
export function h9(repoRoot: string, repoBefore: Snapshot | undefined, project?: { dir: string; before: Snapshot; exclude: string[] }): Gate {
  const d: string[] = []
  if (repoBefore) for (const x of diffSnapshots(repoBefore, snapshotRepo(repoRoot))) d.push(`harness checkout ${x}`)
  if (project) for (const x of diffSnapshots(project.before, snapshotDir(project.dir, project.exclude))) d.push(`project ${x}`)
  return verdict(cap(d))
}
