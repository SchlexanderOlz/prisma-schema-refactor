# Output contract (all paths relative to --out)

## schema.prisma
The source schema with only rule-backed changes, plus these two models (add them verbatim):

```prisma
model QuarantinedRow {
  id          Int      @id @default(autoincrement())
  sourceModel String
  sourceId    String
  reason      String   // orphan_fk | duplicate_loser | dangling_token | unparseable
  payload     Json
  createdAt   DateTime @default(now())
  @@index([sourceModel])
  @@map("quarantined_row")
}

model MigrationIdMap {
  id          Int    @id @default(autoincrement())
  sourceModel String
  sourceId    String
  targetModel String
  targetId    String
  @@unique([sourceModel, sourceId])
  @@map("migration_id_map")
}
```
Every row whose primary key changes (merges, dedupe winners/losers) gets a MigrationIdMap row.
`sourceModel` (in both models) is always the source model's name, never `<Model>.<field>`; put
field context, such as the token that could not be resolved, into `payload`. In MigrationIdMap
`targetModel` is the output model's name.

## mapping.yaml
```yaml
version: 1
models:                     # every source model exactly once
  - source: <Model>
    action: keep            # keep | rename | merge | drop
    target: <Model>         # for keep | rename | merge
    rules: []               # rule IDs; empty for keep
    reason: null
    dedupe: null            # or { key: [<field>], winner: oldest_created_at | newest_updated_at | most_complete }
    fields:                 # every source scalar field exactly once (exclude relation/back-relation fields)
      - source: <field>
        action: copy        # copy | transform | move | explode | derive_away | drop
        target: <Model>.<field>     # null for derive_away | drop
        transform: null     # for transform: lowercase_trim | cast_decimal | cast_datetime | cast_boolean | map_enum
        values: null        # for map_enum: { "<raw>": <ENUM_VALUE> }
        derivable_from: null # for derive_away: "<Model>.<field> via <relation>"
        decision: null      # AMB-/SNAP- id if one applies
        rules: []
        reason: null
new_models:                 # models with no source (child/join models, support models)
  - name: <Model>
    rules: [R2]
    filled_from: [<SourceModel>.<field>]
```
Semantics:
- `copy` keeps values identical.
- `move` keeps values identical in another model.
- `transform` changes the representation.
- `explode` turns one value into child rows. Any field whose values become rows of a new child
  or join model is `explode`: delimited lists, Json arrays, and each field of a repeating group.
- `move` is for values that land 1:1 on rows of an existing or merged model.
- `drop` is allowed only with a `decision` reference.
- In `decisions.yaml`, `quarantine[].source` is a source model name, matching
  `QuarantinedRow.sourceModel`.

## decisions.yaml
```yaml
version: 1
ambiguities:
  - id: AMB-1
    refs: [<Model> | <Model>.<field>]
    rule: R5
    question: "<what you would need to know>"
    options: ["<safe default>", "<alternative>"]
    chosen: safe_default
snapshots:
  - id: SNAP-1
    refs: [<Model>.<field>]
    reason: "<state captured at what moment>"
quarantine:
  - source: <Model>
    reason: orphan_fk
    rows: <n>
assumptions: ["<anything you assumed>"]
```
