import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const FIXTURES = join(ROOT, 'fixtures')
export const MESSY = join(FIXTURES, 'messy')
export const GOLD = join(FIXTURES, 'gold')
export const RESULTS = join(ROOT, 'results')
export const PRISMA_BIN = join(ROOT, 'node_modules', '.bin', 'prisma')
export const TEMPLATE_DB = 'fixture_messy'

export const PGURL_ADMIN = process.env.PGURL_ADMIN ?? 'postgresql://postgres:postgres@localhost:54329/postgres'

export function dbUrl(name: string): string {
  const u = new URL(PGURL_ADMIN)
  u.pathname = `/${name}`
  return u.toString()
}
