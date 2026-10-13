// Score one output dir: hard gates H1–H9, cases, metrics S1–S5, cost (S7 input).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { parse as parseYaml } from 'yaml'
import type { CaseResult, Expected } from './checks.ts'
import { compareCleanModel, runCase } from './checks.ts'
import type { Mapping } from './contract.ts'
import { cloneTemplate, dropDb, ensureTemplate } from './db.ts'
import { FIXTURES, GOLD, MESSY, ROOT, TEMPLATE_DB, dbUrl } from './env.ts'
import type { Gate } from './gates.ts'
import { blocked, fail, h4, h5, h6, h7, h8, h9, loadSupport, pass } from './gates.ts'
import { Resolver, loadOutput } from './output.ts'
import { deployMigrations, driftAgainstDb, validateSchema } from './prisma.ts'
import { parseSchema } from './schema.ts'
import type { Snapshot } from './snapshot.ts'

export const GATES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9'] as const
export const METRICS = ['S1', 'S2', 'S3', 'S4', 'S5'] as const

export interface Cost {
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  wallMs: number | null
  turns: number | null
  costUsd: number | null
  isError: boolean | null
  subtype: string | null
}

export interface Metrics {
  version: 1
  runId: string
  fixtureHash: string
  crashed: string | null
  gates: Record<string, Gate>
  metrics: Record<string, { value: number; passed: number; total: number }>
  cases: CaseResult[]
  cleanModels: { model: string; pass: boolean; diff: string[] }[]
  signatures: Record<string, string>
  cost: Cost | null
}

export interface ScoreOptions {
  outDir: string
  runId: string
  repoBefore?: Snapshot
  project?: { dir: string; before: Snapshot; exclude: string[] }
  claudeJson?: string
  crashed?: string
  keepDb?: boolean
  log?: (s: string) => void
}

export function loadExpected(): Expected {
  return JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8'))
}

export function parseCost(path: string | undefined): Cost | null {
  if (!path || !existsSync(path)) return null
  let j: Record<string, unknown>
  try {
    const text = readFileSync(path, 'utf8').trim()
    j = JSON.parse(text.slice(text.indexOf('{')))
  } catch {
    return null
  }
  const u = (j.usage ?? {}) as Record<string, number>
  let input = u.input_tokens ?? 0
  let output = u.output_tokens ?? 0
  let cacheRead = u.cache_read_input_tokens ?? 0
  let cacheCreate = u.cache_creation_input_tokens ?? 0
  const mu = j.modelUsage as Record<string, Record<string, number>> | undefined
  if (mu && Object.keys(mu).length) {
    input = output = cacheRead = cacheCreate = 0
    for (const m of Object.values(mu)) {
      input += m.inputTokens ?? 0
      output += m.outputTokens ?? 0
      cacheRead += m.cacheReadInputTokens ?? 0
      cacheCreate += m.cacheCreationInputTokens ?? 0
    }
  }
  return {
    tokens: input + output + cacheRead + cacheCreate,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreate,
    wallMs: (j.duration_ms as number) ?? null,
    turns: (j.num_turns as number) ?? null,
    costUsd: (j.total_cost_usd as number) ?? null,
    isError: (j.is_error as boolean) ?? null,
    subtype: (j.subtype as string) ?? null,
  }
}

function emptyMetrics(expected: Expected, opts: ScoreOptions, reason: string): Metrics {
  const gates: Record<string, Gate> = {}
  for (const g of GATES) gates[g] = fail([`run crashed: ${reason}`])
  const metrics: Metrics['metrics'] = {}
  for (const s of METRICS) metrics[s] = { value: 0, passed: 0, total: 1 }
  return {
    version: 1, runId: opts.runId, fixtureHash: expected.fixtureHash, crashed: reason, gates, metrics,
    cases: expected.cases.map((k) => ({ id: k.id, kind: k.kind, rule: k.rule, metrics: k.metrics, pass: false, branch: null, checks: [], anyOf: null })),
    cleanModels: [], signatures: Object.fromEntries(expected.cases.map((k) => [k.id, 'fail'])), cost: parseCost(opts.claudeJson),
  }
}

export async function scoreOutput(opts: ScoreOptions): Promise<Metrics> {
  const log = opts.log ?? (() => {})
  const expected = loadExpected()
  if (opts.crashed) return emptyMetrics(expected, opts, opts.crashed)
  const messy = parseSchema(readFileSync(join(MESSY, 'schema.prisma'), 'utf8'))
  const gold = parseSchema(readFileSync(join(GOLD, 'schema.prisma'), 'utf8'))
  const goldRes = new Resolver(messy, gold, parseYaml(readFileSync(join(GOLD, 'mapping.yaml'), 'utf8')) as Mapping)
  const out = loadOutput(opts.outDir)
  const res = new Resolver(messy, out.schema, out.mapping)
  const gates: Record<string, Gate> = {}

  log('H1 prisma validate')
  if (!existsSync(out.schemaPath)) gates.H1 = fail(['schema.prisma missing'])
  else {
    const v = validateSchema(out.schemaPath)
    gates.H1 = v.ok && out.schema ? pass() : fail([v.output.trim().split('\n').slice(-12).join('\n') || out.schemaError || 'invalid'])
  }

  await ensureTemplate(expected.fixtureHash, log)
  const evalName = `eval_${opts.runId}`.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
  const evalUrl = await cloneTemplate(evalName)
  log('H2 migrate deploy')
  if (!out.migrationDirs.length) gates.H2 = fail(['no migrations/<ts>_*/migration.sql in output'])
  else {
    const d = deployMigrations(evalUrl, [join(MESSY, 'migrations'), join(opts.outDir, 'migrations')], join(MESSY, 'schema.prisma'))
    gates.H2 = d.ok ? pass() : fail([d.output.trim().split('\n').slice(-15).join('\n')])
  }

  log('H3 drift')
  if (gates.H1.status !== 'pass') gates.H3 = blocked('H1')
  else if (gates.H2.status !== 'pass') gates.H3 = blocked('H2')
  else {
    const d = driftAgainstDb(evalUrl, out.schemaPath)
    gates.H3 = d.ok && d.empty ? pass() : fail([d.output.trim().split('\n').slice(0, 30).join('\n')])
  }

  log('H4 mapping')
  gates.H4 = h4(out, messy)

  const tpl = new pg.Client({ connectionString: dbUrl(TEMPLATE_DB), statement_timeout: 60_000 })
  await tpl.connect()
  const ev = gates.H2.status === 'pass' ? new pg.Client({ connectionString: evalUrl, statement_timeout: 60_000 }) : null
  if (ev) await ev.connect()
  try {
    const mappingOk = !!out.mapping && !!out.schema
    const sup = ev && out.schema ? await loadSupport(ev, res) : null
    log('H5 reconciliation')
    gates.H5 = !ev ? blocked('H2') : !mappingOk ? blocked(out.schema ? 'H4' : 'H1') : await h5(tpl, ev, res, sup!)
    log('H6 annotations')
    gates.H6 = h6(out, res)
    log('H7 values')
    gates.H7 = !ev ? blocked('H2') : !mappingOk ? blocked(out.schema ? 'H4' : 'H1') : await h7(tpl, ev, res, sup!)
    log('H8 constraints')
    gates.H8 = !ev ? blocked('H2') : await h8(ev)
    log('H9 untouched')
    gates.H9 = h9(ROOT, opts.repoBefore, opts.project)

    log('cases')
    const env = { res, decisions: out.decisions, ev, tpl }
    const cases: CaseResult[] = []
    for (const k of expected.cases) cases.push(await runCase(env, k))
    const cleanModels = expected.cleanModels.map((m) => ({ model: m, ...(out.schema ? compareCleanModel(res, gold, goldRes, m) : { pass: false, diff: ['no schema'] }) }))

    const rate = (xs: boolean[]) => ({ value: xs.length ? xs.filter(Boolean).length / xs.length : 1, passed: xs.filter(Boolean).length, total: xs.length })
    const s5checks = cases.flatMap((c) => c.checks.filter((k) => k.metric === 'S5').map((k) => k.pass))
    const metrics = {
      S1: rate(cases.filter((c) => c.metrics.includes('S1')).map((c) => c.pass)),
      S2: rate(cleanModels.map((c) => c.pass)),
      S3: rate(cases.filter((c) => c.kind === 'trap').map((c) => c.pass)),
      S4: rate(cases.filter((c) => c.kind === 'ambiguity').map((c) => c.pass)),
      S5: rate(s5checks),
    }
    const signatures = Object.fromEntries(cases.map((c) => [c.id, c.pass ? `pass:${c.branch}` : 'fail']))
    return { version: 1, runId: opts.runId, fixtureHash: expected.fixtureHash, crashed: null, gates, metrics, cases, cleanModels, signatures, cost: parseCost(opts.claudeJson) }
  } finally {
    await tpl.end()
    if (ev) await ev.end()
    if (!opts.keepDb) await dropDb(evalName)
  }
}
