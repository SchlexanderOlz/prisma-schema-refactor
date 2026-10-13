#!/usr/bin/env bash
# THE one command.
#   ./tests/run-tests.sh --gold                         score fixtures/gold (must be 100%)
#   ./tests/run-tests.sh --out <dir>                    score an existing output dir
#   ./tests/run-tests.sh --with-claude [--runs N] [--run-id K] [--skill-dir <path>]
#                                                       run the skill headless N times, score each
#   ./tests/run-tests.sh --selftest                     fixtures up to date, gold 100%, mutants, coverage, anti-leak
#   add --json for machine-readable output on stdout
# Exit codes: 0 MERGE-READY, 1 NOT READY, 2 harness error.
# PGURL_ADMIN overrides the admin connection (default: docker-compose instance on :54329).
set -euo pipefail
cd "$(dirname "$0")/.."

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 24 ]; then
  echo "harness error: Node >= 24 required (found $(node --version 2>/dev/null || echo none))" >&2
  exit 2
fi
if [ ! -x node_modules/.bin/prisma ]; then
  npm ci --no-audit --no-fund >&2 || { echo "harness error: npm ci failed" >&2; exit 2; }
fi

exec node --disable-warning=ExperimentalWarning tests/run.ts "$@"
