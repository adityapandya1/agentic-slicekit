---
slice: P1/S-06
name: Hooks: session start, bash and edit guards, git hooks
repo: .
group: C
runbook: no
requirements: [REQ-3.1, REQ-3.2, REQ-3.3, REQ-3.9, REQ-1.9, REQ-2.1, REQ-1.2]
decisions: [D-10, D-19]
---

## Done when

1. `echo '<json>' | slicekit hook pre-bash` denies a commit on `main`, a push to `main`, a force push, a commit touching `docs/intake/*`, a destructive command from config, and `git commit`/`git push`/`gh pr` while a subagent marker is active; allows everything else; denies with "could not read hook input" on bad stdin.
2. `slicekit hook pre-edit` denies an edit to a frozen test of the active slice (branch-derived), a new file under the docs root while the slice is `tests-red` or `building` (except the runbook), and any edit to `.slicekit/{journal.log,baselines,state}`.
3. `slicekit hook session-start` prints divergence and the active slice, re-injects the brief on `compact`, and exits 0 with no network.
4. `init` installs `.githooks/prepare-commit-msg` and `pre-commit`; a commit on `slice/P1-S-06-x` gains `Slice: P1/S-06`; `check` gains the `hooks` and `trailer` rules.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `hooks/pre-bash.test.js » denies commit on protected branch` | negative | REQ-3.2 |
| `hooks/pre-bash.test.js » denies force push and push to main` | negative | REQ-3.2 |
| `hooks/pre-bash.test.js » denies intake modification` | negative | REQ-1.2 |
| `hooks/pre-bash.test.js » denies destructive pattern from config` | negative | REQ-3.2 |
| `hooks/pre-bash.test.js » denies git from a subagent` | negative | REQ-2.1 |
| `hooks/pre-bash.test.js » allows an ordinary command` | happy | REQ-3.2 |
| `hooks/pre-edit.test.js » backslash path matches frozen file` | negative | REQ-3.3 |
| `hooks/pre-edit.test.js » new doc during build is denied, runbook allowed` | negative | REQ-3.3 |
| `hooks/pre-edit.test.js » kit-owned files are denied` | negative | REQ-3.3 |
| `hooks/session-start.test.js » prints divergence and slice; exits 0 offline` | happy | REQ-3.1 |
| `hooks/session-start.test.js » compact re-injects the brief` | happy | REQ-3.1 |
| `hooks/protocol.test.js » each hook with empty stdin` | negative | REQ-3.2 |
| `githooks.test.js » prepare-commit-msg adds the trailer once` | happy | REQ-1.9 |
| `check/hooks.test.js » hooksPath unset is a finding` | negative | REQ-3.9 |
| `check/trailer.test.js » commit without trailer on a slice branch is a finding` | negative | REQ-1.9 |
| `check/trailer.test.js » no commits is not a finding` | happy | REQ-1.9 |

## Expected changes

`src/hooks/{io,session-start,pre-bash,pre-edit}.js`, `src/cli/hook.js`, `src/check/rules/{hooks,trailer}.js`, `templates/githooks/`, `src/init.js` (install hooks), tests.

## Tasks

### Task 1: Hook I/O and dispatch

**Files:** Create `src/hooks/io.js`, `src/cli/hook.js`, `test/hooks/protocol.test.js`.

**Interfaces:**
- `readHookInput(stdin: string) → object` throws `HookInputError` on empty or invalid JSON.
- `deny(reason) → {hookSpecificOutput:{hookEventName:'PreToolUse', permissionDecision:'deny', permissionDecisionReason: reason}}`; `allow() → {}`; `context(event, text) → {hookSpecificOutput:{hookEventName: event, additionalContext: text}}`; `block(reason) → {decision:'block', reason}`.
- `runHook(name, {stdin, root, env}) → {stdout: object, code: number}`; `FAIL_OPEN = new Set(['session-start','subagent-start','pre-compact','session-end'])`; an exception inside a fail-open hook → `{stdout: {}, code: 0}` with the message on stderr; inside a fail-closed hook → `deny`/`block` with `"slicekit hook <name> failed: <message>"`.
- CLI `slicekit hook <name>` reads all of stdin, prints JSON, exits with `code`.
- Each hook module exports `handle(input, {root, cfg, env, git}) → object`.

- [ ] **Step 1: Failing test** — `each hook with empty stdin`: for every name in C-3's table, empty stdin → fail-open names exit 0 with `{}`; `pre-bash`/`pre-edit` return deny containing `could not read hook input`; `stop`/`subagent-stop` return block with the same text (stubs for S-07 names may return the generic failure until S-07 lands).
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(hooks): protocol, dispatch, fail modes`.

### Task 2: `pre-bash`

**Files:** Create `src/hooks/pre-bash.js`, `src/hooks/subagent-marker.js`, `test/hooks/pre-bash.test.js`.

**Interfaces:**
- Input: Claude Code PreToolUse JSON `{session_id, tool_name:'Bash', tool_input:{command}, cwd}`.
- `classifyGit(command) → {kind:'commit'|'push'|'force-push'|'pr'|'other', branchArg?}` by tokenising on `&&`, `;`, `|` and checking each segment: `git commit`, `git push [remote] [branch]` with `-f`/`--force`/`--force-with-lease`, `gh pr`.
- Rules in order, first deny wins: (1) commit while `currentBranch(root) ∈ cfg.protectedBranches` → `commit on protected branch <b>; create a slice branch`; (2) push whose target branch (explicit arg, or current branch when absent) is protected → `push to protected branch <b>`; (3) force push anywhere → `force push refused`; (4) commit while `git diff --cached --name-only` or the command's `git add` targets include a path under `<docsRoot>/intake/` that already exists in HEAD → `intake snapshot <file> is frozen; add a new snapshot`; (5) `subagentActive(root, session_id)` and kind ∈ {commit, push, force-push, pr} → `agents do not run git; report and let the command commit`; (6) any `cfg.destructive` regex matches → `destructive command refused by rule <pattern>`.
- `subagent-marker.js`: `markerPath(root, sessionId)`, `enter(root, sessionId)` (count +1), `leave(root, sessionId)` (count −1, delete at 0), `subagentActive(root, sessionId) → boolean`; file `.slicekit/.subagent-<sessionId>` holding the count.

- [ ] **Step 1: Failing tests** — the six `pre-bash.test.js` cases (use `makeRepo` on `main`, and on `slice/P1-S-06-x` for the allow case).
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(hooks): pre-bash guard`.

### Task 3: `pre-edit`

**Files:** Create `src/hooks/pre-edit.js`, `test/hooks/pre-edit.test.js`.

**Interfaces:**
- Input `{session_id, tool_name:'Edit'|'Write'|'MultiEdit', tool_input:{file_path}, cwd}`; `normalise(file_path, root) → POSIX relative path` (handles backslashes and absolute paths).
- Active slice: `sliceFromBranch(currentBranch(root))`; its state via `readSlice`.
- Denies: (1) path ∈ `state.frozenTests` and `cfg.freezeTests` and `state.state ∈ {tests-red, building}` and not `state.unfrozen?.includes(path)` → `frozen for <slice>; amend the slice file to change the evaluation set`; (2) `tool_name === 'Write'` and path under `<docsRoot>/` and the file does not exist and `state.state ∈ {tests-red, building}` and path is not the runbook and not under `<docsRoot>/phases/<P>/` → `no slice starts a document; a document changes only when this slice's code made it wrong`; (3) path is `.slicekit/journal.log` or under `.slicekit/baselines/` or `.slicekit/state/` → `<path> is written only by the slicekit CLI`.

- [ ] **Step 1: Failing tests** — the three `pre-edit.test.js` cases, with `backslash path matches frozen file` passing `C:\\repo\\test\\a.test.js` against frozen `test/a.test.js`.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(hooks): pre-edit guard`.

### Task 4: `session-start`

**Files:** Create `src/hooks/session-start.js`, `test/hooks/session-start.test.js`.

**Interfaces:**
- Input `{session_id, source:'startup'|'resume'|'clear'|'compact', cwd}`.
- Does `git fetch origin <defaultBranch>` with a 15 s timeout; on failure the first line is `slicekit: could not fetch origin (<reason>)`; else `slicekit: <branch> is <a> ahead / <b> behind origin/<default>`. Second line: `active slice: <id> (<state>)` or `no active slice`. On `compact` with an active slice, appends the handoff from the state file (`state.handoff`, S-07) and `Brief: run slicekit instructions developer <id>`. Returns `context('SessionStart', text)`.

- [ ] **Step 1: Failing tests** — the two cases (offline via a bogus `origin` URL; `compact` with a seeded `handoff`).
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(hooks): session-start`.

### Task 5: Git hooks, `hooks` and `trailer` rules

**Files:** Create `templates/githooks/prepare-commit-msg`, `templates/githooks/pre-commit`, `src/check/rules/hooks.js`, `src/check/rules/trailer.js`, `test/githooks.test.js`, `test/check/hooks.test.js`, `test/check/trailer.test.js`. Modify `src/init.js` to copy the two files with mode 0o755 and set `core.hooksPath` (S-01 deliberately left it unset). Guards: when `core.hooksPath` already holds a value other than `.githooks`, leave it alone and push a warning naming the value; when `.git/hooks/` holds any hook that is not a `.sample` file, warn that those hooks stop running once `core.hooksPath` is set.

**Interfaces:**
- `prepare-commit-msg` (POSIX sh, `#!/bin/sh`): reads branch, derives `P<n>/S-<nn>` from `slice/P<n>-S-<nn>-*`, appends `Slice: P<n>/S-<nn>` to the message file if no `Slice:` line exists; no-op on other branches and on merge/squash sources.
- `pre-commit`: refuses when branch is in `protectedBranches` read from `.slicekit/config.json` with a one-line `node -e` (falls back to `main` when node is absent), unless `ALLOW_PROTECTED_COMMIT=1`.
- `hooks` rule: `git config core.hooksPath` ≠ `.githooks` → `git hooks not installed; run slicekit init` (skipped when not a repo); either file missing or not executable → named finding. Non-ratchet, blocking.
- `trailer` rule: on a `slice/*` branch with commits beyond `origin/<default>` (or beyond the root when no origin), any commit whose trailers lack `Slice: <id matching branch>` → `commit <sha7> has no Slice trailer`. `hasCommits === false` → no findings. Non-ratchet, blocking.

- [ ] **Step 1: Failing tests** — `prepare-commit-msg adds the trailer once` (real commit in a temp repo, two commits, trailer present exactly once each); `hooksPath unset is a finding`; the two `trailer.test.js` cases.
- [ ] **Step 2–5:** FAIL → implement → run `init` again on the kit so its own hooks install → PASS → commit `feat(hooks): git hooks and the hooks/trailer rules`.
