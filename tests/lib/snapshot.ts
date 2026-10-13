// File-tree fingerprints for H9 (nothing changed outside the output dir).

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { join, relative } from 'node:path'

export type Snapshot = Record<string, string>

function hashFile(p: string): string {
  const st = lstatSync(p)
  if (st.isSymbolicLink()) return `link:${readlinkSync(p)}`
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

/** Tracked + untracked-but-not-ignored files of a git checkout. */
export function snapshotRepo(root: string): Snapshot {
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`)
  const snap: Snapshot = {}
  for (const f of r.stdout.split('\0').filter(Boolean).sort()) {
    const p = join(root, f)
    snap[f] = existsSync(p) || lstatSync(p, { throwIfNoEntry: false }) ? hashFile(p) : 'deleted'
  }
  return snap
}

/** Every file below root except the excluded top-level entries. */
export function snapshotDir(root: string, exclude: string[]): Snapshot {
  const snap: Snapshot = {}
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, e.name)
      const rel = relative(root, p)
      if (exclude.some((x) => rel === x || rel.startsWith(x + '/'))) continue
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p)
      else snap[rel] = hashFile(p)
    }
  }
  walk(root)
  return snap
}

export function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = []
  for (const k of Object.keys(before)) {
    if (!(k in after)) out.push(`deleted: ${k}`)
    else if (before[k] !== after[k]) out.push(`modified: ${k}`)
  }
  for (const k of Object.keys(after)) if (!(k in before)) out.push(`added: ${k}`)
  return out.sort()
}

/** Hash of the harness (tests/ + fixtures/) used to decide baseline comparability. */
export function harnessHash(root: string): string {
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', 'tests', 'fixtures'], { cwd: root, encoding: 'utf8' })
  const h = createHash('sha256')
  for (const f of r.stdout.split('\0').filter(Boolean).sort()) {
    const p = join(root, f)
    if (!existsSync(p)) continue
    h.update(f).update('\0').update(readFileSync(p)).update('\0')
  }
  return h.digest('hex')
}
