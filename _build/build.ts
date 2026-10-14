// Builds site/data.json for the before/after demo from the messy fixture and one skill run.
// node demo/build.ts --run <results/run-N dir> --out <site dir>

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const REPO = process.env.REPO ?? '/home/schlexander/projects/skill-prisma-db-refactor'
const { parseSchema } = await import(join(REPO, 'tests/lib/schema.ts'))

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const runDir = arg('run')!
const outDir = arg('out')!
const out = join(runDir, 'output')

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

function schemaJson(text: string) {
  const s = parseSchema(text)
  return {
    enums: Object.fromEntries(s.enums),
    models: [...s.models.values()].map((m: Any) => ({
      name: m.name,
      table: m.dbName,
      attrs: m.attrs,
      pk: m.compoundId ?? m.fields.filter((f: Any) => f.id).map((f: Any) => f.name),
      fields: m.fields.map((f: Any) => ({
        name: f.name,
        column: f.map ?? f.name,
        type: f.type,
        optional: f.optional,
        list: f.list,
        relation: f.isRelation ? { to: f.type, fields: f.relation?.fields ?? null, onDelete: f.relation?.onDelete ?? null } : null,
        attrs: [f.id && '@id', f.unique && '@unique', f.default !== undefined && `@default(${f.default})`, f.native && `@db.${f.native}`, f.map && `@map("${f.map}")`].filter(Boolean),
        docs: f.docs,
      })),
    })),
  }
}

const migDir = join(out, 'migrations')
const mig = readdirSync(migDir).find((d) => existsSync(join(migDir, d, 'migration.sql')))!
const metrics = JSON.parse(readFileSync(join(runDir, 'metrics.json'), 'utf8'))

const data = {
  generated: 'from one headless run of the refactor-prisma-db skill against fixtures/messy',
  run: {
    gates: Object.fromEntries(Object.entries(metrics.gates).map(([k, v]: [string, Any]) => [k, v.status])),
    metrics: Object.fromEntries(Object.entries(metrics.metrics).map(([k, v]: [string, Any]) => [k, { value: v.value, passed: v.passed, total: v.total }])),
    cost: metrics.cost,
    cases: metrics.cases.map((c: Any) => ({ id: c.id, kind: c.kind, rule: c.rule, pass: c.pass })),
  },
  before: schemaJson(readFileSync(join(REPO, 'fixtures/messy/schema.prisma'), 'utf8')),
  after: schemaJson(readFileSync(join(out, 'schema.prisma'), 'utf8')),
  mapping: parseYaml(readFileSync(join(out, 'mapping.yaml'), 'utf8')),
  decisions: parseYaml(readFileSync(join(out, 'decisions.yaml'), 'utf8')),
  migrationName: mig,
  sql: {
    init: readFileSync(join(REPO, 'fixtures/messy/migrations/20240101000000_init/migration.sql'), 'utf8'),
    seed: readFileSync(join(REPO, 'fixtures/messy/seed.sql'), 'utf8'),
    refactor: readFileSync(join(migDir, mig, 'migration.sql'), 'utf8'),
  },
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'data.json'), JSON.stringify(data))
for (const f of ['index.html', 'app.js', 'style.css']) copyFileSync(join(import.meta.dirname, f), join(outDir, f))
console.log(`site written to ${outDir} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB data)`)
