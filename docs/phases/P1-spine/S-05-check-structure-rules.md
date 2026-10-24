---
slice: P1/S-05
name: Check: citations, coverage, queue, commands, layout, managed
repo: .
group: B
runbook: no
requirements: [REQ-3.7, REQ-1.3, REQ-1.4, REQ-1.5, REQ-1.6, REQ-1.1, REQ-3.12, REQ-2.5, REQ-1.10]
decisions: [D-11, D-14]
---

## Done when

1. `slicekit check` also runs `citations`, `coverage`, `queue`, `commands`, `layout` and `managed`; each has a passing and a failing fixture.
2. `citations` fails a REQ with an empty or missing `Cites:` line, a REQ citing an unknown D or intake file, a slice naming an unknown REQ or D, and an evaluation-set test naming no REQ.
3. `coverage` fails, from stage `plan` on, any REQ named by no slice file, and two slices in one parallel group whose expected changes overlap.
4. `commands` skips an empty command and fails one whose executable is not found.
5. The kit's own repo is still green.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `check/citations.test.js » REQ without Cites is a finding` | negative | REQ-1.3 |
| `check/citations.test.js » evaluation test without a REQ is a finding` | negative | REQ-1.5 |
| `check/citations.test.js » a well-cited spec and slice pass` | happy | REQ-1.3 |
| `check/coverage.test.js » uncovered REQ after plan is a finding` | negative | REQ-3.7 |
| `check/coverage.test.js » overlapping expected changes in one group is a finding` | negative | REQ-2.5 |
| `check/coverage.test.js » before plan, coverage is silent` | happy | REQ-3.7 |
| `check/queue.test.js » BUILD.md differing from state is a finding naming the slice` | negative | REQ-1.6 |
| `check/commands.test.js » empty command is skipped` | happy | REQ-3.7 |
| `check/commands.test.js » unknown executable is a finding` | negative | REQ-3.7 |
| `check/layout.test.js » missing path and shape-foreign file are findings` | negative | REQ-1.1, REQ-1.10 |
| `check/managed.test.js » edited managed block is a finding` | negative | REQ-3.12 |

## Expected changes

`src/check/rules/{citations,coverage,queue,commands,layout,managed}.js`, `src/which.js`, `src/hook-cli.js`, `src/render/update.js`, `src/slicefile.js`, `test/check/`, fixtures.

## Tasks

### Task 1: `citations`

**Files:** Create `src/check/rules/citations.js`, `test/check/citations.test.js`, fixtures.

**Interfaces:** For each `### REQ-` block (heading to next heading of level ≤ 3): a `Cites:` line must exist and name at least one `D-<n>` in `ctx.ids.decision` or an intake file that exists; an `Enforced by:` line must exist. For each slice file: every `requirements[]` in `ctx.ids.req`, every `decisions[]` in `ctx.ids.decision`, every evaluation row `covers` non-empty and known. Messages: `REQ-x.y has no Cites line`, `REQ-x.y cites unknown <id>`, `slice P1/S-03 names unknown <id>`, `slice P1/S-03 test "<name>" covers no requirement`. Also: a `D-<n>` or `REQ-<s>.<n>` defined twice → `duplicate id <id> (<file>:<line> and <file>:<line>)` (REQ-1.4). Non-ratchet, blocking.

- [ ] Steps: failing tests (three cases) → FAIL → implement → PASS → commit `feat(check): citations rule`.

### Task 2: `coverage`

**Files:** Create `src/check/rules/coverage.js`, `test/check/coverage.test.js`.

**Interfaces:** Runs only when `programStage(root, cfg).stage` is `plan` or later (import from `src/stage.js`, S-03). Findings: `REQ-x.y is named by no slice`; for each phase, for each group, any path prefix listed under `## Expected changes` by two slices → `slices P1/S-04 and P1/S-05 in group B both expect <path>` (prefix match on normalised POSIX paths; `.` and `test/` are ignored as shared roots). Non-ratchet, blocking.

- [ ] Steps: failing tests (three cases) → FAIL → implement → PASS → commit `feat(check): coverage and overlap rule`.

### Task 3: `queue`

**Files:** Create `src/check/rules/queue.js`, `test/check/queue.test.js`.

**Interfaces:** `renderBuild(root, cfg)` (S-03) compared to `BUILD.md` text after normalising trailing whitespace; a difference → one finding per differing table row: `BUILD.md row for P1/S-03 says "Todo", state says "PR #14"`; a non-row difference → `BUILD.md is stale; run slicekit status --write`. Skipped with a notice when `.slicekit/state/` is empty and no slice files exist. Non-ratchet, blocking.

- [ ] Steps: failing test → FAIL → implement → PASS → commit `feat(check): queue rule`.

### Task 4: `commands`

**Files:** Create `src/check/rules/commands.js`, `test/check/commands.test.js`.

**Interfaces:** For each of `test, lint, build, e2e` with a non-empty string: the first token resolved on `PATH` (and `node_modules/.bin`, `.`), via `process.platform === 'win32' ? where : which` semantics implemented with `fs.access` over `PATH` entries and `PATHEXT`; not found → `commands.<name>: "<token>" not found on PATH`. Never executes the command. Non-ratchet, blocking.

- [ ] Steps: failing tests (two cases) → FAIL → implement → PASS → commit `feat(check): commands rule`.

### Task 5: `layout` and `managed`

**Files:** Create `src/check/rules/layout.js`, `src/check/rules/managed.js`, tests.

**Interfaces:**
- `layout`: every path from `kitPaths` that P1 owns must exist (`kit, config, state, baselines, docs, intake, decisions, spec, contracts, platform, observability, runbook, build, claude, githooks`); every file under `.claude/` that is in the manifest for a shape other than `cfg.shape` and not for it → `<file> is not part of shape <shape>`. Non-ratchet, blocking.
- `managed`: `planUpdate(root, cfg, {version})` (S-02) entries with status `drifted` → `<file>: managed block edited; run slicekit update`; `missing` → `<file>: managed file missing; run slicekit update`. Non-ratchet, blocking.

- [ ] Steps: failing tests → FAIL → implement → run `check` on the kit and fix → PASS → commit `feat(check): layout and managed rules`.
