// zod schemas for the output contract (mapping.yaml, decisions.yaml).

import { z } from 'zod'

const ref = z.string().min(1)

export const FieldMapZ = z.object({
  source: z.string().min(1),
  action: z.enum(['copy', 'transform', 'move', 'explode', 'derive_away', 'drop']),
  target: z.string().nullable(),
  transform: z.enum(['lowercase_trim', 'cast_decimal', 'cast_datetime', 'cast_boolean', 'map_enum']).nullable().optional(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable().optional(),
  derivable_from: z.string().nullable().optional(),
  decision: z.string().nullable().optional(),
  rules: z.array(z.string()).nullable().optional(),
  reason: z.string().nullable().optional(),
})

export const ModelMapZ = z.object({
  source: z.string().min(1),
  action: z.enum(['keep', 'rename', 'merge', 'drop']),
  target: z.string().nullable(),
  rules: z.array(z.string()).nullable().optional(),
  reason: z.string().nullable().optional(),
  dedupe: z
    .object({ key: z.array(z.string()).min(1), winner: z.enum(['oldest_created_at', 'newest_updated_at', 'most_complete']) })
    .nullable()
    .optional(),
  fields: z.array(FieldMapZ),
})

export const MappingZ = z.object({
  version: z.literal(1),
  models: z.array(ModelMapZ),
  new_models: z
    .array(z.object({ name: z.string().min(1), rules: z.array(z.string()).nullable().optional(), filled_from: z.array(z.string()).nullable().optional() }))
    .nullable()
    .optional(),
})

export const DecisionsZ = z.object({
  version: z.literal(1),
  ambiguities: z
    .array(
      z.object({
        id: z.string().min(1),
        refs: z.array(ref).min(1),
        rule: z.string().nullable().optional(),
        question: z.string().min(1),
        options: z.array(z.string()).nullable().optional(),
        chosen: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  snapshots: z.array(z.object({ id: z.string().min(1), refs: z.array(ref).min(1), reason: z.string().nullable().optional() })).nullable().optional(),
  quarantine: z.array(z.object({ source: z.string(), reason: z.string(), rows: z.number().int() })).nullable().optional(),
  assumptions: z.array(z.string()).nullable().optional(),
})

export type FieldMap = z.infer<typeof FieldMapZ>
export type ModelMap = z.infer<typeof ModelMapZ>
export type Mapping = z.infer<typeof MappingZ>
export type Decisions = z.infer<typeof DecisionsZ>
