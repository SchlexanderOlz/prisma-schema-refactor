// Verifies that a Claude-formatted PR comment kept the verdict line and every number of report.json.
// node tests/verify-comment.ts report.json comment.md  → exit 0 if faithful, 1 otherwise.

import { readFileSync } from 'node:fs'
import type { Report } from './aggregate.ts'

export function verifyComment(r: Report, text: string): string[] {
  const problems: string[] = []
  const first = text.split('\n').find((l) => l.trim()) ?? ''
  if (!first.includes(r.verdict)) problems.push(`first line does not contain the verdict "${r.verdict}"`)
  if (r.verdict === 'MERGE-READY' && text.includes('NOT READY')) problems.push('comment mentions NOT READY although the verdict is MERGE-READY')
  if (r.verdict === 'NOT READY' && /MERGE-READY/.test(text.replace(/NOT READY/g, ''))) problems.push('comment claims MERGE-READY')
  const has = (n: number) => new RegExp(`(^|[^0-9.])[+]?${String(n).replace('.', '\\.')}(?![0-9])`).test(text)
  const nums: [string, number][] = []
  for (const [k, m] of Object.entries(r.metrics)) {
    nums.push([`${k}.value`, m.value], [`${k}.min`, m.min])
    if (m.baseline !== null) nums.push([`${k}.baseline`, m.baseline])
    if (m.delta !== null) nums.push([`${k}.delta`, m.delta])
  }
  for (const [k, v] of Object.entries(r.cost)) if (typeof v === 'number') nums.push([`cost.${k}`, v])
  for (const [k, v] of nums) if (!has(v)) problems.push(`number ${k}=${v} missing`)
  for (const [g, v] of Object.entries(r.gates)) {
    const line = text.split('\n').find((l) => new RegExp(`\\b${g}\\b`).test(l) && l.includes('|'))
    if (!line) problems.push(`gate ${g} row missing`)
    else {
      const fails = v.perRun.filter((s) => s !== 'pass').length
      const crosses = (line.match(/❌|⏸️|⏸/g) ?? []).length
      const ticks = (line.match(/✅/g) ?? []).length
      if (ticks !== v.perRun.length - fails || crosses !== fails) problems.push(`gate ${g} row does not match per-run results`)
    }
  }
  return problems
}

if (process.argv[1]?.endsWith('verify-comment.ts')) {
  const r = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Report
  const p = verifyComment(r, readFileSync(process.argv[3], 'utf8'))
  if (p.length) {
    console.error(`comment rejected:\n- ${p.join('\n- ')}`)
    process.exit(1)
  }
  console.log('comment verified')
}
