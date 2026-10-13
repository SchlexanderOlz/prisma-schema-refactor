// N runs + baseline → report.json, report.md, verdict.txt. The verdict is decided here, nowhere else.
//
// node tests/aggregate.ts --metrics <file>... | --runs-dir <dir>
//   [--expected-runs N] [--baseline <file>] [--selftest passed|failed|skipped]
//   [--harness-touched true|false] [--label-ok true|false] [--pr <n>] --out <dir>

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ROOT } from './lib/env.ts'
import type { Metrics } from './lib/score-core.ts'
import { GATES, loadExpected } from './lib/score-core.ts'
import { harnessHash } from './lib/snapshot.ts'

const SCORED = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const
type Thresholds = Record<(typeof SCORED)[number], { min: number; maxDrop: number }> & { S7: { warnIfMedianTokensAbove: number } }

export interface Report {
  version: 1
  verdict: 'MERGE-READY' | 'NOT READY'
  reasons: string[]
  notes: string[]
  pr: number | null
  harnessHash: string
  fixtureHash: string
  runs: { expected: number; completed: number; ids: string[] }
  selftest: string
  harnessChange: { touched: boolean; labelOk: boolean }
  gates: Record<string, { perRun: string[]; ok: boolean; firstFailure: string | null }>
  metrics: Record<string, { value: number; perRun: number[]; min: number; baseline: number | null; delta: number | null; maxDrop: number; status: 'ok' | 'below_min' | 'regressed' }>
  cost: { medianTokens: number | null; medianWallMinutes: number | null; medianTurns: number | null; medianCostUsd: number | null; baselineMedianTokens: number | null; tokenRatio: number | null; warn: boolean }
  baseline: { comparable: boolean; reason: string; pr: number | null }
  failingCases: { id: string; rule: string; kind: string; failedRuns: number; totalRuns: number; details: string[] }[]
  failingCleanModels: { model: string; failedRuns: number; diff: string[] }[]
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function args() {
  const a = process.argv.slice(2)
  const get = (k: string) => {
    const i = a.indexOf(`--${k}`)
    return i >= 0 ? a[i + 1] : undefined
  }
  const metrics: string[] = []
  for (let i = 0; i < a.length; i++) if (a[i] === '--metrics') metrics.push(a[i + 1])
  return { get, metrics }
}

export function aggregate(o: {
  metrics: Metrics[]
  expectedRuns: number
  baseline: Report | null
  thresholds: Thresholds
  selftest: string
  harnessTouched: boolean
  labelOk: boolean
  pr: number | null
}): Report {
  const expected = loadExpected()
  const runs = [...o.metrics].sort((a, b) => a.runId.localeCompare(b.runId, undefined, { numeric: true }))
  const reasons: string[] = []
  const notes: string[] = []
  const hh = harnessHash(ROOT)
  // Missing runs count as crashed runs.
  const missing = Math.max(0, o.expectedRuns - runs.length)
  if (missing) reasons.push(`${missing} of ${o.expectedRuns} runs produced no metrics (crash/timeout)`)
  const crashed = runs.filter((m) => m.crashed)
  for (const m of crashed) reasons.push(`run ${m.runId} crashed: ${m.crashed}`)

  const gates: Report['gates'] = {}
  for (const g of GATES) {
    const perRun = [...runs.map((m) => m.gates[g]?.status ?? 'fail'), ...Array(missing).fill('fail')]
    const ok = perRun.every((s) => s === 'pass')
    const firstBad = runs.find((m) => m.gates[g]?.status !== 'pass')
    gates[g] = { perRun, ok, firstFailure: firstBad ? `run ${firstBad.runId}: ${(firstBad.gates[g]?.details ?? []).slice(0, 3).join(' | ').slice(0, 400)}` : null }
    if (!ok) reasons.push(`gate ${g} failed in ${perRun.filter((s) => s !== 'pass').length}/${perRun.length} runs`)
  }

  const base = o.baseline
  let comparable = false
  let baseReason = 'no baseline'
  if (base) {
    comparable = base.harnessHash === hh
    baseReason = comparable ? `baseline from PR #${base.pr ?? '?'}` : 'baseline harnessHash differs from current tests/ + fixtures/; regression checks skipped'
  }
  if (!comparable) notes.push(base ? baseReason : 'no comparable baseline; regression checks skipped')

  const metrics: Report['metrics'] = {}
  const perRunValue = (k: string) => [...runs.map((m) => m.metrics[k]?.value ?? 0), ...Array(missing).fill(0)]
  const total = runs.length + missing
  const s6 = (() => {
    if (!total) return 0
    let stable = 0
    for (const c of expected.cases) {
      const sigs = new Set([...runs.map((m) => m.signatures[c.id] ?? 'fail'), ...Array(missing).fill('fail')])
      if (sigs.size === 1) stable++
    }
    return stable / expected.cases.length
  })()
  for (const k of SCORED) {
    const perRun = k === 'S6' ? [s6] : perRunValue(k)
    const value = r3(perRun.length ? perRun.reduce((a, b) => a + b, 0) / perRun.length : 0)
    const t = o.thresholds[k]
    const bv = comparable ? (base!.metrics[k]?.value ?? null) : null
    const delta = bv === null ? null : r3(value - bv)
    let status: 'ok' | 'below_min' | 'regressed' = 'ok'
    if (value < t.min - 1e-9) status = 'below_min'
    else if (delta !== null && -delta > t.maxDrop + 1e-9) status = 'regressed'
    if (status === 'below_min') reasons.push(`${k} = ${value} below min ${t.min}`)
    if (status === 'regressed') reasons.push(`${k} dropped ${r3(-delta!)} vs baseline (max ${t.maxDrop})`)
    metrics[k] = { value, perRun: perRun.map(r3), min: t.min, baseline: bv, delta, maxDrop: t.maxDrop, status }
  }

  const costs = runs.map((m) => m.cost).filter((c): c is NonNullable<Metrics['cost']> => !!c)
  const medTokens = median(costs.map((c) => c.tokens))
  const baseTokens = comparable ? (base!.cost?.medianTokens ?? null) : null
  const ratio = medTokens !== null && baseTokens ? r3(medTokens / baseTokens) : null
  const warn = ratio !== null && ratio > o.thresholds.S7.warnIfMedianTokensAbove
  if (warn) notes.push(`S7: median tokens ${ratio}× baseline (warn above ${o.thresholds.S7.warnIfMedianTokensAbove}×)`)
  const wall = median(costs.filter((c) => c.wallMs !== null).map((c) => c.wallMs!))
  const cost = {
    medianTokens: medTokens,
    medianWallMinutes: wall === null ? null : Math.round((wall / 60000) * 10) / 10,
    medianTurns: median(costs.filter((c) => c.turns !== null).map((c) => c.turns!)),
    medianCostUsd: (() => {
      const m = median(costs.filter((c) => c.costUsd !== null).map((c) => c.costUsd!))
      return m === null ? null : Math.round(m * 100) / 100
    })(),
    baselineMedianTokens: baseTokens,
    tokenRatio: ratio,
    warn,
  }

  if (o.selftest === 'failed') reasons.push('selftest failed')
  else if (o.selftest !== 'passed') notes.push(`selftest ${o.selftest} in this mode`)
  if (o.harnessTouched && !o.labelOk) reasons.push('PR touches tests/, fixtures/ or .github/ and lacks the harness-change label set by the owner')

  const failingCases: Report['failingCases'] = []
  for (const c of expected.cases) {
    const bad = runs.filter((m) => !m.cases.find((x) => x.id === c.id)?.pass)
    const failed = bad.length + missing
    if (!failed) continue
    const first = bad[0]?.cases.find((x) => x.id === c.id)
    const details = first
      ? [...first.checks, ...(first.anyOf?.flat() ?? [])].filter((k) => !k.pass).map((k) => `${k.type}: ${k.detail}`).slice(0, 4)
      : ['run missing']
    failingCases.push({ id: c.id, rule: c.rule, kind: c.kind, failedRuns: failed, totalRuns: total, details })
  }
  failingCases.sort((a, b) => a.rule.localeCompare(b.rule, undefined, { numeric: true }) || a.id.localeCompare(b.id))
  const failingCleanModels: Report['failingCleanModels'] = []
  for (const name of expected.cleanModels) {
    const bad = runs.map((m) => m.cleanModels.find((x) => x.model === name)).filter((x) => x && !x.pass)
    if (bad.length) failingCleanModels.push({ model: name, failedRuns: bad.length, diff: bad[0]!.diff.slice(0, 4) })
  }

  return {
    version: 1,
    verdict: reasons.length ? 'NOT READY' : 'MERGE-READY',
    reasons,
    notes,
    pr: o.pr,
    harnessHash: hh,
    fixtureHash: expected.fixtureHash,
    runs: { expected: Math.max(o.expectedRuns, runs.length), completed: runs.length, ids: runs.map((m) => m.runId) },
    selftest: o.selftest,
    harnessChange: { touched: o.harnessTouched, labelOk: o.labelOk },
    gates,
    metrics,
    cost,
    baseline: { comparable, reason: baseReason, pr: base?.pr ?? null },
    failingCases,
    failingCleanModels,
  }
}

const icon = (s: string) => (s === 'pass' ? '✅' : s === 'blocked' ? '⏸️' : '❌')
const fmt = (x: number | null, signed = false) => (x === null ? '–' : signed && x > 0 ? `+${x}` : String(x))

export function renderMarkdown(r: Report): string {
  const L: string[] = []
  L.push(`**Verdict: ${r.verdict}**`, '')
  if (r.reasons.length) L.push(...r.reasons.map((x) => `- ${x}`), '')
  L.push(`### Gates (${r.runs.completed}/${r.runs.expected} runs)`, '')
  const n = r.runs.expected
  L.push(`| Gate | ${Array.from({ length: n }, (_, i) => `run ${i + 1}`).join(' | ')} |`, `|---|${'---|'.repeat(n)}`)
  for (const [g, v] of Object.entries(r.gates)) L.push(`| ${g} | ${v.perRun.map(icon).join(' | ')} |`)
  L.push('', '### Metrics', '', '| Metric | Value | Min | Baseline | Delta | Status |', '|---|---|---|---|---|---|')
  for (const [k, v] of Object.entries(r.metrics)) L.push(`| ${k} | ${v.value} | ${v.min} | ${fmt(v.baseline)} | ${fmt(v.delta, true)} | ${v.status === 'ok' ? '✅ ok' : `❌ ${v.status}`} |`)
  const c = r.cost
  L.push('', '### Cost (S7, median per run)', '', `tokens ${fmt(c.medianTokens)} · wall ${fmt(c.medianWallMinutes)} min · turns ${fmt(c.medianTurns)} · cost $${fmt(c.medianCostUsd)} · baseline tokens ${fmt(c.baselineMedianTokens)} · ratio ${fmt(c.tokenRatio)}${c.warn ? ' ⚠️' : ''}`)
  if (r.failingCases.length) {
    L.push('', '### Failing cases by rule', '')
    let rule = ''
    for (const f of r.failingCases) {
      if (f.rule !== rule) {
        rule = f.rule
        L.push(`**${rule}**`)
      }
      L.push(`- ${f.id} (${f.kind}, failed ${f.failedRuns}/${f.totalRuns}): ${f.details.join('; ')}`)
    }
  }
  if (r.failingCleanModels.length) {
    L.push('', '### Clean models changed (S2)', '')
    for (const f of r.failingCleanModels) L.push(`- ${f.model} (failed ${f.failedRuns}): ${f.diff.join('; ')}`)
  }
  if (r.notes.length) L.push('', '### Notes', '', ...r.notes.map((x) => `- ${x}`))
  return L.join('\n') + '\n'
}

export function writeReport(r: Report, outDir: string) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(r, null, 2) + '\n')
  writeFileSync(join(outDir, 'report.md'), renderMarkdown(r))
  writeFileSync(join(outDir, 'verdict.txt'), r.verdict + '\n')
}

export function loadThresholds(): Thresholds {
  return JSON.parse(readFileSync(join(ROOT, 'tests', 'thresholds.json'), 'utf8'))
}

async function main() {
  const { get, metrics } = args()
  const files = [...metrics]
  const runsDir = get('runs-dir')
  if (runsDir && existsSync(runsDir)) {
    for (const d of readdirSync(runsDir).sort()) {
      const p = join(runsDir, d, 'metrics.json')
      if (existsSync(p)) files.push(p)
    }
  }
  const out = get('out')
  if (!out) {
    console.error('aggregate: --out required')
    process.exit(2)
  }
  const bpath = get('baseline')
  let baseline: Report | null = null
  if (bpath && existsSync(bpath)) {
    try {
      const b = JSON.parse(readFileSync(bpath, 'utf8'))
      baseline = b && b.metrics ? b : null
    } catch {
      baseline = null
    }
  }
  const r = aggregate({
    metrics: files.map((f) => JSON.parse(readFileSync(resolve(f), 'utf8'))),
    expectedRuns: Number(get('expected-runs') ?? files.length),
    baseline,
    thresholds: loadThresholds(),
    selftest: get('selftest') ?? 'skipped',
    harnessTouched: get('harness-touched') === 'true',
    labelOk: get('label-ok') === 'true',
    pr: get('pr') ? Number(get('pr')) : null,
  })
  writeReport(r, out)
  console.log(r.verdict)
}

if (process.argv[1]?.endsWith('aggregate.ts')) {
  main().catch((e) => {
    console.error(`harness error: ${e?.stack ?? e}`)
    process.exit(2)
  })
}
