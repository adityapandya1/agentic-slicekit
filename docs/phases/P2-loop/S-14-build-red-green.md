---
slice: P2/S-14
name: `/slicekit build`, developer, red-then-green
repo: .
group: C
runbook: no
requirements: [REQ-2.6, REQ-2.10, REQ-1.8, REQ-1.9]
decisions: [D-10, D-19, D-22, D-35]
---

## Done when

1. `slicekit build next` names the first `todo` slice whose earlier Order steps and earlier phases are merged and which no worktree or pushed branch holds; `build start` creates `<root>/.worktrees/P<n>-S-<nn>` on `slice/P<n>-S-<nn>-<descr>` from the up-to-date default branch and pushes the branch at once, so another clone's `build next` skips it (REQ-2.6 step 1).
2. `build red` runs the test command, refuses a zero exit with "the evaluation set must fail before the build", commits the tests, and records `tests-red` with the SHA and the files, then `building` (step 3, D-10).
3. `build commit` commits the developer's work with the test run in its message and refuses a change to a frozen test; `build amend` records a slice-file amendment the human approved and unfreezes that one test (step 4).
4. `build pr` runs the test, lint and build commands and `slicekit check`, pushes, opens or updates the draft pull request with the REQ-2.10 body, and records `draft-pr` (step 5, REQ-1.8).
5. The `/slicekit build` procedure (steps 1 to 5) and the developer brief drive these on `examples/backend` from `todo` to `draft-pr` against the fixture host.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/build.test.js » the draft pull request body carries every section` | happy | REQ-2.10 |
| `commands/build.test.js » tests that pass before the build are refused` | negative | REQ-2.6 |
| `commands/build.test.js » next skips a slice whose group waits on an unmerged step` | negative | REQ-2.6 |
| `commands/build.test.js » a change to a frozen test is refused at commit` | negative | REQ-2.6 |
| `commands/build.test.js » a re-run after a failed open opens the pull request once` | negative | REQ-1.8 |
| `commands/build.test.js » absolute and backslash test paths are stored relative` | negative | REQ-1.8 |
| `commands/build.test.js » a docs root of . does not read the worktrees` | negative | REQ-2.6 |
| `commands/build.test.js » a slice started in one clone is skipped by next in another` | negative | REQ-2.6 |
| `commands/build.test.js » every commit on the slice branch carries the Slice trailer` | happy | REQ-1.9 |
| `commands/build.test.js » examples/backend goes from todo to draft-pr` | e2e | REQ-2.6 |
| `commands/build.test.js » the procedure and the developer brief pass the brief lint` | happy | REQ-2.6 |

## Expected changes

`src/build/{order,worktree,record,red,commit,pr}.js`, `src/cli/build.js`, `src/fs.js`, `src/init.js`, `.gitignore`, `templates/instructions/commands/build.md`, `templates/instructions/agents/developer.md`, `examples/backend/`, tests.

## Tasks

### Task 1: `build next`, `build start`, and finding the worktree

**Files:** Create `src/build/order.js`, `src/build/worktree.js`, `src/cli/build.js`, `test/commands/build.test.js`. Modify `src/fs.js`, `src/init.js`, `.gitignore`, `src/cli/index.js`.

**Interfaces:**
- Consumes (S-09): `parseOrder` from `src/slicefile.js`; `hasRemote`, `switchBranch` from `src/git.js`. From Phase 1: `listSlices`, `findSliceFiles`.
- `class BuildError extends Error` with `code` 1 or 2 (in `src/build/worktree.js`, used by every `src/build/` module). <!-- slicekit:pending P2/S-14 -->
- `runnable(root, cfg) → [{id, phase, group, file}]` in phase and slice order: state `todo` on the default branch's state files; no worktree holds it; no `refs/remotes/origin/slice/P<n>-S-<nn>-*` exists after a fetch; every slice of an earlier phase, and every slice of an earlier Order step of its own phase, is `merged` or `released`. `waiting(root, cfg) → string[]` gives one `<id> waits on <other> (<state>)` per blocked `todo` slice.
- `findWorktree(root, id, {worktree} = {}) → {path, branch}` from `git worktree list --porcelain`, matching branches `slice/P<n>-S-<nn>-*`: none → code 1 `no worktree holds <id>; run slicekit build start <id>`; two or more without `--worktree` → code 2 `two worktrees hold <id>: <a>, <b>; pass --worktree`.
- `startSlice(root, cfg, id, {descr} = {}) → {worktree, branch}`: `id` must be in `runnable` (else code 1 with its `waiting` line); `descr` defaults to the slice file name's part after `S-<nn>-`; fetches `origin <defaultBranch>` when `origin` exists; `git worktree add -b slice/P<n>-S-<nn>-<descr> <root>/.worktrees/P<n>-S-<nn> <origin/default or default>`; an existing worktree or branch → code 1 `<id> is already started in <path>`. In the new worktree it then makes one empty claim commit `chore(slicekit): <id> started` with `Slice: <id>`, so a second push of the same branch name is not a fast-forward. With `origin`, it pushes with `pushBranch(<worktree>, {protectedBranches, defaultBranch})`, then lists origin's `slice/P<n>-S-<nn>-*` branches: when another one exists, it deletes the branch it just pushed, removes the worktree and the local branch, and exits 1 with `<id> was claimed by <other> while starting`. A rejected push is taken back the same way. Without `origin`, it prints `slicekit: no origin; other clones will not see <branch>` to stderr.
- `runnable` and `startSlice` first require the main worktree on `defaultBranch` (else code 1 `build next and build start read slice states from the checkout they run in; run them in the main checkout on <default> (this one is on <branch or a detached HEAD>)`) and, with `origin`, after the fetch, `HEAD` equal to `refs/remotes/origin/<default>` (else code 1 `<default> is behind origin; pull first` or `<default> has commits origin does not; push or reset first`).
- `listFiles` ignores `.worktrees` by default, beside `node_modules` and `.git`. `src/init.js` adds the `.worktrees` directory to `IGNORE_RULES`, and the kit's own `.gitignore` gains the line.
- CLI `build next` prints the ID, or exits 1 with `no slice is ready to build` and the `waiting` lines; `build start <id> [--descr <d>]` prints the worktree path, then the branch. `subcommands = ['next','start','red','commit','amend','pr']` (each lands in its task; S-15 and S-16 add theirs).

- [ ] **Step 1: Failing tests** — `next skips a slice whose group waits on an unmerged step`: a phase with `**Order:** A; B`, S-01 in A at `draft-pr` and S-02 in B at `todo` → exit 1, stdout `no slice is ready to build`, a line `P1/S-02 waits on P1/S-01 (draft-pr)`; with S-01 `merged` → `P1/S-02`; after `build start P1/S-02` → `next` no longer names it. `a docs root of . does not read the worktrees`: a repo with `docsRoot: "."` and a started slice → `check` in the main checkout reports no duplicate slice ID and the same style counts as before the start, and `git status --porcelain` in the main checkout is empty after an `init` and a `build start`. `a slice started in one clone is skipped by next in another`: clones A and B of one bare `origin`; `build start P1/S-01` in A; `build next` in B does not print `P1/S-01`.
- [ ] **Step 2: Run** `node --test test/commands/build.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(build): next, start and the slice worktree`.

### Task 2: Recording state, and `build red`

**Files:** Create `src/build/record.js`, `src/build/red.js`. Modify `src/cli/build.js`, `test/commands/build.test.js`.

**Interfaces:**
- Consumes (S-09): `commitPaths`. From Phase 1: `setState`, `renderBuild`, `loadConfig`.
- `commitBookkeeping(wt, id, what, paths) → sha | null`: commits only `paths` as `chore(slicekit): <id> <what>` with a final `Slice: <id>` line.
- `recordState(wt, cfg, id, to, evidence) → state`: `setState(wt, cfg, id, to, evidence)`, rewrites `BUILD.md` with `renderBuild`, then `commitBookkeeping(wt, id, to, [<state file>, 'BUILD.md'])`. A `TransitionError` passes through unchanged. Every later step records through this.
- `runCommand(wt, command) → {exit, summary, output}` (shell, cwd `wt`; `summary` is the last non-empty output line), in `src/build/red.js` and reused by Tasks 3 and 4. <!-- slicekit:pending P2/S-14 -->
- `red(root, cfg, id, {tests, worktree}) → {commit, tests}`. The slice's state must be `todo` (code 1 `<id> is <state>; red runs from todo`); `commands.test` must be declared (code 1 `commands.test is not declared in .slicekit/config.json`). Each path in `tests` (comma list, absolute or relative, either slash) resolves against the worktree, must lie inside it (code 2 `<p> is outside the worktree`) and exist, and is stored as a POSIX path relative to it. Each evaluation row `<file> » <name>` must match a test path ending in `<file>` whose text holds `<name>` (code 1 `evaluation test "<row>" is not in the test files`). A test run exiting 0 → code 1 `the evaluation set must fail before the build` with the summary. Then it commits the test files as `test(<id>): evaluation set` with `ran: <test command> → exit <n>` and `Slice: <id>`, records `tests-red` with `{commit, testExit, tests}`, and records `building`.
- CLI `build red <id> --tests <a,b> [--worktree <p>]` prints the red commit's SHA, then `tests-red → building`.

- [ ] **Step 1: Failing tests** — `tests that pass before the build are refused`: a started slice whose test file passes → exit 1 with `the evaluation set must fail before the build`, the state stays `todo`, and the branch has no new commit. `absolute and backslash test paths are stored relative`: `--tests` given as the absolute path of the worktree's `test/a.test.js` with backslashes → the state's `frozenTests` is `['test/a.test.js']`; a path outside the worktree exits 2. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/commands/build.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(build): red: failing tests first, then frozen`.

### Task 3: `build commit` and `build amend`

**Files:** Create `src/build/commit.js`. Modify `src/cli/build.js`, `test/commands/build.test.js`.

**Interfaces:**
- Consumes: `recordState`, `commitBookkeeping`, `runCommand` (Task 2); `unfreeze` (Phase 1).
- `commitWork(root, cfg, id, {message, requireGreen = false, worktree}) → {sha, exit}`: state must be `building`; a frozen test not in `unfrozen` that differs from the red commit, committed or not → code 1 `frozen test <p> changed since <sha7>; amend the slice file to change the evaluation set`; runs the test command; with `requireGreen` a non-zero exit → code 1 `tests fail (exit <n>): <summary>` and no commit; else stages everything and commits `<message>` with `ran: <test command> → exit <n>` and `Slice: <id>`; nothing to commit → `sha: null`.
- `amend(root, cfg, id, {test, reason, worktree}) → {sha}`: the slice file must have an uncommitted change (code 1 `amend the slice file first; it has no change`); commits it as `docs(<id>): amend evaluation set` with `<reason>` and `Slice: <id>`; `unfreeze`s `test` (a test that is not frozen → code 1, the `TransitionError` reason); commits the state file with `commitBookkeeping(wt, id, 'unfreeze <test>', …)`.
- CLI `build commit <id> --message <m> [--require-green] [--worktree <p>]` prints `<sha7> exit <n>` or `nothing to commit`; `build amend <id> --test <path> --reason <r> [--worktree <p>]` prints `unfroze <path>`.

- [ ] **Step 1: Failing tests** — `a change to a frozen test is refused at commit`: after `red`, editing the frozen test through the file system (as a Bash write would) → `build commit` exits 1 naming the test and makes no commit; after an edit to the slice file and `build amend --test <it> --reason r`, the same commit succeeds. `every commit on the slice branch carries the Slice trailer`: every commit from the worktree's branch point to its head has a `Slice: <id>` trailer as `parseTrailers` reads it.
- [ ] **Step 2: Run** `node --test test/commands/build.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(build): commit green work, amend a frozen test with the human`.

### Task 4: `build pr`

**Files:** Create `src/build/pr.js`. Modify `src/cli/build.js`, `test/commands/build.test.js`.

**Interfaces:**
- Consumes (S-09): `openOrUpdate`, `pushBranch`, `renderPrBody`, `getSection`, `setSection`; `getHost`, `check` (Phase 1); `recordState`, `runCommand`.
- `openSlicePr(root, cfg, host, id, {notes, worktree}) → {number, url, created}`. The state must be `building`, `draft-pr`, `in-review`, `changes-requested`, `ci-green` or `ready`. At `draft-pr` (a push before any verdict) it pushes with `pushBranch(wt, {protectedBranches: cfg.protectedBranches, defaultBranch: cfg.defaultBranch})` and updates the pull request body and records nothing: the state has no `draft-pr → draft-pr` move, and the reviewer reads the live head. `notes` is a JSON file `{tryIt: [three strings], skipped, decisions?: string[], runbook?, infra?}`; without exactly three `tryIt` steps or a `skipped` → code 2 `notes need tryIt (three steps) and skipped`. When the slice's runbook flag is set, the branch leaves `<docsRoot>/runbook.md` unchanged and `notes.runbook` does not begin `no operational change` → code 1 `the slice touches operations; change the runbook or give notes.runbook "no operational change: <reason>"`. The test, lint and build commands that are declared each run in the worktree; a non-zero exit → code 1 `<name> failed (exit <n>): <summary>`; then `check(wt)` with findings → code 1 with the first ten. Nothing is pushed on a refusal.
- The body is `renderPrBody` with: Done when, the slice's checks numbered on one line; Proof, `` `<test command>` → <summary> · CI: pending `` (S-15 replaces `pending` with the run link); Decisions, `notes.decisions` joined by `; `, or `none`; Runbook, `changed: <docsRoot>/runbook.md` when the branch changed it, else `notes.runbook`, else (flag off) `no operational change: the slice touches no configuration, infrastructure, migration, alert, queue or integration`; Infra / migration, `notes.infra` or `none`; Try it, `1. … 2. … 3. …`; Reviewer blocked, `nothing`; Should-haves declined, `none`; Skipped / not checked, `notes.skipped`. When the slice already has a pull request, the live body's Reviewer blocked and Should-haves declined text is kept.
- Then `openOrUpdate` with title `[<id>] <slice name>`, records `draft-pr` with `{testExit: 0, checkExit: 0, pr: {number, url, headSha: <the pushed head>, title}}`, and pushes again with `pushBranch(wt, {protectedBranches: cfg.protectedBranches, defaultBranch: cfg.defaultBranch})` so the bookkeeping commit reaches the pull request. A slice already at `draft-pr` on the same pushed head records nothing and prints the pull request.
- CLI `build pr <id> --notes <file> [--worktree <p>]` prints `#<n> <url>`.

- [ ] **Step 1: Failing tests** — `the draft pull request body carries every section`: a green slice → exit 0, the fixture's `pr-1.json` has `isDraft: true`, title `[P1/S-01] <name>`, a body for which `prBodyProblems` is `[]`, and the state is `draft-pr` with `pr.number` 1. `a re-run after a failed open opens the pull request once`: with `pr-create-error.txt` present `build pr` exits 1 after the push and the state stays `building`; with it removed, the re-run exits 0, `pr-calls.jsonl` holds one `openPullRequest`, and the state history has one `draft-pr` entry.
- [ ] **Step 2: Run** `node --test test/commands/build.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(build): pr: commands, check, push, the draft pull request`.

### Task 5: The procedure, the developer brief, and `examples/backend`

**Files:** Create `templates/instructions/commands/build.md`, `examples/backend/` (`package.json` with `"type": "module"` and a `test` script, `.slicekit/config.json` with shape `backend` and `commands.test` `node --test`, `docs/spec/01-greeting.md` defining REQ-1.1, `docs/decisions.md`, `docs/phases/P1-greeting/P1.md`, `docs/phases/P1-greeting/S-01-greet.md` with one happy and one negative evaluation row, `src/.keep`, `README.md` saying to run `slicekit init` first). Modify `templates/instructions/agents/developer.md`, `test/commands/build.test.js`.

**Interfaces:**
- Consumes (S-09): `briefProblems`; `{{cli}} instructions developer`.
- Procedure steps 1 to 5, each naming its subcommand: (1) with no slice in `{{args}}`, `{{cli}} build next`; then `{{cli}} build start <id>`; (2) `{{cli}} instructions developer <id> --worktree <path>`, and spawn the developer with that output alone (it holds the worktree path), and the order to write only the evaluation set's tests under that path and report their paths on a line `tests: <a>, <b>`; (3) `{{cli}} build red <id> --tests <paths>`; on a refusal, send the developer back with the printed message; (4) spawn the developer again to make the tests pass; after each report naming a newly passing test, `{{cli}} build commit <id> --message "<subject>"`; when the developer asks to change a frozen test, ask the human; on yes edit the slice file's evaluation set and run `{{cli}} build amend <id> --test <path> --reason "<why>"`; (5) `{{cli}} build commit <id> --message "<subject>" --require-green`, write the notes file from the developer's report (three Try-it steps, what was skipped and not checked, decisions, runbook, infrastructure), and `{{cli}} build pr <id> --notes <file>`. Steps 6 to 9 are S-15's.
- The developer brief gains `## Tests first` and `## Then code`: write exactly the evaluation set's tests and nothing else, then make them pass; work only under the worktree path the command gives, with absolute paths; report each command as `ran: <command> → exit <code>`; never change a frozen test, ask with a line `amend: <test path> — <why>`; name any file outside the slice's expected changes and why; write no document.
- `examples/backend` is the smallest project a slice can be built in: one REQ, one slice, an empty `src/`. Its docs follow the kit's layout, so `slicekit init --shape backend` adds the rest without overwriting them.

- [ ] **Step 1: Failing tests** — `examples/backend goes from todo to draft-pr`: copy `examples/backend` into a temp repo with `makeRemote`, run `init --shape backend`, commit on `main`, push; then `build start P1/S-01`; write the slice's failing test (standing in for the developer) and `build red`; write the code and `build commit --require-green`; write the notes and `build pr` with `SLICEKIT_GITHOST_FIXTURE` → the state is `draft-pr`, the fixture holds one draft pull request, and `check` in the worktree prints `0 findings`. `the procedure and the developer brief pass the brief lint`: `briefProblems` is `[]` for both, the procedure names `build next`, `build start`, `build red`, `build commit`, `build amend`, `build pr`, and the brief holds `ran: <command> → exit <code>` and `amend:`.
- [ ] **Step 2: Run** `node --test test/commands/build.test.js` → FAIL.
- [ ] **Step 3: Write** the procedure, the brief sections and the example.
- [ ] **Step 4: Run** the same, `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(build): the build procedure, steps 1 to 5, on examples/backend`.
