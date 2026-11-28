# C-8 Benchmark report to the repository

**Producer:** `slicekit bench run`, `slicekit bench check` and the report generator (06 REQ-6.6).
**Consumers:** the people who read the report and set the models; `slicekit bench check`, which
reads the report's rows to find a new model.

| Operation | Input | Output |
|---|---|---|
| Write a run | one benchmark run | one result file under `<docsRoot>/benchmark/runs/`: the tasks, the full model IDs, the Claude Code version, and per trial the time, tokens, cost, iterations, reviews needed and code quality |
| Generate the report | every file under `<docsRoot>/benchmark/runs/` | `<docsRoot>/benchmark/report.md`: per agent, a matrix of one row per model with pass rate and its confidence interval, pass^k, time, tokens, cost, iterations, reviews needed and code quality; the tasks and their kinds; a suggested model, or a note that there were too few tasks to tell |

The report SHALL be generated only from the run files, so the same run files give the same report.

Cites: D-118.
