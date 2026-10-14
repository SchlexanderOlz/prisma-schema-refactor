# Writing the migration

1. **Structural diff.** Generate it with `prisma migrate diff` from the source migrations to
   `<out>/schema.prisma` as SQL. Check `npx prisma migrate diff --help` for the installed
   version's flags. Treat the result as a draft.
2. **Never accept DROP+ADD** for anything the mapping marks rename, move, merge, transform or
   explode. Prisma does not detect renames.
3. **Order:**
   1. create new types, tables and columns (nullable first)
   2. insert into QuarantinedRow
   3. copy/transform data and fill MigrationIdMap
   4. re-point FKs via MigrationIdMap
   5. dedupe
   6. set NOT NULL, add FKs, uniques and indexes
   7. drop old columns, tables and types last
4. **Annotate.** Every data block and every DROP gets a preceding comment:
   `-- mapping: <SourceModel>.<field> -> <Target>` or `-- mapping: <SourceModel> (merge)`.
   A DROP without an annotation that points to a mapping entry is a bug.
5. **Enum casts** use `USING CASE …` with the `values` map. Unmapped values go to quarantine
   (reason `unparseable`) first.
6. **Constraints** are added validated: no `NOT VALID`, no disabled triggers.
7. **Atomic.** The migration is all-or-nothing. Check whether Prisma already runs PostgreSQL
   migrations in a transaction before adding BEGIN/COMMIT.
8. **Reconciliation** (run after applying). For every target model T:

   `Σ rows of source models mapped into T  =  rows(T)  +  QuarantinedRow rows from those sources`

   Explode children are checked separately: tokens = child rows + dangling tokens.
