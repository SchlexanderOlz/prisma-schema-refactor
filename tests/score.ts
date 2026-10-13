// One output dir → metrics.json
// tsx tests/score.ts --out <dir> --run-id <id> --metrics <file> [--repo-snapshot <file>]
//   [--project <dir> --project-snapshot <file>] [--claude-json <file>] [--crashed <reason>] [--keep-db]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { scoreOutput } from './lib/score-core.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

export function summarize(m: Awaited<ReturnType<typeof scoreOutput>>): string {
  const g = Object.entries(m.gates).map(([k, v]) => `${k}:${v.status === 'pass' ? '✅' : v.status === 'blocked' ? '⏸' : '❌'}`).join(' ')
  const s = Object.entries(m.metrics).map(([k, v]) => `${k}=${v.value.toFixed(3)} (${v.passed}/${v.total})`).join('  ')
  return `${g}\n${s}`
}

async function main() {
  const out = arg('out')
  const metricsPath = arg('metrics')
  if (!out || !metricsPath) {
    console.error('usage: score.ts --out <dir> --metrics <file> [--run-id id]')
    process.exit(2)
  }
  const projectDir = arg('project')
  const m = await scoreOutput({
    outDir: resolve(out),
    runId: arg('run-id') ?? 'adhoc',
    repoBefore: arg('repo-snapshot') ? JSON.parse(readFileSync(arg('repo-snapshot')!, 'utf8')) : undefined,
    project: projectDir ? { dir: resolve(projectDir), before: JSON.parse(readFileSync(arg('project-snapshot')!, 'utf8')), exclude: ['refactor-out', 'node_modules'] } : undefined,
    claudeJson: arg('claude-json'),
    crashed: arg('crashed'),
    keepDb: process.argv.includes('--keep-db'),
    log: process.argv.includes('--verbose') ? (s) => console.error(`  · ${s}`) : undefined,
  })
  mkdirSync(dirname(resolve(metricsPath)), { recursive: true })
  writeFileSync(metricsPath, JSON.stringify(m, null, 2) + '\n')
  console.log(summarize(m))
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('score.ts')) {
  main().catch((e) => {
    console.error(`harness error: ${e?.stack ?? e}`)
    process.exit(2)
  })
}
