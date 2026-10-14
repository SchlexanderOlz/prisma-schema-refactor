#!/usr/bin/env node
// Read-only data profile of the scratch database, as evidence for the rules in reference/rules.md.
// Usage: node profile.mjs --schema <project>/schema.prisma --out <file.json>
// Connects ONLY to $SCRATCH_DATABASE_URL, in a read-only transaction with a statement timeout.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import pg from 'pg'
import { field, forwardRelations, pk, q, readSchema, scalars } from './schema.mjs'

const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const schemaPath = arg('schema')
const outPath = arg('out')
const SAMPLES = Number(arg('samples') ?? 3)
if (!schemaPath || !outPath) {
  console.error('usage: profile.mjs --schema <schema.prisma> --out <profile.json>')
  process.exit(2)
}
const url = process.env.SCRATCH_DATABASE_URL
if (!url) {
  console.error('SCRATCH_DATABASE_URL is not set. Refusing to connect to anything else.')
  process.exit(2)
}

const { models, enums } = readSchema(schemaPath)
const client = new pg.Client({ connectionString: url, statement_timeout: 30000 })
await client.connect()
await client.query('SET default_transaction_read_only = on')
await client.query('BEGIN READ ONLY')

const one = async (sql) => {
  const r = await client.query(sql)
  return r.rows[0]
}
const num = (x) => (x === null || x === undefined ? null : Number(x))
const r3 = (x) => Math.round(x * 1000) / 1000
const rate = (part, whole) => (whole ? r3(Number(part) / Number(whole)) : null)

const ID_LIKE = /^(.+?)(_id|Id|ID)$/
const KEY_LIKE = /(email|sku|code|number|slug|key|reference|externalId|handle|username|login)$/i
const BOOL_WORDS = ['yes', 'no', 'y', 'n', 'true', 'false', 't', 'f', '1', '0', 'on', 'off']

function findTargetModel(base) {
  const b = base.toLowerCase().replace(/_/g, '')
  const all = [...models.values()]
  return (
    all.find((m) => m.name.toLowerCase() === b) ??
    all.find((m) => m.table.toLowerCase().replace(/_/g, '') === b) ??
    all.find((m) => b.endsWith(m.name.toLowerCase())) ??
    all.find((m) => m.name.toLowerCase().endsWith(b)) ??
    null
  )
}

const relationFkColumns = (m) => new Set(forwardRelations(m).flatMap((r) => r.relation.fields))
const referencedBy = new Map()
for (const m of models.values()) {
  for (const r of forwardRelations(m)) {
    if (!referencedBy.has(r.type)) referencedBy.set(r.type, [])
    referencedBy.get(r.type).push({ model: m.name, fields: r.relation.fields })
  }
}

const profile = { generatedFor: schemaPath, models: {}, schemaFindings: {}, relationEvidence: { transitiveCopies: [], pathAgreement: [], derivedAggregates: [], joinCardinality: [] } }

for (const m of models.values()) {
  const T = q(m.table)
  const rows = num((await one(`SELECT count(*) AS n FROM ${T}`)).n)
  const pkCols = pk(m)
  const fkCols = relationFkColumns(m)
  const mp = { table: m.table, rows, primaryKey: pkCols, relations: forwardRelations(m).map((r) => ({ field: r.name, to: r.type, fields: r.relation.fields, onDelete: r.relation.onDelete ?? null })), referencedBy: referencedBy.get(m.name) ?? [], fields: {}, idLikeWithoutRelation: [], candidateKeys: [] }
  for (const f of scalars(m)) {
    const C = q(f.column)
    // List columns (String[], Int[] …) get element statistics instead of the scalar analyses.
    const isText = f.type === 'String' && !f.list
    const isJson = f.type === 'Json' && !f.list
    const base = await one(
      `SELECT count(*) FILTER (WHERE ${C} IS NULL) AS nulls, count(DISTINCT ${isJson ? `${C}::text` : C}) AS distinct${isText ? `, max(length(${C})) AS maxlen` : ''} FROM ${T}`,
    )
    const nonNull = rows - num(base.nulls)
    const fp = {
      type: f.type + (f.list ? '[]' : f.optional ? '?' : ''),
      native: f.native ?? null,
      enum: enums.has(f.type) ? enums.get(f.type) : undefined,
      nullRate: rows ? r3(num(base.nulls) / rows) : null,
      distinct: num(base.distinct),
      maxLength: isText ? num(base.maxlen) : undefined,
      samples: (await client.query(`SELECT DISTINCT ${C}::text AS v FROM ${T} WHERE ${C} IS NOT NULL ORDER BY 1 LIMIT ${SAMPLES}`)).rows.map((r) => (r.v.length > 60 ? r.v.slice(0, 57) + '...' : r.v)),
    }
    if (isText && nonNull) {
      const p = await one(`SELECT
          count(*) FILTER (WHERE ${C} ~ '^\\s*[-+]?\\d+\\s*$') AS int,
          count(*) FILTER (WHERE ${C} ~ '^\\s*[-+]?\\d+([.,]\\d+)?\\s*$') AS dec,
          count(*) FILTER (WHERE ${C} ~ '^\\d{4}-\\d{2}-\\d{2}([T ]\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:?\\d{2})?)?$') AS iso,
          count(*) FILTER (WHERE ${C} ~ '^\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}$') AS otherdate,
          count(*) FILTER (WHERE lower(btrim(${C})) = ANY($1)) AS bool,
          count(*) FILTER (WHERE ${C} ~ '^\\s*[-+]?\\d+([.,]\\d+)?\\s*[A-Za-z]+\\s*$') AS withunit,
          count(*) FILTER (WHERE ${C} ~ '[,;|]') AS delimited,
          count(*) FILTER (WHERE ${C} <> btrim(${C})) AS untrimmed,
          count(DISTINCT upper(btrim(${C}))) AS normdistinct
        FROM ${T} WHERE ${C} IS NOT NULL`.replace('$1', `ARRAY[${BOOL_WORDS.map((w) => `'${w}'`).join(',')}]`))
      const parse = {
        int: rate(p.int, nonNull), decimal: rate(p.dec, nonNull), isoDate: rate(p.iso, nonNull), otherDate: rate(p.otherdate, nonNull),
        booleanWords: rate(p.bool, nonNull), numberWithUnit: rate(p.withunit, nonNull),
      }
      for (const k of Object.keys(parse)) if (!parse[k]) delete parse[k]
      if (Object.keys(parse).length) fp.parse = parse
      if (num(p.untrimmed)) fp.untrimmedRate = rate(p.untrimmed, nonNull)
      if (num(p.normdistinct) !== num(base.distinct)) fp.distinctCaseInsensitiveTrimmed = num(p.normdistinct)
      if (num(p.delimited)) {
        const toks = (await client.query(`SELECT btrim(t) AS t FROM ${T} x CROSS JOIN LATERAL regexp_split_to_table(x.${C}, '[,;|]') t WHERE x.${C} ~ '[,;|]' AND btrim(t) <> '' LIMIT 500`)).rows.map((r) => r.t)
        fp.delimitedList = {
          rate: rate(p.delimited, nonNull),
          tokens: toks.length,
          numericTokenShare: toks.length ? r3(toks.filter((t) => /^\d+$/.test(t)).length / toks.length) : null,
          codeLikeTokenShare: toks.length ? r3(toks.filter((t) => /^[A-Za-z0-9_-]{1,40}$/.test(t)).length / toks.length) : null,
          sampleTokens: [...new Set(toks)].slice(0, 8),
        }
      }
      if (num(base.distinct) <= 20) {
        fp.values = (await client.query(`SELECT ${C} AS v, count(*)::int AS n FROM ${T} WHERE ${C} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1`)).rows.map((r) => [r.v, r.n])
      }
    }
    if (isJson && nonNull) {
      const kinds = (await client.query(`SELECT jsonb_typeof(${C}) AS k, count(*)::int AS n FROM ${T} WHERE ${C} IS NOT NULL GROUP BY 1 ORDER BY 1`)).rows
      const elemKeys = (await client.query(`SELECT k, count(*)::int AS n FROM ${T} x CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(x.${C}) = 'array' THEN x.${C} ELSE '[]'::jsonb END) e CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(e) = 'object' THEN e ELSE '{}'::jsonb END) k GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 30`)).rows
      const objKeys = (await client.query(`SELECT k, count(*)::int AS n FROM ${T} x CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(x.${C}) = 'object' THEN x.${C} ELSE '{}'::jsonb END) k GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 30`)).rows
      const elems = await one(`SELECT coalesce(sum(jsonb_array_length(${C})), 0) AS n FROM ${T} WHERE jsonb_typeof(${C}) = 'array'`)
      fp.json = { kinds: Object.fromEntries(kinds.map((r) => [r.k, r.n])), arrayElements: num(elems.n), arrayElementKeys: Object.fromEntries(elemKeys.map((r) => [r.k, r.n])), objectKeys: Object.fromEntries(objKeys.map((r) => [r.k, r.n])) }
    }
    if (f.list && nonNull) {
      const l = await one(`SELECT coalesce(sum(cardinality(${C})), 0) AS elems, coalesce(max(cardinality(${C})), 0) AS maxlen, count(*) FILTER (WHERE cardinality(${C}) = 0) AS empty FROM ${T} WHERE ${C} IS NOT NULL`)
      fp.list = { elements: num(l.elems), maxPerRow: num(l.maxlen), emptyArrays: num(l.empty) }
    }
    mp.fields[f.name] = fp

    // array of ids without a relation (R2)
    const idl = f.list && f.name.match(/^(.+?)(Ids|_ids|IDs)$/)
    if (idl && !fkCols.has(f.name)) {
      const target = findTargetModel(idl[1])
      const entry = { field: f.name, guessedTarget: target?.name ?? null }
      if (target && pk(target).length === 1) {
        const tpk = q(field(target, pk(target)[0]).column)
        const o = await one(`SELECT count(*) AS n, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ${q(target.table)} t WHERE t.${tpk}::text = e::text)) AS dangling FROM ${T} x CROSS JOIN LATERAL unnest(x.${C}) e`)
        entry.elements = num(o.n)
        entry.dangling = num(o.dangling)
        entry.matchRate = rate(num(o.n) - num(o.dangling), num(o.n))
      }
      mp.idArraysWithoutRelation = [...(mp.idArraysWithoutRelation ?? []), entry]
    }

    // id-like scalar without a declared relation (R7)
    const idm = f.name.match(ID_LIKE)
    if (idm && !f.id && !fkCols.has(f.name) && !pkCols.includes(f.name)) {
      const target = findTargetModel(idm[1])
      const entry = { field: f.name, guessedTarget: target?.name ?? null }
      if (target && pk(target).length === 1) {
        const tpk = q(field(target, pk(target)[0]).column)
        const o = await one(`SELECT count(*) FILTER (WHERE x.${C} IS NOT NULL) AS nn, count(*) FILTER (WHERE x.${C} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${q(target.table)} t WHERE t.${tpk}::text = x.${C}::text)) AS orphans FROM ${T} x`)
        entry.nonNull = num(o.nn)
        entry.orphans = num(o.orphans)
        entry.matchRate = rate(num(o.nn) - num(o.orphans), num(o.nn))
      }
      mp.idLikeWithoutRelation.push(entry)
    }

    // candidate natural keys (R13)
    if ((f.unique || KEY_LIKE.test(f.name)) && !f.id && !f.list && (isText || f.type === 'Int') && !fkCols.has(f.name)) {
      // Hash of all non-PK columns; to_jsonb avoids the 100-argument limit of concat_ws on wide tables.
      const pkPhys = pkCols.map((n) => field(m, n).column)
      const rowExpr = `md5((to_jsonb(x) - ARRAY[${pkPhys.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ')}]::text[])::text)`
      const d = await one(`SELECT count(*) AS groups, coalesce(sum(n - 1), 0) AS extra, count(*) FILTER (WHERE variants = 1) AS exact
        FROM (SELECT x.${C} AS k, count(*) AS n, count(DISTINCT ${rowExpr}) AS variants FROM ${T} x WHERE x.${C} IS NOT NULL GROUP BY 1 HAVING count(*) > 1) g`)
      mp.candidateKeys.push({ field: f.name, declaredUnique: f.unique, duplicateGroups: num(d.groups), duplicateExtraRows: num(d.extra), exactCopyGroups: num(d.exact), conflictingGroups: num(d.groups) - num(d.exact) })
    }
  }
  profile.models[m.name] = mp
}

// ---------------------------------------------------------------------------
// Relation evidence (R4, R8, R9, R17)
// ---------------------------------------------------------------------------
const singleFkRelations = (m) => forwardRelations(m).filter((r) => r.relation.fields.length === 1 && pk(models.get(r.type)).length === 1)
const comparable = (a, b) => a.type === b.type && !a.list && !b.list && !a.isRelation && !b.isRelation && !['Json', 'Boolean', 'Bytes'].includes(a.type)

for (const m of models.values()) {
  const fkCols = relationFkColumns(m)
  for (const r of singleFkRelations(m)) {
    const t = models.get(r.type)
    const tpk = field(t, pk(t)[0])
    const pairs = []
    for (const f of scalars(m)) {
      if (f.id || fkCols.has(f.name)) continue
      for (const g of scalars(t)) if (!g.id && comparable(f, g) && !relationFkColumns(t).has(g.name)) pairs.push([f, g])
    }
    if (!pairs.length) continue
    // Chunked: wide models produce more pairs than one SELECT list may hold (1664 entries).
    const row = {}
    for (let c0 = 0; c0 < pairs.length; c0 += 300) {
      const sel = pairs.slice(c0, c0 + 300).map(([f, g], k) => `count(*) FILTER (WHERE x.${q(f.column)} IS NOT NULL AND x.${q(f.column)} = t.${q(g.column)}) AS e${c0 + k}, count(x.${q(f.column)}) AS n${c0 + k}, count(DISTINCT x.${q(f.column)}) AS d${c0 + k}`).join(', ')
      Object.assign(row, await one(`SELECT ${sel} FROM ${q(m.table)} x JOIN ${q(t.table)} t ON t.${q(tpk.column)} = x.${q(field(m, r.relation.fields[0]).column)}`))
    }
    pairs.forEach(([f, g], i) => {
      const rt = rate(row[`e${i}`], row[`n${i}`])
      // A copy needs variety: equal booleans or one repeated value prove nothing.
      if (rt !== null && rt >= 0.5 && num(row[`n${i}`]) >= 5 && num(row[`d${i}`]) >= 3) {
        profile.relationEvidence.transitiveCopies.push({ model: m.name, field: f.name, via: r.name, equals: `${t.name}.${g.name}`, rows: num(row[`n${i}`]), equalRate: rt })
      }
    })
  }
  // R8: m.b -> B duplicated by m.a -> A and A.c -> B
  for (const ra of singleFkRelations(m)) {
    const A = models.get(ra.type)
    for (const rb of singleFkRelations(m)) {
      if (rb === ra) continue
      for (const rc of singleFkRelations(A)) {
        if (rc.type !== rb.type || A.name === m.name) continue
        const apk = field(A, pk(A)[0]).column
        const row = await one(`SELECT count(*) AS n, count(*) FILTER (WHERE x.${q(field(m, rb.relation.fields[0]).column)} = a.${q(field(A, rc.relation.fields[0]).column)}) AS agree
          FROM ${q(m.table)} x JOIN ${q(A.table)} a ON a.${q(apk)} = x.${q(field(m, ra.relation.fields[0]).column)}
          WHERE x.${q(field(m, rb.relation.fields[0]).column)} IS NOT NULL AND a.${q(field(A, rc.relation.fields[0]).column)} IS NOT NULL`)
        profile.relationEvidence.pathAgreement.push({ model: m.name, field: rb.relation.fields[0], viaPath: `${ra.relation.fields[0]} -> ${A.name}.${rc.relation.fields[0]}`, rows: num(row.n), agreeRate: rate(row.agree, row.n) })
      }
    }
  }
  // R9: two-FK models — how many B per A and A per B
  const rels = singleFkRelations(m)
  const payload = scalars(m).filter((f) => !f.id && !fkCols.has(f.name))
  if (rels.length === 2 && (m.compoundId || payload.length <= 1) && profile.models[m.name].rows > 0) {
    const [a, b] = rels.map((r) => q(field(m, r.relation.fields[0]).column))
    const row = await one(`SELECT (SELECT coalesce(max(n),0) FROM (SELECT count(DISTINCT ${b}) AS n FROM ${q(m.table)} GROUP BY ${a}) s) AS max_b_per_a,
      (SELECT coalesce(max(n),0) FROM (SELECT count(DISTINCT ${a}) AS n FROM ${q(m.table)} GROUP BY ${b}) s) AS max_a_per_b`)
    profile.relationEvidence.joinCardinality.push({ model: m.name, a: `${rels[0].relation.fields[0]} -> ${rels[0].type}`, b: `${rels[1].relation.fields[0]} -> ${rels[1].type}`, maxBPerA: num(row.max_b_per_a), maxAPerB: num(row.max_a_per_b), payloadFields: payload.map((f) => f.name) })
  }
}
// R17: numeric fields equal to an aggregate over children
for (const t of models.values()) {
  if (pk(t).length !== 1) continue
  const tpk = field(t, pk(t)[0]).column
  const numeric = scalars(t).filter((f) => !f.id && !f.list && ['Int', 'Decimal', 'Float'].includes(f.type) && !relationFkColumns(t).has(f.name))
  if (!numeric.length) continue
  for (const ref of referencedBy.get(t.name) ?? []) {
    if (ref.fields.length !== 1) continue
    const c = models.get(ref.model)
    const fk = q(field(c, ref.fields[0]).column)
    const childNums = scalars(c).filter((f) => !f.id && !f.list && ['Int', 'Decimal', 'Float'].includes(f.type) && !relationFkColumns(c).has(f.name)).slice(0, 200)
    const aggs = [['count(*)', 'count'], ...childNums.map((f) => [`sum(${q(f.column)})`, `sum(${f.name})`])] // [sql, what]
    for (const f of numeric) {
      // Only rows where the aggregate is non-zero count: 0 = 0 matches prove nothing.
      const cases = aggs.map(([expr], i) => `count(*) FILTER (WHERE coalesce(a.v${i}, 0) <> 0 AND x.${q(f.column)} = a.v${i}) AS m${i}, count(*) FILTER (WHERE coalesce(a.v${i}, 0) <> 0 OR coalesce(x.${q(f.column)}, 0) <> 0) AS z${i}`).join(', ')
      const sub = `SELECT ${fk} AS k, ${aggs.map(([e], i) => `${e} AS v${i}`).join(', ')} FROM ${q(c.table)} GROUP BY 1`
      const row = await one(`SELECT count(x.${q(f.column)}) AS n, ${cases} FROM ${q(t.table)} x LEFT JOIN (${sub}) a ON a.k = x.${q(tpk)}`)
      aggs.forEach(([, what], i) => {
        const rt = rate(row[`m${i}`], row[`z${i}`])
        if (rt !== null && rt >= 0.8 && num(row[`m${i}`]) >= 3) profile.relationEvidence.derivedAggregates.push({ model: t.name, field: f.name, equals: `${what} of ${c.name} via ${ref.fields[0]}`, rows: num(row[`z${i}`]), matchRate: rt })
      })
    }
  }
}

// R5: model pairs with largely overlapping fields, and how many natural-key values they share
profile.relationEvidence.overlappingModels = []
const BOOKKEEPING = /^(created|updated|deleted|modified)(At|On|_at|_on)?$/i
const sig = (m) => new Set(scalars(m).filter((f) => !f.id && !relationFkColumns(m).has(f.name) && !BOOKKEEPING.test(f.name) && f.default !== 'now()').map((f) => `${f.name}:${f.type}`))
const all = [...models.values()]
for (let i = 0; i < all.length; i++) {
  for (let j = i + 1; j < all.length; j++) {
    const A = all[i]
    const B = all[j]
    const sa = sig(A)
    const sb = sig(B)
    const shared = [...sa].filter((x) => sb.has(x))
    if (shared.length < 3) continue
    const overlap = r3(shared.length / Math.min(sa.size, sb.size))
    if (overlap < 0.6) continue
    const keys = []
    for (const s of shared) {
      const [name] = s.split(':')
      const fa = field(A, name)
      const fb = field(B, name)
      if (!(fa.unique || fb.unique || KEY_LIKE.test(name))) continue
      const row = await one(`SELECT count(*) AS n FROM (SELECT ${q(fa.column)}::text FROM ${q(A.table)} WHERE ${q(fa.column)} IS NOT NULL INTERSECT SELECT ${q(fb.column)}::text FROM ${q(B.table)} WHERE ${q(fb.column)} IS NOT NULL) s`)
      keys.push({ field: name, sharedValues: num(row.n) })
    }
    profile.relationEvidence.overlappingModels.push({ a: A.name, b: B.name, sharedFields: shared.map((s) => s.split(':')[0]), overlapOfSmaller: overlap, referencedBy: { [A.name]: (referencedBy.get(A.name) ?? []).length, [B.name]: (referencedBy.get(B.name) ?? []).length }, keyOverlap: keys })
  }
}

// ---------------------------------------------------------------------------
// Database objects Prisma does not model (RLS policies, triggers, views). Columns they
// reference must not be removed or retyped without care.
// ---------------------------------------------------------------------------
const byTable = new Map([...models.values()].map((m) => [m.table, m]))
function referencedFields(def, ownTable) {
  const idents = new Set([...def.matchAll(/"([^"]+)"/g)].map((x) => x[1]))
  const words = new Set(def.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])
  const tables = [...idents].filter((x) => byTable.has(x))
  if (ownTable && byTable.has(ownTable)) tables.push(ownTable)
  const out = new Set()
  for (const t of new Set(tables)) for (const f of scalars(byTable.get(t))) if (idents.has(f.column) || words.has(f.column)) out.add(`${byTable.get(t).name}.${f.name}`)
  return [...out].sort()
}
const dbo = { rlsEnabled: [], policies: [], triggers: [], views: [] }
for (const r of (await client.query(`SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity ORDER BY 1`)).rows) dbo.rlsEnabled.push(byTable.get(r.t)?.name ?? r.t)
for (const r of (await client.query(`SELECT tablename AS t, policyname AS name, coalesce(qual, '') || ' ' || coalesce(with_check, '') AS def FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`)).rows) dbo.policies.push({ model: byTable.get(r.t)?.name ?? r.t, name: r.name, references: referencedFields(r.def, r.t) })
for (const r of (await client.query(`SELECT c.relname AS t, tg.tgname AS name, pg_get_triggerdef(tg.oid) || ' ' || coalesce(p.prosrc, '') AS def FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_proc p ON p.oid = tg.tgfoid WHERE NOT tg.tgisinternal AND n.nspname = 'public' ORDER BY 1, 2`)).rows) dbo.triggers.push({ model: byTable.get(r.t)?.name ?? r.t, name: r.name, references: referencedFields(r.def, r.t) })
for (const r of (await client.query(`SELECT viewname AS name, definition AS def FROM pg_views WHERE schemaname = 'public' ORDER BY 1`)).rows) dbo.views.push({ name: r.name, references: referencedFields(r.def, null) })
profile.databaseObjects = dbo

// ---------------------------------------------------------------------------
// Schema-only findings
// ---------------------------------------------------------------------------
const isolated = [...models.values()].filter((m) => !forwardRelations(m).length && !(referencedBy.get(m.name) ?? []).length).map((m) => m.name)
const oneToOne = []
for (const m of models.values()) {
  for (const r of forwardRelations(m)) {
    if (r.relation.fields.length !== 1) continue
    const fk = field(m, r.relation.fields[0])
    const otherRelations = forwardRelations(m).length - 1 + (referencedBy.get(m.name) ?? []).length
    if (fk.unique && !fk.optional) oneToOne.push({ model: m.name, parent: r.type, fk: fk.name, otherRelations, payload: scalars(m).filter((f) => !f.id && f !== fk).map((f) => `${f.name}:${f.type}${f.native ? `@${f.native}` : ''}`) })
  }
}
const missingFkIndexes = []
for (const m of models.values()) {
  const covered = new Set([...(m.compoundId ? [m.compoundId[0]] : []), ...m.uniques.map((u) => u[0]), ...m.indexes.map((i) => i[0]), ...m.fields.filter((f) => f.unique || f.id).map((f) => f.name)])
  for (const r of forwardRelations(m)) if (!covered.has(r.relation.fields[0])) missingFkIndexes.push(`${m.name}.${r.relation.fields[0]}`)
}
const naming = []
for (const m of models.values()) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(m.name) || /[^s]s$/.test(m.name)) naming.push(m.name)
  for (const f of m.fields) if (!/^[a-z][A-Za-z0-9]*$/.test(f.name)) naming.push(`${m.name}.${f.name}`)
}
const numbered = []
for (const m of models.values()) {
  const groups = new Map()
  for (const f of scalars(m)) {
    const g = f.name.match(/^(.*?)(\d+)$/)
    if (g) groups.set(g[1], [...(groups.get(g[1]) ?? []), f.name])
  }
  for (const [stem, fs] of groups) if (fs.length >= 2) numbered.push({ model: m.name, stem, fields: fs })
}
// Scoping (tenant/owner) keys: the same FK to the same model on a large share of models.
const fkUse = new Map()
for (const m of models.values()) for (const r of forwardRelations(m)) {
  if (r.relation.fields.length !== 1) continue
  const k = `${r.relation.fields[0]} -> ${r.type}`
  fkUse.set(k, [...(fkUse.get(k) ?? []), m.name])
}
const scoping = [...fkUse].filter(([, ms]) => ms.length >= 5 && ms.length / models.size >= 0.25).map(([k, ms]) => ({ column: k, models: ms.length, share: r3(ms.length / models.size) }))
profile.schemaFindings = { scopingColumns: scoping, modelsWithoutRelations: isolated, requiredUniqueFk: oneToOne, fkWithoutIndex: missingFkIndexes, namingViolations: naming, numberedFieldFamilies: numbered }

// ---------------------------------------------------------------------------
// Highlights: the evidence worth reading first. Everything else is in `models`.
// ---------------------------------------------------------------------------
const H = []
for (const [mn, mp] of Object.entries(profile.models)) {
  for (const [fn, fp] of Object.entries(mp.fields)) {
    const ref = `${mn}.${fn}`
    const nonNull = Math.round(mp.rows * (1 - (fp.nullRate ?? 0)))
    if (fp.type.endsWith('?') && fp.nullRate === 0 && mp.rows >= 10) H.push(`never-null optional: ${ref} (${fp.type})`)
    if (fp.type.startsWith('Float')) H.push(`float column: ${ref}`)
    if (fp.delimitedList && fp.delimitedList.rate >= 0.2 && (fp.delimitedList.numericTokenShare >= 0.5 || fp.delimitedList.codeLikeTokenShare >= 0.8)) H.push(`delimited values: ${ref} rate ${fp.delimitedList.rate}, numeric tokens ${fp.delimitedList.numericTokenShare}`)
    if (fp.distinctCaseInsensitiveTrimmed !== undefined) H.push(`case/whitespace variants: ${ref} ${fp.distinct} raw -> ${fp.distinctCaseInsensitiveTrimmed} normalized values`)
    if (fp.values && fp.type.startsWith('String') && nonNull >= 10 && fp.distinct * 2 <= nonNull) H.push(`repeated string values: ${ref} ${fp.distinct} distinct in ${nonNull} rows`)
    for (const [k, v] of Object.entries(fp.parse ?? {})) if (v === 1) H.push(`all values parse as ${k}: ${ref}`)
    if (fp.parse?.numberWithUnit && fp.parse.numberWithUnit < 1) H.push(`mixed numbers/units: ${ref} (${fp.parse.numberWithUnit} with unit)`)
    if (fp.json?.arrayElements) H.push(`json arrays: ${ref} ${fp.json.arrayElements} elements, element keys ${Object.keys(fp.json.arrayElementKeys).join(',')}`)
  }
  for (const x of mp.idLikeWithoutRelation) if (x.guessedTarget && x.matchRate >= 0.5) H.push(`id-like without @relation: ${mn}.${x.field} -> ${x.guessedTarget}, match ${x.matchRate}, orphans ${x.orphans}`)
  for (const x of mp.idArraysWithoutRelation ?? []) if (x.guessedTarget && x.matchRate >= 0.5) H.push(`array of ids without a relation: ${mn}.${x.field} -> ${x.guessedTarget}, ${x.elements} elements, match ${x.matchRate}, dangling ${x.dangling}`)
  for (const k of mp.candidateKeys) {
    if (k.duplicateGroups) H.push(`duplicates on ${mn}.${k.field}: ${k.duplicateGroups} groups (${k.exactCopyGroups} exact, ${k.conflictingGroups} conflicting)${k.declaredUnique ? '' : ', not unique'}`)
    else if (!k.declaredUnique && mp.rows) H.push(`no duplicates, not unique: ${mn}.${k.field}`)
  }
}
for (const c of profile.relationEvidence.transitiveCopies) H.push(`copy of related value: ${c.model}.${c.field} = ${c.equals} via ${c.via} in ${c.equalRate} of ${c.rows} rows`)
for (const pa of profile.relationEvidence.pathAgreement) if (pa.agreeRate !== null && pa.agreeRate >= 0.95) H.push(`redundant path: ${pa.model}.${pa.field} agrees with ${pa.viaPath} in ${pa.agreeRate} of ${pa.rows} rows`)
for (const d of profile.relationEvidence.derivedAggregates) H.push(`aggregate match: ${d.model}.${d.field} = ${d.equals} in ${d.matchRate} of ${d.rows} rows`)
for (const j of profile.relationEvidence.joinCardinality) if (j.maxAPerB <= 1 || j.maxBPerA <= 1) H.push(`join cardinality: ${j.model} max ${j.maxBPerA} of (${j.b}) per a, max ${j.maxAPerB} of (${j.a}) per b`)
for (const o of profile.relationEvidence.overlappingModels) H.push(`overlapping models: ${o.a} / ${o.b} share ${o.sharedFields.length} fields (${o.overlapOfSmaller} of the smaller), key overlap ${o.keyOverlap.map((k) => `${k.field}=${k.sharedValues}`).join(', ') || 'none'}`)
for (const sc of profile.schemaFindings.scopingColumns) H.push(`scoping (tenant) column: ${sc.column} on ${sc.models} models (${sc.share} of all)`)
for (const m of profile.schemaFindings.modelsWithoutRelations) H.push(`no relations: ${m}`)
{
  const used = new Map()
  for (const [kind, xs] of [['policy', profile.databaseObjects.policies], ['trigger', profile.databaseObjects.triggers], ['view', profile.databaseObjects.views]]) {
    for (const x of xs) for (const ref of x.references) used.set(ref, [...(used.get(ref) ?? []), `${kind} ${x.name}`])
  }
  if (profile.databaseObjects.rlsEnabled.length) H.push(`row-level security enabled on ${profile.databaseObjects.rlsEnabled.length} tables: ${profile.databaseObjects.rlsEnabled.join(', ')}`)
  for (const [ref, by] of [...used].sort()) H.push(`used by database objects outside the schema: ${ref} (${by.slice(0, 3).join(', ')}${by.length > 3 ? ', …' : ''})`)
}
for (const o of profile.schemaFindings.requiredUniqueFk) H.push(`required unique FK (1:1): ${o.model}.${o.fk} -> ${o.parent}, other relations ${o.otherRelations}, payload ${o.payload.join(', ')}`)
for (const f of profile.schemaFindings.fkWithoutIndex) H.push(`FK without index: ${f}`)
for (const n of profile.schemaFindings.numberedFieldFamilies) H.push(`numbered field family: ${n.model}.${n.fields.join('/')}`)
for (const n of profile.schemaFindings.namingViolations) H.push(`naming: ${n}`)
profile.highlights = H

await client.query('ROLLBACK')
await client.end()

// One field per line keeps the file greppable and readable in chunks.
function render(p) {
  const L = ['{', `  "generatedFor": ${JSON.stringify(p.generatedFor)},`, '  "highlights": [']
  L.push(p.highlights.map((h) => `    ${JSON.stringify(h)}`).join(',\n'), '  ],', '  "models": {')
  const ms = Object.entries(p.models)
  ms.forEach(([mn, mp], i) => {
    const { fields, ...rest } = mp
    L.push(`    ${JSON.stringify(mn)}: {`)
    for (const [k, v] of Object.entries(rest)) L.push(`      ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    L.push('      "fields": {')
    const fs = Object.entries(fields)
    fs.forEach(([fn, fv], j) => L.push(`        ${JSON.stringify(fn)}: ${JSON.stringify(fv)}${j < fs.length - 1 ? ',' : ''}`))
    L.push(`      }`, `    }${i < ms.length - 1 ? ',' : ''}`)
  })
  L.push('  },')
  L.push(`  "relationEvidence": {`)
  const re = Object.entries(p.relationEvidence)
  re.forEach(([k, v], i) => {
    L.push(`    ${JSON.stringify(k)}: [`)
    L.push(v.map((x) => `      ${JSON.stringify(x)}`).join(',\n'))
    L.push(`    ]${i < re.length - 1 ? ',' : ''}`)
  })
  L.push('  },', `  "schemaFindings": ${JSON.stringify(p.schemaFindings)}`, '}')
  return L.join('\n') + '\n'
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, render(profile))
JSON.parse(render(profile))
const nModels = Object.keys(profile.models).length
console.log(`profile: ${nModels} models, ${profile.highlights.length} highlights -> ${outPath} (start with "highlights")`)
