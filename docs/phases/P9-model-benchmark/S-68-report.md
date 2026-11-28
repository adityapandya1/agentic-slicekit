---
slice: P9/S-68
name: Report
repo: .
group: E
runbook: no
requirements: [REQ-6.6, REQ-6.1, REQ-5.8]
decisions: [D-108, D-118, D-126, D-97]
---

## Done when

1. `slicekit bench report` writes `<docsRoot>/benchmark/report.md` from every run file under `<docsRoot>/benchmark/runs/` and from nothing else; the same run files give the same bytes (REQ-6.6, D-118).
2. For each agent the report holds a matrix with one row per full model ID and the columns pass rate with its 95% Wilson interval, pass^k, time, tokens, cost, iterations, reviews needed and code quality; below it, each task with its kind (REQ-6.6, D-118).
3. For each agent it suggests the cheapest model whose interval does not lie wholly below the best model's, and with too few tasks to tell it names no model and says so (REQ-6.6, D-126).
4. `bench run` regenerates the report after its run file; the report says a person sets the models with `slicekit models apply` in a pull request (REQ-6.1, D-108).
5. The bench page has a `report` section, and `node scripts/guide-html.js --check` exits 0 (REQ-5.8, D-97).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `bench-report.test.js » the report has one matrix per agent with a row per model and every column` | happy | REQ-6.6 |
| `bench-report.test.js » with one task the report names no suggested model and says there were too few tasks to tell` | negative | REQ-6.6 |
| `bench-report.test.js » the cheapest model whose interval overlaps the best is suggested` | happy | REQ-6.6 |
| `bench-report.test.js » a model whose interval lies wholly below the best is not suggested` | negative | REQ-6.6 |
| `bench-report.test.js » the same run files give the same report` | happy | REQ-6.6 |
| `bench-report.test.js » the report tells the person to set the models in a pull request` | happy | REQ-6.1 |

## Expected changes

`src/bench/report.js`, `src/bench/stats.js`, `src/bench/run.js`, `src/cli/bench.js`, `docs/guide/commands/bench.md`, `docs/guide/slicekit-guide.html`, tests.

## Tasks

### Task 1: The numbers

**Files:** Create `src/bench/stats.js`, `src/bench/report.js`, `test/bench-report.test.js`.

- [ ] **Step 1: Failing tests** — the first five tests above, on run files the test writes.
- [ ] **Step 2: Run** `node --test test/bench-report.test.js` → FAIL.
- [ ] **Step 3: Implement** the Wilson interval, pass^k as the share of tasks whose every trial passed, the matrix, the task list and the suggestion of D-126.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(bench): the report from the run files`.

### Task 2: The command and its page

**Files:** Modify `src/cli/bench.js`, `src/bench/run.js`, `docs/guide/commands/bench.md`.

- [ ] **Step 1: Failing test** — the last test above.
- [ ] **Step 2: Run** it → FAIL.
- [ ] **Step 3: Implement** `bench report`, the regeneration after a run, the line on `models apply`; the page section. Run `node scripts/guide-html.js`.
- [ ] **Step 4: Run** the same, `node --test test/bench-run.test.js test/guide-page.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(bench): slicekit bench report`.

## Notes

"Too few tasks to tell" is the case where every model's interval overlaps every other's and one task or fewer per agent was run; with more tasks and overlapping intervals the cheapest model is suggested, as D-126 reads.
