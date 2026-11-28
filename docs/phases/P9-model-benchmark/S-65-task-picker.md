---
slice: P9/S-65
name: Task picker
repo: .
group: B
runbook: no
requirements: [REQ-6.2, REQ-5.8]
decisions: [D-110, D-116, D-123, D-127, D-129, D-97]
---

## Done when

1. `slicekit bench pick` lists suggested tasks from the merged slices that have frozen tests, one per line as `<task id> <agent> <slice> <lane>`, covering each agent the project has and both lanes when both have merged slices; a slice with no frozen tests is never suggested (REQ-6.2, D-116).
2. A task holds the slice file, the files at its red commit and its frozen tests, read with git into the task, and the merged change kept apart as the hidden reference answer; a reviewer, auditor or ops task plants one defect from the list of D-123, or none, and records which; a fixer task is a past verdict with a blocker and the files at that point; a designer task exists only in a fullstack project (REQ-6.2, D-123, D-127, D-129).
3. `slicekit bench pick` writes nothing; `slicekit bench pick --confirm` writes the listed tasks to `<docsRoot>/benchmark/tasks.json`, which the runner reads (REQ-6.2, D-116).
4. In a project with no merged slice, `slicekit bench pick` suggests the built-in pack under `templates/bench/pack/`, made from `examples/backend` (REQ-6.2, D-116). <!-- slicekit:pending P9/S-65 -->
5. `docs/guide/commands/bench.md` exists with a `pick` section, the guide index names it, and `node scripts/guide-html.js --check` exits 0 (REQ-5.8, D-97). <!-- slicekit:pending P9/S-65 -->

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `bench-pick.test.js » pick lists merged slices with frozen tests and a quick one among them` | happy | REQ-6.2 |
| `bench-pick.test.js » a task holds no file of the merged change` | negative | REQ-6.2 |
| `bench-pick.test.js » a slice with no frozen tests is never suggested` | negative | REQ-6.2 |
| `bench-pick.test.js » pick writes no task list until a person confirms it` | negative | REQ-6.2 |
| `bench-pick.test.js » a reviewer task plants one defect from the fixed list and records it` | happy | REQ-6.2 |
| `bench-pick.test.js » a fixer task replays a past verdict with a blocker` | happy | REQ-6.2 |
| `bench-pick.test.js » a new project with no merged slice gets the built-in pack` | happy | REQ-6.2 |
| `user-guide.test.js » the bench command has a page` | happy | REQ-5.8 |

## Expected changes

`src/bench/tasks.js`, `src/bench/plant.js`, `src/bench/pack.js`, `src/cli/bench.js`, `src/cli/index.js`, `templates/bench/pack/`, `docs/guide/commands/bench.md`, `docs/guide/README.md`, `docs/guide/slicekit-guide.html`, tests.

## Tasks

### Task 1: Tasks from merged slices

**Files:** Create `src/bench/tasks.js`, `src/bench/plant.js`, `test/bench-pick.test.js`.

- [ ] **Step 1: Failing tests** — the first six `bench-pick.test.js` tests above, on a fixture repository with merged slices, one on the quick lane, and a verdict with a blocker.
- [ ] **Step 2: Run** `node --test test/bench-pick.test.js` → FAIL.
- [ ] **Step 3: Implement** the suggestion from the state files, the task's files read at the red commit, the reference answer kept apart, the planted defect (one of the four kinds of D-123, chosen by a seed recorded with the task), the fixer replay and the designer screen.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(bench): tasks from merged slices`.

### Task 2: The built-in pack, the command and its page

**Files:** Create `src/bench/pack.js`, `templates/bench/pack/`, `src/cli/bench.js`, `docs/guide/commands/bench.md`. Modify `src/cli/index.js`, `docs/guide/README.md`, `test/user-guide.test.js`.

- [ ] **Step 1: Failing tests** — the last two tests above.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** the pack from `examples/backend` (a slice file, the files before its code, its tests and the reference answer for each task), `bench pick` and `--confirm`, the page and the index row. Run `node scripts/guide-html.js`.
- [ ] **Step 4: Run** the same, `node --test test/guide-page.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(bench): slicekit bench pick and the built-in pack`.

## Notes

The task list's path, `<docsRoot>/benchmark/tasks.json`, is a plan choice: the decisions name the run files and the report, not where a confirmed list lives. Committing it beside them lets a later run and the new-model check use the same tasks (D-117).
