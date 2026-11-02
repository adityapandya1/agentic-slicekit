---
slice: P4/S-38
name: Frozen tests hold in CI
repo: .
group: B
runbook: no
requirements: [REQ-3.15]
decisions: [D-10, D-66]
---

## Done when

1. On a slice branch, `slicekit check --ci` fails with `frozen test changed after red: <path>` when a test file of the slice's evaluation set differs from its content at the red commit in the slice's state file (REQ-3.15).
2. The rule passes when the slice file was changed in a commit after the red commit, as `build amend` does (REQ-3.15).
3. The rule reads the state file, the red commit and the test files from git objects of `HEAD`; a state file or test hidden with `git update-index --assume-unchanged` or `--skip-worktree` is judged by its committed content (issue #71, REQ-3.15).
4. On the default branch, on a branch that is not a slice branch, and on a slice before `tests-red`, the rule reports nothing (REQ-3.15).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `check/frozen.test.js » a frozen test changed after red fails the rule, naming the file` | negative | REQ-3.15 |
| `check/frozen.test.js » a state file hidden with assume-unchanged is judged by its committed content` | negative | REQ-3.15 |
| `check/frozen.test.js » a change after an amend of the slice file passes` | happy | REQ-3.15 |
| `check/frozen.test.js » a branch with no red commit reports nothing` | happy | REQ-3.15 |

## Expected changes

`src/check/rules/frozen.js`, `test/check/frozen.test.js`.

## Tasks

### Task 1: The frozen rule

**Files:** Create `src/check/rules/frozen.js`, `test/check/frozen.test.js`.

- [ ] **Step 1: Failing tests** — the four tests above, each in a scratch repo built with the helpers under `test/helpers/`.
- [ ] **Step 2: Run** `node --test test/check/frozen.test.js` → FAIL.
- [ ] **Step 3: Implement** `id = 'frozen'`, `blocking = true`, `ratchet = false`. Read the slice from the branch name; `git show HEAD:.slicekit/state/<P-S>.json` for the red commit and the frozen paths; `git diff --name-only <red>..HEAD -- <paths>` for changes; `git log --format=%H <red>..HEAD -- <slice file>` for an amend.
- [ ] **Step 4: Run** the same, then `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(check): frozen tests hold in CI`.
