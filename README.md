# Demo: before and after one skill run

Static GitHub Pages site. It loads two PostgreSQL databases in the browser with
[PGlite](https://pglite.dev) (Postgres compiled to WASM). The first gets the messy fixture's
migration and seed; the second gets the same plus the skill's refactor migration. The page shows
every model's schema and data before and after, together with the reason from the skill's
`mapping.yaml` and `decisions.yaml`.

`data.json` is produced by `_build/build.ts` from `fixtures/messy` and one run directory
(`results/run-<n>` of `./tests/run-tests.sh --with-claude`). All data is generated and fictional.
