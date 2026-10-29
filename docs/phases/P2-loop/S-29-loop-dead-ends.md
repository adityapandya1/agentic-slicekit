---
slice: P2/S-29
name: The build loop's dead ends
repo: .
group: I
runbook: no
requirements: [REQ-1.8, REQ-2.6, REQ-2.8, REQ-2.11]
decisions: [D-43]
---

## Done when

1. A slice that changes the kit's version can land the re-render: `slicekit build render <id>` runs `update --yes` in the slice worktree and commits only the files `update` writes, as `chore(slicekit): <id> render`, and `build commit`'s check for kit files changed by hand accepts that commit when the files equal a fresh render; a render commit that holds any other file, or a rendered file that differs from a fresh render, is still refused.
2. `build amend` runs from `draft-pr`, `in-review` and `changes-requested` as well as `building`, so a should-have or blocker that sits inside a frozen test can be fixed during review; the amendment is recorded as before, and the slice returns to `building`.
3. `build pr` at `draft-pr` records the new head when the worktree's head has moved since the recorded one (a merge of the default branch, or any commit), in a bookkeeping commit, so `build verdict` accepts the next verdict; a head with nothing new is still recorded as before.
4. `build verdict` refuses a verdict whose text would fail the `references` rule (an unknown slice, requirement or decision ID, or a backticked path that does not exist in the worktree), naming each line, before it moves or commits the file; a reviewer brief says so.
5. `state set <id> merged --backfill` is accepted from any state when the git host reports the slice's pull request merged, with its merge time and head, and refused otherwise; deleting a state file is no longer the way to record a merge done outside `build finish`.
6. An untracked local file, .slicekit/local.json, may set `testCommand`; every build step that runs the test command locally (`build red`, `build commit --require-green`, `build pr`) uses it, and prints that it did; CI and `slicekit check` keep the committed command. On a machine with little memory, `{"testCommand": "node --test --test-concurrency=2 \"test/**/*.test.js\""}` runs the same suite with fewer files at a time. `init` adds that local file to the ignore rules it owns.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `build-render.test.js » build render commits a version's re-render and build commit accepts it` | happy | REQ-2.6 |
| `build-render.test.js » a render commit with another file in it is refused by build commit` | negative | REQ-2.6 |
| `build-amend.test.js » amend runs from in-review and returns the slice to building` | happy | REQ-1.8 |
| `build-amend.test.js » amend from ci-green or ready is refused` | negative | REQ-1.8 |
| `build-pr-head.test.js » build pr at draft-pr records a head moved by a merge of the default branch` | happy | REQ-2.6 |
| `verdict-references.test.js » a verdict naming an unknown slice or a missing path is refused, naming the line` | negative | REQ-2.11 |
| `verdict-references.test.js » a verdict with only known IDs and real paths is accepted` | happy | REQ-2.11 |
| `state-backfill.test.js » backfill merged from draft-pr is accepted when the host reports the pull request merged` | happy | REQ-1.8 |
| `state-backfill.test.js » backfill merged is refused when the host reports the pull request open` | negative | REQ-1.8 |
| `local-test-command.test.js » build steps run the local test command and say so; check keeps the committed one` | happy | REQ-2.6 |

## Expected changes

`src/build/`, `src/cli/build.js`, `src/cli/state.js`, `src/state.js`, `src/config.js`, `src/init.js`, `templates/instructions/agents/reviewer.md`, `templates/instructions/commands/build.md`, `test/`, tests.

## Tasks

### Task 1: Render and amend (Done when 1 and 2)

**Files:** `src/build/commit.js`, `src/build/render.js` (new), `src/build/amend.js`, `src/cli/build.js`, `templates/instructions/commands/build.md`, `test/build-render.test.js`, `test/build-amend.test.js`.

- [ ] **Step 1: Failing tests** for Done when 1 and 2.
- [ ] **Step 2: Implement** `build render` and the wider `build amend`; the build procedure says when to run `build render`.
- [ ] **Step 3: Commit** `feat(P2/S-29): build render, and amend during review`.

### Task 2: The head after a merge, and verdict references (Done when 3 and 4)

**Files:** `src/build/pr.js`, `src/build/verdict.js`, `templates/instructions/agents/reviewer.md`, `test/build-pr-head.test.js`, `test/verdict-references.test.js`.

- [ ] **Step 1: Failing tests** for Done when 3 and 4.
- [ ] **Step 2: Implement**; the reviewer brief says a verdict names only IDs and paths that exist.
- [ ] **Step 3: Commit** `feat(P2/S-29): build pr records a moved head; verdicts are reference-checked`.

### Task 3: Backfill from the host, and the local test command (Done when 5 and 6)

**Files:** `src/cli/state.js`, `src/state.js`, `src/config.js`, `src/init.js`, `src/build/`, `test/state-backfill.test.js`, `test/local-test-command.test.js`.

- [ ] **Step 1: Failing tests** for Done when 5 and 6.
- [ ] **Step 2: Implement**.
- [ ] **Step 3: Run** `npm test` (with the local command) and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 4: Commit** `feat(P2/S-29): backfill merged from the host, and a local test command`.
