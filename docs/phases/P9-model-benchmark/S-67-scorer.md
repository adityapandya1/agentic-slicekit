---
slice: P9/S-67
name: Scorer
repo: .
group: D
runbook: no
requirements: [REQ-6.4, REQ-5.8]
decisions: [D-110, D-113, D-116, D-118, D-123, D-127, D-128, D-129, D-97]
---

## Done when

1. Each trial in a run file gains a score: passed or failed, the reason when failed, time, tokens, cost, turns, the reviews needed after the task (the blockers a reviewer raised on the trial's result) and, for coding work, the frozen tests' result and the `slicekit check` findings in the trial's folder (REQ-6.4, D-118).
2. A developer trial passes when the frozen tests pass with no frozen test changed; one that changes a frozen test fails and names it. A test-writing trial passes when its tests fail on the files at the red commit and pass on the reference answer (REQ-6.4, D-116).
3. A reviewer trial scores whether its verdict finds the planted defect, and counts each finding on a task with none planted as a false alarm; an auditor trial scores the planted defect its gaps file finds (REQ-6.4, D-123).
4. A fixer trial passes when the frozen tests pass, a reviewer re-check finds the replayed blocker gone and no file outside the finding changed; an ops trial passes when its report names the slice and the file of the planted defect and proposes no change of its own; a designer trial scores the broken rule found and the false alarms on an unbroken screen. brief, intake, specify, plan and next have no scorer (REQ-6.4, D-113, D-127, D-128, D-129).
5. The bench page says how each agent is scored, and `node scripts/guide-html.js --check` exits 0 (REQ-5.8, D-97).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `bench-score.test.js » a trial records time tokens cost turns and the reviews needed` | happy | REQ-6.4 |
| `bench-score.test.js » a developer trial whose result passes the frozen tests passes` | happy | REQ-6.4 |
| `bench-score.test.js » a developer trial that edits a frozen test fails and names the test` | negative | REQ-6.4 |
| `bench-score.test.js » a test-writing trial whose tests pass at the red commit fails` | negative | REQ-6.4 |
| `bench-score.test.js » a reviewer finding on a task with none planted counts as a false alarm` | negative | REQ-6.4 |
| `bench-score.test.js » a fixer trial that changes a file outside the finding fails` | negative | REQ-6.4 |
| `bench-score.test.js » an ops trial that names the planted defect's slice and file passes` | happy | REQ-6.4 |
| `bench-score.test.js » a designer trial outside a fullstack project is refused` | negative | REQ-6.4 |

## Expected changes

`src/bench/score.js`, `src/bench/run.js`, `docs/guide/commands/bench.md`, `docs/guide/slicekit-guide.html`, tests.

## Tasks

### Task 1: Coding work

**Files:** Create `src/bench/score.js`, `test/bench-score.test.js`. Modify `src/bench/run.js`.

- [ ] **Step 1: Failing tests** — the first four tests above, on trial folders the test writes.
- [ ] **Step 2: Run** `node --test test/bench-score.test.js` → FAIL.
- [ ] **Step 3: Implement** the common numbers, the frozen tests run with the project's test command in the trial folder, the frozen-test comparison by `findTest`, the red and reference runs, and the review after the task through C-4.
- [ ] **Step 4: Run** the same and `node --test test/bench-run.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(bench): score developer and test-writing trials`.

### Task 2: Reviewer, auditor, fixer, ops and designer

**Files:** Modify `src/bench/score.js`, `docs/guide/commands/bench.md`.

- [ ] **Step 1: Failing tests** — the last four tests above.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** the verdict and gaps file reads (`parseVerdict`), the fixer re-check, the ops report match and the designer score; the page section. Run `node scripts/guide-html.js`.
- [ ] **Step 4: Run** the same, `node --test test/guide-page.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(bench): score the review, audit, fix, ops and design trials`.

## Notes

The review after a task and the fixer's re-check are Claude Code runs too; they run on the reviewer's current model, count toward the cap of S-66, and are recorded in the trial.
