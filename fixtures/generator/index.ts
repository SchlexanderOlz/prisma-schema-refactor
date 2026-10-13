// Entry point: `tsx fixtures/generator/index.ts --out <dir>`
// Writes <dir>/{clean,messy,gold}/... and <dir>/expected.json. Fully deterministic.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import { Ctx, PHASES } from './ctx.ts'
import { generateData } from './data.ts'
import { cleanSchema } from './domains.ts'
import type { Model, Schema } from './ir.ts'
import { createTableSql, isolatedModels, printSchema, seedSql, tableConstraintsSql } from './ir.ts'
import {
  ambiguity, jsonTrap, m01, m02, m03, m04, m05, m06, m07, m08, m09, m10, m11, m12, m13, m14, m15, m16,
  snapshotTrap, stripSnapshotDocs,
} from './transforms.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PRISMA = join(ROOT, 'node_modules', '.bin', 'prisma')
export const INIT_MIGRATION = '20240101000000_init'
export const GOLD_MIGRATION = '20250101000000_refactor'

export const SUPPORT_MODELS = `model QuarantinedRow {
  id          Int      @id @default(autoincrement())
  sourceModel String
  sourceId    String
  reason      String   // orphan_fk | duplicate_loser | dangling_token | unparseable
  payload     Json
  createdAt   DateTime @default(now())
  @@index([sourceModel])
  @@map("quarantined_row")
}

model MigrationIdMap {
  id          Int    @id @default(autoincrement())
  sourceModel String
  sourceId    String
  targetModel String
  targetId    String
  @@unique([sourceModel, sourceId])
  @@map("migration_id_map")
}
`

const SUPPORT_IR: Model[] = [
  {
    name: 'QuarantinedRow', domain: 'support-models', rows: 0, map: 'quarantined_row', uniques: [], indexes: [['sourceModel']],
    fields: [
      { name: 'id', type: 'Int', id: true, default: 'autoincrement()' },
      { name: 'sourceModel', type: 'String' },
      { name: 'sourceId', type: 'String' },
      { name: 'reason', type: 'String' },
      { name: 'payload', type: 'Json' },
      { name: 'createdAt', type: 'DateTime', default: 'now()' },
    ],
  },
  {
    name: 'MigrationIdMap', domain: 'support-models', rows: 0, map: 'migration_id_map', uniques: [['sourceModel', 'sourceId']], indexes: [],
    fields: [
      { name: 'id', type: 'Int', id: true, default: 'autoincrement()' },
      { name: 'sourceModel', type: 'String' },
      { name: 'sourceId', type: 'String' },
      { name: 'targetModel', type: 'String' },
      { name: 'targetId', type: 'String' },
    ],
  },
]

function buildCatalog(ctx: Ctx) {
  m01(ctx, { id: 'M01-a', A: 'Customer', B: 'ClientCompany', key: 'customerNumber', omit: ['creditLimit', 'accountManagerId'], dupCount: 6, newCount: 5 })
  m01(ctx, { id: 'M01-b', A: 'Supplier', B: 'Vendor', key: 'supplierCode', omit: ['websiteUrl', 'ratingScore'], dupCount: 4, newCount: 3 })
  m02(ctx, { id: 'M02-a', P: 'Employee', S: 'EmployeeProfile', fk: 'employeeId', fields: ['dateOfBirth', 'emergencyContactName', 'emergencyContactPhone'] })
  m02(ctx, { id: 'M02-b', P: 'Product', S: 'ProductDimensions', fk: 'productId', fields: ['weightGrams', 'lengthMm', 'widthMm', 'heightMm'] })
  m03(ctx, { id: 'M03-a', P: 'Ticket', field: 'labelIds', after: 'status', join: 'TicketLabelAssignment', fkP: 'ticketId', fkR: 'labelId', R: 'TicketLabel', dangling: 3 })
  m03(ctx, { id: 'M03-b', P: 'Campaign', field: 'segmentIds', after: 'budget', join: 'CampaignSegment', fkP: 'campaignId', fkR: 'segmentId', R: 'Segment', dangling: 2 })
  m04(ctx, { id: 'M04-a', P: 'Contact', child: 'ContactPhone', fk: 'contactId', slot: 'slot', value: 'phoneNumber', prefix: 'phone', after: 'jobTitle', n: 3 })
  m04(ctx, { id: 'M04-b', P: 'Product', child: 'ProductImage', fk: 'productId', slot: 'sortOrder', value: 'imageUrl', prefix: 'imageUrl', after: 'details', n: 3 })
  m05(ctx, { id: 'M05-a', M: 'Contact', field: 'customerName', via: 'customerId', src: 'Customer', srcField: 'companyName' })
  m05(ctx, { id: 'M05-b', M: 'Task', field: 'projectTitle', via: 'projectId', src: 'Project', srcField: 'title' })
  m06(ctx, { id: 'M06-a', M: 'TimeEntry', field: 'projectId', target: 'Project', via: 'taskId', viaModel: 'Task', viaField: 'projectId' })
  m06(ctx, { id: 'M06-b', M: 'StocktakeLine', field: 'warehouseId', target: 'Warehouse', via: 'stocktakeId', viaModel: 'Stocktake', viaField: 'warehouseId' })
  m07(ctx, { id: 'M07-a', M: 'Ticket', field: 'status', probe: 'CLOSED' })
  m07(ctx, { id: 'M07-b', M: 'Lead', field: 'status', probe: 'QUALIFIED' })
  m07(ctx, { id: 'M07-c', M: 'PurchaseOrder', field: 'status', probe: 'RECEIVED' })
  m08(ctx, { id: 'M08-a', M: 'ShippingRate', field: 'price', kind: 'float_money' })
  m08(ctx, { id: 'M08-b', M: 'Absence', field: 'startsOn', kind: 'iso_date' })
  m08(ctx, { id: 'M08-c', M: 'NewsletterSubscription', field: 'doubleOptIn', kind: 'yes_no' })
  m09(ctx, { id: 'M09-a', M: 'Activity', field: 'contactId', target: 'Contact', orphans: 3 })
  m09(ctx, { id: 'M09-b', M: 'TrackingEvent', field: 'parcelId', target: 'Parcel', orphans: 2 })
  m10(ctx, { id: 'M10-a', M: 'Currency', key: 'isoCode', copies: [0, 1], winner: 'oldest_created_at' })
  m10(ctx, { id: 'M10-b', M: 'TaxRate', key: 'taxCode', copies: [0, 1], winner: 'most_complete' })
  m11(ctx, { id: 'M11-a', M: 'Ticket', field: 'createdAt' })
  m11(ctx, { id: 'M11-b', M: 'Lead', field: 'fullName' })
  m11(ctx, { id: 'M11-c', M: 'PurchaseOrder', field: 'orderedAt' })
  m12(ctx, { id: 'M12-a', P: 'Project', field: 'milestones', child: 'Milestone', fk: 'projectId', after: 'budget', keys: ['title', 'dueOn', 'completedAt'] })
  m13(ctx, { id: 'M13-a', child: 'Parcel', fk: 'shipmentId', parent: 'Shipment', join: 'ShipmentParcel' })
  m14(ctx, { id: 'M14-a', M: 'TimeEntry', field: 'employeeId' })
  m14(ctx, { id: 'M14-b', M: 'StocktakeLine', field: 'productVariantId' })
  m15(ctx, { id: 'M15-a', M: 'PerformanceReview', messyName: 'performance_reviews' })
  m15(ctx, { id: 'M15-b', M: 'CannedResponse', messyName: 'CannedResponses' })
  m16(ctx, { id: 'M16-a', M: 'Cart', field: 'itemCount', child: 'CartItem', fk: 'cartId', after: 'salesChannelId' })

  snapshotTrap(ctx, { id: 'T1', M: 'OrderItem', looksLike: 'a transitive copy of the variant price (R4)', groups: [{ fields: ['unitPrice'], reason: 'variant price at the moment the order was placed' }] })
  snapshotTrap(ctx, { id: 'T2', M: 'Shipment', looksLike: 'transitive copies of the customer address (R4)', groups: [{ fields: ['shipToName', 'shipToStreet', 'shipToPostalCode', 'shipToCity'], reason: 'recipient and delivery address printed on the label at dispatch' }] })
  snapshotTrap(ctx, {
    id: 'T3', M: 'Invoice', looksLike: 'customer copies (R4) and cached totals (R17)',
    groups: [
      { fields: ['billingName', 'billingStreet', 'billingPostalCode', 'billingCity'], reason: 'billing party as printed on the issued invoice' },
      { fields: ['totalNet', 'totalTax', 'totalGross'], reason: 'invoice totals as issued, including rounding adjustments' },
    ],
  })
  jsonTrap(ctx, { id: 'T4', refs: ['AuditEvent.payload', 'AppSetting.configData'] })

  ambiguity(ctx, {
    id: 'A1', rule: 'R19', refs: ['PublicHoliday'], models: ['PublicHoliday'], description: 'model without any relation',
    question: 'PublicHoliday has no relations. Is it still read by application code (e.g. working-day calculations)?',
    options: ['keep unchanged', 'drop the model'],
    checks: [{ type: 'ambiguity_logged', refsAny: ['PublicHoliday'] }, { type: 'model_kept', model: 'PublicHoliday' }],
  })
  ambiguity(ctx, {
    id: 'A2', rule: 'R5', refs: ['EmailTemplate', 'NotificationTemplate'], models: ['EmailTemplate', 'NotificationTemplate'], description: 'overlapping models with different meaning',
    question: 'EmailTemplate and NotificationTemplate share most fields but no template keys. Are they the same concept?',
    options: ['keep both models', 'merge into one template model with a kind column'],
    checks: [{ type: 'not_merged', a: 'EmailTemplate', b: 'NotificationTemplate' }, { type: 'ambiguity_logged', refsAny: ['EmailTemplate', 'NotificationTemplate'] }],
  })
  ambiguity(ctx, {
    id: 'A3', rule: 'R13', refs: ['Carrier.carrierCode'], models: ['Carrier'], fieldDecision: 'Carrier.carrierCode', description: 'natural key with conflicting duplicates',
    question: 'Two Carrier rows share a carrierCode but differ in title and tracking URL. Which one is authoritative?',
    options: ['no unique constraint', 'make carrierCode unique and quarantine one row'],
    checks: [],
    anyOf: [
      [{ type: 'unique', refs: ['Carrier.carrierCode'], negate: true }, { type: 'ambiguity_logged', refsAny: ['Carrier.carrierCode'] }],
      [
        { type: 'unique', refs: ['Carrier.carrierCode'] },
        { type: 'dedupe_documented', model: 'Carrier' },
        { type: 'quarantined', source: 'Carrier', reason: 'duplicate_loser', rows: 1 },
        { type: 'ambiguity_logged', refsAny: ['Carrier.carrierCode'] },
      ],
    ],
  })
  ambiguity(ctx, {
    id: 'A4', rule: 'R11', refs: ['PurchaseOrderLine.orderedQuantity'], models: ['PurchaseOrderLine'], fieldDecision: 'PurchaseOrderLine.orderedQuantity', description: 'quantity string with mixed units',
    question: 'PurchaseOrderLine.orderedQuantity mixes units ("2 kg", "500g", "1.5"). What unit should a numeric column use?',
    options: ['keep as String', 'split into a numeric quantity and a unit'],
    checks: [
      { type: 'field_type', ref: 'PurchaseOrderLine.orderedQuantity', fieldType: 'String' },
      { type: 'ambiguity_logged', refsAny: ['PurchaseOrderLine.orderedQuantity'] },
    ],
  })
  stripSnapshotDocs(ctx)
}

function prismaCfg(dir: string): string {
  const p = join(dir, 'prisma.config.mjs')
  writeFileSync(p, `export default { datasource: { url: 'postgresql://offline:offline@127.0.0.1:1/offline' } }\n`)
  return p
}

function formatSchema(path: string, cfg: string) {
  execFileSync(PRISMA, ['format', '--config', cfg, '--schema', path], { stdio: 'pipe' })
}

function initMigration(schemaPath: string, cfg: string): string {
  const out = execFileSync(PRISMA, ['migrate', 'diff', '--config', cfg, '--from-empty', '--to-schema', schemaPath, '--script'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  if (!out.includes('CREATE TABLE')) throw new Error(`prisma migrate diff produced no SQL for ${schemaPath}`)
  return out
}

const LOCK = '# Please do not edit this file manually\n# It should be added in your version-control system (e.g., Git)\nprovider = "postgresql"\n'

function writeProject(dir: string, schema: Schema, seed: string, cfg: string) {
  mkdirSync(join(dir, 'migrations', INIT_MIGRATION), { recursive: true })
  const sp = join(dir, 'schema.prisma')
  writeFileSync(sp, printSchema(schema))
  formatSchema(sp, cfg)
  writeFileSync(join(dir, 'migrations', INIT_MIGRATION, 'migration.sql'), initMigration(sp, cfg))
  writeFileSync(join(dir, 'migrations', 'migration_lock.toml'), LOCK)
  writeFileSync(join(dir, 'seed.sql'), seed)
}

function goldMigration(ctx: Ctx): string {
  const goldWithSupport: Schema = { models: [...ctx.gold.models, ...SUPPORT_IR], enums: ctx.gold.enums }
  const support = SUPPORT_IR.flatMap((m) => [createTableSql(goldWithSupport, m), ...tableConstraintsSql(goldWithSupport, m).indexes])
  const titles: Record<string, string> = {
    create: '1. New types, tables and columns (nullable first)',
    quarantine: '2. Quarantine rows that cannot be migrated',
    data: '3. Copy/transform data and fill MigrationIdMap',
    repoint: '4. Re-point foreign keys via MigrationIdMap',
    dedupe: '5. Dedupe',
    constraints: '6. NOT NULL, foreign keys, uniques and indexes',
    drop: '7. Drop old columns, tables and types',
  }
  const out = ['-- Refactor migration (gold). Generated by fixtures/generator. Do not edit.', '-- Prisma runs each PostgreSQL migration in a transaction; no explicit BEGIN/COMMIT.', '']
  for (const ph of PHASES) {
    out.push(`-- ===== ${titles[ph]}`, '')
    if (ph === 'create') out.push(...support.map((s) => s + '\n'))
    for (const stmt of ctx.sql[ph]) out.push(stmt.startsWith('-- ') ? stmt : stmt + '\n')
  }
  return out.join('\n')
}

export function generate(outDir: string) {
  const clean = cleanSchema()
  const data = generateData(clean)
  const ctx = new Ctx(clean, data)
  buildCatalog(ctx)

  // ---- invariants
  const isolated = isolatedModels(ctx.messy)
  if (JSON.stringify(isolated) !== '["PublicHoliday"]') throw new Error(`unexpected isolated models: ${isolated}`)
  if (clean.models.length < 110) throw new Error('need 110+ clean models')
  const messyModels = new Set(ctx.cases.filter((c) => c.kind === 'mess').flatMap((c) => c.models))
  if (messyModels.size < 25 || messyModels.size > 35) throw new Error(`messy models: ${messyModels.size}`)
  if (messyModels.size / ctx.messy.models.length > 0.25) throw new Error('more than 25% of models touched')

  const tmp = mkdtempSync(join(tmpdir(), 'fixtures-'))
  try {
    const cfg = prismaCfg(tmp)
    rmSync(join(outDir, 'clean'), { recursive: true, force: true })
    rmSync(join(outDir, 'messy'), { recursive: true, force: true })
    rmSync(join(outDir, 'gold'), { recursive: true, force: true })
    writeProject(join(outDir, 'clean'), clean, seedSql(clean, data), cfg)
    writeProject(join(outDir, 'messy'), ctx.messy, seedSql(ctx.messy, ctx.messyData), cfg)

    const gold = join(outDir, 'gold')
    mkdirSync(join(gold, 'migrations', GOLD_MIGRATION), { recursive: true })
    writeFileSync(join(gold, 'schema.prisma'), printSchema(ctx.gold, SUPPORT_MODELS))
    formatSchema(join(gold, 'schema.prisma'), cfg)
    const mapping = { version: 1, models: ctx.buildMapping(), new_models: [...ctx.newModels, { name: 'QuarantinedRow', rules: [], filled_from: [] }, { name: 'MigrationIdMap', rules: [], filled_from: [] }] }
    writeFileSync(join(gold, 'mapping.yaml'), stringify(mapping, { lineWidth: 0 }))
    const decisions = { version: 1, ambiguities: ctx.ambiguities, snapshots: ctx.snapshots, quarantine: ctx.quarantine, assumptions: ctx.assumptions }
    writeFileSync(join(gold, 'decisions.yaml'), stringify(decisions, { lineWidth: 0 }))
    writeFileSync(join(gold, 'migrations', GOLD_MIGRATION, 'migration.sql'), goldMigration(ctx))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  const messySchema = readFileSync(join(outDir, 'messy', 'schema.prisma'))
  const messySeed = readFileSync(join(outDir, 'messy', 'seed.sql'))
  const fixtureHash = createHash('sha256').update(messySchema).update(messySeed).digest('hex')
  const touched = new Set(ctx.cases.flatMap((c) => c.models))
  const cleanModels = ctx.messy.models.map((m) => m.name).filter((n) => !touched.has(n))
  const cov = (pred: (c: (typeof ctx.cases)[number]) => boolean) => ctx.cases.filter(pred).map((c) => c.id)
  const expected = {
    version: 1,
    fixtureHash,
    cases: ctx.cases,
    cleanModels,
    metricCoverage: {
      S1: cov((c) => c.metrics.includes('S1')),
      S2: cleanModels,
      S3: cov((c) => c.metrics.includes('S3')),
      S4: cov((c) => c.metrics.includes('S4')),
      S5: cov((c) => c.metrics.includes('S5') || c.checks.some((k) => k.metric === 'S5')),
    },
    stats: {
      cleanModels: clean.models.length,
      messyModels: ctx.messy.models.length,
      modelsTouchedByMess: messyModels.size,
      untouchedShare: Number((1 - messyModels.size / ctx.messy.models.length).toFixed(3)),
    },
  }
  writeFileSync(join(outDir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n')
  return expected
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out')
  const out = resolve(i > 0 ? process.argv[i + 1] : join(ROOT, 'fixtures'))
  const e = generate(out)
  console.log(`fixtures written to ${out}: ${e.stats.cleanModels} clean models, ${e.stats.messyModels} messy models, ${e.stats.modelsTouchedByMess} touched by mess (${e.cases.length} cases)`)
}
