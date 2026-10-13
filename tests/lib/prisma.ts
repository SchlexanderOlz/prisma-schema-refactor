// Thin wrappers around the pinned Prisma CLI. Prisma 7 reads the datasource only from a
// config file, so every call gets a throwaway prisma.config.mjs.
// NOTE: prisma 7.10 `migrate diff` exits 0 with empty output when no datasource is configured;
// callers below never trust an empty result.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRISMA_BIN } from './env.ts'

export interface CliResult {
  ok: boolean
  code: number | null
  output: string
  stdout: string
}

function withConfig<T>(cfg: { url?: string; schema?: string; migrations?: string }, fn: (cfgPath: string, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'prisma-cfg-'))
  try {
    const p = join(dir, 'prisma.config.mjs')
    const parts: string[] = []
    if (cfg.schema) parts.push(`schema: ${JSON.stringify(cfg.schema)}`)
    if (cfg.migrations) parts.push(`migrations: { path: ${JSON.stringify(cfg.migrations)} }`)
    parts.push(`datasource: { url: ${JSON.stringify(cfg.url ?? 'postgresql://offline:offline@127.0.0.1:1/offline')} }`)
    writeFileSync(p, `export default { ${parts.join(', ')} }\n`)
    return fn(p, dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function run(args: string[], timeoutMs = 180_000): CliResult {
  const r = spawnSync(PRISMA_BIN, args, { encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' } })
  return { ok: r.status === 0, code: r.status, stdout: r.stdout ?? '', output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` }
}

export function validateSchema(schemaPath: string): CliResult {
  return withConfig({}, (cfg) => run(['validate', '--config', cfg, '--schema', schemaPath]))
}

/** Copy every migration dir from `sources` into one folder and run `migrate deploy`. */
export function deployMigrations(url: string, sources: string[], schemaPath: string): CliResult {
  const mdir = mkdtempSync(join(tmpdir(), 'prisma-migrations-'))
  try {
    for (const src of sources) {
      for (const d of readdirSync(src)) {
        const p = join(src, d)
        if (statSync(p).isDirectory() && existsSync(join(p, 'migration.sql'))) cpSync(p, join(mdir, d), { recursive: true })
      }
    }
    writeFileSync(join(mdir, 'migration_lock.toml'), 'provider = "postgresql"\n')
    return withConfig({ url, schema: schemaPath, migrations: mdir }, (cfg) => run(['migrate', 'deploy', '--config', cfg]))
  } finally {
    rmSync(mdir, { recursive: true, force: true })
  }
}

export interface DriftResult {
  ok: boolean
  empty: boolean
  output: string
}

export function driftAgainstDb(url: string, schemaPath: string): DriftResult {
  const r = withConfig({ url, schema: schemaPath }, (cfg) => run(['migrate', 'diff', '--config', cfg, '--from-config-datasource', '--to-schema', schemaPath, '--exit-code']))
  if (r.code === 0 && r.stdout.includes('No difference detected')) return { ok: true, empty: true, output: r.output }
  if (r.code === 2) return { ok: true, empty: false, output: r.output }
  return { ok: false, empty: false, output: r.output || `prisma migrate diff exited ${r.code} without output` }
}

export function sqlFromEmpty(schemaPath: string): CliResult {
  return withConfig({}, (cfg) => run(['migrate', 'diff', '--config', cfg, '--from-empty', '--to-schema', schemaPath, '--script']))
}

export function ensureDir(p: string) {
  mkdirSync(p, { recursive: true })
}
