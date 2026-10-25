---
slice: P2/S-13
name: `/slicekit plan`
repo: .
group: B
runbook: no
requirements: [REQ-2.5, REQ-1.5, REQ-1.6]
decisions: [D-10, D-22]
---

## Done when

1. `slicekit plan check` refuses, listing each one, while any `[NEEDS CLARIFICATION` marker is under the spec or the gap scan is not done ("gap scan not done" and the command that does it, REQ-1.7); otherwise it prints `ready to plan` (REQ-2.5).
2. The `coverage` rule also fails, from the plan stage on, a slice whose evaluation set lacks a `happy` or a `negative` test, and a phase whose `**Order:**` line misses, repeats or invents a group; slices in different groups of one Order step are checked for overlap like slices of one group, since they run at the same time; REQ-3.7's coverage row says so.
3. The `/slicekit plan` procedure writes `stack.md` when it says nothing yet, the phases with their Order lines and the slice files (REQ-1.5), regenerates `BUILD.md` (REQ-1.6), runs `check` to `0 findings`, and opens the `[plan] <program name>` pull request.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/plan.test.js » every requirement is named by a slice and BUILD.md is regenerated` | happy | REQ-2.5, REQ-1.6 |
| `commands/plan.test.js » refuses while a clarification marker or an open gap exists` | negative | REQ-2.5 |
| `check/coverage.test.js » a slice with no negative test is a finding` | negative | REQ-1.5 |
| `check/coverage.test.js » an Order line missing a group is a finding` | negative | REQ-2.5 |
| `check/coverage.test.js » slices in one Order step are checked for overlap` | negative | REQ-2.5 |
| `commands/plan.test.js » the procedure passes the brief lint` | happy | REQ-2.5 |

## Expected changes

`src/plan.js`, `src/cli/plan.js`, `src/check/rules/coverage.js`, `docs/spec/03-hooks-gates-ci.md`, `templates/instructions/commands/plan.md`, tests.

## Tasks

### Task 1: `plan check`

**Files:** Create `src/plan.js`, `src/cli/plan.js`, `test/commands/plan.test.js`. Modify `src/cli/index.js`.

**Interfaces:**
- Consumes: `requireStage`, `StageError` from `src/stage.js` (Phase 1).
- `planBlockers(root, cfg) → string[]`: first one `<file>:<line> clarification marker: <the marker text up to its closing bracket>` per `[NEEDS CLARIFICATION` in any `.md` under `<docsRoot>/spec/` (contracts and `stack.md` included), then the `StageError` message of `requireStage(root, cfg, 'gap-scan')` when it throws (for a missing `gaps.md`: `gap scan not done: <docsRoot>/spec/gaps.md is missing; run /slicekit gaps`).
- CLI `plan check`: no blockers → `ready to plan`, exit 0; else one blocker per line, exit 1. `subcommands = ['check']`.

- [ ] **Step 1: Failing test** — `refuses while a clarification marker or an open gap exists`: a repo past spec review whose spec holds one marker and whose `gaps.md` has an open `G-1` → exit 1 with two lines, the first naming the spec file, its line and `clarification marker`, the second `gap scan not done: G-1 is not closed; run /slicekit gaps`; with the marker resolved and `G-1` closed → `ready to plan`. With no `gaps.md` the message holds `gap scan not done`. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/commands/plan.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(plan): refuse to plan over markers and open gaps`.

### Task 2: Evaluation-set and Order findings in `coverage`

**Files:** Modify `src/check/rules/coverage.js`, `test/check/coverage.test.js`, `docs/spec/03-hooks-gates-ci.md`.

**Interfaces:**
- Consumes (S-09): `parseOrder` from `src/slicefile.js`.
- Both run only when `planned(ctx, …)` is true, like the rule's other findings.
- Per parsed slice, at line 1 of its file: no `happy` row → `slice <id> has no happy test`; no `negative` row → `slice <id> has no negative test`.
- Per phase directory whose `P<n>.md` has an Order line, at that line: a group of the phase's slices the line does not name → `phase <P> Order line does not name group <g>`; a group named twice → `phase <P> Order line names group <g> twice`; a group no slice of the phase has → `phase <P> Order line names group <g>, which no slice has`. A phase with no Order line gives nothing.
- Overlap: with an Order line, the overlap test runs over all slices of one step (each step's groups together) instead of one group; the message names the step: `slices <a> and <b> in step <B, C> both expect <path>`. Without one, it runs per group as it does now. The shared roots stay exempt.
- REQ-3.7's coverage row in `docs/spec/03-hooks-gates-ci.md` gains: "a slice whose evaluation set has no `happy` or no `negative` test, or a phase whose Order line misses, repeats or names a group no slice has", and its overlap clause reads "two slices in one parallel group, or in one step of the phase's Order line, expecting the same path".

- [ ] **Step 1: Failing tests** — `a slice with no negative test is a finding`: a planned fixture whose slice has only `happy` rows → `slice P1/S-01 has no negative test`. `an Order line missing a group is a finding`: slices in groups A and B under `**Order:** A` → `phase P1 Order line does not name group B`; `**Order:** A; B; B` → `names group B twice`. `slices in one Order step are checked for overlap`: S-01 in group B and S-02 in group C both expecting `src/x.js` under `**Order:** A; B, C` → `slices P1/S-01 and P1/S-02 in step B, C both expect src/x.js`; under `**Order:** A; B; C` → no finding. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/check/coverage.test.js` → FAIL.
- [ ] **Step 3: Implement**; edit the REQ-3.7 row.
- [ ] **Step 4: Run** the same, `npm test` and `node bin/slicekit.js check` on the kit → PASS, `0 findings` (every kit slice has both kinds; only P2's phase file carries an Order line, and its step B, C has no shared path).
- [ ] **Step 5: Commit** `feat(check): evaluation sets need a happy and a negative test; Order lines name every group`.

### Task 3: The `/slicekit plan` procedure

**Files:** Create `templates/instructions/commands/plan.md`. Modify `test/commands/plan.test.js`.

**Interfaces:**
- Consumes (S-09): `briefProblems`; `{{cli}} branch plan`, `{{cli}} decide add`, `{{cli}} pr open`.
- Steps, in order: (1) `{{cli}} plan check` until it prints `ready to plan`; (2) `{{cli}} branch plan <slug>`; (3) when `<docsRoot>/spec/stack.md` says nothing yet, take the stack from the intake or decisions when given, else ask the human one question per choice and record each answer with `{{cli}} decide add`, then write `stack.md`; (4) one phase per milestone in the intake or decisions: `<docsRoot>/phases/P<n>-<name>/P<n>.md` with its goal and an `**Order:**` line; (5) slice files in the REQ-1.5 shape (front matter `slice`, `name`, `repo`, `group`, `runbook`, `requirements`, `decisions`; at most five Done-when checks; an evaluation set `Test | Kind | Covers` with at least one `happy` and one `negative` row, each naming a REQ; expected changes; the runbook flag per D-21), so that every REQ is named by a slice and no two slices in one group expect the same path apart from the shared roots (`.`, `test/`, `src/cli/index.js`, the runbook); (6) `{{cli}} status --write`, then `{{cli}} check` until `0 findings`; (7) `{{cli}} pr open --title "[plan] <program name>" --body-file <file> --commit "docs(plan): <program name>" --paths <docsRoot>/spec/stack.md,<docsRoot>/phases,<docsRoot>/decisions.md,BUILD.md`.

- [ ] **Step 1: Failing tests** — `every requirement is named by a slice and BUILD.md is regenerated`: a fixture with two REQs, a phase file with `**Order:** A`, and two group-A slices each naming one REQ with disjoint expected changes → `check` reports no `coverage` finding and `status --write` writes a `BUILD.md` row for each slice; removing one slice gives `<REQ> is named by no slice`. `the procedure passes the brief lint`: `briefProblems(text, {kind: 'command'})` is `[]`, and the text holds `plan check`, `**Order:**`, `status --write` and `pr open --title "[plan]`.
- [ ] **Step 2: Run** `node --test test/commands/plan.test.js` → FAIL (no procedure).
- [ ] **Step 3: Write** the procedure.
- [ ] **Step 4: Run** the same and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(plan): the /slicekit plan procedure`.
