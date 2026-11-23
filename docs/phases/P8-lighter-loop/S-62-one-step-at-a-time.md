---
slice: P8/S-62
name: One step at a time
repo: .
group: E
runbook: no
requirements: [REQ-2.16, REQ-5.8, REQ-5.7]
decisions: [D-104, D-101, D-98, D-97]
---

## Done when

1. `slicekit next` reads `.slicekit/state/`, the slice files, the verdict files and `decisions.md` only, and prints the one next step on its first line and the command that runs it on its second; it changes no file, starts no process that writes, and calls no git host. Run twice with no change in between it prints the same lines; a step whose result the files already record is never printed, and the second scenario of REQ-2.16 (round 1 recorded) passes as written (REQ-2.16, D-104).
2. At a slice at `ready` it prints that a person merges the pull request, with its number, and exits 0; the first scenario of REQ-2.16 passes as written. It stops the same way, naming the command for the person and running nothing, before a publish, before a force push, at an Open decision row the step depends on, and at the review budget stop of REQ-2.8, where it prints the three choices (REQ-2.16, D-101).
3. `slicekit instructions --command next` prints the procedure: run `slicekit next`, run the one command it names unless the step is a person's, then stop. `/slicekit next` and `/slicekit-next` reach it; `.claude/commands/slicekit-next.md` is rendered by `slicekit update`; the procedure says `/loop /slicekit next` runs one step per iteration and that a step resumes after a restart or a compaction (REQ-2.16, D-104). <!-- slicekit:pending P8/S-62 -->
4. `docs/guide/commands/next.md` and `docs/guide/slash/next.md` exist, the guide index's Pages and Stages sections name them, and `node scripts/guide-html.js --check` exits 0. The README's "What it covers" table has a Next row (REQ-5.8, REQ-5.7, D-97). <!-- slicekit:pending P8/S-62 -->
5. The README's "Built with itself" block says that every change to `src/`, `bin/` and `templates/` went through a slice, and that test files have also changed in spec pull requests, naming #94 as the one case so far (issue #195, REQ-5.7, D-98). `slicekit check` gives `0 findings`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `next.test.js » at tests-red next names the build step and its command` | happy | REQ-2.16 |
| `next.test.js » at ready next names the merge for a person and changes no file` | negative | REQ-2.16 |
| `next.test.js » two runs with no change print the same step and never a recorded round` | happy | REQ-2.16 |
| `next.test.js » an Open decision row the step depends on stops next for a person` | negative | REQ-2.16 |
| `user-guide.test.js » the next command and procedure have pages` | happy | REQ-5.8 |
| `readme.test.js » Built with itself names the test changes made in spec pull requests` | negative | REQ-5.7 |

## Expected changes

`src/next.js`, `src/stage.js`, `src/cli/next.js`, `src/cli/index.js`, `src/instructions.js`, `templates/instructions/commands/next.md`, `templates/claude-code/commands/slicekit-next.md`, `templates/claude-code/commands/slicekit.md`, `templates/claude-code/manifest.json`, `.claude/commands/slicekit-next.md`, `.claude/commands/slicekit.md`, `docs/guide/commands/next.md`, `docs/guide/slash/next.md`, `docs/guide/README.md`, `docs/guide/slicekit-guide.html`, `README.md`, `docs/adapters.md`, `docs/guide/slash/slicekit.md`, the rendered `slicekit.md` and `slicekit-next.md` under `.claude/commands/` and `.slicekit/rendered/` of the kit and of `examples/data` and `examples/fullstack`, tests. The adapters page and the `/slicekit` page list every procedure, and the examples check green only with the new command rendered.

## Tasks

### Task 1: The next step from files

**Files:** Create `src/next.js`, `src/stage.js`, `src/cli/next.js`, `test/next.test.js`. Modify `src/cli/index.js`.

- [ ] **Step 1: Failing tests** — the four `next.test.js` tests above, each on a fixture repository with no git host; each compares every file's bytes before and after the run.
- [ ] **Step 2: Run** `node --test test/next.test.js` → FAIL.
- [ ] **Step 3: Implement** the program stage from `programStage`, then for the first slice not `merged` or `released` in Order the step its state calls for, read from the state file's history and verdicts; the person's points of Done when 2 print the command and exit 0.
- [ ] **Step 4: Run** the same and `node --test test/build.test.js test/cli.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(next): slicekit next prints the one next step`.

### Task 2: The procedure, the slash command, the pages and the README

**Files:** Create `templates/instructions/commands/next.md`, `templates/claude-code/commands/slicekit-next.md`, `docs/guide/commands/next.md`, `docs/guide/slash/next.md`. Modify `src/instructions.js`, `templates/claude-code/commands/slicekit.md`, `templates/claude-code/manifest.json`, `docs/guide/README.md`, `README.md`, `test/user-guide.test.js`, `test/readme.test.js`.

- [ ] **Step 1: Failing tests** — the `user-guide.test.js` and `readme.test.js` tests above.
- [ ] **Step 2: Run** `node --test test/user-guide.test.js test/readme.test.js` → FAIL.
- [ ] **Step 3: Implement** the procedure, the slash command and its manifest entry, `next` in `PROCEDURES`, the pages, the index rows, the README's Next row and its "Built with itself" sentence. Run `node bin/slicekit.js update` and `node scripts/guide-html.js`.
- [ ] **Step 4: Run** the same, `node --test test/guide-page.test.js test/instructions.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(next): /slicekit next and its pages`.

## Notes

Issue #195 was raised on P6/S-55 and moved here from P8/S-63 because this slice changes the README in the same Order step (see P8.md, Order). `build next`, which prints the next runnable slice, stays as it is; `slicekit next` reads it.
