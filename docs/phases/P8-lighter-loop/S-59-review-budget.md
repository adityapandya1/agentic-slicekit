---
slice: P8/S-59
name: Review budget
repo: .
group: B
runbook: no
requirements: [REQ-2.8, REQ-2.6, REQ-2.11, REQ-2.12]
decisions: [D-101, D-104, D-18]
---

## Done when

1. `slicekit review start <PR>` starts the first independent round of a slice; it starts a second only when the latest independent verdict holds an open blocker; and it refuses a third, before any worktree is touched, with exit 1 unless `decisions.md` holds a row that names the slice and allows one more round. The refusal names each open blocker by ID and prints the three choices of REQ-2.8: fix by hand, re-scope the slice, or record a decision row and run the same command again. The scenario of REQ-2.8 (blocker B-1 after the second independent verdict) passes as written (REQ-2.8, D-101).
2. `build verdict --independent` on the last allowed round with an open blocker sets `changes-requested` and prints the same open findings and three choices; with a decision row allowing another round it prints the `review start` command for that round. The in-loop budget of REQ-2.6 is unchanged: two rounds, and a blocker that survives round two stops the loop as before (REQ-2.6, D-101, D-18).
3. A verdict file whose verdict line is `APPROVE` and whose findings table has a header and no row passes the verdict parser and the SubagentStop shape check, and `build verdict` records it with zero findings (REQ-2.11, D-101).
4. `slicekit instructions reviewer` prints that the reviewer reports no finding on wording, formatting or naming alone, writes no finding when it has none, and writes `APPROVE` with an empty findings table then; it names the round budget of REQ-2.6 and REQ-2.8. The agent table row of REQ-2.12 for the reviewer is what the brief says (REQ-2.12, D-101).
5. `slicekit instructions --command review` says, in one sentence, that a reviewer subagent started by `slicekit review start <PR>` from the main checkout, given only the pull request and the reviewer's brief and no build context, counts as independent, and that `/slicekit review` in a new session is the stronger form (REQ-2.8, D-104).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `review-budget.test.js » a second independent round starts only after a blocker` | happy | REQ-2.8 |
| `review-budget.test.js » a third independent round with no decision row is refused naming the blocker and the three choices` | negative | REQ-2.8 |
| `review-budget.test.js » a decision row naming the slice allows one more round` | happy | REQ-2.8 |
| `review-budget.test.js » the last independent round with a blocker sets changes-requested and prints the choices` | negative | REQ-2.6 |
| `verdict.test.js » an APPROVE verdict with an empty findings table is well formed` | happy | REQ-2.11 |
| `instructions.test.js » the reviewer brief forbids a style finding and names the round budget` | negative | REQ-2.12 |
| `instructions.test.js » the review procedure says a fresh reviewer subagent from the main checkout is independent` | happy | REQ-2.8 |

## Expected changes

`src/build/review.js`, `src/build/verdict.js`, `src/cli/build.js`, `src/cli/review.js`, `src/verdict.js`, `src/hooks/shapes.js`, `templates/instructions/commands/review.md`, `templates/instructions/agents/reviewer.md`, `docs/runbook.md`, tests.

## Tasks

### Task 1: The independent round budget

**Files:** Create `test/review-budget.test.js`. Modify `src/build/review.js`, `src/build/verdict.js`, `src/cli/build.js`, `src/cli/review.js`, `docs/runbook.md`.

- [ ] **Step 1: Failing tests** — the four `review-budget.test.js` tests above, on the fixtures of `test/review-worktree.test.js` with a fixture host (`SLICEKIT_GITHOST_FIXTURE`). A decision row allows a round when its answer names the slice ID and the words "one more round".
- [ ] **Step 2: Run** `node --test test/review-budget.test.js` → FAIL.
- [ ] **Step 3: Implement** the count of independent verdicts and the open blockers of the latest one in `startReview`, read before `clearOld`; the same stop in `build verdict --independent`; the three choices as one exported list both print. The runbook's review section says what to do at the stop.
- [ ] **Step 4: Run** the same and `node --test test/review-worktree.test.js test/commands/review-1.test.js test/commands/review-2.test.js test/commands/review-3.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(review): an independent round budget that stops for a person`.

### Task 2: The verdict with nothing to report

**Files:** Modify `src/verdict.js`, `src/hooks/shapes.js`, `test/verdict.test.js`.

- [ ] **Step 1: Failing test** — `verdict.test.js » an APPROVE verdict with an empty findings table is well formed`.
- [ ] **Step 2: Run** `node --test test/verdict.test.js test/hooks/subagent-stop.test.js` → FAIL, or PASS when the parser already accepts it; the test is kept either way.
- [ ] **Step 3: Implement** what the test needs, if anything.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `fix(verdict): an APPROVE with no findings is well formed`.

### Task 3: The reviewer's brief and the review procedure

**Files:** Modify `templates/instructions/agents/reviewer.md`, `templates/instructions/commands/review.md`, `test/instructions.test.js`.

- [ ] **Step 1: Failing tests** — the two `instructions.test.js` tests above.
- [ ] **Step 2: Run** `node --test test/instructions.test.js` → FAIL.
- [ ] **Step 3: Implement** the lines of Done when 4 and 5.
- [ ] **Step 4: Run** the same, `node --test test/briefs.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `docs(review): the reviewer reports no style finding; a fresh subagent is independent`.

## Notes

The guide pages `docs/guide/commands/review.md` and `docs/guide/slash/review.md` change in P8/S-61, not here: S-58 writes the web page in this Order step (see P8.md, Order).
