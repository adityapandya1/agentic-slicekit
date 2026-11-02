---
slice: P4/S-22
name: Observability steps in CI
repo: .
group: A
runbook: yes
requirements: [REQ-3.11]
decisions: [D-20, D-56]
---

## Done when

1. A table with the columns Step and Command under `## CI steps the monitoring setup requires` in `observability.md` renders one `obs-<n>` job per row, after the jobs of `ci.observabilitySteps`, and each is required by `SLICEKIT_CHECKS_OK` (REQ-3.11, D-56).
2. A section holding only `Not yet known` or `None`, or no table, renders no job; a row with an empty Command renders no job, and `slicekit workflow` prints `<file>:<line>: step "<name>" has no command; no job rendered` on stderr (REQ-3.11).
3. A doc step that fails config's step validation (a line separator, a GitHub expression) or whose name is also a config step's is refused by `slicekit workflow --write` and `init`, naming the file and line, and nothing is written (REQ-3.11).
4. `slicekit workflow --check` reports drift when `observability.md` gains a row and the workflow was not regenerated; the kit's own workflow is unchanged, because the kit's `observability.md` names no step (REQ-3.11).
5. `examples/backend/docs/observability.md` carries one step; the intake procedure tells the agent to write steps as that table; the kit's runbook says where an observability job's step comes from (REQ-3.11, D-21).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `workflow.test.js » observability steps from observability.md and config become jobs` | happy | REQ-3.11 |
| `workflow.test.js » an observability step with an empty command renders no job` | negative | REQ-3.11 |
| `observability.test.js » a section of Not yet known or None holds no steps` | negative | REQ-3.11 |
| `observability.test.js » a step named in observability.md and in config is refused, naming both` | negative | REQ-3.11 |
| `observability.test.js » a doc step holding a GitHub expression is refused with its line` | negative | REQ-3.11 |
| `workflow.test.js » a new row in observability.md is workflow drift` | happy | REQ-3.11 |
| `observability.test.js » the backend example's step renders as a job` | e2e | REQ-3.11 |

## Expected changes

`src/observability.js`, `src/config.js`, `src/workflow.js`, `src/cli/workflow.js`, `src/init.js`, `templates/instructions/commands/intake.md`, `examples/backend/docs/observability.md`, `docs/runbook.md`, `test/fixtures/golden/workflow/`, tests.

## Tasks

### Task 1: The steps table

**Files:** Create `src/observability.js`, `test/observability.test.js`. Modify `src/config.js`.

**Interfaces:**
- Consumes: `headings`, `tables`, `lines` from `src/markdown.js`; `workflowTextErrors` from `src/config.js` (exported by this task).
- `STEPS_HEADING = 'CI steps the monitoring setup requires'`.
- `docSteps(text, rel) → {steps: [{name, run, at}], warnings: string[], errors: string[]}`. It reads the first table inside the `##` section whose heading is `STEPS_HEADING` whose header row's cells are `Step` and `Command`, any case. Each row is `{name, run, at: '<rel>:<line>'}`, the cells trimmed and a code span's backticks removed. A row with an empty Command is a warning `<rel>:<line>: step "<name>" has no command; no job rendered` and no step; a row with an empty Step is an error `<rel>:<line>: a step needs a name`. Each step's name and command pass `workflowTextErrors` as config's do, each problem prefixed `<rel>:<line>: `. No section, no table, or a section whose only line is `Not yet known` or `None` (with or without a full stop) → no steps and no warning.
- `allSteps(cfg, doc) → {steps, warnings, errors}`: config's `ci.observabilitySteps` first, then the doc's; a doc name equal to a config name is the error `<at>: step "<name>" is also in ci.observabilitySteps[<i>]; name it in one place`.

- [ ] **Step 1: Failing tests** — `a section of Not yet known or None holds no steps` (three texts: `Not yet known`, `None.`, prose with no table → `steps` empty, `warnings` empty); `a step named in observability.md and in config is refused, naming both`; `a doc step holding a GitHub expression is refused with its line` (a Command of `echo ${{ secrets.X }}` → an error beginning `docs/observability.md:<line>:`). <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/observability.test.js` → FAIL.
- [ ] **Step 3: Implement**; export `workflowTextErrors` from `src/config.js` without changing it.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(workflow): read the CI steps table of observability.md`.

### Task 2: The workflow renders the doc's steps

**Files:** Modify `src/workflow.js`, `src/cli/workflow.js`, `src/init.js`, `test/workflow.test.js`, `test/fixtures/golden/workflow/`, `test/observability.test.js`.

**Interfaces:**
- `renderWorkflow(cfg, pins, {template, steps})`: `steps` defaults to `cfg.ci.observabilitySteps`, so a caller that passes none renders as today; `checksOk` and the `obs-<n>` jobs use `steps`.
- `workflowState(root, cfg, pins) → {file, expected, current, warnings}`: reads `kitPaths(root, cfg).observability` when it exists, calls `allSteps`, throws `Error` with the errors joined by `; ` when there are any, and passes `steps` to `renderWorkflow`. `init` and `slicekit workflow` already call it; `slicekit workflow` prints each warning to stderr; `init` prints them as warnings.
- The golden files gain one case: a config step and a doc step, rendered as `obs-1` and `obs-2`.

- [ ] **Step 1: Failing tests** — `observability steps from observability.md and config become jobs`: a repository with one config step and a two-row table → jobs `obs-1` (config), `obs-2`, `obs-3` in that order, each in `SLICEKIT_CHECKS_OK`. `an observability step with an empty command renders no job`: the second row's Command empty → no `obs-3`, the warning on stderr of `slicekit workflow --write`, exit 0. `a new row in observability.md is workflow drift`: write the workflow, add a row → `workflow --check` exits 1. `the backend example's step renders as a job`: a copy of `examples/backend` after `init` → its workflow holds one `obs-1` job running the example's command.
- [ ] **Step 2: Run** `node --test test/workflow.test.js test/observability.test.js` → FAIL.
- [ ] **Step 3: Implement**; regenerate the golden files; `node bin/slicekit.js workflow --check` still exits 0 on the kit.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(workflow): steps from observability.md become CI jobs`.

### Task 3: The example, the intake procedure and the runbook

**Files:** Modify `examples/backend/docs/observability.md`, `templates/instructions/commands/intake.md`, `docs/runbook.md`.

**Interfaces:**
- The backend example's section becomes a table with one row: Step `Test report as TAP`, Command `node --test --test-reporter=tap`. Its opening line says the test output is all there is to observe, so a TAP report is the one step.
- The intake procedure's observability interview: write the CI steps as a two-column table, Step and Command, one command per row, no secret in a command; a step that needs a secret goes in `ci.observabilitySteps` with `env`.
- The kit's runbook, under `## Known failure modes and the first thing to check`: a failing `obs-<n>` job runs a step from `ci.observabilitySteps` or from the table in `observability.md`; the job's name is the step's; `slicekit workflow --write` after any change to either.

- [ ] **Step 1: Failing test** — `the backend example's step renders as a job` (Task 2) fails until the example carries the row.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `node --test test/observability.test.js test/walkthrough.test.js test/briefs.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`. The walkthrough test is the long one (up to 15 minutes); run it once here.
- [ ] **Step 4: Commit** `docs(example): the backend example's one observability step; intake writes the table`.
