# Rules for working in this repo
- Never push to main. Every change: branch → PR.
- Never edit fixtures/clean, fixtures/messy, fixtures/gold or fixtures/expected.json by hand.
  Change fixtures/generator, run `npm run fixtures`, commit the regenerated output.
- Files under skills/** must not mention fixture model names, field names or case ids.
  `npm run selftest` enforces this.
- Never tune the skill to pass specific planted cases. Improve general rules only.
- Before opening a PR: `npm run selftest` and `./tests/run-tests.sh --gold` must both pass.
- PRs that touch tests/, fixtures/ or .github/ are harness changes: say so in the
  description; they need the `harness-change` label from the owner to merge.
