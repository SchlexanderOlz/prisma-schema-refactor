# prisma-schema-refactor

A Claude skill, **`refactor-prisma-db`**, that designs a normalized target for an existing
Prisma + PostgreSQL schema, plus a deterministic harness that measures how well it does.

The skill reads a project's `schema.prisma`, its migrations and a disposable copy of the
database, and writes a proposal into an output directory:

- `schema.prisma`: the source schema with only rule-backed changes
- `mapping.yaml`: where every source model and field went, and why
- `decisions.yaml`: open questions (ambiguities), snapshots it kept on purpose, quarantined rows
- `migrations/<ts>_refactor/migration.sql`: a data-preserving migration

It never touches a real database and never edits the project.

## What's in here

| Path | What |
|---|---|
| `skills/refactor-prisma-db/` | The skill: `SKILL.md`, rules, output contract, migration playbook, profiling and contract-check scripts |
| `fixtures/generator/` | Deterministic generator (fixed seed) for every fixture below |
| `fixtures/clean/` | A fictional company platform: 122 models in 14 domains, correct by design |
| `fixtures/messy/` | The clean DB with 32 planted mess transforms (29 models touched). **This is the skill's input.** |
| `fixtures/gold/` | The perfect skill output for the messy DB, under the same contract |
| `fixtures/expected.json` | 40 planted cases (mess, traps, ambiguities), their checks and metric coverage |
| `tests/` | Scoring (`score.ts`), aggregation and verdict (`aggregate.ts`), self-test, the one command |
| `.github/workflows/` | PR check (`claude-check.yml`), baseline (`baseline.yml`), fork notice (`fork-notice.yml`) |

Nothing here is real data. Names, companies and addresses are invented.

## Requirements

- Node 24 LTS or newer (the harness runs TypeScript with Node's built-in type stripping, so there's no build step)
- Docker, for the local PostgreSQL (`postgres:17.10-alpine` on host port 54329), or set
  `PGURL_ADMIN` to an admin URL of your own disposable server
- `psql` is optional for the harness, but the skill may use it
- Claude Code CLI only for `--with-claude` runs

Pinned versions: Prisma 7.10.0, Node 24.21.0 in CI, Claude Code 2.1.296 in CI, postgres 17.10.

## Run the tests locally

```bash
npm ci
docker compose up -d --wait        # optional: run-tests.sh starts it when needed

./tests/run-tests.sh --gold        # score fixtures/gold as if it were skill output (must be 100%)
npm run selftest                   # fixtures up to date, gold 100%, 14 mutants, coverage, anti-leak
./tests/run-tests.sh --out <dir>   # score any output dir
./tests/run-tests.sh --with-claude --runs 1   # run the skill headless and score it (uses your Claude usage)
```

Add `--json` to any mode for machine-readable output. Exit codes: `0` MERGE-READY,
`1` NOT READY, `2` harness error. Reports land in `results/` (`report.json`, `report.md`,
`verdict.txt`, and `run-<n>/metrics.json` per run).

`--with-claude` creates a fresh temp project per run (`prisma/schema.prisma`,
`prisma/migrations`, `prisma.config.ts`) and a fresh `scratch_<run>` database cloned from the
`fixture_messy` template. It then runs:

```bash
claude -p "/refactor-prisma-db --project prisma --out refactor-out" \
  --output-format json --max-turns 300 --permission-mode dontAsk \
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash(npx prisma *),Bash(node *),Bash(npm --prefix *),Bash(psql *)" \
  --add-dir <skill-dir> --no-session-persistence --append-system-prompt "<sandbox note>"
```

The sandbox note (`SANDBOX_NOTE` in `tests/run.ts`) tells the headless run which shell commands
are allowed and that nobody can answer questions. It contains nothing about the fixtures.

The run gets a 40-minute timeout. Its environment has `SCRATCH_DATABASE_URL` and a fake,
unreachable `DATABASE_URL`, and no GitHub token. Scoring uses a separate `eval_<run>` database
the skill never saw. Set `CLAUDE_MODEL` to pin a model. Locally, your own `~/.claude` settings
and `CLAUDE.md` apply to the run; CI starts from a clean home.

Regenerate fixtures after changing the generator:

```bash
npm run fixtures     # byte-identical on every run; the self-test fails if the committed copy is stale
```

## Install the skill

```bash
./install.sh         # symlinks skills/* into ~/.claude/skills/ (idempotent, never overwrites a real dir)
```

Then, in a project with a `prisma/` directory:

```bash
claude
> /refactor-prisma-db
```

The skill needs no database and never asks for one. It profiles the schema and migrations,
writes the reviewed `schema.prisma` plus `mapping.yaml`, `decisions.yaml` and an untested
`migration.sql` to `refactor-out/`, and stops. Applying and checking the migration against real
data (gates H2–H7) is the harness's job in CI. If `SCRATCH_DATABASE_URL` happens to point at a
local copy, the profile adds read-only data statistics from it; the harness runs use this.

## How it is scored

**Hard gates.** Every gate must pass in every run. A crash or timeout fails all gates for that run.

| | Gate |
|---|---|
| H1 | `prisma validate` on the output schema |
| H2 | `prisma migrate deploy` of the source migrations plus the output migration succeeds |
| H3 | No drift between the migrated database and the output schema |
| H4 | `mapping.yaml` is complete: every source model and scalar field exactly once, every target element has an origin |
| H5 | Reconciliation: every source row is in its target, in `MigrationIdMap` or in `QuarantinedRow`, and every target row has an origin. Exploded children: tokens = child rows + dangling tokens |
| H6 | Every `DROP TABLE/COLUMN/TYPE` has a `-- mapping:` annotation pointing to a mapping entry |
| H7 | `copy`/`move` fields keep their values, compared per row by md5 (through `MigrationIdMap` where ids changed) |
| H8 | No `NOT VALID` constraints, no disabled triggers |
| H9 | Nothing changed outside the output dir, in either the harness checkout or the project copy |

A gate is `pass`, `fail` or `blocked` (when a gate it depends on failed, e.g. H3 needs H1 and H2).
Blocked counts as not passed.

**Scored metrics.** Cases are resolved through the output's `mapping.yaml`, so the skill's own naming choices don't matter.

| | Metric | Min | Max drop vs baseline |
|---|---|---|---|
| S1 | Recall: planted mess cases fixed | 0.90 | 0.05 |
| S2 | Restraint: clean models structurally identical to gold | 1.00 | 0.00 |
| S3 | Traps: snapshots and opaque Json left alone and documented | 1.00 | 0.00 |
| S4 | Ambiguities logged instead of guessed | 0.80 | 0.10 |
| S5 | Constraints (per check) | 0.90 | 0.05 |
| S6 | Stability: case outcome identical in all N runs | 0.80 | 0.10 |
| S7 | Cost: median tokens, wall time, turns | warning only, above 1.5× baseline tokens | |

Thresholds live in `tests/thresholds.json`. The verdict is **MERGE-READY** if and only if:
the self-test passed, every gate passed in every run, every S1–S6 mean ≥ min, every drop vs a
comparable baseline ≤ max drop, and, for PRs touching `tests/`, `fixtures/` or `.github/`,
the `harness-change` label was set by the owner. Otherwise it is **NOT READY**, with every
reason listed. Scripts decide the verdict; Claude only formats it.

A baseline is comparable only if its `harnessHash` (a hash of `tests/` + `fixtures/`) matches
the current harness. After a harness change, regression checks are skipped until a new
baseline exists, and the report says so.

## The PR check

On every PR (`opened`, `synchronize`, `reopened`, `labeled`), `claude-check.yml` runs:

1. **selftest**: the PR head's harness, no secrets.
2. **authorize**: Claude runs only for PRs from branches in this repo, authored by `vars.OWNER`,
   or when the owner adds the `run-check` label. Other label events on the owner's PRs (e.g.
   adding `harness-change`) re-aggregate the existing runs of that commit instead of
   spending usage again.
3. **skill-run** × `vars.CHECK_RUNS` (default 5): harness, tests and fixtures from the **base**
   commit; only `skills/refactor-prisma-db` from the PR head. Each run uploads `results/run-<n>`.
4. **aggregate**: downloads the runs and the baseline from the `metrics` branch, writes
   `report.json`, `report.md` and `verdict.txt`.
5. **report**: Claude formats `report.json` into a comment. A script then checks the verdict
   line, every metric, every cost number and every gate row. If anything differs, the raw
   `report.md` is posted instead. The comment is sticky: it is updated in place.
6. **gate**: fails unless the verdict is `MERGE-READY`; fails with "not evaluated" when Claude did not run.

`baseline.yml` stores the merged PR's report as `baseline.json` on the `metrics` branch.
`selftest` and `gate` are required status checks on `main`.

### Security

- `pull_request_target` is never used. Fork PRs run with GitHub's read-only token and receive no secrets.
- The Claude steps receive only `CLAUDE_CODE_OAUTH_TOKEN`, never a GitHub token. The steps that talk to the GitHub API never run Claude.
- Fork PRs never receive secrets and never trigger Claude. Because a fork's `pull_request`
  token cannot comment, `fork-notice.yml` (a `workflow_run` that never checks out PR code)
  posts the one-time notice.
- Actions require approval for workflows from all outside contributors.
- `main` is protected by a ruleset: PR required, `selftest` and `gate` must pass on an
  up-to-date branch, no force pushes or deletion, no bypass.

## Deviations from the original spec, and why

- **Support table names.** The output contract maps `QuarantinedRow`/`MigrationIdMap` to
  `quarantined_row`/`migration_id_map` instead of `_quarantined_row`/`_migration_id_map`.
  Prisma 7.10 does not recognise autoincrement on tables whose name starts with `_`, so even
  Prisma's own migration for them reports drift and H3 could never pass.
- **Mutant b10 (identity output)** also lowers S5, because every mess case carries
  constraint checks. b10 keeps the gold decisions and snapshot docs so that S2–S4 stay at 1.
- **Anti-leak tokens** are model names, scalar field names, enum names and case ids. Relation
  field names are excluded: they derive from model names and are mostly plain words
  (`project`, `parent`, `invoices`). Names of the output contract's own support models are
  excluded too.
- **`fork-notice.yml`** exists because a `pull_request` workflow from a fork cannot comment.
