---
slice: P2/S-16
name: `/slicekit review` and `--parallel`
repo: .
group: E
runbook: no
requirements: [REQ-2.7, REQ-2.8, REQ-1.8]
decisions: [D-06, D-18, D-22, D-35, D-38, D-39]
---

## Done when

1. `slicekit review start <PR>` puts the pull request head in a fresh worktree on a branch that pushes to the slice branch, and prints the slice, the worktree, the round and the verdict path `.slicekit/reviews/P<n>-S-<nn>i-r<k>.md` (REQ-2.8).
2. `build verdict --independent` records a verdict marked independent from `draft-pr`, `changes-requested`, `in-review`, `ci-green` or `ready` without using one of the two in-loop rounds; REQ-1.8's table says so, citing D-39.
3. `build finish` records `ready` after `ci-green` only when the latest independent verdict on the head has no blockers, or review is optional; `slicekit ready-label` withholds the label with "independent review missing" otherwise (REQ-2.8).
4. `build parallel P<n>` starts every runnable slice of the phase's next Order step, each in its own worktree; `build pr` refuses, before pushing, a branch that changes a path another slice of the same step has already pushed, as a plan defect (REQ-2.7, D-06).
5. The `/slicekit review` procedure and the build procedure's `--parallel` section pass the brief lint.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/review.test.js » the verdict of an independent review is marked independent` | happy | REQ-2.8 |
| `commands/review.test.js » the ready label is withheld without an independent verdict` | negative | REQ-2.8 |
| `commands/build-parallel.test.js » a second run changing the same path stops as a plan defect` | negative | REQ-2.7 |
| `commands/review.test.js » an independent verdict does not use an in-loop round` | happy | REQ-2.8 |
| `commands/review.test.js » start checks out the pull request head in a fresh worktree` | happy | REQ-2.8 |
| `commands/review.test.js » a worktree behind origin is refused until synced` | negative | REQ-2.8 |
| `state.test.js » ci-green moves to in-review only on an independent verdict` | negative | REQ-1.8 |
| `commands/build-parallel.test.js » parallel starts one worktree per runnable slice of the step` | happy | REQ-2.7 |
| `commands/build-parallel.test.js » a shared root or a bookkeeping file is not an overlap` | negative | REQ-2.7 |
| `commands/review.test.js » the review and parallel procedures pass the brief lint` | happy | REQ-2.8 |

## Expected changes

`src/build/{review,sync,parallel,overlap,verdict,finish,pr}.js`, `src/cli/build.js`, `src/cli/review.js`, `src/state/transitions.js`, `src/state/covers.js`, `src/check/rules/coverage.js`, `docs/spec/01-layout-and-state.md`, `templates/instructions/commands/{review,build}.md`, tests.

## Tasks

### Task 1: Independent verdicts

**Files:** Modify `src/state/transitions.js`, `src/build/verdict.js`, `src/cli/build.js`, `docs/spec/01-layout-and-state.md`, `test/state.test.js`. Create `test/commands/review.test.js`. <!-- slicekit:example -->

**Interfaces:**
- Consumes: `recordVerdict` (S-15); D-39, already in `decisions.md`.
- `TRANSITIONS['in-review'].from` becomes `['draft-pr', 'changes-requested', 'in-review', 'ci-green', 'ready']`; its `check` refuses from the last three unless `ev.verdict.independent` is true: `<state> takes only an independent verdict`. The round rule is unchanged: `k` counts every verdict of the slice.
- `recordVerdict(…, {independent: true})` requires the name `<P-S>i-r<k>.md`, and an `i` name requires `--independent` (code 2 `an independent verdict is named <P-S>i-r<k>.md`). The in-loop cap and `roundsUsed` ignore independent verdicts; after one, `next` is `fix` with blockers and `ci` without.
- CLI `build verdict <id> <file> --independent`.
- REQ-1.8's table: the `draft-pr → in-review` row becomes `draft-pr or changes-requested → in-review | a verdict file exists for the next round`, with a new row `in-review, ci-green or ready → in-review | an independent verdict file exists for the next round`; REQ-1.8's `Cites:` line gains D-39.

- [ ] **Step 1: Failing tests** — `ci-green moves to in-review only on an independent verdict` (`test/state.test.js`): from `ci-green`, `in-review` with a non-independent verdict is refused with `ci-green takes only an independent verdict`; with `--independent` it is recorded and stamped with the head. `the verdict of an independent review is marked independent`: a slice at `ci-green` after two in-loop rounds; `build verdict P1/S-01 <session>/.slicekit/reviews/P1-S-01i-r3.md --independent` → exit 0, the state's last verdict has `independent: true` and `round: 3`, the state is `in-review`. `an independent verdict does not use an in-loop round`: after it, `build verdict` prints `rounds: 2 of 2` and a blocker in it gives `next: fix`, not `stuck`.
- [ ] **Step 2: Run** `node --test test/state.test.js test/commands/review.test.js` → FAIL.
- [ ] **Step 3: Implement**; edit the REQ-1.8 table and its `Cites:` line.
- [ ] **Step 4: Run** the same, `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(state): an independent verdict can send a green slice back to review`.

### Task 2: `review start`

**Files:** Create `src/build/review.js`, `src/build/sync.js`, `src/cli/review.js`. Modify `src/build/pr.js`, `src/build/verdict.js`, `src/build/finish.js`, `src/cli/build.js`, `src/cli/index.js`, `test/commands/review.test.js`. <!-- slicekit:example -->

**Interfaces:**
- Consumes: C-1 `getPullRequest` (its `headRef`, S-09); `titleSlice` from `src/check/rules/ci-title.js`; `findWorktree` (S-14).
- `startReview(root, cfg, host, number) → {id, worktree, branch, round, verdictPath}`: a title naming no slice → code 2 `pull request #<n> is not a slice pull request`; a pull request that is not open → code 1. Fetches `origin <headRef>`; a review worktree at `<root>/.worktrees/review-P<n>-S-<nn>` that has uncommitted changes → code 1 `<path> has uncommitted changes`, a clean one is removed first (the review starts fresh). Creates the branch `slice/P<n>-S-<nn>-review` at `origin/<headRef>` with that as its upstream, so `pushBranch` pushes to the slice branch and the hook and pre-edit see the slice. `round` is the count of verdicts in the worktree's state file plus one; `verdictPath` is `.slicekit/reviews/P<n>-S-<nn>i-r<round>.md`.
- `openSlicePr` (S-14): for a slice that already has a pull request, `--notes` is optional, and each section the notes do not give keeps the live body's text (the reviewing session does not have the building session's notes).
- Behind the remote: `build pr`, `build verdict` and `build finish` refuse, before pushing, a worktree whose `behindUpstream` (S-09) is above 0: code 1 `<branch> is <n> commits behind origin; run slicekit build sync <id>`. `build sync <id> [--worktree <p>]` fast-forwards the worktree to its upstream (`git pull --ff-only`) and prints the new head; a branch that cannot fast-forward → code 1 `<branch> has diverged from origin; resolve it by hand`. This is how the build worktree takes the fixes a review session pushed. `subcommands` gains `sync`.
- CLI `review start <PR>` prints four lines: `slice <id>`, `worktree <path>`, `round <k>`, `verdict <path>`. `subcommands = ['start']`. Later `build` calls in that worktree pass `--worktree <path>`, since two worktrees then hold the slice.

- [ ] **Step 1: Failing test** — `start checks out the pull request head in a fresh worktree`: a slice at `ci-green` with its branch pushed and the fixture's `pr-1.json` naming that branch as `headRefName` → `review start 1` prints the four lines; the worktree's `HEAD` equals `origin/<headRef>`; its upstream is `origin/<headRef>`; a second `review start 1` on a clean worktree recreates it; with an untracked file in it → exit 1. `a worktree behind origin is refused until synced`: after the review worktree pushes a fix, `build pr` in the build worktree exits 1 with `commits behind origin`; after `build sync` it succeeds.
- [ ] **Step 2: Run** `node --test test/commands/review.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(review): a fresh worktree of the pull request head`.

### Task 3: `ready` after the independent verdict

**Files:** Modify `src/build/finish.js`, `test/commands/review.test.js`. <!-- slicekit:example -->

**Interfaces:**
- Consumes: `independentProblem`, `verdictsOnHead` (`src/state/transitions.js`); `decideReady` (`src/ready-label.js`) through `slicekit ready-label`.
- At `ci-green` already, `finish` skips the CI wait and goes straight to the `ready` decision. After recording `ci-green`, `finish` records `ready` when `cfg.review.independent` is `optional` or `independentProblem(verdictsOnHead(state, head, wt))` is null; otherwise it prints `ready: waiting for an independent review; run /slicekit review <PR> in a new session` and exits 0.

- [ ] **Step 1: Failing test** — `the ready label is withheld without an independent verdict`: two in-loop rounds ending `APPROVE` and a successful CI fixture → `build finish` records `ci-green`, not `ready`, and prints `waiting for an independent review`; `slicekit ready-label`, run in the slice worktree with `GITHUB_EVENT_PATH` naming an event `{pull_request: {number: 1, title, head: {sha}, labels: [{name: 'ready'}]}}`, `SLICEKIT_CHECKS_OK=true`, `GH_TOKEN=x` and `SLICEKIT_GITHOST_FIXTURE`, prints `independent review missing` and the fixture's `label-calls.jsonl` holds a removal of `ready`. After an independent `APPROVE` and `build finish` again, the state is `ready`.
- [ ] **Step 2: Run** `node --test test/commands/review.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(build): ready only after an independent verdict`.

### Task 4: `build parallel` and the overlap stop

**Files:** Create `src/build/overlap.js`, `src/build/parallel.js`, `test/commands/build-parallel.test.js`. Modify `src/build/pr.js`, `src/check/rules/coverage.js`, `src/state/covers.js`, `src/cli/build.js`.

**Interfaces:**
- Consumes: `runnable`, `waiting`, `startSlice` (S-14); `parseOrder` (S-09).
- `src/check/rules/coverage.js` exports `isSharedRoot(path, runbookRel) → boolean` (its `ALWAYS_SHARED` test); `src/state/covers.js` exports `isBookkeepingPath(root, rel) → boolean` (its `bookkeeping` test: state, reviews, journal, `BUILD.md`).
- `startParallel(root, cfg, phase) → [{id, worktree, branch}]`: the first Order step of `phase` holding a `runnable` slice (a phase without an Order line has one step per group); starts each runnable slice of that step; none → code 1 `no slice of <phase> is ready to build` with the `waiting` lines.
- `overlapWith(wt, cfg, id) → [{other, path}]`: after a fetch, for each other slice of the same phase and Order step (or group, without an Order line) that has a branch `origin/slice/P<n>-S-<mm>-*`, the paths both branches change since their merge base with `origin/<defaultBranch>`, less shared roots and bookkeeping paths.
- `openSlicePr` calls it before pushing; a non-empty result → code 1, one line `plan defect: <id> and <other> both change <path>; the plan said they do not overlap`, and nothing is pushed.
- CLI `build parallel P<n>` prints `<id> <worktree> <branch>` per started slice. `subcommands` gains `parallel`.

- [ ] **Step 1: Failing tests** — `a second run changing the same path stops as a plan defect`: two group-A slices, both started, both changing `src/billing.js`; the first `build pr` pushes; the second exits 1 with `plan defect: P1/S-02 and P1/S-01 both change src/billing.js` and `origin/<its branch>` has not moved past the start commit. `a shared root or a bookkeeping file is not an overlap`: both change only `test/x.test.js`, `BUILD.md` and their state files → the second `build pr` succeeds. `parallel starts one worktree per runnable slice of the step`: `**Order:** A; B` with two `todo` slices in A and one in B → `build parallel P1` prints two lines, both worktrees exist, and the B slice is not started. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/commands/build-parallel.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(build): parallel worktrees and the plan-defect stop`.

### Task 5: The `/slicekit review` procedure and `--parallel`

**Files:** Create `templates/instructions/commands/review.md`. Modify `templates/instructions/commands/build.md`, `test/commands/review.test.js`. <!-- slicekit:example -->

**Interfaces:**
- Consumes (S-09): `briefProblems`.
- Review procedure steps: (1) state that this runs in a session with no context from the building session (D-18), which the kit cannot check and leaves to the person; (2) `{{cli}} review start {{args}}`; (3) `{{cli}} instructions reviewer <id>`, then spawn the reviewer with it, the pull request number, the worktree, the round and the verdict path; (4) `{{cli}} build verdict <id> <path> --independent --worktree <wt>`; (5) on `next: fix`, offer the fixer; on yes spawn it with `{{cli}} instructions fixer <id>`, then `{{cli}} build commit <id> --worktree <wt> --message "fix: <ids>" --require-green` and `{{cli}} build pr <id> --worktree <wt>`, and start again at (2), since the new head needs its own independent verdict; the building session runs `{{cli}} build sync <id>` before its next push; (6) on `next: ci`, `{{cli}} build finish <id> --worktree <wt>`; stop: a human merges.
- Build procedure, `--parallel P<n>` section: `{{cli}} build parallel P<n>`; for every printed slice, steps 2 to 5 in its own worktree, spawning the developers together; then steps 6 to 9 for each slice in turn (D-06); a `build pr` that prints `plan defect` stops that slice, and the command reports the overlap to the human as a defect of the plan.

- [ ] **Step 1: Failing test** — `the review and parallel procedures pass the brief lint`: `briefProblems(text, {kind: 'command'})` is `[]` for both; the review procedure names `review start`, `--independent` and `build finish`; the build procedure names `build parallel` and `plan defect`.
- [ ] **Step 2: Run** `node --test test/commands/review.test.js` → FAIL.
- [ ] **Step 3: Write** both.
- [ ] **Step 4: Run** the same, `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(review): the /slicekit review procedure and build --parallel`.
