# 06 Model benchmark

How a team measures which model does each agent's work best on its own project, keeps the numbers
in the repository, and sets a model per agent from them. Source:
`../intake/2026-11-28-model-benchmark.md`. Decisions: D-108 to D-130.

## REQ-6.1 What the benchmark is for

The kit SHALL measure how well each model does each agent's work on the team's own project, keep a
report of the numbers in the repository, and suggest a model for each agent. A suggestion SHALL
never set a model: a person sets the models in a pull request, like any other change, and may choose
a model other than the one suggested. Anyone working on the project SHALL be able to run the
benchmark and read the report (D-108, D-109).

Scenario: GIVEN a report that suggests a model for the developer agent WHEN the benchmark finishes
THEN no agent file and no `models` entry in `.slicekit/config.json` changed.

Cites: D-108, D-109, `../intake/2026-11-28-model-benchmark.md`.

Enforced by: `test/bench-run.test.js` (a run writes only its run file and the report). <!-- slicekit:pending P9/S-66 -->

## REQ-6.2 Picking the tasks

`slicekit bench pick` SHALL suggest benchmark tasks from the merged slices that have frozen tests,
covering each agent's work and both lanes, code and quick. A task SHALL hold the slice file, the
files at the slice's red commit and its frozen tests; the merged change SHALL be kept out of the
task as its hidden reference answer. For the reviewer, auditor and ops tasks, it SHALL plant one
known defect per task in the merged change, from a fixed list: a boundary off by one, a negated
condition, a removed check, a swallowed error; and record the planted defect with the task. Some
reviewer and auditor tasks SHALL have none planted, to count false alarms (D-123). A fixer task
SHALL be a past verdict with a blocker and the files at that point (D-127). A designer task, in a
fullstack project only, SHALL be a screen with one of the team's design rules broken, or none
(D-129). A person SHALL confirm the list before a run uses it. A project with no merged slice SHALL
get a built-in task pack made from `examples/` (D-110, D-116).

Scenario: GIVEN a project with three merged slices, one of them on the quick lane WHEN
`slicekit bench pick` runs THEN it lists tasks from those slices, at least one of them quick, each
with no file of its merged change, and writes no task list until a person confirms it.

Scenario: GIVEN a new project with no merged slice WHEN `slicekit bench pick` runs THEN it suggests
the built-in pack from `examples/`.

Cites: D-110, D-116, D-123, D-127, D-129, `../intake/2026-11-28-model-benchmark.md`.

Enforced by: `test/bench-pick.test.js`. <!-- slicekit:pending P9/S-65 -->

## REQ-6.3 Running a trial

`slicekit bench run` SHALL run each confirmed task with each named model, for each agent, as one
headless Claude Code run per trial: `claude -p --model <full model id> --output-format json`. Each
trial SHALL run in a throwaway folder that holds a copy of the task's files and no git history and
no git remote, so that the merged answer cannot be read and the trial cannot push. The time,
tokens, cost and turns of a trial SHALL come from the run's JSON output. A run record SHALL pin the
full model ID and the Claude Code version, never an alias alone. Only models Claude Code can run
SHALL be benchmarked (D-111, D-114, D-121).

Each task SHALL be run with each model as many times as `.slicekit/config.json` sets, 3 when it
sets none (D-124).

Scenario: GIVEN a confirmed task and the model alias `sonnet` WHEN `slicekit bench run` runs it
THEN the trial's folder has no `.git` entry, and the run record names the full model ID the alias
resolved to and the Claude Code version.

Cites: D-111, D-114, D-121, D-124.

Enforced by: `test/bench-run.test.js`, with a stand-in for `claude` that prints recorded JSON. <!-- slicekit:pending P9/S-66 -->

## REQ-6.4 Scoring each agent's work

The scorer SHALL record, for each trial: time taken, tokens, cost, iterations (turns), the reviews
needed after the task (the blockers a review raised on the trial's result), and, for coding work,
code quality: whether the frozen tests pass, the `slicekit check` findings and the reviewer's
blockers (D-110, D-118). Each agent's result SHALL be scored against what its own gate checks:

| Agent | Scored by |
|---|---|
| developer | the frozen tests pass with no test changed |
| developer, writing tests | the tests fail on the files at the red commit and pass on the reference answer |
| reviewer | the planted defects its verdict finds, and the findings it raises on a task with none planted |
| auditor | the planted defects its gaps file finds |
| fixer | the frozen tests pass, a reviewer re-check finds the replayed blocker gone, and no file outside the finding changed (D-127) |
| ops | its report names the slice and the file that carry the planted defect, and proposes no change of its own (D-128) |
| designer | the broken design rule its verdict finds, and the findings it raises on a screen with none broken (D-129) |

brief, intake, specify, plan and the step runner SHALL NOT be benchmarked (D-113).

Scenario: GIVEN a developer trial whose result passes the frozen tests but edits one of them WHEN
it is scored THEN the trial counts as failed and its record names the changed test.

Cites: D-110, D-113, D-116, D-118, D-127, D-128, D-129, `../intake/2026-11-28-model-benchmark.md`.

Enforced by: `test/bench-score.test.js`. <!-- slicekit:pending P9/S-67 -->

## REQ-6.5 What a run may spend

A benchmark run SHALL start only when a person starts it, or from the opt-in scheduled CI job of
REQ-6.8. Before it spends anything, it SHALL print an estimate of its cost and wait for the person
to go on. It SHALL stop at the spending cap set in `.slicekit/config.json` and record which trials
did not run. It SHALL never switch a model itself (D-112).

With no cap set, a run SHALL be refused, naming the setting; nothing is spent by default (D-125).

Scenario: GIVEN a cap that the estimate exceeds WHEN `slicekit bench run` starts THEN it prints the
estimate and the cap and starts no trial until the person goes on; once spend reaches the cap it
starts no further trial and the run record lists the trials not run.

Cites: D-112, D-125.

Enforced by: `test/bench-run.test.js`. <!-- slicekit:pending P9/S-66 -->

## REQ-6.6 The report

Each run SHALL write one result file under `<docsRoot>/benchmark/runs/`, and the kit SHALL generate
`<docsRoot>/benchmark/report.md` from all of them. For each agent, the report SHALL hold a matrix with one
row per model and these columns: pass rate with its confidence interval, pass^k (the share of
tasks for which all k trials succeed), time, tokens, cost, iterations, reviews needed after the
task, and code quality. It SHALL list each task with its kind. For each agent, it SHALL suggest the
cheapest model that is not clearly worse than the best, and SHALL say so when there were too few
tasks to tell (D-118).

A model SHALL count as clearly worse when the 95% Wilson interval of its pass rate lies wholly
below that of the best model (D-126).

Scenario: GIVEN two run files for the reviewer agent, one per model, and one task WHEN the report is
generated THEN it names no suggested model for the reviewer and says there were too few tasks to
tell.

Cites: D-118, D-126, `../intake/2026-11-28-model-benchmark.md`.

Enforced by: `test/bench-report.test.js`. <!-- slicekit:pending P9/S-68 -->

## REQ-6.7 Setting the models

`.slicekit/config.json` SHALL hold a `models` map from a role to a model. `slicekit models apply`
SHALL write each agent's entry into the `model:` field of its agent file in `.claude/agents/`
(auditor, designer, developer, fixer, ops, reviewer). A role with no entry SHALL keep `inherit`, and
`slicekit update` SHALL keep a team's `model:` choice. brief, intake, specify, plan and the step
runner SHALL be configurable through the same map, with no benchmark (D-113, D-115). The change
SHALL reach the default branch in a pull request (D-109).

For a main-session role, `slicekit models apply` SHALL write the `model:` field into the frontmatter
of that command's slicekit command or skill file, which Claude Code reads when the command runs
(D-130).

Scenario: GIVEN `models` maps `reviewer` to a model ID and names no `fixer` WHEN
`slicekit models apply` runs and then `slicekit update` runs THEN `reviewer.md` has that model ID in
`model:` and `fixer.md` has `inherit`.

Cites: D-109, D-113, D-115, D-130.

Enforced by: `test/models-apply.test.js`. <!-- slicekit:pending P9/S-64 -->

## REQ-6.8 Checking a new model

`slicekit bench check` SHALL list the models from Anthropic's models API (`GET /v1/models`, with the
key from `ANTHROPIC_API_KEY`). A model with no row in the report is new. For a new model, it SHALL
run that model against each agent's current model on the same tasks, and add its column to the
report. Without a key, a person SHALL be able to name the model by hand. An opt-in scheduled CI job
SHALL be able to run the check; it SHALL only open a pull request with the run file and the report,
and never change a `models` entry (D-112, D-117).

Scenario: GIVEN a models API listing with one model the report has no row for WHEN
`slicekit bench check` runs THEN it runs that model and the current models on the same tasks, and
the report gains a row for the new model.

Cites: D-112, D-117.

Enforced by: `test/bench-check.test.js`, with a stand-in for the models API. <!-- slicekit:pending P9/S-69 -->

## REQ-6.9 Keys and network

On a person's machine, a run SHALL use Claude Code's own login, and `ANTHROPIC_API_KEY` from the
environment for the models API. In the CI job, `ANTHROPIC_API_KEY` SHALL come from a repository
secret the team adds. The kit SHALL never write a key to a file, a run record or the report. The
benchmark SHALL call nothing but the models API and the trials' Claude Code runs (D-119, D-120,
D-121).

Scenario: GIVEN `ANTHROPIC_API_KEY` set WHEN a run finishes THEN no file the run wrote contains the
key's value.

Cites: D-119, D-120, D-121.

Enforced by: `test/bench-run.test.js`; <!-- slicekit:pending P9/S-66 -->
`test/bench-check.test.js`. <!-- slicekit:pending P9/S-69 -->

## REQ-6.10 Out of scope

This capability SHALL NOT cover models Claude Code cannot run, or that are reached only through a
gateway to another provider; benchmarking brief, intake, specify, plan or the step runner; switching
a model without a person's pull request; or publishing results to, or comparing them with, public
leaderboards (D-113).

Scenario: GIVEN a model ID that Claude Code cannot run WHEN `slicekit bench run` is given it THEN it
refuses that model and names it.

Cites: D-113.

Enforced by: `test/bench-run.test.js`. <!-- slicekit:pending P9/S-66 -->
