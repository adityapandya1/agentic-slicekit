---
slice: P1/S-07
name: Hooks: subagent shape, compaction handoff, journal
repo: .
group: C
runbook: no
requirements: [REQ-3.4, REQ-3.5, REQ-3.6, REQ-3.7, REQ-3.8, REQ-2.11, REQ-2.12]
decisions: [D-19]
---

## Done when

1. `slicekit hook subagent-start` sets the marker and injects the role brief, the writing rules and the no-git sentence; `subagent-stop` clears the marker and blocks once, with the missing parts named, when the agent's output lacks its required shape.
2. `slicekit hook pre-compact` writes a handoff into the active slice's state file; `session-start` on `compact` prints it (S-06).
3. `slicekit hook session-end` appends a hash-chained line to the current branch's `.slicekit/journal/<branch>.log`; `slicekit journal verify` and the `journal` check rule fail on a hand-edited line and never repair it.
4. `slicekit hook stop` runs `check` and blocks with the first ten findings when it fails.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `hooks/subagent-start.test.js » sets marker and injects brief and no-git rule` | happy | REQ-3.4 |
| `hooks/subagent-stop.test.js » reviewer without verdict file blocks naming it` | negative | REQ-3.5 |
| `hooks/subagent-stop.test.js » verdict finding without how-verified blocks` | negative | REQ-2.11 |
| `hooks/subagent-stop.test.js » developer without Skipped/Not checked blocks once, then passes` | negative | REQ-2.12 |
| `hooks/subagent-stop.test.js » well-formed output clears the marker and allows` | happy | REQ-3.5 |
| `hooks/pre-compact.test.js » writes handoff with stage, findings, last command, next step` | happy | REQ-3.6 |
| `journal.test.js » append builds a chain from genesis` | happy | REQ-3.8 |
| `journal.test.js » an edited line breaks the chain at its number` | negative | REQ-3.8 |
| `journal.test.js » verify never rewrites the file` | negative | REQ-3.8 |
| `hooks/stop.test.js » blocks when check fails, allows when green` | happy | REQ-3.7 |
| `hooks/protocol.test.js » each hook with empty stdin` | negative | REQ-3.5 |

## Expected changes

`src/hooks/{subagent-start,subagent-stop,pre-compact,stop,session-end}.js`, `src/journal.js`, `src/cli/journal.js`, `src/check/rules/journal.js`, `src/verdict.js`, tests.

## Tasks

### Task 1: Verdict file parser

**Files:** Create `src/verdict.js`, `test/verdict.test.js`, fixture `test/fixtures/verdicts/good.md`, `missing-verified.md`.

**Interfaces:** `parseVerdict(text, path) → {verdict:'BLOCK'|'CHANGES'|'APPROVE', findings:[{id, kind:'blocker'|'should-have', file, line, wrong, why, verified}], checklists: string[], notChecked: string[], independent: boolean}`; `verdictProblems(v) → string[]` (`no verdict line`, `finding B-2 has no "how verified"`, `no "Not checked" section`, `no checklists listed`). Verdict file layout: first line `Verdict: BLOCK`; a table with columns `ID | File:line | What is wrong | Why it matters | How verified`; `## Checklists run` list; `## Not checked` list; optional `Independent: yes` line.

- [ ] Steps: failing tests (`parses good`, `names missing how-verified`) → FAIL → implement → PASS → commit `feat(verdict): parser and shape problems`.

### Task 2: `subagent-start` and `subagent-stop`

**Files:** Create `src/hooks/subagent-start.js`, `src/hooks/subagent-stop.js`, `src/hooks/shapes.js`, tests.

**Interfaces:**
- SubagentStart input `{session_id, agent_type?, agent_id?}`; `enter(root, session_id)`; role = `agent_type` mapped onto `developer|reviewer|fixer|auditor|ops|designer` (unknown → `other`, no shape check); returns `context('SubagentStart', brief)` where brief = `slicekit instructions <role>` text if that command exists (S-09) else the P1 placeholder `Brief: role <role>.`, then the writing rules from `templates/claude-code/skills/slicekit-writing/SKILL.md`, then `You never run git; report and the command commits.`
- SubagentStop input `{session_id, agent_type?, last_assistant_message?, transcript_path?}`; `leave(root, session_id)`; `shapeProblems(role, text, {root}) → string[]` in `shapes.js`: every role → text must contain lines starting `Skipped:` and `Not checked:`; `reviewer` → the newest file in `.slicekit/reviews/` modified in the last 30 minutes must exist and `verdictProblems` be empty; `developer` → at least one line matching `^ran: .+ → exit \d+` ; `fixer` → at least one `B-<n>` or `H-<n>` named. Retry state `.slicekit/.retry-<session_id>-<agent_id>`: first failure → `block("output shape: " + problems.join('; ') + ". Add the missing parts and finish.")`; second failure → `block("stopping: shape still wrong after retry: …")` and the marker is still cleared.

- [ ] Steps: failing tests (five cases from the evaluation set) → FAIL → implement → PASS → commit `feat(hooks): subagent start and stop`.

### Task 3: `pre-compact`

**Files:** Create `src/hooks/pre-compact.js`, `test/hooks/pre-compact.test.js`.

**Interfaces:** Input `{session_id, trigger:'manual'|'auto', transcript_path?}`. With an active slice: `handoff = {at, state, openFindings: [ids from the latest verdict with blockers], lastCommand: <last 'ran:' line found in the tail of the transcript file if readable, else null>, nextStep: <by state: tests-red → 'build until the frozen tests pass', building → 'run the test command; when green run slicekit check and push', draft-pr/in-review → 'address verdict <path>', changes-requested → 'fix blockers <ids>', else 'run slicekit status'>}` written via `writeSlice`. No active slice → `{}`.

- [ ] Steps: failing test → FAIL → implement → PASS → commit `feat(hooks): pre-compact handoff`.

### Task 4: Journal

**Files:** Create `src/journal.js`, `src/cli/journal.js`, `src/check/rules/journal.js`, `src/hooks/session-end.js`, `test/journal.test.js`.

**Interfaces:**
- Line format: `<iso> actor=<a> slice=<id|-> stage=<s> commits=<sha7,…|-> verdicts=<ids|-> decisions=<ids|-> prev=<hash|genesis> hash=<sha256>`; `hashLine(lineWithoutHashField) → hex`; the hashed text is the line up to and including `prev=<…>`.
- `appendJournal(root, {actor, slice, stage, commits, verdicts, decisions}) → line`; `verifyJournal(root) → {ok, lines, brokenAt: number | null}` (recomputes every hash and every `prev` link); `readLast(root) → parsed | null`.
- CLI `slicekit journal verify` exits 1 with `journal chain broken at line <n>`; `slicekit journal show [-n 10]`.
- `journal` rule: `verifyJournal(root).ok === false` → that message. Non-ratchet, blocking.
- `session-end` hook: input `{session_id, reason}`; actor = `env.SLICEKIT_ACTOR || env.USER || env.USERNAME || 'unknown'`; slice = active slice; stage = program stage; commits = `commitsOnBranch` shas since the last journal line's time for that branch (empty when not a repo); verdicts and decisions = IDs of files or rows changed since that time; append; fail-open.

- [ ] Steps: failing tests (three journal cases) → FAIL → implement → PASS → commit `feat(journal): hash-chained session journal`.

### Task 5: `stop`

**Files:** Create `src/hooks/stop.js`, `test/hooks/stop.test.js`.

**Interfaces:** Input `{session_id, stop_hook_active}`; if `stop_hook_active` is true → `allow()` (never loop); else `check(root, {})`; `exitCode === 0` → `allow()`; else `block("slicekit check failed:\n" + first ten finding lines + (more ? "\n…and <n> more" : "") + "\nFix them; do not raise a baseline.")`. Fail-closed.

- [ ] Steps: failing test → FAIL → implement → PASS → commit `feat(hooks): stop runs the gate`.
