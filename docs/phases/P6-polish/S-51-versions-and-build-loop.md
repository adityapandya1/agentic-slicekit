---
slice: P6/S-51
name: Versions and the build loop
repo: .
group: A
runbook: yes
requirements: [REQ-5.5, REQ-2.6, REQ-3.15, REQ-3.8, REQ-3.11, REQ-2.9, REQ-5.6, REQ-5.8]
decisions: [D-96, D-90, D-92, D-94, D-10, D-43, D-80]
---

## Done when

1. A phase sets its minor version once (D-96). The changelog is the record, as D-92 has it for slices: a phase whose line a `CHANGELOG.md` section on the default branch holds has had its minor version. A sync that leaves every slice of such a phase `merged` or `released` sets the next patch version, and its section names the newly merged slice alone, with no phase line. A phase no section names still gets the minor version and the phase section at its first completion, as before. The `sync-release` rule computes the same, so a sync pull request that carries a second minor version for a phase is one finding per file (issue #174, REQ-5.5).
2. `build commit` refuses, before it runs a test, when the slice's own state file is marked `skip-worktree` or `assume-unchanged`, or differs on disk from the file at `HEAD`; the line names the state file and says which it is. The steps of issue #71 (unfreeze a test in the state file on disk, hide the file from git, empty the frozen test) end in exit 1 and no commit (issue #71, REQ-2.6). With paths staged, the test command still sees every tracked file as staged and no unstaged change, and now also reads a file the worktree holds that git ignores or does not track, such as `.slice-tests`, at the same relative path; a git command the test command runs in its working directory exits 0 (issue #107, REQ-2.6, D-43).
3. The `frozen` rule judges a tip that has no state file by the versions of the file in the tip's history: when one of them recorded a red commit, the removal is one finding naming the state file, and each frozen test that changed after red is a finding as before. A slice whose state file never recorded a red commit gets no finding (issue #100, REQ-3.15). A test runs the rule with `freezeTests` set to false on a branch whose frozen test changed after red, and the rule reports nothing (issue #101, D-10).
4. While the journal heads log names no merge, `headsFiles` owes a line for every journal file the commit holds, for a merge commit with two parents as for any other commit, so the files of an earlier merge whose sync pull request never merged are recorded at the first sync that does; `check --ci` recomputes the same set (issue #129, REQ-3.8). `toolCalled` skips the value of a wrapper option that takes one: `sudo -u runner mvn verify`, `nice -n 10 ./gradlew test` and `env -u FOO mvn test` are read as Java calls, and `sudo -u mvn ls` is not (issue #136, REQ-3.11). Issue #127 is not answered in the workflow template: the `pull_request` trigger filters on the base branch only, and a job's `if` is read after a run is approved, so no change to the template keeps the waiting run from being created. The template stays as it is, and the runbook says that a sync pull request carries a `pull_request` run in `action_required`, that the `workflow_dispatch` run is the one the ruleset reads, and that the waiting run is left as it is (issue #127, D-80).
5. `branch release <slug>-<n>`, when that branch holds its own commits and no branch of its family has an open pull request, names the next free number of the family, `<slug>-<n+1>` or the first one after it that no local or origin branch has, never `<slug>-<n>-2` (issue #170, REQ-2.9). After `slicekit branch` drops a migrated config and switches, the config on disk equals the branch's committed bytes and `git status --porcelain` is empty, whatever line endings or trailing whitespace the committed file has (issue #171, D-94). The guide's `sync-release` page says the rule also judges the rendered files of each folder under `examples/`, quotes the second half of the finding line an example file gets and names `slicekit update --yes` in that folder (issue #172, REQ-5.8). `slicekit check` gives `0 findings`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `release-version-phase.test.js » a slice added to a phase that has its minor version gets a patch version naming that slice alone` | happy | REQ-5.5 |
| `release-version-phase.test.js » a sync pull request that sets a second minor version for a phase is a finding` | negative | REQ-5.5 |
| `build-commit-state.test.js » build commit refuses a state file hidden from git or changed on disk` | negative | REQ-2.6 |
| `build-commit-staged.test.js » with paths staged the test command reads an ignored file and runs git` | happy | REQ-2.6 |
| `check/frozen.test.js » a tip that removed the state file after red is a finding and its frozen tests are still judged` | negative | REQ-3.15 |
| `check/frozen.test.js » with freezeTests false a changed frozen test is no finding` | happy | REQ-3.15 |
| `journal-heads.test.js » the first sync on a two-parent merge records every journal file the merge holds` | happy | REQ-3.8 |
| `workflow-java-cache.test.js » a wrapper option that takes a value does not hide the Java call` | happy | REQ-3.11 |
| `runbook.test.js » the runbook says the waiting pull request run on a sync pull request is expected` | happy | REQ-3.11 |
| `branch.test.js » branch release given a numbered slug names the next free number of its family` | negative | REQ-2.9 |
| `cli.test.js » branch leaves no staged config when the branch's config differs only in its line endings` | happy | REQ-5.6 |
| `user-guide.test.js » the sync-release page says what a finding on an example file means` | happy | REQ-5.8 |

Amended (author's standing instruction, 2026-11-15): `test/journal-heads.test.js`, where an older test in the frozen file pins the rule this slice replaces: `headsFiles over a multi-commit push after a recorded merge names every file the push changed` expects the first sync of a two-parent merge that holds two journal files to record one line, and under the new rule it records two. That one count changes; the rest of the test stands.

## Expected changes

`src/release-version.js`, `src/check/rules/sync-release.js`, `src/build/commit.js`, `src/check/rules/frozen.js`, `src/journal.js`, `src/workflow.js`, `src/cli/branch.js`, `docs/guide/rules/sync-release.md`, `docs/guide/rules/frozen.md`, `docs/guide/commands/branch.md`, `docs/guide/commands/build.md`, `docs/runbook.md`, tests.

## Tasks

### Task 1: A phase's minor version, once

**Files:** Create `test/release-version-phase.test.js`. Modify `src/release-version.js`, `src/check/rules/sync-release.js`, `docs/runbook.md`.

- [ ] **Step 1: Failing tests** — the `release-version-phase.test.js` tests above, on a fixture repository with a fixture host (`SLICEKIT_GITHOST_FIXTURE`), built with the helpers `test/release-version.test.js` uses: a phase completes and gets its minor version, a plan adds a slice to it, that slice merges. No test reaches the network.
- [ ] **Step 2: Run** `node --test test/release-version-phase.test.js` → FAIL.
- [ ] **Step 3: Implement** in `releaseFor`: a phase counts as completed by this sync only when no changelog section at the merge holds its phase line. The `sync-release` rule recomputes with the same function. The runbook's "Releasing a version" section says the rule of D-96.
- [ ] **Step 4: Run** the same and `node --test test/release-version.test.js test/release-version-order.test.js test/release-version-examples.test.js` → PASS; the earlier version tests pass unchanged.
- [ ] **Step 5: Commit** `fix(release): a phase gets its minor version once`.

### Task 2: build commit and the state file; the staged run

**Files:** Create `test/build-commit-state.test.js`. Modify `src/build/commit.js`, `test/build-commit-staged.test.js`, `docs/guide/commands/build.md`.

- [ ] **Step 1: Failing tests** — the `build-commit-state.test.js` test (the steps of issue #71, then a state file edited on disk with no mark) and the `build-commit-staged.test.js` test, whose test command reads an ignored file from its working directory and runs `git rev-parse --show-toplevel`.
- [ ] **Step 2: Run** `node --test test/build-commit-state.test.js test/build-commit-staged.test.js` → FAIL.
- [ ] **Step 3: Implement** the state file test before `frozenProblem`, and in `runOnIndex` make the untracked and ignored files of the worktree readable in the run directory (linked or copied, `node_modules` as today) and git usable there. The directory is still removed whether the run passes or fails, and removing it never walks into the worktree. Say both in the `build` page.
- [ ] **Step 4: Run** the same and `node --test test/build-commit-merge.test.js test/build.test.js` → PASS.
- [ ] **Step 5: Commit** `fix(build): commit refuses a forged state file, and the staged run reads untracked files`.

### Task 3: The frozen rule and a removed state file

**Files:** Modify `src/check/rules/frozen.js`, `docs/guide/rules/frozen.md`, `test/check/frozen.test.js`.

- [ ] **Step 1: Failing tests** — the tests this slice adds to `test/check/frozen.test.js`. The `freezeTests` test passes before any change to the rule; it is written first and kept, since issue #101 asks for the test alone.
- [ ] **Step 2: Run** `node --test test/check/frozen.test.js` → the removed-state-file test FAILS.
- [ ] **Step 3: Implement**: read the state file's versions from the tip's history when the tip has none; say it in the rule's page.
- [ ] **Step 4: Run** the same and `node --test test/check/frozen-ci.test.js` → PASS.
- [ ] **Step 5: Commit** `fix(check): a removed state file does not lift the freeze`.

### Task 4: The first sync's journal lines, Java wrappers, the waiting run

**Files:** Modify `src/journal.js`, `src/workflow.js`, `docs/runbook.md`, `test/journal-heads.test.js`, `test/workflow.test.js`, `test/workflow-java-cache.test.js`, `test/runbook.test.js`.

- [ ] **Step 1: Failing tests** — the `journal-heads.test.js`, `workflow-java-cache.test.js` and `runbook.test.js` tests above. The existing tests that pin the first-parent comparison change with the rule: `headsFiles gives the first sync of a merge commit a line only for the files the merge changed` in `test/journal-heads.test.js`, and the last assertion of `the sync job writes a journal-heads line per changed journal file` in `test/workflow.test.js`. Both belong to P4/S-42, which is merged, so neither is frozen for this slice.
- [ ] **Step 2: Run** `node --test test/journal-heads.test.js test/workflow.test.js test/workflow-java-cache.test.js test/runbook.test.js` → FAIL.
- [ ] **Step 3: Implement** the rule in `headsFiles`, the value-taking options per wrapper in `toolCalled`, and the runbook's lines: the first-sync rule and the waiting `pull_request` run, both in "The state sync pull request". `templates/workflow/slicekit.yml` does not change, so `slicekit workflow --check` still passes.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `fix: the first sync records every journal file; a wrapper's option value is not the command`.

### Task 5: The release family, the dropped config, the sync-release page

**Files:** Modify `src/cli/branch.js`, `docs/guide/commands/branch.md`, `docs/guide/rules/sync-release.md`, `docs/runbook.md`, `test/branch.test.js`, `test/cli.test.js`, `test/user-guide.test.js`.

- [ ] **Step 1: Failing tests** — the `branch.test.js`, `cli.test.js` and `user-guide.test.js` tests above.
- [ ] **Step 2: Run** `node --test test/branch.test.js test/cli.test.js test/user-guide.test.js` → FAIL.
- [ ] **Step 3: Implement** the next number from the family's first branch, and the write-back that leaves the branch's committed bytes; bring the `branch` page, the `sync-release` page and the runbook's line about the next slug in step.
- [ ] **Step 4: Run** the same, `node --test test/commands/release.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `fix(branch): the next slug of a release family, and no staged config after a drop`.
