---
slice: P4/S-45
name: build commit and build amend fixes
repo: .
group: C
runbook: no
requirements: [REQ-2.6, REQ-1.8]
decisions: [D-10, D-43]
---

## Done when

1. When paths are staged, `build commit` commits only the staged paths and leaves the rest of the worktree as it was; with nothing staged it commits every changed path, as today, and its help says which (issue #69, REQ-2.6).
2. A deletion already staged with `git rm` is committed; `build commit` no longer fails with "pathspec did not match" (issue #69, REQ-2.6).
3. `build amend --reason <text>` with no test named changes and commits the slice file alone when every test the slice file names is already unfrozen, and records the reason in the state file (issue #72, REQ-1.8).
4. `build amend` still refuses to change a frozen test without naming it (REQ-1.8).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `build.test.js » build commit with staged paths commits only those paths` | happy | REQ-2.6 |
| `build.test.js » build commit commits a deletion staged with git rm` | negative | REQ-2.6 |
| `build-amend.test.js » build amend changes only the slice file when its tests are already unfrozen` | happy | REQ-1.8 |
| `build-amend.test.js » build amend still refuses a frozen test it does not name` | negative | REQ-1.8 |

## Expected changes

`src/build/commit.js`, `src/git.js`, `src/cli/build.js`, `src/build/record.js`, tests.

## Tasks

### Task 1: build commit

**Files:** Modify `src/build/commit.js`, `src/git.js`, `test/build.test.js`.

- [ ] **Step 1: Failing tests** — the two build tests above.
- [ ] **Step 2: Implement**: read `git diff --cached --name-status`; when it is non-empty commit those paths; skip `git add` for a path staged as deleted.
- [ ] **Step 3: Run** `node --test test/build.test.js` → PASS.

### Task 2: build amend

**Files:** Modify `src/cli/build.js`, `src/build/record.js`, `test/build-amend.test.js`.

- [ ] **Step 1: Failing tests** — the two amend tests above.
- [ ] **Step 2: Implement**; run `node --test test/build-amend.test.js` → PASS.
- [ ] **Step 3: Commit** `fix(build): commit only staged paths; amend the slice file alone (#69, #72)`.
