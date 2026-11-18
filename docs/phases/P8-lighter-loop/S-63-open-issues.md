---
slice: P8/S-63
name: Open issues
repo: .
group: F
runbook: no
requirements: [REQ-3.2, REQ-5.6, REQ-2.6, REQ-5.8]
decisions: [D-83, D-96, D-43, D-97]
---

## Done when

1. The pre-bash hook denies a long option cut short that follows a short option written with its value attached: `git push -oo --forc origin <branch>` is denied as a force push, `git checkout -bb --forc` and `git switch -CC --discard` are denied, and with a test frozen `git restore --staged -ss --worktre <test>` is denied. Each denial gives the line the same command gets with the value written apart (issue #180, REQ-3.2, D-83).
2. With a test frozen, `git clean -f -e --dry-run`, `git clean -fe --dry-run` and `git clean -f --exclude --dry-run` are denied as `git clean -f` is: a `--dry-run` that is the value of `-e` or `--exclude` is not read as a dry run, and `git clean -n` and `git clean -f --dry-run` are still allowed (issue #181, REQ-3.2).
3. `namesPhase` in `src/release-version.js` counts a phase's line in a `CHANGELOG.md` section when the line is wrapped over two or more lines or written by hand without a final full stop. A slice added to a phase whose wrapped line a section holds gets a patch version naming that slice alone, and the `sync-release` rule computes the same (issue #183, REQ-5.6, D-96).
4. The git directory `build commit` makes for the staged run keeps no ref of the repository writable: a test command that commits or moves a branch in its working directory leaves the slice branch where it was, and `build commit` then commits the staged paths with the trailer and the test result as before; the comment above `gitIn` says what such a command writes (issue #184, REQ-2.6, D-43).
5. `scripts/guide-html.js` refuses, with the file and line, a word between two colons outside a code span that the git host shows as an emoji (issue #188); it keeps a paragraph that links the web page anywhere but in the introduction (issue #189); and the runbook's line about a link that leads to nothing in the guide says a link to a file that is no page of the guide, a folder included, is refused and is removed or written as an absolute address (issue #190). The web page the script writes from the pages is unchanged by this slice: `node scripts/guide-html.js --check` exits 0 with `docs/guide/slicekit-guide.html` as the default branch has it (REQ-5.8, D-97). `slicekit check` gives `0 findings`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `hooks/pre-bash-deny.test.js » a cut long option after a short option with its value attached is denied` | negative | REQ-3.2 |
| `hooks/pre-bash-deny.test.js » git clean with --dry-run as the value of -e is denied` | negative | REQ-3.2 |
| `hooks/pre-bash-deny.test.js » git clean -n and git clean -f --dry-run are still allowed` | happy | REQ-3.2 |
| `release-version-phase.test.js » a phase line wrapped over two lines counts as the phase's minor version` | happy | REQ-5.6 |
| `build-commit-staged.test.js » a test command that commits in the staged run leaves the slice branch where it was` | negative | REQ-2.6 |
| `guide-html-refusals.test.js » a word between colons that the host shows as an emoji is refused with its file and line` | negative | REQ-5.8 |
| `guide-html-refusals.test.js » a paragraph outside the introduction that links the web page is kept` | happy | REQ-5.8 |
| `runbook.test.js » the runbook says a link to a file that is no page is refused` | happy | REQ-5.8 |

## Expected changes

`src/hooks/pre-bash.js`, `src/release-version.js`, `src/build/commit.js`, `scripts/guide-html.js`, `docs/runbook.md`, tests.

## Tasks

### Task 1: The guard issues

**Files:** Modify `src/hooks/pre-bash.js`, `test/hooks/pre-bash-deny.test.js`.

- [ ] **Step 1: Failing tests** — the three `test/hooks/pre-bash-deny.test.js` tests above, with the commands of issues #180 and #181.
- [ ] **Step 2: Run** `node --test test/hooks/pre-bash-deny.test.js` → FAIL.
- [ ] **Step 3: Implement** the attached value of a short option that takes one, read as git reads it, before the cut-option test; the `-e` and `--exclude` value of `git clean` skipped before the dry-run test.
- [ ] **Step 4: Run** `node --test test/hooks/` → PASS; every hook test that passed before passes unchanged.
- [ ] **Step 5: Commit** `fix(hooks): attached option values and git clean's exclude value (closes #180, #181)`.

### Task 2: The wrapped phase line and the staged run's refs

**Files:** Modify `src/release-version.js`, `src/build/commit.js`, `test/release-version-phase.test.js`, `test/build-commit-staged.test.js`.

- [ ] **Step 1: Failing tests** — the `release-version-phase.test.js` and `build-commit-staged.test.js` tests above, the second on the fixture of the staged run test with a test command that runs `git commit --allow-empty -m x` before its tests.
- [ ] **Step 2: Run** `node --test test/release-version-phase.test.js test/build-commit-staged.test.js` → FAIL.
- [ ] **Step 3: Implement** the phase line read across wrapped lines; the staged run's git directory with refs of its own, or a detached HEAD, so no ref of the repository moves.
- [ ] **Step 4: Run** the same and `node --test test/release-version.test.js test/build-commit-state.test.js` → PASS.
- [ ] **Step 5: Commit** `fix: a wrapped phase line counts; the staged run moves no branch (closes #183, #184)`.

### Task 3: The guide script and the runbook

**Files:** Modify `scripts/guide-html.js`, `docs/runbook.md`, `test/guide-html-refusals.test.js`, `test/runbook.test.js`.

- [ ] **Step 1: Failing tests** — the two `guide-html-refusals.test.js` tests and the `runbook.test.js` test above, on scratch copies of the guide.
- [ ] **Step 2: Run** `node --test test/guide-html-refusals.test.js test/runbook.test.js` → FAIL.
- [ ] **Step 3: Implement** the refusal and the paragraph rule in the script and its header; the runbook line.
- [ ] **Step 4: Run** the same, `node --test test/guide-page.test.js` and `node scripts/guide-html.js --check` → PASS, exit 0 with the web page unchanged.
- [ ] **Step 5: Commit** `fix(guide): emoji words, a second link to the page, the runbook line (closes #188, #189, #190)`.

## Notes

Issue #195 moved to P8/S-62 (see P8.md, Order). The guide's `build` page says a git command in the staged run exits 0 and reads the staged files; that stays true after Task 2, so this slice changes no guide page.
