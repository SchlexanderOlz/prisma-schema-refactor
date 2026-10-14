# Target rules (3NF, exceptions only when documented)

Each rule: what violates it → evidence to require → fix. Never apply a fix without the evidence.

Percentages need volume. A rate threshold (R2, R4, R8, R10, R17) is evidence only when it is
measured on at least 10 non-null rows; on fewer rows agreement is coincidence. Below that, keep
the element, and log an ambiguity only if the schema shape alone is strongly suspicious.

**R1 Primary key.** Every model has a single-column surrogate PK. Keep the existing PK type
(never switch Int↔UUID). A non-join model with a composite natural PK → add a surrogate `id`
and keep the old key as `@@unique`, but only when other models reference its rows or need to.
A table nobody references (counters, sequences, per-period balances) keeps its composite key.
A model without any primary key gets one.

**New columns on existing tables.** A required column added to a table that already has rows
or other writers needs a database-level default: `autoincrement()`, `now()`, a literal, or
`dbgenerated("gen_random_uuid()::text")`. `cuid()`, `uuid()` and `nanoid()` exist only in Prisma
Client; raw SQL, triggers and other services that insert rows never get them.

**R2 Atomic values (1NF).** Delimited lists or arrays of references in scalar columns.
Evidence: ≥20% of non-null values contain `,` `;` or `|`, and the tokens look like ids or codes.
Fix: a child or join model. Tokens referencing nothing → QuarantinedRow (reason `dangling_token`).

**R3 No repeating groups.** Field families such as `x1, x2, x3` or `xPrimary, xSecondary` of the
same type. Fix: a child model with a `position` or `kind` column.

**R4 No transitive dependencies.** An attribute describing another entity that is already
referenced by FK. Evidence: it equals that entity's value in ≥95% of rows.
Example shape: `<entity>Email` next to `<entity>Id`.
Fix: remove it (`derive_away`). If R16 applies, it is a snapshot instead.

**R5 One concept, one model.** Merge two models only when ALL hold:
- ≥70% overlapping fields (name and type)
- overlapping identity: shared natural-key values
- no hint that they mean different things

Fix: merge into the more-referenced model, dedupe on the natural key, record IDs in
`MigrationIdMap`. The losing duplicate of each pair is also a QuarantinedRow (reason
`duplicate_loser`), exactly as in R13. Overlap with unclear meaning → ambiguity, no merge.
A pair with ≥70% field overlap that fails the identity test (no shared natural-key values) is
still an open question, not a clean result: two models that look the same may be one concept
split by population, or two concepts. Keep both and log an ambiguity naming both models.

**R6 Unneeded 1:1 split.** A model with a required unique FK to a parent and no other relations →
merge into the parent. Keep the split when it holds large blobs/JSON or credentials/secrets.
The exceptions are exhaustive. "Credentials/secrets" means authentication material (password
hashes, tokens, keys, MFA secrets). Ordinary attributes of the parent, including personal
data, are not secrets: merge them.

**R7 Declared relations.** An id-like scalar (`<model>Id` whose values are mostly ids of that model)
must be a `@relation` with explicit `onDelete`: `Restrict` by default, `Cascade` only for
owned children. Orphan rows → QuarantinedRow (reason `orphan_fk`).

**R8 No redundant relation paths.** An FK duplicating a path reachable through another FK, agreeing
in ≥95% of rows → remove (`derive_away`). Disagreeing rows → ambiguity, keep.
Keep it anyway, and record why in `assumptions`, when it is a scoping (tenant/owner) key, i.e.
the same FK to the same model on a large share of models (profile `scopingColumns`): such keys
are deliberate access paths for filtering and isolation, not redundancy.

**R9 Join models.** A join model where each A has at most one B is a 1:n in disguise → put the FK on
the child. m:n with payload → an explicit model.

**R10 Closed value sets → enum.** A String field with ≤20 distinct values that look like states or
categories (case/whitespace variants count as one). Map the variants in `mapping.yaml`.
Free text or user-defined values stay String.

**R11 Precise types.**
- money/amounts → `Decimal` with explicit precision (never Float)
- dates and timestamps → `DateTime`
- flags → `Boolean`
- counts → `Int`

Cast only if every non-null value parses unambiguously. Otherwise log an ambiguity and keep the
type.

**R12 Required when always present.** An optional field with 0% nulls whose meaning implies presence
(names, foreign keys of owned children, timestamps, amounts) → required.
Never make a field required if any row is null.
When the field is one of these kinds and has 0% nulls, apply the fix (see "Ambiguity" below).
Fields of other kinds (free-text notes, optional descriptions, contact data) stay optional.

**R13 Natural uniqueness.** Candidate keys (email, sku, code, number, slug, external ids) with 0
duplicates → `@unique`. A candidate key identifies the record itself: the login email of an
account, the sku of a product, the number of a document, an external system's id. Values that
merely describe the record (contact, billing or notification addresses, telephone numbers, labels)
are not keys even when they happen to be unique today; leave them alone. Duplicates that are exact copies (all non-PK fields equal) → keep the
oldest, quarantine the rest (reason `duplicate_loser`), map the IDs. Duplicates with
conflicting data → ambiguity, no unique.

**R14 FK indexes.** Every FK scalar has an index, or is the leading column of a PK/unique.

**R15 Naming.** Models PascalCase singular, fields camelCase. Fix at the Prisma level with
`@map`/`@@map` to the existing physical names. Never rename physically.

**R16 Snapshots (keep).** Values copied onto historical records (orders, order lines, invoices,
shipments, contracts, payments, audit/event logs) that capture state at a moment in time.
Signals:
- the record is a dated document or event, and/or
- some rows differ from the current source value.

Keep the field, add a doc comment `/// @snapshot: <reason>`, and log it in `decisions.yaml`.
This covers every value of that kind on such a record: copied names, addresses and prices, and
also totals or other aggregates stored on it. When you identify a record as a dated document,
go through all of its fields and document each copied or aggregated one.
R16 is about copied attribute values. A foreign key that duplicates another relation path is
governed by R8 (agreement decides), whatever kind of record it sits on.

**R17 Derived values.** Values fully computable from other data on mutable records (cached counts,
cached totals) → remove (`derive_away` with `derivable_from`). On historical documents → R16.

**R18 JSON.** A Json column whose values consistently are arrays of objects with entity-like keys
(ids, names, dates) → child model. Opaque payloads stay Json: event payloads, external API
responses, settings blobs.

**R19 Possibly unused.** A model with no relations and no evidence of use → never drop; log an
ambiguity. Look for evidence first: search the project's source for the model (e.g.
`prisma.<modelName>`, its name in queries, framework adapters such as auth libraries). A model
the code uses is clean, with no ambiguity.

**Database objects outside the schema.** Row-level security policies, triggers, views and
functions are invisible in `schema.prisma` (profile `databaseObjects`). Never remove, rename,
retype or move a column such an object references, and never drop or merge away its table;
rules that would do so do not apply to it. Keep it and note the dependency in `assumptions`.
Also check that every statement of the migration leaves those objects valid.

## Ambiguity
Log an ambiguity and use the safe default whenever:
- a merge candidate's meaning is unclear (R5)
- an FK path disagrees (R8)
- a cast would need assumptions such as units, formats or locale (R11)
- duplicates conflict (R13)
- a model is possibly unused (R19)
- any fix would need business knowledge you don't have

Safe default: keep the source structure for that element unchanged.

An ambiguity needs a concrete conflict you can point to in the schema or the data: rows that
disagree, duplicates that conflict, values that don't parse, models whose meaning is unclear.
A hypothetical future (a value that might one day be null, a versioning scheme that might be
intended) is not evidence. When a rule's evidence holds, apply its fix; you may add the
consideration to `assumptions`.
