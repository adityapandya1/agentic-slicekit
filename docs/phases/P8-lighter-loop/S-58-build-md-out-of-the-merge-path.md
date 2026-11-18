---
slice: P8/S-58
name: BUILD.md out of the merge path
repo: .
group: A
runbook: yes
requirements: [REQ-1.6, REQ-1.8, REQ-3.7, REQ-3.11, REQ-1.1]
decisions: [D-100, D-35]
---

## Done when

1. Every state move of the build loop on a slice branch (`build red`, `build commit`, `build pr`, `build verdict`, `build amend`, `build finish`) makes a bookkeeping commit that holds the slice's state file and no `BUILD.md`; `git diff --name-only <default branch>...HEAD -- BUILD.md` on a slice branch after the loop reaches `ready` prints nothing (REQ-1.6, D-100).
2. The queue rule reports nothing on a slice branch, whatever `BUILD.md` holds, and on any other branch reports as before; the scenario of REQ-1.6 (`draft-pr` with PR 14, `BUILD.md` on the default branch says `todo`) still fails naming the slice. After a sync pull request merges, `BUILD.md` on the default branch equals what `slicekit status --write` renders (REQ-3.7, REQ-1.6).
3. `slicekit init` writes `BUILD.md merge=slicekit-build` to `.gitattributes` and sets `merge.slicekit-build.driver` in the clone's git config to the kit's `status` merge-driver mode; run again it adds neither twice. A local `git merge` of the default branch into a slice branch, both of which changed state files and `BUILD.md`, completes with no conflict on `BUILD.md`, and the file equals what `status --write` renders from the merged state files. The layout rule reports a `.gitattributes` that lacks the rule; the kit's own `.gitattributes` carries it (REQ-1.6, REQ-1.1).
4. A verdict on head A covers head B when B adds to A a merge of the default branch after which every file the pull request changes, bookkeeping aside, has the content it had at A (D-100, refining D-35): `state set <id> ready` accepts an independent verdict on A, the ready label of REQ-3.11 is given on B, and `build pr` keeps a slice at `in-review`, `ci-green` or `ready` rather than moving it to `draft-pr`. When the merge changes one of those files, each refuses as before; the scenario of REQ-1.8 passes as written (REQ-1.8, REQ-3.11).
5. The runbook says how a clone made after init gets the merge driver (run `slicekit init` once; it changes no committed file), what a `BUILD.md` conflict means when the driver is not set, and that the sync pull request rewrites `BUILD.md`. The guide pages of the queue and layout rules and of `init` and `status` say the same, `node scripts/guide-html.js --check` exits 0, and `slicekit check` gives `0 findings`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `build-record.test.js » a state move on a slice branch commits the state file and not BUILD.md` | happy | REQ-1.6 |
| `check/queue.test.js » on a slice branch a BUILD.md that differs from state is no finding` | happy | REQ-3.7 |
| `check/queue.test.js » on the default branch a BUILD.md that differs from state is still a finding` | negative | REQ-3.7 |
| `build-merge-driver.test.js » a local merge regenerates BUILD.md through the merge driver with no conflict` | happy | REQ-1.6 |
| `init.test.js » init writes the merge rule and the driver once` | happy | REQ-1.1 |
| `check/layout.test.js » a .gitattributes without the BUILD.md merge rule is a layout finding` | negative | REQ-1.1 |
| `covers.test.js » a merge of the default branch that leaves the pull request's files as they were covers the verdict` | happy | REQ-1.8 |
| `covers.test.js » a merge that changes a file the pull request changes does not cover the verdict` | negative | REQ-1.8 |
| `ready-label.test.js » the ready label is given after a merge of the default branch that leaves the slice's files` | happy | REQ-3.11 |

## Expected changes

`src/build/record.js`, `src/build/pr.js`, `src/state/covers.js`, `src/check/rules/queue.js`, `src/check/rules/layout.js`, `src/init.js`, `src/paths.js`, `src/cli/status.js`, `src/state/build.js`, `.gitattributes`, `docs/guide/rules/queue.md`, `docs/guide/rules/layout.md`, `docs/guide/commands/init.md`, `docs/guide/commands/status.md`, `docs/guide/slicekit-guide.html`, `docs/runbook.md`, tests.

## Tasks

### Task 1: The state file alone on a slice branch

**Files:** Create `test/build-record.test.js`. Modify `src/build/record.js`, `src/build/pr.js`, `src/check/rules/queue.js`, `test/check/queue.test.js`.

- [ ] **Step 1: Failing tests** — `build-record.test.js` and the two `test/check/queue.test.js` tests above. Existing tests that read `BUILD.md` from a slice branch's bookkeeping commit change with the rule; each one names P8/S-58 in a comment.
- [ ] **Step 2: Run** `node --test test/build-record.test.js test/check/queue.test.js` → FAIL.
- [ ] **Step 3: Implement** `commitState` without `BUILD.md`; `cleanOrFinish` accepts the state file alone; the queue rule returns no finding when the current branch is a slice branch.
- [ ] **Step 4: Run** the same and `node --test test/build.test.js test/build-commit-merge.test.js` → PASS.
- [ ] **Step 5: Commit** `fix(build): a slice branch commits no BUILD.md`.

### Task 2: The merge driver

**Files:** Create `test/build-merge-driver.test.js`. Modify `src/init.js`, `src/paths.js`, `src/cli/status.js`, `src/state/build.js`, `src/check/rules/layout.js`, `.gitattributes`, `test/init.test.js`, `test/check/layout.test.js`, `docs/runbook.md`.

- [ ] **Step 1: Failing tests** — `build-merge-driver.test.js`, `init.test.js` and `test/check/layout.test.js` tests above, on a fixture repository whose two branches each moved a state file.
- [ ] **Step 2: Run** `node --test test/build-merge-driver.test.js test/init.test.js test/check/layout.test.js` → FAIL.
- [ ] **Step 3: Implement** the attribute line in `attributeRules`, the git config entry (the command is the config's `cli` followed by the driver mode and `%O %A %B`), the driver mode in `slicekit status` that renders from the merged state files and writes the path git gave as `%A`, and the layout rule's check of the attribute. Add the rule to the kit's own `.gitattributes`. Write the runbook lines of Done when 5.
- [ ] **Step 4: Run** the same and `node --test test/init-heads-ignore.test.js test/intake.test.js` → PASS; intake's own attribute rule is untouched.
- [ ] **Step 5: Commit** `feat(init): a merge driver regenerates BUILD.md on a local merge`.

### Task 3: A merge of the default branch keeps the verdict

**Files:** Modify `src/state/covers.js`, `test/covers.test.js`, `test/ready-label.test.js`.

- [ ] **Step 1: Failing tests** — the two `covers.test.js` tests and the `ready-label.test.js` test above.
- [ ] **Step 2: Run** `node --test test/covers.test.js test/ready-label.test.js` → FAIL.
- [ ] **Step 3: Implement** in `headCovers`: when every non-bookkeeping commit between A and B is a merge whose second parent is reachable from the default branch, compare the pull request's own files (its changes against the merge base, bookkeeping aside) at A and at B.
- [ ] **Step 4: Run** the same and `node --test test/state.test.js test/build-pr-head.test.js` → PASS.
- [ ] **Step 5: Commit** `fix(state): a merge of the default branch does not reset a verdict on untouched files`.

### Task 4: The pages

**Files:** Modify `docs/guide/rules/queue.md`, `docs/guide/rules/layout.md`, `docs/guide/commands/init.md`, `docs/guide/commands/status.md`, `docs/guide/slicekit-guide.html`.

- [ ] **Step 1: Write** the pages' lines for Done when 2 to 4; run `node scripts/guide-html.js`.
- [ ] **Step 2: Run** `node --test test/guide-page.test.js test/user-guide.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 3: Commit** `docs(guide): BUILD.md out of the merge path`.
