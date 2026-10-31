---
slice: P3/S-36
name: Release 0.2.1
repo: .
group: D
runbook: yes
requirements: [REQ-1.1, REQ-3.7, REQ-5.7]
decisions: [D-41]
---

## Done when

1. `init` writes the repository's own default branch as `defaultBranch` and as the one entry of `protectedBranches` (issue #78). It reads the branch `refs/remotes/origin/HEAD` points at, else the branch HEAD is on (an unborn HEAD counts), else git's `init.defaultBranch`, else `main`. In a repository whose only branch is `master`, `init` writes `master` and `graph` builds. An existing config is left as it is. The runbook does not change (D-21): it names neither field, and this repository's own config, whose branch is `main`, does not change.
2. `slicekit <command> --help` prints that command's usage lines on standard output and exits 0, for every command, with nothing on standard error (issue #77). A `--help` after a `--` is passed to the command as an argument.
3. `test/check/references.test.js` opens with a comment naming the requirement its tests check, REQ-3.7's references rule, so the graph no longer links it only to REQ-1.1 through its fixture text (issue #83).
4. `package.json` carries `0.2.1` and the kit's own rendered files are re-rendered for it. `CHANGELOG.md` has a 0.2.1 entry naming the three fixes with their issue numbers. Publishing stays the author's, after merge (D-41).
5. `slicekit check` gives `0 findings`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `init.test.js » init in a repository whose branch is master writes master as the default and protected branch` | happy | REQ-1.1 |
| `init.test.js » init takes the default branch from origin's HEAD before the current branch` | happy | REQ-1.1 |
| `init.test.js » init outside a repository writes main` | negative | REQ-1.1 |
| `cli.test.js » every command's --help prints its usage on standard output and exits 0` | happy | REQ-1.1 |
| `cli.test.js » a --help after -- reaches the command as an argument` | negative | REQ-1.1 |
| `package.test.js » package.json is 0.2.1, links the repository and has no dependencies` | happy | REQ-5.7 |

`cli.test.js` was amended after red: the red commit wrote its escaped newlines as real line breaks, so the file did not parse and its two tests failed for that reason. The amendment restores the escapes; the tests and their assertions are the ones above.

## Expected changes

`package.json`, `CHANGELOG.md`, `src/init.js`, `src/git.js`, `src/cli/index.js`, `.claude/`, `.slicekit/rendered/`, `test/init.test.js`, `test/cli.test.js`, `test/package.test.js`, `test/hook-cli.test.js`, `test/check/references.test.js`, tests.

## Tasks

### Task 1: The default branch, the help of each command, the tag line and the version

**Files:** as Expected changes.

- [ ] **Step 1: Failing tests:** the six tests above. The existing tests that pin `0.2.0` change through `build amend` with the reason "0.2.1 release (S-36)".
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** Done when 1 to 4; run `node bin/slicekit.js update --yes`.
- [ ] **Step 4: Run** the targeted tests and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `release(P3/S-36): 0.2.1`.
