// Self-test (no Claude): fixtures up to date, clean fixture valid, gold 100%,
// mutants fail exactly their target, coverage, anti-leak.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { Report } from '../aggregate.ts'
import { aggregate, loadThresholds } from '../aggregate.ts'
import { withClient } from '../lib/db.ts'
import { FIXTURES, GOLD, PGURL_ADMIN, RESULTS, ROOT, dbUrl } from '../lib/env.ts'
import { deployMigrations, driftAgainstDb } from '../lib/prisma.ts'
import { parseSchema } from '../lib/schema.ts'
import type { Metrics } from '../lib/score-core.ts'
import { GATES, METRICS, loadExpected, scoreOutput } from '../lib/score-core.ts'
import { snapshotRepo } from '../lib/snapshot.ts'
import { MUTANTS } from './mutants.ts'

interface Step {
  name: string
  ok: boolean
  details: string[]
}

function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else out.push(relative(dir, p))
    }
  }
  walk(dir)
  return out
}

function compareTrees(a: string, b: string): string[] {
  const fa = listFiles(a)
  const fb = listFiles(b)
  const d: string[] = []
  for (const f of fa) if (!fb.includes(f)) d.push(`only committed: ${f}`)
  for (const f of fb) if (!fa.includes(f)) d.push(`only regenerated: ${f}`)
  for (const f of fa.filter((x) => fb.includes(x))) if (!readFileSync(join(a, f)).equals(readFileSync(join(b, f)))) d.push(`differs: ${f}`)
  return d
}

// ---------------------------------------------------------------------------

function fixturesUpToDate(): Step {
  const tmp = mkdtempSync(join(tmpdir(), 'regen-'))
  try {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(FIXTURES, 'generator', 'index.ts'), '--out', tmp], { encoding: 'utf8' })
    if (r.status !== 0) return { name: 'fixtures up to date', ok: false, details: [`generator failed: ${r.stderr.slice(-800)}`] }
    const d: string[] = []
    for (const sub of ['clean', 'messy', 'gold']) d.push(...compareTrees(join(FIXTURES, sub), join(tmp, sub)).map((x) => `${sub}/${x}`))
    if (!readFileSync(join(FIXTURES, 'expected.json')).equals(readFileSync(join(tmp, 'expected.json')))) d.push('differs: expected.json')
    return { name: 'fixtures up to date (regenerated output is byte-identical)', ok: !d.length, details: d.length ? [...d, 'run `npm run fixtures` and commit the result'] : [] }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function cleanFixtureValid(): Promise<Step> {
  const name = 'selftest_clean'
  const d: string[] = []
  await withClient(PGURL_ADMIN, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await c.query(`CREATE DATABASE ${name}`)
  })
  try {
    const url = dbUrl(name)
    const dep = deployMigrations(url, [join(FIXTURES, 'clean', 'migrations')], join(FIXTURES, 'clean', 'schema.prisma'))
    if (!dep.ok) d.push(`clean migrations: ${dep.output.slice(-500)}`)
    else {
      await withClient(url, async (c) => {
        await c.query(readFileSync(join(FIXTURES, 'clean', 'seed.sql'), 'utf8'))
      }).catch((e) => d.push(`clean seed: ${e.message}`))
      const drift = driftAgainstDb(url, join(FIXTURES, 'clean', 'schema.prisma'))
      if (!drift.ok || !drift.empty) d.push(`clean drift: ${drift.output.slice(0, 500)}`)
    }
    const clean = parseSchema(readFileSync(join(FIXTURES, 'clean', 'schema.prisma'), 'utf8'))
    if (clean.models.size < 110) d.push(`clean schema has ${clean.models.size} models (< 110)`)
    const e = loadExpected() as unknown as { stats: { modelsTouchedByMess: number; untouchedShare: number } }
    if (e.stats.modelsTouchedByMess < 25 || e.stats.modelsTouchedByMess > 35) d.push(`messy models touched: ${e.stats.modelsTouchedByMess} (want 25–35)`)
    if (e.stats.untouchedShare < 0.75) d.push(`untouched share ${e.stats.untouchedShare} < 0.75`)
  } finally {
    await withClient(PGURL_ADMIN, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`))
  }
  return { name: 'clean fixture deploys, seeds and has no drift; model counts in range', ok: !d.length, details: d }
}

function goldPerfect(m: Metrics): Step {
  const d: string[] = []
  for (const g of GATES) if (m.gates[g].status !== 'pass') d.push(`${g}: ${m.gates[g].status} ${m.gates[g].details.slice(0, 3).join(' | ')}`)
  for (const s of METRICS) if (m.metrics[s].value !== 1) d.push(`${s} = ${m.metrics[s].value}`)
  for (const c of m.cases.filter((x) => !x.pass)) d.push(`case ${c.id}: ${[...c.checks, ...(c.anyOf?.flat() ?? [])].filter((k) => !k.pass).map((k) => `${k.type}: ${k.detail}`).join('; ')}`)
  for (const c of m.cleanModels.filter((x) => !x.pass)) d.push(`clean model ${c.model}: ${c.diff.join('; ')}`)
  return { name: 'gold scores 100% on every gate and metric', ok: !d.length, details: d }
}

async function runMutants(log: (s: string) => void): Promise<{ step: Step; hits: Record<string, string[]> }> {
  const thresholds = loadThresholds()
  const d: string[] = []
  const hits: Record<string, string[]> = {}
  for (const mu of MUTANTS) {
    const dir = mkdtempSync(join(tmpdir(), `mutant-${mu.id}-`))
    let m: Metrics
    try {
      cpSync(GOLD, dir, { recursive: true })
      mu.apply?.(dir)
      const repoBefore = snapshotRepo(ROOT)
      if (mu.simulateWrite) writeFileSync(join(ROOT, mu.simulateWrite), 'probe\n')
      try {
        m = await scoreOutput({ outDir: dir, runId: `selftest_${mu.id}`, repoBefore })
      } finally {
        if (mu.simulateWrite) rmSync(join(ROOT, mu.simulateWrite), { force: true })
      }
    } catch (e) {
      d.push(`${mu.id}: harness error ${(e as Error).message}`)
      continue
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const failed = GATES.filter((g) => m.gates[g].status === 'fail')
    for (const g of failed) (hits[g] ??= []).push(mu.id)
    const problems: string[] = []
    if (mu.gate) {
      if (!failed.includes(mu.gate as never)) problems.push(`${mu.gate} did not fail`)
      const others = failed.filter((g) => g !== mu.gate)
      if (others.length) problems.push(`also failed ${others.map((g) => `${g} (${m.gates[g].details[0]?.slice(0, 160)})`).join(', ')}`)
    }
    if (mu.metric) {
      if (failed.length) problems.push(`gates failed: ${failed.map((g) => `${g} (${m.gates[g].details[0]?.slice(0, 160)})`).join(', ')}`)
      const v = m.metrics[mu.metric.key].value
      const min = thresholds[mu.metric.key as 'S1'].min
      const okCond = mu.metric.cond === 'below_min' ? v < min : mu.metric.cond === 'zero' ? v === 0 : v < 1
      if (!okCond) problems.push(`${mu.metric.key} = ${v} does not satisfy ${mu.metric.cond}`)
      for (const s of METRICS) {
        if (s === mu.metric.key || mu.alsoDrops?.includes(s)) continue
        if (m.metrics[s].value !== 1) problems.push(`${s} also dropped to ${m.metrics[s].value}`)
      }
    }
    const summary = `${GATES.map((g) => `${g}:${m.gates[g].status[0]}`).join(' ')} ${METRICS.map((s) => `${s}=${m.metrics[s].value.toFixed(2)}`).join(' ')}`
    log(`  ${problems.length ? '❌' : '✅'} ${mu.id} ${mu.change}: ${summary}`)
    for (const p of problems) d.push(`${mu.id} (${mu.change}): ${p}`)
  }
  return { step: { name: 'mutants fail exactly their target', ok: !d.length, details: d }, hits }
}

function coverage(hits: Record<string, string[]>): Step {
  const e = loadExpected()
  const d: string[] = []
  for (const s of ['S1', 'S3', 'S4', 'S5']) if ((e.metricCoverage[s] ?? []).length < 2) d.push(`${s} covered by ${(e.metricCoverage[s] ?? []).length} cases (< 2)`)
  if (e.cleanModels.length < 2) d.push(`S2 has ${e.cleanModels.length} clean models (< 2)`)
  for (const g of GATES) if (!hits[g]?.length) d.push(`gate ${g} not hit by any mutant`)
  return { name: 'coverage: every S1–S5 metric ≥ 2 cases, every H gate hit by a mutant', ok: !d.length, details: d }
}

/** The verdict rules of §6.4, exercised on the gold metrics. */
function verdictLogic(gold: Metrics): Step {
  const d: string[] = []
  const base = { metrics: [gold, { ...gold, runId: 'g2' }], expectedRuns: 2, baseline: null as Report | null, thresholds: loadThresholds(), selftest: 'passed', harnessTouched: false, labelOk: false, pr: 1 }
  const v = (o: Partial<typeof base>) => aggregate({ ...base, ...o })
  if (v({}).verdict !== 'MERGE-READY') d.push(`gold x2 should be MERGE-READY: ${v({}).reasons.join('; ')}`)
  if (v({ harnessTouched: true }).verdict !== 'NOT READY') d.push('harness change without label must be NOT READY')
  if (v({ harnessTouched: true, labelOk: true }).verdict !== 'MERGE-READY') d.push('harness change with owner label should be MERGE-READY')
  if (v({ selftest: 'failed' }).verdict !== 'NOT READY') d.push('failed selftest must be NOT READY')
  if (v({ expectedRuns: 3 }).verdict !== 'NOT READY') d.push('a missing run must be NOT READY')
  const hi = v({})
  const better = structuredClone(hi)
  better.metrics.S4.value = 1
  better.metrics.S1.value = 1
  const worse = structuredClone(gold)
  worse.runId = 'w'
  worse.metrics = { ...gold.metrics, S1: { value: 0.93, passed: 0, total: 0 } }
  const reg = v({ metrics: [worse, { ...worse, runId: 'w2' }], baseline: better })
  if (reg.verdict !== 'NOT READY' || !reg.reasons.some((r) => r.startsWith('S1 dropped'))) d.push(`S1 drop of 0.07 vs comparable baseline must be NOT READY (${reg.reasons.join('; ')})`)
  const stale = v({ metrics: [worse, { ...worse, runId: 'w2' }], baseline: { ...better, harnessHash: 'other' } })
  if (stale.verdict !== 'MERGE-READY') d.push(`incomparable baseline must skip regression checks (${stale.reasons.join('; ')})`)
  const flip = structuredClone(gold)
  flip.runId = 'f'
  flip.signatures = { ...gold.signatures, [Object.keys(gold.signatures)[0]]: 'fail' }
  const s6 = v({ metrics: [gold, flip] }).metrics.S6.value
  if (!(s6 < 1)) d.push(`S6 must drop when a case outcome differs between runs (got ${s6})`)
  return { name: 'verdict logic (labels, selftest, missing runs, baseline regression, stability)', ok: !d.length, details: d }
}

export function antiLeak(): Step {
  const d: string[] = []
  const skillsDir = join(ROOT, 'skills')
  if (!existsSync(skillsDir)) return { name: 'anti-leak (skills/ absent)', ok: true, details: [] }
  const tokens = new Set<string>()
  const support = new Set<string>()
  const gold = parseSchema(readFileSync(join(GOLD, 'schema.prisma'), 'utf8'))
  for (const n of ['QuarantinedRow', 'MigrationIdMap']) {
    support.add(n)
    for (const f of gold.models.get(n)?.fields ?? []) support.add(f.name)
  }
  for (const sub of ['clean', 'messy']) {
    const s = parseSchema(readFileSync(join(FIXTURES, sub, 'schema.prisma'), 'utf8'))
    // Model names, scalar field names and enum names. Relation fields are left out: they are
    // derived from model names (already covered) and are mostly plain English words.
    for (const m of s.models.values()) {
      tokens.add(m.name)
      for (const f of m.fields) if (!f.isRelation) tokens.add(f.name)
    }
    for (const e of s.enums.keys()) tokens.add(e)
  }
  const names = [...tokens].filter((t) => t.replace(/[^A-Za-z]/g, '').length > 4 && !support.has(t))
  const caseIds = loadExpected().cases.map((c) => c.id)
  const files = listFiles(skillsDir).filter((f) => !f.split('/').includes('node_modules'))
  for (const f of files) {
    const text = readFileSync(join(skillsDir, f), 'utf8')
    for (const t of [...names, ...caseIds]) {
      const re = new RegExp(`(?<![A-Za-z0-9_])${t.replace(/[-]/g, '\\-')}(?![A-Za-z0-9_])`)
      const m = text.match(re)
      if (m) {
        const line = text.slice(0, m.index).split('\n').length
        d.push(`skills/${f}:${line} mentions fixture identifier "${t}"`)
      }
    }
  }
  return { name: `anti-leak: no fixture model/field names or case ids under skills/ (${names.length} names, ${caseIds.length} case ids, ${files.length} files)`, ok: !d.length, details: d }
}

export async function selftest(o: { log: (s: string) => void; json: boolean }): Promise<boolean> {
  const { log } = o
  const steps: Step[] = []
  const record = (s: Step) => {
    steps.push(s)
    log(`${s.ok ? '✅' : '❌'} ${s.name}`)
    for (const x of s.details.slice(0, 40)) log(`     ${x}`)
  }
  record(fixturesUpToDate())
  record(await cleanFixtureValid())
  const repoBefore = snapshotRepo(ROOT)
  const gold = await scoreOutput({ outDir: GOLD, runId: 'selftest_gold', repoBefore })
  record(goldPerfect(gold))
  record(verdictLogic(gold))
  const { step, hits } = await runMutants(log)
  record(step)
  record(coverage(hits))
  record(antiLeak())
  const ok = steps.every((s) => s.ok)
  mkdirSync(join(RESULTS, 'selftest'), { recursive: true })
  const report = { status: ok ? 'passed' : 'failed', steps }
  writeFileSync(join(RESULTS, 'selftest', 'selftest.json'), JSON.stringify(report, null, 2) + '\n')
  if (o.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  log(ok ? 'SELFTEST PASSED' : 'SELFTEST FAILED')
  return ok
}
