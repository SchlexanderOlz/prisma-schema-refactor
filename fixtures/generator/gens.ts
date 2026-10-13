// Value generators. All of them are pure functions of the GenCtx (seeded rng + row index).

import type { Gen, GenCtx, Value } from './ir.ts'
import { CITY, COMPANY_STEM, COMPANY_SUFFIX, COUNTRY, FIRST, LAST, SENTENCES, STREET, WORDS } from './names.ts'

const BASE = Date.UTC(2024, 0, 1)
const DAY = 86400000

const pad = (n: number, w: number) => String(n).padStart(w, '0')

export function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`
}
export function fmtTs(ms: number): string {
  const d = new Date(ms)
  return `${fmtDate(ms)} ${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`
}
export function parseDay(s: string): number {
  return Date.parse(s.length === 10 ? s + 'T00:00:00Z' : s.replace(' ', 'T') + 'Z')
}

export const seq =
  (prefix: string, width = 4, start = 1): Gen =>
  (c) =>
    `${prefix}${pad(start + c.i, width)}`

export const uniqPick =
  (pool: readonly string[]): Gen =>
  (c) =>
    pool[c.i % pool.length] + (c.i >= pool.length ? ` ${Math.floor(c.i / pool.length) + 1}` : '')

export const firstName: Gen = (c) => c.rng.pick(FIRST)
export const lastName: Gen = (c) => c.rng.pick(LAST)
export const fullName: Gen = (c) => `${c.rng.pick(FIRST)} ${c.rng.pick(LAST)}`
export const company: Gen = (c) => `${COMPANY_STEM[(c.i * 7 + c.model.name.length) % COMPANY_STEM.length]} ${c.rng.pick(COMPANY_SUFFIX)}`
export const email: Gen = (c) => `${c.rng.pick(FIRST)}.${c.rng.pick(LAST)}${c.id}@example.test`.toLowerCase()
export const phone: Gen = (c) => `+44 20 7${pad(c.rng.int(0, 999), 3)} ${pad(c.rng.int(0, 9999), 4)}`
export const street: Gen = (c) => `${c.rng.int(1, 240)} ${c.rng.pick(STREET)}`
export const city: Gen = (c) => c.rng.pick(CITY)
export const postal: Gen = (c) => pad(c.rng.int(10000, 99999), 5)
export const country: Gen = (c) => c.rng.pick(COUNTRY)
export const sentence: Gen = (c) => c.rng.pick(SENTENCES)
export const words =
  (n = 2): Gen =>
  (c) =>
    Array.from({ length: n }, () => c.rng.pick(WORDS)).join(' ')
export const titleWords =
  (n = 2): Gen =>
  (c) =>
    Array.from({ length: n }, () => {
      const w = c.rng.pick(WORDS)
      return w[0].toUpperCase() + w.slice(1)
    }).join(' ')
export const hex =
  (n: number): Gen =>
  (c) =>
    Array.from({ length: n }, () => '0123456789abcdef'[c.rng.int(0, 15)]).join('')
export const url: Gen = (c) => `https://${c.rng.pick(WORDS)}-${c.id}.example.test`
export const int =
  (a: number, b: number): Gen =>
  (c) =>
    c.rng.int(a, b)
export const dec =
  (a: number, b: number, scale = 2): Gen =>
  (c) =>
    (c.rng.int(a * 10 ** scale, b * 10 ** scale) / 10 ** scale).toFixed(scale)
export const money = (a: number, b: number) => dec(a, b, 2)
export const bool =
  (p = 0.7): Gen =>
  (c) =>
    c.rng.chance(p)
export const date =
  (fromDay = 0, toDay = 600): Gen =>
  (c) =>
    fmtDate(BASE + c.rng.int(fromDay, toDay) * DAY)
export const ts =
  (fromDay = 0, toDay = 600): Gen =>
  (c) =>
    fmtTs(BASE + c.rng.int(fromDay, toDay) * DAY + c.rng.int(7 * 3600, 19 * 3600) * 1000)
export const pick =
  (...vals: Value[]): Gen =>
  (c) =>
    c.rng.pick(vals)
export const fixed =
  (v: Value): Gen =>
  () =>
    v
export const ipv4: Gen = (c) => `10.${c.rng.int(0, 255)}.${c.rng.int(0, 255)}.${c.rng.int(1, 254)}`

/** Date offset from another field of the same row. */
export const after =
  (field: string, minDays: number, maxDays: number, asTs = false): Gen =>
  (c) => {
    const base = c.row[field]
    if (typeof base !== 'string') return null
    const ms = parseDay(base) + c.rng.int(minDays, maxDays) * DAY
    return asTs ? fmtTs(ms + c.rng.int(8 * 3600, 18 * 3600) * 1000) : fmtDate(ms)
  }

export function defaultGen(name: string, type: string, native?: string): Gen {
  const n = name.toLowerCase()
  if (type === 'String') {
    if (n.includes('email')) return email
    if (n === 'firstname') return firstName
    if (n === 'lastname') return lastName
    if (n.endsWith('fullname') || n === 'displayname') return fullName
    if (n.endsWith('companyname')) return company
    if (n.includes('phone')) return phone
    if (n.endsWith('street')) return street
    if (n.endsWith('city')) return city
    if (n.endsWith('postalcode')) return postal
    if (n.endsWith('url')) return url
    if (n.endsWith('hash')) return hex(40)
    if (/(description|note|body|summary|memo|text)$/.test(n)) return sentence
    if (n === 'title' || n.endsWith('title') || n.endsWith('label')) return titleWords(2)
    return words(2)
  }
  if (type === 'Int') return int(1, 100)
  if (type === 'Float') return (c: GenCtx) => c.rng.int(100, 99999) / 100
  if (type === 'Decimal') {
    const m = native?.match(/Decimal\(\d+,\s*(\d+)\)/)
    return dec(5, 900, m ? Number(m[1]) : 2)
  }
  if (type === 'Boolean') return bool(0.7)
  if (type === 'DateTime') return native === 'Date' ? date() : ts()
  if (type === 'Json') return fixed({})
  throw new Error(`no default gen for ${name}:${type}`)
}
