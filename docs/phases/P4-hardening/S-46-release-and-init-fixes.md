---
slice: P4/S-46
name: Old verdicts after a version bump, and init's default branch
repo: .
group: E
runbook: yes
requirements: [REQ-3.7, REQ-1.1]
decisions: [D-43, D-53]
---

## Done when

1. The references rule does not report a path under `.slicekit/rendered/<version>/` named in a verdict file that is already on the default branch, so a version bump no longer fails check on merged verdicts (issue #75, REQ-3.7).
2. A path under `.slicekit/rendered/` in a verdict of the current slice is still checked (REQ-3.7).
3. The release section of `docs/runbook.md` says `build render` runs from the worktree's own `bin/` during a version bump (issue #75).
4. With no origin, no `init.defaultBranch` and a current branch that is neither `main` nor `master`, `init` refuses and asks for `--default-branch <name>`, instead of protecting the current branch; a detached HEAD in such a repository is refused the same way (issue #87, REQ-1.1).
5. `init --default-branch trunk` writes `trunk` as `defaultBranch` and as the protected branch (REQ-1.1).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `check/references.test.js » a rendered path of an old version in a merged verdict is not a finding` | happy | REQ-3.7 |
| `check/references.test.js » a missing rendered path in the current slice's verdict is a finding` | negative | REQ-3.7 |
| `default-branch.test.js » init on a feature branch with no origin refuses and asks for --default-branch` | negative | REQ-1.1 |
| `default-branch.test.js » init --default-branch trunk protects trunk` | happy | REQ-1.1 |

## Expected changes

`src/check/rules/references.js`, `src/init.js`, `src/cli/init.js`, `docs/runbook.md`, tests.

## Tasks

### Task 1: Old verdicts

**Files:** Modify `src/check/rules/references.js`, `test/check/references.test.js`, `docs/runbook.md`.

- [ ] **Step 1: Failing tests** — the two references tests above.
- [ ] **Step 2: Implement**: a verdict file present at `origin/<defaultBranch>` is history; its rendered-folder paths are skipped.
- [ ] **Step 3: Run** `node --test test/check/references.test.js` → PASS.

### Task 2: init's default branch

**Files:** Modify `src/init.js`, `src/cli/init.js`, `test/default-branch.test.js`.

- [ ] **Step 1: Failing tests** — the two default-branch tests above.
- [ ] **Step 2: Implement**; run `node --test test/default-branch.test.js` → PASS.
- [ ] **Step 3: Commit** `fix: old verdicts survive a version bump; init asks for the default branch (#75, #87)`.
