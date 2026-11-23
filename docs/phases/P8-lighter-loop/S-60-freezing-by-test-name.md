---
slice: P8/S-60
name: Freezing by test name and slice-file amendments
repo: .
group: C
runbook: yes
requirements: [REQ-1.5, REQ-3.3, REQ-3.2, REQ-3.7, REQ-3.15, REQ-1.8]
decisions: [D-102, D-10, D-43]
---

## Done when

1. `build red` records each test of the evaluation set as its file and its name, read from the `<file> » <test name>` cell, and refuses with exit 1 when a named test is not found in its file at the red commit. `tests-red → building` requires each named test present in its file (REQ-1.8, REQ-1.5, D-102). A state file written before this slice, which lists files only, is read as freezing every evaluation test of those files by name.
2. With `freezeTests` set, the pre-edit hook denies an Edit or Write after which a frozen test's body differs from its body at the red commit, or the test is gone or renamed, with "frozen for <id>; amend the slice file to change the evaluation set"; it allows an edit to any other test, or any other line, of the same file. The pre-bash hook still denies a redirection, `tee`, `sed -i`, `cp`, `mv` or `rm` that writes a file holding a frozen test. Both scenarios of REQ-3.3 pass as written (REQ-3.3, REQ-3.2, D-102).
3. The `frozen` rule under `--ci` reports, per named test, `frozen test changed after red: <file> » <name>` when its body differs from the red commit or it is gone, unless `build amend` unfroze that test after red; a change to another test of the same file is no finding. Issue #71's case (the file hidden with `skip-worktree`) is still judged by the committed content (REQ-3.15, REQ-3.7).
4. `build amend <id> --test "<file> » <name>" --reason <r>` unfreezes that one test and records the reason; `build amend <id> --reason <r>` with no test commits any change to the slice file, with the reason in the state file, and leaves every frozen test frozen, whether or not a test is frozen. Naming a test already unfrozen records the second amendment and its reason and exits 0. The scenario of REQ-1.5 and the steps of issue #187 pass (REQ-1.5, D-102, issue #187).
5. While a slice is `tests-red` or `building`, the pre-edit hook allows the creation of a new file under the docs root that the slice file's Expected changes names, and still denies one it does not name. The runbook's build section and the build procedure say what an amendment records and that a test is frozen by name. `slicekit check` gives `0 findings` (REQ-3.3, D-102).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `testnames.test.js » a named test's body is found in a node:test file and a missing name is null` | happy | REQ-3.3 |
| `build-red-names.test.js » build red refuses an evaluation test whose name is not in its file` | negative | REQ-1.8 |
| `hooks/pre-edit.test.js » an edit to a test the evaluation set does not name is allowed in a frozen file` | happy | REQ-3.3 |
| `hooks/pre-edit.test.js » an edit that removes or renames a frozen test is denied` | negative | REQ-3.3 |
| `hooks/pre-edit.test.js » a new document that Expected changes names is allowed while building` | happy | REQ-3.3 |
| `hooks/pre-bash.test.js » a redirection into a file holding a frozen test is still denied` | negative | REQ-3.2 |
| `check/frozen.test.js » a changed frozen test is a finding naming the file and the test` | negative | REQ-3.15 |
| `check/frozen.test.js » a change to another test of the same file is no finding` | happy | REQ-3.15 |
| `build-amend.test.js » amend with no test records a slice-file change while tests stay frozen` | happy | REQ-1.5 |
| `build-amend.test.js » amend of a test already unfrozen records the second amendment` | happy | REQ-1.5 |

Amended (author's standing instruction, 2026-11-23): `test/build-amend.test.js`, whose existing test "build amend still refuses a frozen test it does not name" changes with Task 4: a test frozen by name is named as `<file> » <name>`.

## Expected changes

`src/testnames.js`, `src/state/index.js`, `src/state/transitions.js`, `src/build/red.js`, `src/build/commit.js`, `src/cli/build.js`, `src/hooks/pre-edit.js`, `src/hooks/paths.js`, `src/check/rules/frozen.js`, `templates/instructions/commands/build.md`, `docs/runbook.md`, tests.

## Tasks

### Task 1: A test by its name

**Files:** Create `src/testnames.js`, `test/testnames.test.js`.

- [ ] **Step 1: Failing test** — `testnames.test.js`: a `test('<name>', …)` or `it('<name>', …)` call at any depth, single, double or backtick quotes with no substitution, and its body to the matching close; a name given twice in one file is an error naming both lines.
- [ ] **Step 2: Run** `node --test test/testnames.test.js` → FAIL.
- [ ] **Step 3: Implement** with `node:` modules only (D-04). A file the reader cannot parse is an error, which every caller treats as "cannot judge".
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat: find a named test in a test file`.

### Task 2: Red and the state file record names

**Files:** Create `test/build-red-names.test.js`. Modify `src/build/red.js`, `src/state/index.js`, `src/state/transitions.js`, `test/state.test.js`.

- [ ] **Step 1: Failing test** — `build-red-names.test.js`, and a state test that a file-only state file reads as every evaluation test of its files.
- [ ] **Step 2: Run** `node --test test/build-red-names.test.js test/state.test.js` → FAIL.
- [ ] **Step 3: Implement** `frozenTests` and `unfrozen` entries as `{file, name}`, with the reader for the old form.
- [ ] **Step 4: Run** the same and `node --test test/build.test.js test/commands/build.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(state): frozen tests are recorded by name`.

### Task 3: The hooks and the frozen rule compare named tests

**Files:** Modify `src/hooks/pre-edit.js`, `src/hooks/paths.js`, `src/check/rules/frozen.js`, `test/hooks/pre-edit.test.js`, `test/hooks/pre-bash.test.js`, `test/check/frozen.test.js`.

- [ ] **Step 1: Failing tests** — the `test/hooks/pre-edit.test.js`, `test/hooks/pre-bash.test.js` and `test/check/frozen.test.js` tests above.
- [ ] **Step 2: Run** `node --test test/hooks/ test/check/frozen.test.js test/check/frozen-ci.test.js` → FAIL.
- [ ] **Step 3: Implement** in `judge`: apply the edit to the file's text, then compare each frozen test's body with the red commit's; in `frozenTests` of `src/hooks/paths.js`, the files that hold a frozen test, for pre-bash; in the `frozen` rule, the body comparison per name. The new-document exception reads the slice file's `expectedChanges`.
- [ ] **Step 4: Run** the same → PASS; every hook test that passed before passes unchanged.
- [ ] **Step 5: Commit** `feat(hooks): freeze a test by its name`.

### Task 4: Amendments

**Files:** Modify `src/build/commit.js`, `src/cli/build.js`, `templates/instructions/commands/build.md`, `docs/runbook.md`, `test/build-amend.test.js`.

- [ ] **Step 1: Failing tests** — the two `build-amend.test.js` tests above. The existing test `build amend still refuses a frozen test it does not name` changes with D-102: amend with no test now commits the slice file while tests stay frozen.
- [ ] **Step 2: Run** `node --test test/build-amend.test.js` → FAIL.
- [ ] **Step 3: Implement** `amend` for a test named `<file> » <name>`, the second amendment of one test, and the slice-file-only amendment with tests still frozen; the build procedure's step 4 and the runbook say what each records.
- [ ] **Step 4: Run** the same, `node --test test/commands/review-loop-1.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `fix(build): amend records any slice-file change (closes #187)`.

## Notes

The guide pages `docs/guide/commands/build.md`, `docs/guide/slash/build.md`, `docs/guide/commands/hook.md` and `docs/guide/rules/frozen.md` change in P8/S-61, not here: S-58 writes the web page in this Order step (see P8.md, Order).
