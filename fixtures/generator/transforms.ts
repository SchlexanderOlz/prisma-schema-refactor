// The mess catalog. Each transform turns a piece of the clean schema/data into its messy
// form and emits (1) the expected case, (2) gold mapping/decisions, (3) gold SQL fragments.

import type { Ctx } from './ctx.ts'
import type { Field, Model, Row, Value } from './ir.ts'
import {
  clone, colName, columnDef, createEnumSql, createTableSql, fkSql, getField, indexSql,
  relationFields, sqlIdent as q, tableConstraintsSql, tableName,
} from './ir.ts'
import { addFkIndexes } from './domains.ts'
import { Rng, SEED } from './rng.ts'
import { COMPANY_STEM, COMPANY_SUFFIX } from './names.ts'

const ann = (s: string) => `-- mapping: ${s}`
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`
const QR = '"quarantined_row"'
const IDMAP = '"migration_id_map"'

function removeIndexesOn(m: Model, field: string) {
  m.indexes = m.indexes.filter((ix) => !ix.includes(field))
  m.uniques = m.uniques.filter((ix) => !ix.includes(field))
}
function removeFk(m: Model, fk: string): Field {
  const scalar = getField(m, fk)
  m.fields = m.fields.filter((f) => f.name !== fk && !(f.relation && f.relation.fields.includes(fk)))
  removeIndexesOn(m, fk)
  return scalar
}
function removeScalar(m: Model, name: string) {
  m.fields = m.fields.filter((f) => f.name !== name)
  removeIndexesOn(m, name)
}
function insertAfter(m: Model, after: string, ...fields: Field[]) {
  const i = m.fields.findIndex((f) => f.name === after)
  if (i < 0) throw new Error(`insertAfter: ${m.name}.${after}`)
  let j = i + 1
  while (j < m.fields.length && m.fields[j].relation && m.fields[j].relation!.fields.includes(after)) j++
  m.fields.splice(j, 0, ...fields)
}
function dropData(ctx: Ctx, model: string, field: string) {
  for (const r of ctx.messyData[model]) delete r[field]
}
const nonNull = (v: Value) => v !== null && v !== undefined

// ===========================================================================
// M01 — duplicate entity
// ===========================================================================
export function m01(ctx: Ctx, o: { id: string; A: string; B: string; key: string; omit: string[]; dupCount: number; newCount: number }) {
  const rng = Rng.from(SEED, `t:${o.id}`)
  const A = ctx.mm(o.A)
  const B: Model = clone(A)
  B.name = o.B
  B.fields = B.fields.filter((f) => !o.omit.includes(f.name) && !(f.relation && o.omit.includes(f.relation.fields[0])))
  B.indexes = []
  B.uniques = []
  addFkIndexes(B)
  ctx.messy.models.splice(ctx.messy.models.indexOf(A) + 1, 0, B)

  const shared = B.fields.filter((f) => !f.relation && !f.id).map((f) => f.name)
  const aRows = ctx.messyData[o.A]
  const dupSrc = rng.sample(aRows, o.dupCount).sort((x, y) => (x.id as number) - (y.id as number))
  const rows: Row[] = []
  for (const r of dupSrc) rows.push(Object.fromEntries(shared.map((f) => [f, r[f]])))
  const newKeys: string[] = []
  for (let j = 0; j < o.newCount; j++) {
    const tpl = rng.pick(aRows)
    const r: Row = Object.fromEntries(shared.map((f) => [f, tpl[f]]))
    const key = `${String(tpl[o.key]).replace(/\d+$/, '')}${String(90001 + j)}`
    r[o.key] = key
    newKeys.push(key)
    // A genuinely new entity: fresh name and contact data, nothing shared with the template row.
    if ('companyName' in r) r.companyName = `${COMPANY_STEM[(j * 5 + 3) % COMPANY_STEM.length]} ${rng.pick(COMPANY_SUFFIX)}`
    for (const f of shared) {
      if (/email/i.test(f)) r[f] = `office${j + 1}@${String(r.companyName ?? 'new').toLowerCase().replace(/[^a-z]+/g, '-')}.example.test`
      else if (/phone/i.test(f) && r[f] !== null) r[f] = `+44 20 7${String(rng.int(0, 999)).padStart(3, '0')} ${String(rng.int(0, 9999)).padStart(4, '0')}`
      else if (/vatId/.test(f)) r[f] = `XU${String(800000000 + j * 7717)}`
    }
    rows.push(r)
  }
  const ordered = rng.shuffle(rows).map((r, i) => ({ id: i + 1, ...r }))
  ctx.messyData[o.B] = ordered

  const tA = q(tableName(A))
  const tB = q(o.B)
  const k = q(o.key)
  const cols = shared.map((f) => q(f)).join(', ')
  ctx.add(
    'quarantine',
    ann(`${o.B} (merge)`),
    `INSERT INTO ${QR} ("sourceModel", "sourceId", "reason", "payload")\nSELECT ${lit(o.B)}, b."id"::text, 'duplicate_loser', to_jsonb(b)\nFROM ${tB} b\nWHERE EXISTS (SELECT 1 FROM ${tA} a WHERE a.${k} = b.${k})\nORDER BY b."id";`,
  )
  ctx.add(
    'data',
    ann(`${o.B} (merge)`),
    `INSERT INTO ${tA} (${cols})\nSELECT ${shared.map((f) => `b.${q(f)}`).join(', ')}\nFROM ${tB} b\nWHERE NOT EXISTS (SELECT 1 FROM ${tA} a WHERE a.${k} = b.${k})\nORDER BY b."id";`,
    `INSERT INTO ${IDMAP} ("sourceModel", "sourceId", "targetModel", "targetId")\nSELECT ${lit(o.B)}, b."id"::text, ${lit(o.A)}, a."id"::text\nFROM ${tB} b JOIN ${tA} a ON a.${k} = b.${k}\nORDER BY b."id";`,
  )
  ctx.add('drop', ann(`${o.B} (merge)`), `DROP TABLE ${tB};`)

  ctx.mapModel(o.B, { action: 'merge', target: o.A, rules: ['R5'], reason: `same concept as ${o.A}: ${shared.length} shared fields and shared ${o.key} values`, dedupe: { key: [o.key], winner: 'oldest_created_at' } })
  ctx.mapField(o.B, 'id', { action: 'move', target: `${o.A}.id`, reason: 'ids remapped via MigrationIdMap' })
  ctx.quarantine.push({ source: o.B, reason: 'duplicate_loser', rows: o.dupCount })

  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R5', description: `${o.B} duplicates ${o.A}`, metrics: ['S1', 'S5'], models: [o.B, o.A],
    checks: [
      { type: 'merged', a: o.B, b: o.A },
      { type: 'quarantined', source: o.B, reason: 'duplicate_loser', rows: o.dupCount },
      { type: 'data_sql', sql: `SELECT count(*) FROM {{T:${o.A}}}`, equals: aRows.length + o.newCount },
      { type: 'data_sql', sql: `SELECT count(*) FROM {{T:${o.A}}} WHERE {{C:${o.A}.${o.key}}} IN (${newKeys.map(lit).join(', ')})`, equals: o.newCount },
      { type: 'data_sql', sql: `SELECT count(*) FROM {{M:MigrationIdMap}} WHERE "sourceModel" = ${lit(o.B)}`, equals: ordered.length },
      { type: 'unique', refs: [`${o.B}.${o.key}`], metric: 'S5' },
    ],
    anyOf: null,
  })
}

// ===========================================================================
// M02 — unneeded 1:1 split
// ===========================================================================
export function m02(ctx: Ctx, o: { id: string; P: string; S: string; fk: string; fields: string[] }) {
  const P = ctx.mm(o.P)
  const moved = o.fields.map((f) => getField(P, f))
  for (const f of o.fields) removeScalar(P, f)
  const S: Model = {
    name: o.S, domain: P.domain, rows: 0,
    fields: [
      { name: 'id', type: 'Int', id: true, default: 'autoincrement()' },
      { name: o.fk, type: 'Int', unique: true },
      { name: lcfirstName(o.P), type: o.P, relation: { fields: [o.fk], references: ['id'], onDelete: 'Cascade' } },
      ...moved.map((f) => ({ ...clone(f), optional: true })),
    ],
    uniques: [], indexes: [],
  }
  ctx.messy.models.splice(ctx.messy.models.indexOf(P) + 1, 0, S)
  const sRows: Row[] = []
  for (const r of ctx.messyData[o.P]) {
    if (o.fields.some((f) => nonNull(r[f]))) sRows.push({ id: sRows.length + 1, [o.fk]: r.id, ...Object.fromEntries(o.fields.map((f) => [f, r[f]])) })
    for (const f of o.fields) delete r[f]
  }
  ctx.messyData[o.S] = sRows

  const g = ctx.gm(o.P)
  const tP = q(tableName(P))
  ctx.add('create', ann(`${o.S} (merge)`), `ALTER TABLE ${tP} ${o.fields.map((f) => `ADD COLUMN ${columnDefGold(ctx, getField(g, f))}`).join(',\n    ')};`)
  ctx.add(
    'data',
    ann(`${o.S} (merge)`),
    `UPDATE ${tP} p SET ${o.fields.map((f) => `${q(f)} = s.${q(f)}`).join(', ')}\nFROM ${q(o.S)} s WHERE s.${q(o.fk)} = p."id";`,
    `INSERT INTO ${IDMAP} ("sourceModel", "sourceId", "targetModel", "targetId")\nSELECT ${lit(o.S)}, s."id"::text, ${lit(o.P)}, s.${q(o.fk)}::text FROM ${q(o.S)} s ORDER BY s."id";`,
  )
  ctx.add('drop', ann(`${o.S} (merge)`), `DROP TABLE ${q(o.S)};`)

  ctx.mapModel(o.S, { action: 'merge', target: o.P, rules: ['R6'], reason: `1:1 split of ${o.P} without blobs or secrets` })
  ctx.mapField(o.S, 'id', { action: 'move', target: `${o.P}.id`, reason: 'ids remapped via MigrationIdMap' })
  ctx.mapField(o.S, o.fk, { action: 'derive_away', target: null, derivable_from: `${o.P}.id via ${lcfirstName(o.P)}`, rules: ['R6'] })
  for (const f of o.fields) ctx.mapField(o.S, f, { rules: ['R6'] })

  const probe = o.fields[0]
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R6', description: `${o.S} is an unneeded 1:1 split of ${o.P}`, metrics: ['S1'], models: [o.S, o.P],
    checks: [
      { type: 'merged', a: o.S, b: o.P },
      { type: 'data_sql', sql: `SELECT count(*) FROM {{T:${o.P}}} WHERE {{C:${o.S}.${probe}}} IS NOT NULL`, equals: sRows.filter((r) => nonNull(r[probe])).length },
    ],
    anyOf: null,
  })
}

function lcfirstName(s: string) {
  return s[0].toLowerCase() + s.slice(1)
}
function columnDefGold(ctx: Ctx, f: Field): string {
  return columnDef(ctx.gold, f, true)
}

// ===========================================================================
// M03 — delimited id list
// ===========================================================================
export function m03(ctx: Ctx, o: { id: string; P: string; field: string; after: string; join: string; fkP: string; fkR: string; R: string; dangling: number }) {
  const rng = Rng.from(SEED, `t:${o.id}`)
  const P = ctx.mm(o.P)
  ctx.messy.models = ctx.messy.models.filter((m) => m.name !== o.join)
  insertAfter(P, o.after, { name: o.field, type: 'String', optional: true })
  const links = ctx.messyData[o.join]
  delete ctx.messyData[o.join]
  const byP = new Map<number, number[]>()
  for (const l of links) byP.set(l[o.fkP] as number, [...(byP.get(l[o.fkP] as number) ?? []), l[o.fkR] as number])
  const withTokens = ctx.messyData[o.P].filter((r) => byP.has(r.id as number))
  const danglingRows = new Set(rng.sample(withTokens, o.dangling).map((r) => r.id as number))
  let valid = 0
  for (const r of ctx.messyData[o.P]) {
    const ids = (byP.get(r.id as number) ?? []).map(String)
    valid += ids.length
    if (danglingRows.has(r.id as number)) ids.push(String(900 + rng.int(1, 99)))
    r[o.field] = ids.length ? ids.join(rng.chance(0.2) ? ', ' : ',') : null
  }

  const J = ctx.gm(o.join)
  const tP = q(tableName(P))
  const tR = q(tableName(ctx.mm(o.R)))
  const tokens = `SELECT p."id" AS pid, btrim(tok) AS tok FROM ${tP} p CROSS JOIN LATERAL regexp_split_to_table(p.${q(o.field)}, '[,;|]') AS tok WHERE p.${q(o.field)} IS NOT NULL AND btrim(tok) <> ''`
  ctx.add('create', ann(`${o.P}.${o.field} -> ${o.join}`), createTableSql(ctx.gold, J))
  ctx.add(
    'quarantine',
    ann(`${o.P}.${o.field} -> ${o.join}`),
    `INSERT INTO ${QR} ("sourceModel", "sourceId", "reason", "payload")\nSELECT ${lit(o.P)}, t.pid::text, 'dangling_token', jsonb_build_object('field', ${lit(o.field)}, 'token', t.tok)\nFROM (${tokens}) t\nWHERE NOT EXISTS (SELECT 1 FROM ${tR} r WHERE r."id"::text = t.tok)\nORDER BY t.pid, t.tok;`,
  )
  ctx.add(
    'data',
    ann(`${o.P}.${o.field} -> ${o.join}`),
    `INSERT INTO ${q(tableName(J))} (${q(o.fkP)}, ${q(o.fkR)})\nSELECT DISTINCT t.pid, t.tok::integer\nFROM (${tokens}) t\nWHERE EXISTS (SELECT 1 FROM ${tR} r WHERE r."id"::text = t.tok)\nORDER BY 1, 2;`,
  )
  const cons = tableConstraintsSql(ctx.gold, J)
  ctx.add('constraints', ...cons.indexes, ...cons.fks)
  ctx.add('drop', ann(`${o.P}.${o.field} -> ${o.join}`), `ALTER TABLE ${tP} DROP COLUMN ${q(o.field)};`)

  ctx.mapField(o.P, o.field, { action: 'explode', target: `${o.join}.${o.fkR}`, rules: ['R2'], reason: `comma-separated ${o.R} ids` })
  ctx.newModels.push({ name: o.join, rules: ['R2'], filled_from: [`${o.P}.${o.field}`] })
  ctx.quarantine.push({ source: o.P, reason: 'dangling_token', rows: o.dangling })

  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R2', description: `${o.P}.${o.field} holds a delimited list of ${o.R} ids`, metrics: ['S1'], models: [o.P],
    checks: [
      { type: 'join_between', a: o.P, b: o.R },
      { type: 'quarantined', source: o.P, reason: 'dangling_token', rows: o.dangling },
      { type: 'data_sql', sql: `SELECT count(*) FROM {{F:${o.P}.${o.field}}}`, equals: valid },
    ],
    anyOf: null,
  })
}

// ===========================================================================
// M04 — repeating group
// ===========================================================================
export function m04(ctx: Ctx, o: { id: string; P: string; child: string; fk: string; slot: string; value: string; prefix: string; after: string; n: number }) {
  const P = ctx.mm(o.P)
  ctx.messy.models = ctx.messy.models.filter((m) => m.name !== o.child)
  const cols = Array.from({ length: o.n }, (_, k) => `${o.prefix}${k + 1}`)
  insertAfter(P, o.after, ...cols.map((c) => ({ name: c, type: 'String', optional: true }) as Field))
  const kids = ctx.messyData[o.child]
  delete ctx.messyData[o.child]
  for (const r of ctx.messyData[o.P]) for (const c of cols) r[c] = null
  const byId = new Map(ctx.messyData[o.P].map((r) => [r.id, r]))
  for (const k of kids) byId.get(k[o.fk])![`${o.prefix}${k[o.slot]}`] = k[o.value]

  const C = ctx.gm(o.child)
  const tP = q(tableName(P))
  ctx.add('create', ann(`${o.P}.${cols.join('/')} -> ${o.child}`), createTableSql(ctx.gold, C))
  ctx.add(
    'data',
    ann(`${o.P}.${cols.join('/')} -> ${o.child}`),
    `INSERT INTO ${q(tableName(C))} (${q(o.fk)}, ${q(o.slot)}, ${q(o.value)})\n${cols.map((c, i) => `SELECT p."id", ${i + 1}, p.${q(c)} FROM ${tP} p WHERE p.${q(c)} IS NOT NULL`).join('\nUNION ALL\n')}\nORDER BY 1, 2;`,
  )
  const cons = tableConstraintsSql(ctx.gold, C)
  ctx.add('constraints', ...cons.indexes, ...cons.fks)
  for (const c of cols) ctx.add('drop', ann(`${o.P}.${c} -> ${o.child}`), `ALTER TABLE ${tP} DROP COLUMN ${q(c)};`)

  for (const c of cols) ctx.mapField(o.P, c, { action: 'explode', target: `${o.child}.${o.value}`, rules: ['R3'], reason: 'repeating group' })
  ctx.newModels.push({ name: o.child, rules: ['R3'], filled_from: cols.map((c) => `${o.P}.${c}`) })

  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R3', description: `${o.P}.${o.prefix}1..${o.n} is a repeating group`, metrics: ['S1'], models: [o.P],
    checks: [
      { type: 'child_model', of: o.P, fieldsFrom: cols.map((c) => `${o.P}.${c}`) },
      { type: 'data_sql', sql: `SELECT count(*) FROM {{F:${o.P}.${cols[0]}}}`, equals: kids.length },
    ],
    anyOf: null,
  })
}

// ===========================================================================
// M05 — transitive copy on a mutable record
// ===========================================================================
export function m05(ctx: Ctx, o: { id: string; M: string; field: string; via: string; src: string; srcField: string }) {
  const M = ctx.mm(o.M)
  const srcF = getField(ctx.mm(o.src), o.srcField)
  insertAfter(M, o.via, { name: o.field, type: 'String', optional: !!srcF.optional })
  const src = new Map(ctx.messyData[o.src].map((r) => [r.id, r]))
  for (const r of ctx.messyData[o.M]) r[o.field] = r[o.via] === null ? null : src.get(r[o.via])![o.srcField]
  ctx.add('drop', ann(`${o.M}.${o.field} -> derive_away`), `ALTER TABLE ${q(tableName(M))} DROP COLUMN ${q(o.field)};`)
  const rel = o.via.replace(/Id$/, '')
  ctx.mapField(o.M, o.field, { action: 'derive_away', target: null, derivable_from: `${o.src}.${o.srcField} via ${rel}`, rules: ['R4'], reason: `always equals ${o.src}.${o.srcField}` })
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R4', description: `${o.M}.${o.field} copies ${o.src}.${o.srcField}`, metrics: ['S1'], models: [o.M],
    checks: [{ type: 'field_removed', ref: `${o.M}.${o.field}` }],
    anyOf: null,
  })
}

// ===========================================================================
// M06 — redundant FK path
// ===========================================================================
export function m06(ctx: Ctx, o: { id: string; M: string; field: string; target: string; via: string; viaModel: string; viaField: string }) {
  const M = ctx.mm(o.M)
  insertAfter(M, o.via, { name: o.field, type: 'Int' }, { name: o.field.replace(/Id$/, ''), type: o.target, relation: { fields: [o.field], references: ['id'], onDelete: 'Restrict' } })
  M.indexes.push([o.field])
  const via = new Map(ctx.messyData[o.viaModel].map((r) => [r.id, r]))
  for (const r of ctx.messyData[o.M]) r[o.field] = via.get(r[o.via])![o.viaField]
  const t = tableName(M)
  ctx.add(
    'drop',
    ann(`${o.M}.${o.field} -> derive_away`),
    `ALTER TABLE ${q(t)} DROP CONSTRAINT ${q(`${t}_${o.field}_fkey`)};`,
    `DROP INDEX ${q(`${t}_${o.field}_idx`)};`,
    ann(`${o.M}.${o.field} -> derive_away`),
    `ALTER TABLE ${q(t)} DROP COLUMN ${q(o.field)};`,
  )
  ctx.mapField(o.M, o.field, { action: 'derive_away', target: null, derivable_from: `${o.viaModel}.${o.viaField} via ${o.via.replace(/Id$/, '')}`, rules: ['R8'], reason: 'redundant path, agrees in all rows' })
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R8', description: `${o.M}.${o.field} duplicates the path via ${o.via}`, metrics: ['S1'], models: [o.M],
    checks: [{ type: 'field_removed', ref: `${o.M}.${o.field}` }],
    anyOf: null,
  })
}

// ===========================================================================
// M07 — status string with variants
// ===========================================================================
export function m07(ctx: Ctx, o: { id: string; M: string; field: string; probe: string }) {
  const rng = Rng.from(SEED, `t:${o.id}`)
  const M = ctx.mm(o.M)
  const f = getField(M, o.field)
  const en = f.type
  const values = ctx.messy.enums.find((e) => e.name === en)!.values
  ctx.messy.enums = ctx.messy.enums.filter((e) => e.name !== en)
  f.type = 'String'
  const variants = (v: string) => {
    const lower = v.toLowerCase()
    const title = lower.replace(/(^|_)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
    return [v, lower, title, `${lower} `, ` ${title}`, `${v} `]
  }
  for (const r of ctx.messyData[o.M]) r[o.field] = rng.pick(variants(r[o.field] as string))
  const raw = [...new Set(ctx.messyData[o.M].map((r) => r[o.field] as string))].sort()
  const map = Object.fromEntries(raw.map((v) => [v, v.trim().toUpperCase()]))
  const t = q(tableName(M))
  const e = ctx.gold.enums.find((x) => x.name === en)!
  ctx.add('create', ann(`${o.M}.${o.field} -> ${o.M}.${o.field}`), createEnumSql(e))
  ctx.add(
    'data',
    ann(`${o.M}.${o.field} -> ${o.M}.${o.field}`),
    `ALTER TABLE ${t} ALTER COLUMN ${q(o.field)} SET DATA TYPE ${q(en)} USING (CASE ${q(o.field)}\n${raw.map((v) => `    WHEN ${lit(v)} THEN ${lit(map[v])}::${q(en)}`).join('\n')}\n  END);`,
  )
  ctx.mapField(o.M, o.field, { action: 'transform', transform: 'map_enum', values: map, rules: ['R10'], reason: 'closed set with case/whitespace variants' })
  const count = ctx.messyData[o.M].filter((r) => (r[o.field] as string).trim().toUpperCase() === o.probe).length
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R10', description: `${o.M}.${o.field} is a status string with variants`, metrics: ['S1', 'S5'], models: [o.M],
    checks: [
      { type: 'enum_field', ref: `${o.M}.${o.field}`, valuesSuperset: values, metric: 'S5' },
      { type: 'data_sql', sql: `SELECT count(*) FROM {{T:${o.M}}} WHERE upper({{C:${o.M}.${o.field}}}::text) = ${lit(o.probe)}`, equals: count },
    ],
    anyOf: null,
  })
}

// ===========================================================================
// M08 — wrong types
// ===========================================================================
export function m08(ctx: Ctx, o: { id: string; M: string; field: string; kind: 'float_money' | 'iso_date' | 'yes_no' }) {
  const rng = Rng.from(SEED, `t:${o.id}`)
  const M = ctx.mm(o.M)
  const f = getField(M, o.field)
  const g = getField(ctx.gm(o.M), o.field)
  const t = q(tableName(M))
  const c = q(o.field)
  const rows = ctx.messyData[o.M]
  let using: string
  let transform: string
  let check: { fieldType: string; nativeType?: string }
  let probe: { sql: string; equals: number }
  if (o.kind === 'float_money') {
    f.type = 'Float'
    delete f.native
    for (const r of rows) r[o.field] = r[o.field] === null ? null : Number(r[o.field])
    using = `round(${c}::numeric, 2)`
    transform = 'cast_decimal'
    check = { fieldType: 'Decimal', nativeType: 'Decimal' }
    const sum = rows.reduce((s, r) => s + Math.round((r[o.field] as number) * 100), 0)
    probe = { sql: `SELECT round(sum({{C:${o.M}.${o.field}}}) * 100)::int FROM {{T:${o.M}}}`, equals: sum }
  } else if (o.kind === 'iso_date') {
    f.type = 'String'
    delete f.native
    using = `${c}::date`
    transform = 'cast_datetime'
    check = { fieldType: 'DateTime' }
    const n = rows.filter((r) => (r[o.field] as string) < '2025-01-01').length
    probe = { sql: `SELECT count(*) FROM {{T:${o.M}}} WHERE {{C:${o.M}.${o.field}}} < DATE '2025-01-01'`, equals: n }
  } else {
    f.type = 'String'
    for (const r of rows) r[o.field] = r[o.field] ? rng.pick(['yes', 'yes', 'Yes', 'YES']) : rng.pick(['no', 'no', 'No', 'NO'])
    using = `CASE lower(btrim(${c})) WHEN 'yes' THEN true WHEN 'no' THEN false END`
    transform = 'cast_boolean'
    check = { fieldType: 'Boolean' }
    const n = rows.filter((r) => String(r[o.field]).toLowerCase() === 'yes').length
    probe = { sql: `SELECT count(*) FROM {{T:${o.M}}} WHERE {{C:${o.M}.${o.field}}} IS TRUE`, equals: n }
  }
  const def = columnDef(ctx.gold, g).replace(/^"[^"]+" /, '').replace(/ NOT NULL.*$/, '').replace(/ DEFAULT.*$/, '')
  ctx.add('data', ann(`${o.M}.${o.field} -> ${o.M}.${o.field}`), `ALTER TABLE ${t} ALTER COLUMN ${c} SET DATA TYPE ${def} USING (${using});`)
  ctx.mapField(o.M, o.field, { action: 'transform', transform, rules: ['R11'], reason: 'every value parses unambiguously' })
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R11', description: `${o.M}.${o.field} has the wrong type (${o.kind})`, metrics: ['S1', 'S5'], models: [o.M],
    checks: [{ type: 'field_type', ref: `${o.M}.${o.field}`, ...check, metric: 'S5' }, { type: 'data_sql', ...probe }],
    anyOf: null,
  })
}

// ===========================================================================
// M09 — missing @relation with orphans
// ===========================================================================
export function m09(ctx: Ctx, o: { id: string; M: string; field: string; target: string; orphans: number }) {
  const rng = Rng.from(SEED, `t:${o.id}`)
  const M = ctx.mm(o.M)
  const rel = M.fields.find((f) => f.relation?.fields[0] === o.field)!
  M.fields = M.fields.filter((f) => f !== rel)
  removeIndexesOn(M, o.field)
  const candidates = ctx.messyData[o.M].filter((r) => r[o.field] !== null)
  for (const [i, r] of rng.sample(candidates, o.orphans).entries()) r[o.field] = 9000 + i * 17
  const t = q(tableName(M))
  const tt = q(tableName(ctx.mm(o.target)))
  const where = `x.${q(o.field)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${tt} t WHERE t."id" = x.${q(o.field)})`
  ctx.add(
    'quarantine',
    ann(`${o.M}.${o.field} -> ${o.M}.${o.field}`),
    `INSERT INTO ${QR} ("sourceModel", "sourceId", "reason", "payload")\nSELECT ${lit(o.M)}, x."id"::text, 'orphan_fk', to_jsonb(x) FROM ${t} x WHERE ${where} ORDER BY x."id";`,
    `DELETE FROM ${t} x WHERE ${where};`,
  )
  const gM = ctx.gm(o.M)
  ctx.add('constraints', indexSql(gM, [o.field], false), fkSql(ctx.gold, gM, gM.fields.find((f) => f.relation?.fields[0] === o.field)!))
  ctx.mapField(o.M, o.field, { rules: ['R7', 'R14'], reason: `id-like scalar referencing ${o.target}` })
  ctx.quarantine.push({ source: o.M, reason: 'orphan_fk', rows: o.orphans })
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R7', description: `${o.M}.${o.field} references ${o.target} without @relation`, metrics: ['S1', 'S5'], models: [o.M],
    checks: [
      { type: 'fk', from: `${o.M}.${o.field}`, to: o.target, metric: 'S5' },
      { type: 'quarantined', source: o.M, reason: 'orphan_fk', rows: o.orphans },
    ],
    anyOf: null,
  })
}

// ===========================================================================
// M10 — missing unique, exact duplicates
// ===========================================================================
export function m10(ctx: Ctx, o: { id: string; M: string; key: string; copies: number[]; winner: string }) {
  const M = ctx.mm(o.M)
  getField(M, o.key).unique = false
  const rows = ctx.messyData[o.M]
  for (const idx of o.copies) rows.push({ ...clone(rows[idx]), id: rows.length + 1 })
  const t = q(tableName(M))
  const k = q(o.key)
  const loser = `EXISTS (SELECT 1 FROM ${t} w WHERE w.${k} = x.${k} AND w."id" < x."id")`
  ctx.add(
    'quarantine',
    ann(`${o.M} (dedupe)`),
    `INSERT INTO ${QR} ("sourceModel", "sourceId", "reason", "payload")\nSELECT ${lit(o.M)}, x."id"::text, 'duplicate_loser', to_jsonb(x) FROM ${t} x WHERE ${loser} ORDER BY x."id";`,
  )
  ctx.add(
    'data',
    ann(`${o.M} (dedupe)`),
    `INSERT INTO ${IDMAP} ("sourceModel", "sourceId", "targetModel", "targetId")\nSELECT ${lit(o.M)}, x."id"::text, ${lit(o.M)}, (SELECT min(w."id") FROM ${t} w WHERE w.${k} = x.${k})::text FROM ${t} x WHERE ${loser} ORDER BY x."id";`,
  )
  for (const m of ctx.messy.models) {
    for (const rf of relationFields(m).filter((f) => f.type === o.M)) {
      const fk = q(colName(getField(m, rf.relation!.fields[0])))
      ctx.add('repoint', ann(`${o.M} (dedupe)`), `UPDATE ${q(tableName(m))} r SET ${fk} = mm."targetId"::integer FROM ${IDMAP} mm WHERE mm."sourceModel" = ${lit(o.M)} AND mm."sourceId" = r.${fk}::text;`)
    }
  }
  ctx.add('dedupe', ann(`${o.M} (dedupe)`), `DELETE FROM ${t} x WHERE ${loser};`)
  ctx.add('constraints', indexSql(ctx.gm(o.M), [o.key], true))
  ctx.mapModel(o.M, { rules: ['R13'], reason: `exact duplicates on ${o.key}`, dedupe: { key: [o.key], winner: o.winner } })
  ctx.mapField(o.M, o.key, { rules: ['R13'], reason: 'natural key' })
  ctx.quarantine.push({ source: o.M, reason: 'duplicate_loser', rows: o.copies.length })
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R13', description: `${o.M}.${o.key} lacks @unique and has exact duplicates`, metrics: ['S5'], models: [o.M],
    checks: [
      { type: 'unique', refs: [`${o.M}.${o.key}`], metric: 'S5' },
      { type: 'quarantined', source: o.M, reason: 'duplicate_loser', rows: o.copies.length, metric: 'S5' },
    ],
    anyOf: null,
  })
}

// ===========================================================================
// M11 — optional although never null
// ===========================================================================
export function m11(ctx: Ctx, o: { id: string; M: string; field: string }) {
  const f = getField(ctx.mm(o.M), o.field)
  f.optional = true
  if (ctx.messyData[o.M].some((r) => r[o.field] === null)) throw new Error(`${o.id}: nulls present`)
  ctx.add('constraints', ann(`${o.M}.${o.field} -> ${o.M}.${o.field}`), `ALTER TABLE ${q(tableName(ctx.mm(o.M)))} ALTER COLUMN ${q(o.field)} SET NOT NULL;`)
  ctx.mapField(o.M, o.field, { rules: ['R12'], reason: 'never null' })
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R12', description: `${o.M}.${o.field} is optional but never null`, metrics: ['S5'], models: [o.M],
    checks: [{ type: 'field_required', ref: `${o.M}.${o.field}`, metric: 'S5' }],
    anyOf: null,
  })
}

// ===========================================================================
// M12 — Json holding an entity list
// ===========================================================================
export function m12(ctx: Ctx, o: { id: string; P: string; field: string; child: string; fk: string; after: string; keys: string[] }) {
  const P = ctx.mm(o.P)
  ctx.messy.models = ctx.messy.models.filter((m) => m.name !== o.child)
  insertAfter(P, o.after, { name: o.field, type: 'Json', optional: true })
  const kids = ctx.messyData[o.child]
  delete ctx.messyData[o.child]
  for (const r of ctx.messyData[o.P]) {
    const mine = kids.filter((k) => k[o.fk] === r.id)
    r[o.field] = mine.length ? mine.map((k) => Object.fromEntries(o.keys.map((x) => [x, k[x]]))) : (r.id as number) % 2 ? [] : null
  }
  const C = ctx.gm(o.child)
  const tP = q(tableName(P))
  const cf = o.keys.map((x) => getField(C, x))
  const cast = (f: Field) => (f.native === 'Date' ? '::date' : f.type === 'DateTime' ? '::timestamp(3)' : '')
  ctx.add('create', ann(`${o.P}.${o.field} -> ${o.child}`), createTableSql(ctx.gold, C))
  ctx.add(
    'data',
    ann(`${o.P}.${o.field} -> ${o.child}`),
    `INSERT INTO ${q(tableName(C))} (${q(o.fk)}, ${cf.map((f) => q(f.name)).join(', ')})\nSELECT p."id", ${cf.map((f) => `(e.value->>${lit(f.name)})${cast(f)}`).join(', ')}\nFROM ${tP} p CROSS JOIN LATERAL jsonb_array_elements(p.${q(o.field)}) WITH ORDINALITY AS e(value, ord)\nWHERE jsonb_typeof(p.${q(o.field)}) = 'array'\nORDER BY p."id", e.ord;`,
  )
  const cons = tableConstraintsSql(ctx.gold, C)
  ctx.add('constraints', ...cons.indexes, ...cons.fks)
  ctx.add('drop', ann(`${o.P}.${o.field} -> ${o.child}`), `ALTER TABLE ${tP} DROP COLUMN ${q(o.field)};`)
  ctx.mapField(o.P, o.field, { action: 'explode', target: `${o.child}.${o.keys[0]}`, rules: ['R18'], reason: 'array of entity-like objects' })
  ctx.newModels.push({ name: o.child, rules: ['R18'], filled_from: [`${o.P}.${o.field}`] })
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R18', description: `${o.P}.${o.field} stores a list of ${o.child} entities as Json`, metrics: ['S1'], models: [o.P],
    checks: [
      { type: 'child_model', of: o.P, fieldsFrom: [`${o.P}.${o.field}`] },
      { type: 'data_sql', sql: `SELECT count(*) FROM {{F:${o.P}.${o.field}}}`, equals: kids.length },
    ],
    anyOf: null,
  })
}

// ===========================================================================
// M13 — join model for a 1:n
// ===========================================================================
export function m13(ctx: Ctx, o: { id: string; child: string; fk: string; parent: string; join: string }) {
  const C = ctx.mm(o.child)
  removeFk(C, o.fk)
  const childFk = `${lcfirstName(o.child)}Id`
  const J: Model = {
    name: o.join, domain: C.domain, rows: 0,
    fields: [
      { name: o.fk, type: 'Int' },
      { name: o.fk.replace(/Id$/, ''), type: o.parent, relation: { fields: [o.fk], references: ['id'], onDelete: 'Cascade' } },
      { name: childFk, type: 'Int' },
      { name: lcfirstName(o.child), type: o.child, relation: { fields: [childFk], references: ['id'], onDelete: 'Cascade' } },
    ],
    compoundId: [o.fk, childFk], uniques: [], indexes: [[childFk]],
  }
  ctx.messy.models.splice(ctx.messy.models.indexOf(C) + 1, 0, J)
  ctx.messyData[o.join] = ctx.messyData[o.child].map((r) => ({ [o.fk]: r[o.fk], [childFk]: r.id })).sort((a, b) => (a[o.fk] as number) - (b[o.fk] as number) || (a[childFk] as number) - (b[childFk] as number))
  dropData(ctx, o.child, o.fk)

  const gC = ctx.gm(o.child)
  const t = q(tableName(C))
  ctx.add('create', ann(`${o.join}.${o.fk} -> ${o.child}.${o.fk}`), `ALTER TABLE ${t} ADD COLUMN ${columnDef(ctx.gold, getField(gC, o.fk), true)};`)
  ctx.add('data', ann(`${o.join}.${o.fk} -> ${o.child}.${o.fk}`), `UPDATE ${t} c SET ${q(o.fk)} = j.${q(o.fk)} FROM ${q(o.join)} j WHERE j.${q(childFk)} = c."id";`)
  ctx.add(
    'constraints',
    ann(`${o.join}.${o.fk} -> ${o.child}.${o.fk}`),
    `ALTER TABLE ${t} ALTER COLUMN ${q(o.fk)} SET NOT NULL;`,
    indexSql(gC, [o.fk], false),
    fkSql(ctx.gold, gC, gC.fields.find((f) => f.relation?.fields[0] === o.fk)!),
  )
  ctx.add('drop', ann(`${o.join} (merge)`), `DROP TABLE ${q(o.join)};`)
  ctx.mapModel(o.join, { action: 'merge', target: o.child, rules: ['R9'], reason: `each ${o.child} has exactly one ${o.parent}` })
  ctx.mapField(o.join, o.fk, { action: 'move', target: `${o.child}.${o.fk}`, rules: ['R9'] })
  ctx.mapField(o.join, childFk, { action: 'derive_away', target: null, derivable_from: `${o.child}.id via ${lcfirstName(o.child)}`, rules: ['R9'] })
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R9', description: `${o.join} is a 1:n in disguise`, metrics: ['S1'], models: [o.join, o.child],
    checks: [
      { type: 'fk', from: `${o.join}.${o.fk}`, to: o.parent },
      { type: 'data_sql', sql: `SELECT count(*) FROM {{T:${o.child}}} WHERE {{C:${o.join}.${o.fk}}} IS NOT NULL`, equals: ctx.messyData[o.join].length },
    ],
    anyOf: null,
  })
}

// ===========================================================================
// M14 — missing FK index
// ===========================================================================
export function m14(ctx: Ctx, o: { id: string; M: string; field: string }) {
  const M = ctx.mm(o.M)
  const before = M.indexes.length
  M.indexes = M.indexes.filter((ix) => !(ix.length === 1 && ix[0] === o.field))
  if (M.indexes.length === before) throw new Error(`${o.id}: no index to remove`)
  ctx.add('constraints', indexSql(ctx.gm(o.M), [o.field], false))
  ctx.mapField(o.M, o.field, { rules: ['R14'], reason: 'FK without index' })
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R14', description: `${o.M}.${o.field} has no index`, metrics: ['S5'], models: [o.M],
    checks: [{ type: 'index_on', ref: `${o.M}.${o.field}`, metric: 'S5' }],
    anyOf: null,
  })
}

// ===========================================================================
// M15 — naming
// ===========================================================================
export function m15(ctx: Ctx, o: { id: string; M: string; messyName: string }) {
  const M = ctx.mm(o.M)
  const G = ctx.gm(o.M)
  const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
  const renames = new Map<string, string>()
  for (const f of M.fields.filter((x) => !x.relation)) if (snake(f.name) !== f.name) renames.set(f.name, snake(f.name))
  for (const f of M.fields) {
    if (f.relation) f.relation.fields = f.relation.fields.map((x) => renames.get(x) ?? x)
    else if (renames.has(f.name)) f.name = renames.get(f.name)!
  }
  M.indexes = M.indexes.map((ix) => ix.map((x) => renames.get(x) ?? x))
  M.uniques = M.uniques.map((ix) => ix.map((x) => renames.get(x) ?? x))
  for (const m of ctx.messy.models) for (const f of m.fields) if (f.type === o.M) f.type = o.messyName
  M.name = o.messyName
  ctx.messyData[o.messyName] = ctx.messyData[o.M].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [renames.get(k) ?? k, v])))
  delete ctx.messyData[o.M]
  G.map = o.messyName
  for (const f of G.fields) if (renames.has(f.name)) f.map = renames.get(f.name)
  ctx.mapModel(o.messyName, { action: 'rename', target: o.M, rules: ['R15'], reason: 'naming convention; physical name kept via @@map' })
  for (const [orig, sn] of renames) ctx.mapField(o.messyName, sn, { target: `${o.M}.${orig}`, rules: ['R15'], reason: 'camelCase via @map' })
  const [orig, sn] = [...renames.entries()].find(([k]) => !k.endsWith('Id'))!
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R15', description: `${o.messyName} violates naming conventions`, metrics: ['S1'], models: [o.messyName],
    checks: [
      { type: 'naming', ref: o.messyName },
      { type: 'physical_name_unchanged', ref: o.messyName },
      { type: 'naming', ref: `${o.messyName}.${sn}` },
      { type: 'physical_name_unchanged', ref: `${o.messyName}.${sn}` },
    ],
    anyOf: null,
  })
  void orig
}

// ===========================================================================
// M16 — cached derived value on a mutable record
// ===========================================================================
export function m16(ctx: Ctx, o: { id: string; M: string; field: string; child: string; fk: string; after: string }) {
  const M = ctx.mm(o.M)
  insertAfter(M, o.after, { name: o.field, type: 'Int', default: '0' })
  for (const r of ctx.messyData[o.M]) r[o.field] = ctx.messyData[o.child].filter((k) => k[o.fk] === r.id).length
  ctx.add('drop', ann(`${o.M}.${o.field} -> derive_away`), `ALTER TABLE ${q(tableName(M))} DROP COLUMN ${q(o.field)};`)
  ctx.mapField(o.M, o.field, { action: 'derive_away', target: null, derivable_from: `count(${o.child}) via ${lcfirstName(o.child)}s`, rules: ['R17'], reason: 'cached count on a mutable record' })
  ctx.addCase({
    id: o.id, kind: 'mess', rule: 'R17', description: `${o.M}.${o.field} caches a count of ${o.child}`, metrics: ['S1'], models: [o.M],
    checks: [{ type: 'field_removed', ref: `${o.M}.${o.field}` }],
    anyOf: null,
  })
}

// ===========================================================================
// Traps and ambiguities (no structural change; the clean state is already right)
// ===========================================================================
export function snapshotTrap(ctx: Ctx, o: { id: string; M: string; groups: { fields: string[]; reason: string }[]; looksLike: string }) {
  const checks = []
  for (const g of o.groups) {
    const id = `SNAP-${ctx.snapshots.length + 1}`
    ctx.snapshots.push({ id, refs: g.fields.map((f) => `${o.M}.${f}`), reason: g.reason })
    for (const f of g.fields) {
      ctx.mapField(o.M, f, { rules: ['R16'], decision: id, reason: g.reason })
      checks.push({ type: 'snapshot_kept', ref: `${o.M}.${f}` })
    }
  }
  ctx.addCase({ id: o.id, kind: 'trap', rule: 'R16', description: `${o.M} snapshot fields look like ${o.looksLike}`, metrics: ['S3'], models: [o.M], checks, anyOf: null })
}

export function jsonTrap(ctx: Ctx, o: { id: string; refs: string[] }) {
  ctx.assumptions.push(...o.refs.map((r) => `${r} is an opaque payload and stays Json (R18)`))
  ctx.addCase({
    id: o.id, kind: 'trap', rule: 'R18', description: 'opaque Json that looks like an entity list', metrics: ['S3'], models: o.refs.map((r) => r.split('.')[0]),
    checks: o.refs.map((ref) => ({ type: 'json_kept', ref })), anyOf: null,
  })
}

export function ambiguity(ctx: Ctx, o: { id: string; rule: string; refs: string[]; question: string; options: string[]; checks: object[]; anyOf?: object[][]; models: string[]; description: string; fieldDecision?: string }) {
  const amb = `AMB-${ctx.ambiguities.length + 1}`
  ctx.ambiguities.push({ id: amb, refs: o.refs, rule: o.rule, question: o.question, options: o.options, chosen: 'safe_default' })
  if (o.fieldDecision) {
    const [m, f] = o.fieldDecision.split('.')
    ctx.mapField(m, f, { decision: amb, rules: [o.rule], reason: 'ambiguous; kept' })
  }
  ctx.addCase({ id: o.id, kind: 'ambiguity', rule: o.rule, description: o.description, metrics: ['S4'], models: o.models, checks: o.checks as never, anyOf: (o.anyOf ?? null) as never })
}

export function stripSnapshotDocs(ctx: Ctx) {
  for (const m of ctx.messy.models) for (const f of m.fields) delete f.doc
}

