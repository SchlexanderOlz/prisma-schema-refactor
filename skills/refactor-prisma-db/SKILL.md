---
name: refactor-prisma-db
description: Designs a normalized target for an existing Prisma + PostgreSQL schema and produces schema.prisma, mapping.yaml, decisions.yaml and a data-preserving migration. Use when asked to clean up, normalize, consolidate or refactor a Prisma database schema. Never applies anything to a real database.
---

# Refactor a Prisma schema

## Inputs
Invoked as `/refactor-prisma-db [--project <dir>] [--out <dir>]`.
- `--project`: directory with `schema.prisma` and `migrations/`. Default: the single `prisma/`
  directory in the working tree; if there are several, ask.
- `--out`: output directory. Default: `./refactor-out`.
- No database is needed. Never ask for one, never set one up, never connect to one yourself.
  The output is a reviewed design; applying it to a database is the user's own step.
  - `SCRATCH_DATABASE_URL` (env), only if it is already set: `profile.mjs` then adds read-only
    data statistics from it. The script decides whether it is safe to use (local host, not
    `DATABASE_URL`) and falls back to schema-only otherwise. Do not mention a missing
    `SCRATCH_DATABASE_URL` as a problem.

## Hard rules
1. Write only inside `--out`. Never edit the project, its schema, its migrations or anything else.
2. Default is KEEP. A model or field changes only if it violates a rule in `reference/rules.md`
   and you can name the rule ID and the evidence (schema or profile). Never change a correct
   model for style, taste, or consistency with your other changes.
3. Every source model and every source scalar field appears exactly once in `mapping.yaml`.
   Nothing disappears without a mapping entry and a reason.
4. Never remove a snapshot (rule R16). If you are unsure whether duplication is a snapshot,
   treat it as one and log it.
5. If the right answer depends on business meaning that schema and data cannot establish,
   do not decide. Keep the safe default (see "Ambiguity" in rules.md) and log an ambiguity.
   A logged question is a correct outcome; a confident guess is not.
6. Rows that cannot be migrated (orphans, losing duplicates, unparseable values) go to
   `QuarantinedRow` with a reason. Never drop them silently, never invent values.
7. Never drop a model or field because nothing seems to use it. Log it as an ambiguity.

## Procedure
1. **Setup.** Read all three files in `reference/`. Install script deps once:
   `npm --prefix <skill-dir>/scripts ci --silent`.
2. **Profile.** Run
   `node <skill-dir>/scripts/profile.mjs --schema <project>/schema.prisma --out <out>/.work/profile.json`
   and read the result. Its `mode` says whether data evidence exists. In `schema-only` mode, a
   rule whose evidence is a data measurement (rates, orphans, duplicates, parse results) cannot
   fire: keep the element, and log an ambiguity only if the schema shape alone is strongly
   suspicious. `databaseObjects` then comes from the raw SQL in the migrations.
3. **Findings.** Write one line per model to `<out>/.work/findings.md`:
   `Model — clean` or `Model — R<n>: <evidence>`. In real schemas most models are clean;
   expect that, and treat a long findings list as a sign you are over-reaching.
4. **Design.** For each finding apply the fix from rules.md.
   - Check ripple effects: relations to merged or renamed models.
   - Write `<out>/schema.prisma`: start from a copy of the source schema and change only what
     findings require.
   - Add the two support models from output-contract.md.
5. **Contract files.** Write `<out>/mapping.yaml` and `<out>/decisions.yaml` exactly as
   output-contract.md specifies.
6. **Migration.** Follow migration-playbook.md and produce
   `<out>/migrations/<UTC timestamp>_refactor/migration.sql`.
6b. **Code impact.** Search the project's source (outside `--project`) for code the change
   would break: raw SQL (`$queryRaw`, `$executeRaw`, SQL strings) that names a changed table or
   column, Prisma Client calls on removed, moved or retyped fields, and compound-unique
   selectors. Change the design when a change would break raw SQL at runtime. Otherwise list
   every required code change in the final report and in `assumptions`.
7. **Review.** No database. Loop until clean, max 3 iterations, then report what is left.
   - `node <skill-dir>/scripts/check-output.mjs --project <project> --out <out>`
   - `npx prisma validate` on `<out>/schema.prisma`
   - Re-read `migration.sql` against `mapping.yaml` and migration-playbook.md: every mapping
     entry has its SQL, every DROP has its `-- mapping:` annotation.
8. **Summary.** Point to `<out>/schema.prisma` as the result. Print counts: models
   clean/changed/merged/new, fields moved, rows quarantined (or "unknown, schema-only"),
   ambiguities, snapshots. State that the migration was not applied anywhere and should be
   tested on a copy of the database before production. Then list every ambiguity as a
   question for the user.
