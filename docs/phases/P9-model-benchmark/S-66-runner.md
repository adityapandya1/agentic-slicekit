---
slice: P9/S-66
name: Runner
repo: .
group: C
runbook: yes
requirements: [REQ-6.1, REQ-6.3, REQ-6.5, REQ-6.9, REQ-6.10, REQ-5.8]
decisions: [D-108, D-111, D-112, D-113, D-114, D-119, D-120, D-121, D-124, D-125, D-97]
---

## Done when

1. `slicekit bench run --models <id,…>` runs each confirmed task with each model, for the task's agent, `bench.trials` times (3 when unset), each trial as one `claude -p --model <id> --output-format json` in a new folder that holds a copy of the task's files, no `.git`, no remote and no file of the reference answer; `SLICEKIT_CLAUDE` names the program to run in place of `claude` (REQ-6.3, D-114, D-124).
2. Each trial's time, tokens, cost, turns and exit status come from the run's JSON; the run file under `<docsRoot>/benchmark/runs/` records the full model ID a trial ran on and the output of `claude --version`, never an alias alone; a model Claude Code cannot run is refused before any trial, naming it (REQ-6.3, REQ-6.10, D-111, D-113).
3. With no `bench.cap` set the run is refused, naming the setting. Otherwise it prints an estimate from earlier run files of the same agent, or says it has none, and starts no trial until the person passes `--yes`; once spend reaches the cap it starts no further trial, and the run file lists the trials not run (REQ-6.5, D-112, D-125).
4. No file the run writes holds the value of `ANTHROPIC_API_KEY`; the run writes only its run file and its trial folders under the system's temporary folder, and changes no agent file and no `models` entry (REQ-6.9, REQ-6.1, D-108, D-120, D-121).
5. The bench page has a `run` section, the runbook says what a run needs (Claude Code logged in, the cap, the key for the check) and what a refused model means, and `node scripts/guide-html.js --check` exits 0 (REQ-5.8, D-119, D-97).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `bench-run.test.js » a trial runs in a folder with no git entry and records the full model id and the Claude Code version` | happy | REQ-6.3 |
| `bench-run.test.js » each task runs three times per model when no count is set` | happy | REQ-6.3 |
| `bench-run.test.js » with no cap set a run is refused naming the setting` | negative | REQ-6.5 |
| `bench-run.test.js » a run prints its estimate and starts no trial until the person goes on` | negative | REQ-6.5 |
| `bench-run.test.js » a run stops at the cap and lists the trials not run` | negative | REQ-6.5 |
| `bench-run.test.js » no file the run wrote holds the API key` | negative | REQ-6.9 |
| `bench-run.test.js » a model Claude Code cannot run is refused and named` | negative | REQ-6.10 |
| `bench-run.test.js » a run writes only its run file and changes no agent file or models entry` | happy | REQ-6.1 |

## Expected changes

`src/bench/claude.js`, `src/bench/run.js`, `src/bench/cap.js`, `src/cli/bench.js`, `src/config.js`, `docs/guide/commands/bench.md`, `docs/guide/slicekit-guide.html`, `docs/runbook.md`, tests.

## Tasks

### Task 1: One trial through Claude Code

**Files:** Create `src/bench/claude.js`, `src/bench/run.js`, `test/bench-run.test.js`, `test/fixtures/bench/claude-standin.js`.

- [ ] **Step 1: Failing tests** — the first two, the sixth, seventh and eighth tests above, with the stand-in printing recorded JSON.
- [ ] **Step 2: Run** `node --test test/bench-run.test.js` → FAIL.
- [ ] **Step 3: Implement** C-4: the trial folder, the run, the parse, the version, the alias resolved to the ID the JSON reports, the refusal of a model whose probe run fails, the run file.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(bench): one trial through Claude Code`.

### Task 2: The cap and the estimate

**Files:** Create `src/bench/cap.js`. Modify `src/bench/run.js`, `src/config.js`, `src/cli/bench.js`, `docs/guide/commands/bench.md`, `docs/runbook.md`.

- [ ] **Step 1: Failing tests** — the third, fourth and fifth tests above.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** `bench.trials` and `bench.cap` in `validateConfig`, the estimate, `--yes`, the stop at the cap; the page section and the runbook lines. Run `node scripts/guide-html.js`.
- [ ] **Step 4: Run** the same, `node --test test/config.test.js test/guide-page.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(bench): the spending cap and the estimate`.

## Notes

The estimate has no price table to read: the decisions name none, so it comes from earlier run files of the same agent and model, and with none the cap alone bounds the run. A model's refusal costs one short probe run; that cost counts toward the cap.
