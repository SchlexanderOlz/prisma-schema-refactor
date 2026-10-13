// Shared state for the mess catalog: clean/messy/gold schemas and data, gold mapping
// overrides, decisions, migration fragments and expected cases.

import type { Data, Field, Model, Schema } from './ir.ts'
import { clone, getModel, scalarFields } from './ir.ts'

export const PHASES = ['create', 'quarantine', 'data', 'repoint', 'dedupe', 'constraints', 'drop'] as const
export type Phase = (typeof PHASES)[number]

export interface FieldMap {
  source: string
  action: 'copy' | 'transform' | 'move' | 'explode' | 'derive_away' | 'drop'
  target: string | null
  transform: string | null
  values: Record<string, string> | null
  derivable_from: string | null
  decision: string | null
  rules: string[]
  reason: string | null
}

export interface ModelMap {
  source: string
  action: 'keep' | 'rename' | 'merge' | 'drop'
  target: string | null
  rules: string[]
  reason: string | null
  dedupe: { key: string[]; winner: string } | null
  fields: FieldMap[]
}

export interface Check {
  type: string
  metric?: 'S5'
  negate?: boolean
  [k: string]: unknown
}

export interface Case {
  id: string
  kind: 'mess' | 'trap' | 'ambiguity'
  rule: string
  description: string
  metrics: string[]
  models: string[]
  checks: Check[]
  anyOf: Check[][] | null
}

export interface Ambiguity {
  id: string
  refs: string[]
  rule: string
  question: string
  options: string[]
  chosen: string
}
export interface Snapshot {
  id: string
  refs: string[]
  reason: string
}

export class Ctx {
  messy: Schema
  messyData: Data
  gold: Schema
  modelPatch = new Map<string, Partial<ModelMap>>()
  fieldPatch = new Map<string, Partial<FieldMap>>()
  newModels: { name: string; rules: string[]; filled_from: string[] }[] = []
  ambiguities: Ambiguity[] = []
  snapshots: Snapshot[] = []
  quarantine: { source: string; reason: string; rows: number }[] = []
  assumptions: string[] = []
  sql: Record<Phase, string[]> = { create: [], quarantine: [], data: [], repoint: [], dedupe: [], constraints: [], drop: [] }
  cases: Case[] = []

  readonly clean: Schema
  readonly cleanData: Data

  constructor(clean: Schema, cleanData: Data) {
    this.clean = clean
    this.cleanData = cleanData
    this.messy = clone(clean)
    this.messyData = clone(cleanData)
    this.gold = clone(clean)
  }

  mm(name: string): Model {
    return getModel(this.messy, name)
  }
  gm(name: string): Model {
    return getModel(this.gold, name)
  }
  cm(name: string): Model {
    return getModel(this.clean, name)
  }

  mapModel(source: string, patch: Partial<ModelMap>): void {
    this.modelPatch.set(source, { ...(this.modelPatch.get(source) ?? {}), ...patch })
  }
  mapField(model: string, field: string, patch: Partial<FieldMap>): void {
    const k = `${model}.${field}`
    this.fieldPatch.set(k, { ...(this.fieldPatch.get(k) ?? {}), ...patch })
  }
  add(phase: Phase, ...stmts: string[]): void {
    this.sql[phase].push(...stmts)
  }
  addCase(c: Case): void {
    this.cases.push(c)
  }

  /** Build the complete gold mapping: identity for everything not patched. */
  buildMapping(): ModelMap[] {
    const out: ModelMap[] = []
    for (const m of this.messy.models) {
      const mp = this.modelPatch.get(m.name) ?? {}
      const action = mp.action ?? 'keep'
      const target = mp.target === undefined ? m.name : mp.target
      const fields: FieldMap[] = scalarFields(m).map((f: Field) => {
        const fp = this.fieldPatch.get(`${m.name}.${f.name}`) ?? {}
        return {
          source: f.name,
          action: fp.action ?? (action === 'merge' ? 'move' : 'copy'),
          target: fp.target === undefined ? `${target}.${f.name}` : fp.target,
          transform: fp.transform ?? null,
          values: fp.values ?? null,
          derivable_from: fp.derivable_from ?? null,
          decision: fp.decision ?? null,
          rules: fp.rules ?? [],
          reason: fp.reason ?? null,
        }
      })
      out.push({
        source: m.name,
        action,
        target,
        rules: mp.rules ?? [],
        reason: mp.reason ?? null,
        dedupe: mp.dedupe ?? null,
        fields,
      })
    }
    for (const k of this.fieldPatch.keys()) {
      const [mn, fn] = k.split('.')
      if (!this.messy.models.find((m) => m.name === mn)?.fields.find((f) => f.name === fn && !f.relation)) {
        throw new Error(`field patch for unknown messy field ${k}`)
      }
    }
    return out
  }
}
