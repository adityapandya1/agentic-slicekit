---
slice: P3/S-32
name: Faster CI: bookkeeping pushes skip the tests, and team commands run in shards
repo: .
group: B
runbook: no
requirements: [REQ-3.11]
decisions: [D-49]
---

## Done when

1. On a pull request, a push whose commits since the last run change only bookkeeping (the slice's state file, verdict files under the reviews directory, and `BUILD.md`, the same set `build commit` treats as the kit's own) runs the `gate` job and skips every team command job; the run concludes green. The decision is made by a new `slicekit ci bookkeeping` subcommand that the gate runs and that prints `bookkeeping` or `code` with the commit range it judged; any doubt (no base to compare, a force push, a file outside the set) prints `code`, and the tests run. The gate passes `--head` and the pull request's base branch, never a `--base` of its own: the command finds the base itself, as the newest commit of the pull request whose CI passed (D-49).
2. The `ready-label` job counts a team command job skipped for bookkeeping as passed, and still counts a job that failed, was cancelled, or was skipped for any other reason as not passed.
3. `ci.shards` in `.slicekit/config.json` (default none) splits the `test` command's job into that many parallel jobs per operating system, given as a map such as `{ "windows-latest": 3 }`; each job sets `SLICEKIT_SHARD` to `<k>/<n>`, and the kit's own test command, `npm run test:shard`, runs its share of the test files, placed on shards by measured weight, when it is set, and every test file when it is not. A team whose test command does not read `SLICEKIT_SHARD` gets the same command in each shard, which the generator warns about at `workflow --write`.
4. The kit's own config sets `ci.shards` to `{ "windows-latest": 3 }`, its workflow is regenerated, and each Windows shard of a pull request finishes in under half of today's unsharded Windows time (measured on PR #50: 6.0, 7.3 and 7.6 minutes against about 20).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `ci-bookkeeping.test.js » a push of only state, verdict and BUILD.md is bookkeeping` | happy | REQ-3.11 |
| `ci-bookkeeping.test.js » a push that changes any other file, or has no base, is code` | negative | REQ-3.11 |
| `workflow.test.js » team command jobs are skipped for bookkeeping and ready-label counts them as passed` | happy | REQ-3.11 |
| `workflow.test.js » ci.shards renders one job per shard with SLICEKIT_SHARD` | happy | REQ-3.11 |
| `workflow.test.js » a shard count that is not a positive integer is refused, naming the field` | negative | REQ-3.11 |

## Expected changes

`src/workflow.js`, `src/cli/ci.js`, `src/cli/index.js`, `src/config.js`, `templates/workflow/slicekit.yml`, `.github/workflows/slicekit.yml`, `.slicekit/config.json`, `package.json`, `test/ci-bookkeeping.test.js`, `test/workflow.test.js`, `test/fixtures/golden/workflow/`.

## Tasks

### Task 1: The bookkeeping decision

**Files:** Create `src/cli/ci.js` (`ci bookkeeping [--base <sha>] [--head <sha>]`), register it in `src/cli/index.js`; reuse the kit-file sets `build commit` already uses. Create `test/ci-bookkeeping.test.js`.

- [ ] **Step 1: Failing tests** — the two ci-bookkeeping tests, on a temporary repository with a slice branch.
- [ ] **Step 2: Implement**; run the tests → PASS.

### Task 2: The workflow

**Files:** `templates/workflow/slicekit.yml`, `src/workflow.js`, `src/config.js`, `test/workflow.test.js`, the golden files, the kit's own `.github/workflows/slicekit.yml` (regenerated with `slicekit workflow --write`), `.slicekit/config.json`, `package.json` (the test script reads `SLICEKIT_SHARD`).

- [ ] **Step 1: Failing tests** — the three workflow tests.
- [ ] **Step 2: Implement**: the gate exposes the bookkeeping decision as a job output; each team command job has `if:` on it; ready-label's pass test treats that skip as passed; `ci.shards` renders a matrix of shards per operating system.
- [ ] **Step 3: Run** the workflow and config tests and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 4: Commit** `ci(P3/S-32): bookkeeping pushes skip the tests; Windows runs in three shards`.
