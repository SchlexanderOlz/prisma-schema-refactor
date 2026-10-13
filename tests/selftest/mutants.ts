// Mutants derived from fixtures/gold. Each must fail exactly its target.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify } from 'yaml'
import { MESSY } from '../lib/env.ts'
import { parseSchema, scalarFieldsOf } from '../lib/schema.ts'

export interface Mutant {
  id: string
  change: string
  /** gate that must fail (all others pass or are blocked) */
  gate?: string
  /** metric that must drop; others stay at 1 unless listed in alsoDrops */
  metric?: { key: string; cond: 'below_min' | 'below_one' | 'zero' }
  alsoDrops?: string[]
  /** write into the harness checkout while scoring (b9) */
  simulateWrite?: string
  apply?: (dir: string) => void
}

const rd = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8')
const wr = (dir: string, f: string, s: string) => writeFileSync(join(dir, f), s)
const MIG = 'migrations/20250101000000_refactor/migration.sql'

function must(s: string, needle: string | RegExp, what: string): void {
  if (typeof needle === 'string' ? !s.includes(needle) : !needle.test(s)) throw new Error(`mutant setup: ${what} not found`)
}

/** Apply fn to the body of `model name { ... }`. */
function editModel(schema: string, name: string, fn: (body: string) => string): string {
  const re = new RegExp(`(model ${name} \\{\\n)([\\s\\S]*?)(\\n\\})`)
  must(schema, re, `model ${name}`)
  return schema.replace(re, (_, a, body, z) => a + fn(body) + z)
}

function removeStatement(sql: string, stmt: string, withAnnotation = true): string {
  must(sql, stmt, stmt)
  const lines = sql.split('\n')
  const i = lines.findIndex((l) => l === stmt)
  const from = withAnnotation && lines[i - 1]?.startsWith('-- mapping:') ? i - 1 : i
  lines.splice(from, i - from + 1)
  return lines.join('\n')
}

export const MUTANTS: Mutant[] = [
  {
    id: 'b1', change: 'schema syntax error', gate: 'H1',
    apply: (d) => wr(d, 'schema.prisma', rd(d, 'schema.prisma') + '\nmodel Broken {\n  id Int @id\n'),
  },
  {
    id: 'b2', change: 'invalid SQL statement', gate: 'H2',
    apply: (d) => wr(d, MIG, rd(d, MIG) + '\nSELEC 1;\n'),
  },
  {
    id: 'b3', change: 'extra field in schema, not in migration', gate: 'H3',
    apply: (d) => wr(d, 'schema.prisma', editModel(rd(d, 'schema.prisma'), 'TicketLabelAssignment', (b) => `${b}\n  note String?`)),
  },
  {
    id: 'b4', change: 'one mapping field entry removed', gate: 'H4',
    apply: (d) => {
      const m = parseYaml(rd(d, 'mapping.yaml'))
      const brand = m.models.find((x: { source: string }) => x.source === 'Brand')
      brand.fields = brand.fields.filter((f: { source: string }) => f.source !== 'websiteUrl')
      wr(d, 'mapping.yaml', stringify(m, { lineWidth: 0 }))
    },
  },
  {
    id: 'b5', change: 'DELETE of rows without quarantine', gate: 'H5',
    apply: (d) => wr(d, MIG, rd(d, MIG) + '\nDELETE FROM "Session" WHERE "id" = 3;\n'),
  },
  {
    id: 'b6', change: 'DROP COLUMN without annotation', gate: 'H6',
    apply: (d) => {
      const sql = rd(d, MIG)
      const stmt = 'ALTER TABLE "Cart" DROP COLUMN "itemCount";'
      must(sql, `-- mapping: Cart.itemCount -> derive_away\n${stmt}`, 'annotated Cart drop')
      wr(d, MIG, sql.replace(`-- mapping: Cart.itemCount -> derive_away\n${stmt}`, stmt))
    },
  },
  {
    id: 'b7', change: 'UPDATE altering a copied column', gate: 'H7',
    apply: (d) => wr(d, MIG, rd(d, MIG) + `\nUPDATE "Brand" SET "websiteUrl" = 'https://changed.example.test' WHERE "id" = 2;\n`),
  },
  {
    id: 'b8', change: 'FK added NOT VALID', gate: 'H8',
    apply: (d) => {
      const sql = rd(d, MIG)
      const re = /(ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contactId_fkey" [^;]*);/
      must(sql, re, 'Activity FK')
      wr(d, MIG, sql.replace(re, '$1 NOT VALID;'))
    },
  },
  { id: 'b9', change: 'simulated write into tests/', gate: 'H9', simulateWrite: 'tests/.h9-probe' },
  {
    id: 'b10', change: 'identity output (messy schema unchanged, empty migration, complete keep-mapping)',
    metric: { key: 'S1', cond: 'below_min' }, alsoDrops: ['S5'],
    apply: (d) => {
      const messyText = readFileSync(join(MESSY, 'schema.prisma'), 'utf8')
      const messy = parseSchema(messyText)
      // keep structure byte-for-byte; only add the snapshot docs and reuse gold decisions
      const decisions = parseYaml(rd(d, 'decisions.yaml'))
      decisions.quarantine = []
      let schema = messyText
      for (const s of decisions.snapshots as { refs: string[] }[]) {
        for (const ref of s.refs) {
          const [m, f] = ref.split('.')
          schema = editModel(schema, m, (b) => b.replace(new RegExp(`^(\\s+)(${f}\\s)`, 'm'), `$1/// @snapshot: kept\n$1$2`))
        }
      }
      wr(d, 'schema.prisma', schema)
      wr(d, MIG, '-- identity: no changes\n')
      const models = [...messy.models.values()].map((m) => ({
        source: m.name, action: 'keep', target: m.name, rules: [], reason: null, dedupe: null,
        fields: scalarFieldsOf(m).map((f) => ({ source: f.name, action: 'copy', target: `${m.name}.${f.name}`, transform: null, values: null, derivable_from: null, decision: null, rules: [], reason: null })),
      }))
      wr(d, 'mapping.yaml', stringify({ version: 1, models, new_models: [] }, { lineWidth: 0 }))
      wr(d, 'decisions.yaml', stringify(decisions, { lineWidth: 0 }))
    },
  },
  {
    id: 'b11', change: 'one clean model renamed', metric: { key: 'S2', cond: 'below_one' },
    apply: (d) => {
      let s = rd(d, 'schema.prisma')
      s = editModel(s, 'Brand', (b) => `${b}\n\n  @@map("Brand")`)
      s = s.replace(/^model Brand \{/m, 'model ProductBrand {').replace(/^(\s+\w+\s+)Brand(\??)(\s|$)/gm, '$1ProductBrand$2$3')
      wr(d, 'schema.prisma', s)
      const m = parseYaml(rd(d, 'mapping.yaml'))
      const brand = m.models.find((x: { source: string }) => x.source === 'Brand')
      brand.action = 'rename'
      brand.target = 'ProductBrand'
      for (const f of brand.fields) f.target = `ProductBrand.${f.source}`
      wr(d, 'mapping.yaml', stringify(m, { lineWidth: 0 }))
    },
  },
  {
    id: 'b12', change: 'one snapshot removed', metric: { key: 'S3', cond: 'below_one' },
    apply: (d) => {
      wr(d, 'schema.prisma', editModel(rd(d, 'schema.prisma'), 'OrderItem', (b) => b.replace(/^\s+\/\/\/ @snapshot.*\n/m, '')))
      const dec = parseYaml(rd(d, 'decisions.yaml'))
      dec.snapshots = dec.snapshots.filter((s: { refs: string[] }) => !s.refs.includes('OrderItem.unitPrice'))
      wr(d, 'decisions.yaml', stringify(dec, { lineWidth: 0 }))
    },
  },
  {
    id: 'b13', change: 'empty ambiguities', metric: { key: 'S4', cond: 'zero' },
    apply: (d) => {
      const dec = parseYaml(rd(d, 'decisions.yaml'))
      dec.ambiguities = []
      wr(d, 'decisions.yaml', stringify(dec, { lineWidth: 0 }))
    },
  },
  {
    id: 'b14', change: 'two constraints removed', metric: { key: 'S5', cond: 'below_one' },
    apply: (d) => {
      let s = rd(d, 'schema.prisma')
      s = editModel(s, 'Ticket', (b) => b.replace(/^(\s+createdAt\s+)DateTime(\s)/m, '$1DateTime?$2'))
      s = editModel(s, 'TimeEntry', (b) => b.replace(/^\s+@@index\(\[employeeId\]\)\n?/m, ''))
      wr(d, 'schema.prisma', s)
      let sql = rd(d, MIG)
      sql = removeStatement(sql, 'ALTER TABLE "Ticket" ALTER COLUMN "createdAt" SET NOT NULL;')
      sql = removeStatement(sql, 'CREATE INDEX "TimeEntry_employeeId_idx" ON "TimeEntry"("employeeId");', false)
      wr(d, MIG, sql)
    },
  },
]
