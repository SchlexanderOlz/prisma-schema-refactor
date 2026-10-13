// Database lifecycle: one template DB with the messy migrations + seed, cloned per run.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { MESSY, PGURL_ADMIN, TEMPLATE_DB, dbUrl } from './env.ts'
import { deployMigrations } from './prisma.ts'

export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url, statement_timeout: 60_000 })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`

export async function dropDb(name: string): Promise<void> {
  await withClient(PGURL_ADMIN, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`)
  })
}

export async function cloneTemplate(name: string): Promise<string> {
  await withClient(PGURL_ADMIN, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`)
    await c.query(`CREATE DATABASE ${ident(name)} TEMPLATE ${ident(TEMPLATE_DB)}`)
  })
  return dbUrl(name)
}

/** (Re)build fixture_messy when missing or built from a different fixture hash. */
export async function ensureTemplate(fixtureHash: string, log: (s: string) => void = () => {}): Promise<void> {
  const current = await withClient(PGURL_ADMIN, async (c) => {
    const r = await c.query(
      `SELECT shobj_description(d.oid, 'pg_database') AS note FROM pg_database d WHERE d.datname = $1`,
      [TEMPLATE_DB],
    )
    return r.rows[0]?.note ?? null
  })
  if (current === fixtureHash) return
  log(`building template database ${TEMPLATE_DB}`)
  await withClient(PGURL_ADMIN, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${ident(TEMPLATE_DB)} WITH (FORCE)`)
    await c.query(`CREATE DATABASE ${ident(TEMPLATE_DB)}`)
  })
  const url = dbUrl(TEMPLATE_DB)
  const dep = deployMigrations(url, [join(MESSY, 'migrations')], join(MESSY, 'schema.prisma'))
  if (!dep.ok) throw new Error(`template migrate deploy failed:\n${dep.output}`)
  await withClient(url, async (c) => {
    await c.query(readFileSync(join(MESSY, 'seed.sql'), 'utf8'))
  })
  await withClient(PGURL_ADMIN, async (c) => {
    await c.query(`COMMENT ON DATABASE ${ident(TEMPLATE_DB)} IS '${fixtureHash}'`)
  })
}

export async function pgReachable(): Promise<boolean> {
  try {
    await withClient(PGURL_ADMIN, async (c) => {
      await c.query('SELECT 1')
    })
    return true
  } catch {
    return false
  }
}
