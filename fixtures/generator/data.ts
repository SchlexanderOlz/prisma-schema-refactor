// Seeded row generation for the clean schema, plus cross-model hooks (snapshots,
// child rows, deliberate traps). Output is a pure function of SEED.

import type { Data, Field, Model, Row, Schema, Value } from './ir.ts'
import { fkOrder, scalarFields } from './ir.ts'
import { Rng, SEED } from './rng.ts'
import { defaultGen, fmtTs, parseDay, phone } from './gens.ts'
import { WORDS } from './names.ts'

const relFor = (m: Model, fk: string) => m.fields.find((f) => f.relation && f.relation.fields[0] === fk)

function uniqueKeys(m: Model): string[][] {
  const keys: string[][] = []
  for (const f of scalarFields(m)) if (f.unique && !f.id) keys.push([f.name])
  for (const u of m.uniques) keys.push(u)
  if (m.compoundId) keys.push(m.compoundId)
  return keys
}

function genModel(s: Schema, m: Model, data: Data): Row[] {
  const rng = Rng.from(SEED, `model:${m.name}`)
  const enums = new Map(s.enums.map((e) => [e.name, e.values]))
  const keys = uniqueKeys(m)
  const seen = keys.map(() => new Set<string>())
  const usedUniqueFk = new Map<string, Set<number>>()
  const rows: Row[] = []
  for (let i = 0; i < m.rows; i++) {
    const id = rows.length + 1
    let accepted: Row | null = null
    for (let attempt = 0; attempt < 200 && !accepted; attempt++) {
      const row: Row = {}
      for (const f of scalarFields(m)) row[f.name] = genValue(f, m, { rng, i, id, row, data, enums, usedUniqueFk, rows })
      const sig = keys.map((k) => JSON.stringify(k.map((c) => row[c])))
      if (sig.every((x, j) => !seen[j].has(x))) {
        sig.forEach((x, j) => seen[j].add(x))
        for (const [fk, set] of usedUniqueFk) if (row[fk] !== null) set.add(row[fk] as number)
        accepted = row
      }
    }
    if (accepted) rows.push(accepted)
  }
  return rows
}

interface Ctx {
  rng: Rng
  i: number
  id: number
  row: Row
  data: Data
  enums: Map<string, string[]>
  usedUniqueFk: Map<string, Set<number>>
  rows: Row[]
}

function genValue(f: Field, m: Model, c: Ctx): Value {
  if (f.id && f.default === 'autoincrement()') return c.id
  const rel = relFor(m, f.name)
  if (f.optional && c.rng.chance(f.nullRate ?? (rel ? 0.15 : 0.2))) return null
  if (rel) {
    const self = rel.type === m.name
    let ids = (self ? c.rows : c.data[rel.type]).map((r) => r.id as number)
    if (self) ids = ids.filter((x) => x < c.id)
    if (f.unique) {
      if (!c.usedUniqueFk.has(f.name)) c.usedUniqueFk.set(f.name, new Set())
      const used = c.usedUniqueFk.get(f.name)!
      ids = ids.filter((x) => !used.has(x))
    }
    if (!ids.length) {
      if (f.optional) return null
      throw new Error(`no target rows for ${m.name}.${f.name}`)
    }
    return c.rng.pick(ids)
  }
  if (c.enums.has(f.type)) return c.rng.pick(c.enums.get(f.type)!)
  const gen = f.gen ?? defaultGen(f.name, f.type, f.native)
  return gen({ rng: c.rng, i: c.i, id: c.id, row: c.row, data: c.data, model: m })
}

// ---------------------------------------------------------------------------

const cents = (s: Value) => Math.round(Number(s) * 100)
const money = (c: number) => (c / 100).toFixed(2)
const byId = (rows: Row[]) => new Map(rows.map((r) => [r.id as number, r]))

type Post = (data: Data, rng: Rng, s: Schema) => void

const POSTS: [string, Post][] = [
  ['ContactPhone', (d, rng) => {
    const out: Row[] = []
    for (const ct of d.Contact) {
      const n = rng.pick([0, 0, 1, 1, 2, 3])
      for (let k = 1; k <= n && out.length < 50; k++) {
        out.push({ id: out.length + 1, contactId: ct.id, slot: k, phoneNumber: phone({ rng, i: 0, id: 0, row: {}, data: d, model: null as never }) as string })
      }
    }
    d.ContactPhone = out
  }],
  ['ProductImage', (d, rng) => {
    const out: Row[] = []
    for (const p of d.Product) {
      const n = rng.pick([0, 1, 1, 2])
      for (let k = 1; k <= n && out.length < 50; k++) out.push({ id: out.length + 1, productId: p.id, sortOrder: k, imageUrl: `https://img.example.test/${String(p.productNumber).toLowerCase()}-${k}.jpg` })
    }
    d.ProductImage = out
  }],
  ['TicketLabelAssignment', (d, rng) => {
    const out: Row[] = []
    const labels = d.TicketLabel.map((r) => r.id as number)
    for (const t of d.Ticket) for (const l of rng.sample(labels, rng.pick([0, 1, 1, 2, 2])).sort((a, b) => a - b)) if (out.length < 50) out.push({ ticketId: t.id, labelId: l })
    d.TicketLabelAssignment = out
  }],
  ['CampaignSegment', (d, rng) => {
    const out: Row[] = []
    const segs = d.Segment.map((r) => r.id as number)
    for (const c of d.Campaign) for (const sg of rng.sample(segs, rng.pick([1, 1, 2, 3])).sort((a, b) => a - b)) out.push({ campaignId: c.id, segmentId: sg })
    d.CampaignSegment = out
  }],
  ['Milestone', (d, rng) => {
    const out: Row[] = []
    for (const p of d.Project) {
      const n = rng.pick([0, 1, 2, 3, 4])
      const start = parseDay(p.startsOn as string)
      for (let k = 1; k <= n; k++) {
        const due = start + k * 21 * 86400000
        const done = rng.chance(0.5)
        out.push({
          id: out.length + 1,
          projectId: p.id,
          title: `${['Kick-off', 'Design sign-off', 'Pilot', 'Go-live'][k - 1]}`,
          dueOn: fmtTs(due).slice(0, 10),
          completedAt: done ? fmtTs(due - rng.int(0, 5) * 86400000 + 15 * 3600000) : null,
        })
      }
    }
    d.Milestone = out
  }],
  ['Employee.profileGaps', (d, rng) => {
    // Some employees never filled in their personal details at all.
    for (const e of d.Employee) if (rng.chance(0.2)) e.dateOfBirth = e.emergencyContactName = e.emergencyContactPhone = null
  }],
  ['Product.dimensionGaps', (d, rng) => {
    for (const p of d.Product) if (rng.chance(0.2)) p.weightGrams = p.lengthMm = p.widthMm = p.heightMm = null
  }],
  ['TaskDependency', (d) => {
    d.TaskDependency = d.TaskDependency.filter((r) => r.taskId !== r.dependsOnTaskId)
  }],
  ['OrderItem.unitPrice', (d, rng) => {
    const variants = byId(d.ProductVariant)
    for (const oi of d.OrderItem) {
      const cur = cents(variants.get(oi.productVariantId as number)!.price)
      // Prices change over time: some orders were placed at an older price.
      oi.unitPrice = money(rng.chance(0.18) ? Math.round(cur * rng.pick([0.8, 0.85, 0.9, 1.1])) : cur)
    }
  }],
  ['Shipment.shipTo', (d, rng) => {
    const orders = byId(d.SalesOrder)
    const customers = byId(d.Customer)
    const addrByCustomer = new Map<number, Row[]>()
    for (const a of d.CustomerAddress) {
      const l = addrByCustomer.get(a.customerId as number) ?? []
      l.push(a)
      addrByCustomer.set(a.customerId as number, l)
    }
    const addrs = byId(d.CustomerAddress)
    for (const sh of d.Shipment) {
      const order = orders.get(sh.salesOrderId as number)!
      const own = addrByCustomer.get(order.customerId as number)
      if (own?.length) sh.customerAddressId = rng.pick(own).id
      const a = addrs.get(sh.customerAddressId as number)!
      const cust = customers.get(order.customerId as number)!
      const moved = rng.chance(0.15)
      sh.shipToName = rng.chance(0.1) ? `${cust.companyName} (Goods-in)` : cust.companyName
      sh.shipToStreet = moved ? `${rng.int(1, 240)} Old ${rng.pick(['Mill', 'Station', 'Market'])} Road` : a.street
      sh.shipToPostalCode = moved ? String(rng.int(10000, 99999)) : a.postalCode
      sh.shipToCity = moved ? rng.pick(['Old Harbour', 'Millbrook', 'Eastwick', 'Stonebridge']) : a.city
    }
  }],
  ['Invoice.billing', (d, rng) => {
    const accounts = byId(d.BillingAccount)
    const customers = byId(d.Customer)
    const rates = byId(d.TaxRate)
    const firstAddr = new Map<number, Row>()
    for (const a of d.CustomerAddress) if (!firstAddr.has(a.customerId as number)) firstAddr.set(a.customerId as number, a)
    for (const inv of d.Invoice) {
      const cust = customers.get(accounts.get(inv.billingAccountId as number)!.customerId as number)!
      const a = firstAddr.get(cust.id as number)
      // Customers rename and move; issued invoices keep what was printed.
      inv.billingName = rng.chance(0.15) ? `${String(cust.companyName).split(' ')[0]} Holdings` : cust.companyName
      inv.billingStreet = a && !rng.chance(0.12) ? a.street : `${rng.int(1, 240)} Former ${rng.pick(['Dock', 'Hill', 'Bridge'])} Street`
      inv.billingPostalCode = a ? a.postalCode : String(rng.int(10000, 99999))
      inv.billingCity = a ? a.city : 'Ardenmouth'
      let net = 0
      let tax = 0
      for (const l of d.InvoiceLine.filter((x) => x.invoiceId === inv.id)) {
        const ln = cents(l.unitPrice) * (l.quantity as number)
        net += ln
        tax += Math.round((ln * Number(rates.get(l.taxRateId as number)!.ratePercent)) / 100)
      }
      // Some invoices carry a manual rounding adjustment made at issue time.
      if (rng.chance(0.1)) tax += rng.pick([-1, 1])
      inv.totalNet = money(net)
      inv.totalTax = money(tax)
      inv.totalGross = money(net + tax)
    }
  }],
  ['AuditEvent.payload', (d, rng) => {
    for (const ev of d.AuditEvent) {
      const n = rng.int(1, 3)
      ev.payload = Array.from({ length: n }, (_, k) => ({
        entityId: rng.int(1, 50),
        entityName: `${rng.pick(WORDS)}-${rng.int(100, 999)}`,
        changedAt: ev.occurredAt,
        sequence: k + 1,
      }))
    }
  }],
  ['AppSetting.configData', (d, rng) => {
    for (const st of d.AppSetting) {
      st.configData = {
        enabled: rng.chance(0.8),
        threshold: rng.int(1, 100),
        mode: rng.pick(['strict', 'lenient', 'auto']),
        recipients: [`ops-${st.id}@example.test`],
      }
    }
  }],
  ['Carrier.conflictingDuplicate', (d) => {
    // A3: the same carrier code used twice with different data. Nothing references the newer row.
    const src = d.Carrier[1]
    d.Carrier.push({ id: d.Carrier.length + 1, carrierCode: src.carrierCode, title: `${src.title} Freight`, trackingUrlTemplate: `https://track-alt.example.test/{code}` })
  }],
]

export function generateData(s: Schema): Data {
  const data: Data = {}
  for (const m of fkOrder(s)) data[m.name] = genModel(s, m, data)
  for (const [label, post] of POSTS) post(data, Rng.from(SEED, `post:${label}`), s)
  // sanity: every non-null FK points to an existing row
  for (const m of s.models) {
    for (const rf of m.fields.filter((f) => f.relation)) {
      const ids = new Set(data[rf.type].map((r) => r.id))
      for (const r of data[m.name]) {
        const v = r[rf.relation!.fields[0]]
        if (v !== null && v !== undefined && !ids.has(v)) throw new Error(`dangling ${m.name}.${rf.relation!.fields[0]}=${v}`)
      }
    }
    if (data[m.name].length > 50 || data[m.name].length < 5) throw new Error(`${m.name} has ${data[m.name].length} rows`)
  }
  return data
}
