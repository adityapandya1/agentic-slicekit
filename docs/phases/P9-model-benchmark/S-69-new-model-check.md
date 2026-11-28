---
slice: P9/S-69
name: New-model check
repo: .
group: F
runbook: yes
requirements: [REQ-6.8, REQ-6.9, REQ-5.7, REQ-5.8]
decisions: [D-112, D-117, D-119, D-120, D-121, D-97, D-98]
---

## Done when

1. `slicekit bench check` lists the models from `GET /v1/models` with the key from `ANTHROPIC_API_KEY` (`SLICEKIT_MODELS_FIXTURE` names a listing file in its place) and prints each model with no row in the report; `--model <id>` names one by hand, with or without a key (REQ-6.8, D-117).
2. For a new model it runs the confirmed tasks with that model and with each agent's current model from the `models` map, through the runner and its cap, and regenerates the report, which gains the new model's row; a failed API call stops the check with the API's status and message and runs no trial (REQ-6.8, D-112, D-117).
3. With `bench.schedule` set, `slicekit workflow --write` also writes `.github/workflows/slicekit-bench.yml`, which runs `bench check --yes` on that cron with `ANTHROPIC_API_KEY` from a repository secret and opens a pull request with the run file and the report; it changes no `models` entry. With it unset, no such file is written (REQ-6.8, D-112, D-120). <!-- slicekit:pending P9/S-69 -->
4. No file the check writes holds the key's value, and the check calls nothing but the models API and the runner (REQ-6.9, D-120, D-121).
5. The bench page has a `check` section, the runbook says how to add the secret and set the schedule, the README's "What it covers" table has a Benchmark row, and `node scripts/guide-html.js --check` exits 0 (REQ-5.8, REQ-5.7, D-119, D-97, D-98).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `bench-check.test.js » a listed model with no report row is run against the current models and gains a row` | happy | REQ-6.8 |
| `bench-check.test.js » with no key a model named by hand is checked` | happy | REQ-6.8 |
| `bench-check.test.js » a failed models API call stops the check and runs no trial` | negative | REQ-6.8 |
| `bench-check.test.js » the scheduled workflow opens a pull request and changes no models entry` | happy | REQ-6.8 |
| `bench-check.test.js » with no schedule set no benchmark workflow is written` | negative | REQ-6.8 |
| `bench-check.test.js » no file the check wrote holds the API key` | negative | REQ-6.9 |
| `readme.test.js » What it covers has a Benchmark row` | happy | REQ-5.7 |

## Expected changes

`src/bench/models-api.js`, `src/bench/check.js`, `src/cli/bench.js`, `src/config.js`, `src/workflow.js`, `src/cli/workflow.js`, `templates/workflow/slicekit-bench.yml`, `docs/guide/commands/bench.md`, `docs/guide/commands/workflow.md`, `docs/guide/slicekit-guide.html`, `docs/runbook.md`, `README.md`, tests.

## Tasks

### Task 1: The check

**Files:** Create `src/bench/models-api.js`, `src/bench/check.js`, `test/bench-check.test.js`. Modify `src/cli/bench.js`.

- [ ] **Step 1: Failing tests** — the first three and the sixth tests above, with a listing fixture and the Claude Code stand-in.
- [ ] **Step 2: Run** `node --test test/bench-check.test.js` → FAIL.
- [ ] **Step 3: Implement** C-7, the new models against the report's rows, `--model`, the run through `bench run` and the report.
- [ ] **Step 4: Run** the same and `node --test test/bench-run.test.js test/bench-report.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(bench): slicekit bench check`.

### Task 2: The scheduled workflow, the pages and the README

**Files:** Create `templates/workflow/slicekit-bench.yml`. Modify `src/config.js`, `src/workflow.js`, `src/cli/workflow.js`, `docs/guide/commands/bench.md`, `docs/guide/commands/workflow.md`, `docs/runbook.md`, `README.md`, `test/readme.test.js`.

- [ ] **Step 1: Failing tests** — the fourth, fifth and last tests above.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** `bench.schedule` in `validateConfig`, the workflow from its template with pinned actions, the pages, the runbook lines and the README row. Run `node scripts/guide-html.js`.
- [ ] **Step 4: Run** the same, `node --test test/workflow.test.js test/guide-page.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(bench): the opt-in scheduled check`.

## Notes

The kit's own repository sets no `bench.schedule`, so its CI writes no benchmark workflow and spends nothing.
