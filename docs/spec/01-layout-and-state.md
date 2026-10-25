# 01 — Layout and state

What `slicekit init` writes into a team's repository, the IDs everything carries, and the states a
phase and a slice move through.

## REQ-1.1 The install layout

The kit SHALL write the following into a repository on `slicekit init`, with the docs root taken
from config (default `docs/`, D-24):

```
.slicekit/
  config.json          shape · commands {test, lint, build, e2e} · docsRoot · repos · tracker ·
                       review {independent: required|optional} · freezeTests · style (phrase list)
  state/<P>-<S>.json   one file per slice (D-22); only the CLI writes here
  baselines/           ratchet counts: references.json, style.json
  journal/<branch>--<clone-id>.log  append-only, hash-chained session journal, one per branch per clone (03, REQ-3.8)
  graph/               built, never committed (04)
  workspace.json       present only in a program repo that spans repositories (D-15)
<docsRoot>/
  intake/              frozen source snapshots (REQ-1.2)
  decisions.md         D-NN rows (D-17)
  spec/<capability>.md REQ-NN requirements (REQ-1.3)
  spec/contracts/      events, topics, queues, APIs between components or repositories
  spec/gaps.md         G-NN gaps and how each closed
  spec/stack.md        the stack as given or decided
  platform.md          infrastructure as the team has it (D-20)
  observability.md     the monitoring stack as the team has it (D-20)
  runbook.md           one per repository (D-21)
  phases/P<n>-<name>/P<n>.md        milestone, slices, parallel groups
  phases/P<n>-<name>/S-<nn>-<descr>.md  the slice file (REQ-1.5)
  releases/P<n>.md     release records (05 / 02 REQ-2.9)
BUILD.md               the human-readable queue (REQ-1.6)
.claude/               rendered adapter files inside managed-block markers (03 REQ-3.12)
.github/workflows/slicekit.yml
.githooks/prepare-commit-msg
.githooks/pre-commit
.githooks/pre-merge-commit
```

Scenario: GIVEN an empty repository WHEN `slicekit init --shape backend` runs THEN every path above
exists except `.slicekit/workspace.json`, `.slicekit/graph/`, `docs/phases/*` and `docs/releases/*`, and `slicekit check` exits 0. <!-- slicekit:example -->

Scenario: GIVEN a repository that already has `docs/` WHEN init runs THEN nothing already present is
overwritten; the kit adds its files beside them and reports each one it added.

Cites: D-15, D-17, D-20, D-21, D-22, D-24.

Enforced by: `slicekit init`, `slicekit check` (layout rule).

## REQ-1.2 Intake snapshots are frozen

Every source document SHALL be copied into `<docsRoot>/intake/` as `YYYY-MM-DD-<slug>.<ext>` with a
sidecar `.meta.json` carrying origin (URL or path), the SHA-256 of the content, who brought it in and
when (D-08). The kit SHALL refuse a commit that modifies an existing intake file; a changed source is
a new snapshot. A file is frozen only while its sidecar's SHA-256 matches its bytes: a file under
`<docsRoot>/intake/` without such a sidecar SHALL be reported by `slicekit check`, checked like any
other doc, and SHALL keep the intake stage from being done.

Scenario: GIVEN an intake file WHEN a commit changes its bytes THEN the PreToolUse guard refuses the
commit and names the file.

Scenario: GIVEN a file dropped into `<docsRoot>/intake/` with no sidecar WHEN `slicekit check` runs
THEN it reports "intake file has no valid sidecar" for that file and checks its references and style.

Cites: D-08.

Enforced by: PreToolUse guard on Bash (03 REQ-3.2), `slicekit check` (hash matches sidecar).

## REQ-1.3 Requirements have one shape

A requirement SHALL be a `## REQ-<section>.<n> <title>` or `### REQ-<section>.<n> <title>` heading
followed by one or more SHALL sentences, at least one `Scenario:` in GIVEN / WHEN / THEN form, a
`Cites:` line naming intake files or D-NN rows, and an `Enforced by:` line naming a script, a hook,
a reviewer check, or the word `advisory`. Unresolved points SHALL be written as
`[NEEDS CLARIFICATION: <question>]` and never as a guess.

Scenario: GIVEN a spec file with a REQ whose `Cites:` line names a decision row that does not exist
WHEN `slicekit check` runs THEN it fails naming the file, the REQ and the missing ID.

Scenario: GIVEN a spec file containing `[NEEDS CLARIFICATION` WHEN `slicekit plan` is invoked THEN
it refuses to start and lists the markers.

Cites: D-08, D-17, `../intake/2026-10-24-founding-requirement.md`.

Enforced by: `slicekit check` (citations rule), `slicekit plan` precondition.

## REQ-1.4 Decisions have IDs and provenance

`decisions.md` SHALL hold one table row per decision: ID `D-<n>`, type (Decision, Action,
Information, Counsel, Open), the question in plain words, the answer, who answered and when. A settled
row is never edited; a reversal is a new row naming the one it replaces (D-17).

Scenario: GIVEN a spec sentence that rests on an Open row WHEN `slicekit gaps` runs THEN the gap
scan lists it as an open dependency.

Cites: D-17.

Enforced by: `slicekit check` (ID uniqueness, cited rows exist), `slicekit gaps`.

## REQ-1.5 The slice file

Each slice SHALL have `phases/P<n>-<name>/S-<nn>-<descr>.md` containing: the slice ID; the repository
it is built in (D-15); the REQ and D rows it implements; a **Done when** list of at most five
observable checks; an **Evaluation set** listing each test to be written, tagged `happy`, `negative`
or `e2e`, each naming the REQ it covers; the files or packages expected to change; whether the slice
touches configuration, infrastructure, migrations, alerts, queues or integrations (the runbook flag,
D-21); and the parallel group within its phase.

Scenario: GIVEN a slice file whose evaluation set has a test naming no REQ WHEN `slicekit check`
runs THEN it fails naming the slice and the test.

Cites: D-10, D-15, D-21, `../intake/2026-10-24-founding-requirement.md`.

Enforced by: `slicekit check` (citations rule).

## REQ-1.6 BUILD.md is a view of state, never the source

`BUILD.md` SHALL list every phase and slice with status and pull request number, generated from the
state files. A difference between `BUILD.md` and `.slicekit/state/` SHALL fail `slicekit check`.
`slicekit status --write` regenerates it.

Scenario: GIVEN a slice state file at `draft-pr` with PR 14 WHEN `BUILD.md` says `todo` THEN
`slicekit check` fails and names the slice.

Cites: D-10, D-22.

Enforced by: `slicekit check` (queue rule).

## REQ-1.7 Program stages, in order

The program SHALL move through: `intake → clarify → specify → spec-review → gap-scan → stack → plan
→ build → release`. A stage command SHALL refuse to start until the CLI confirms from files that the
previous stage is complete:

| Stage | Complete when |
|---|---|
| intake | at least one snapshot, and every file under intake has a valid sidecar |
| clarify | `decisions.md` exists and no row of type Open is cited by the spec |
| specify | every REQ has the shape of REQ-1.3 |
| spec-review | the spec was merged to the default branch through a pull request (D-07) |
| gap-scan | `gaps.md` exists and every G-NN row is closed by a D-NN or a REQ change |
| stack | `<docsRoot>/spec/stack.md` exists with no clarification marker |
| plan | every REQ is named by at least one slice file; the plan was merged through a pull request |
| build | every slice in the phase is `merged` |
| release | `releases/P<n>.md` exists naming every merged pull request |

Scenario: GIVEN no `gaps.md` WHEN `/slicekit plan` is invoked THEN it stops with "gap scan not done"
and the command that does it.

Cites: D-07, `../intake/2026-10-24-founding-requirement.md`.

Enforced by: each stage command's precondition, read through `slicekit status --json`.

## REQ-1.8 Slice states and their preconditions

A slice SHALL be in exactly one of: `todo`, `tests-red`, `building`, `draft-pr`, `in-review`,
`changes-requested`, `ci-green`, `ready`, `merged`, `released`. Only the CLI writes the state file.
Transitions and their mechanical preconditions:

| From → to | Precondition checked from files |
|---|---|
| todo → tests-red | a commit exists on the slice branch whose test run exit code was non-zero, recorded in the state file with the commit SHA |
| tests-red → building | the test files listed in the state file are present and (if `freezeTests`) frozen |
| building → draft-pr | the test command exits 0; `slicekit check` exits 0; a pull request exists whose title begins `[P<n>/S-<nn>]` |
| draft-pr → in-review | a verdict file exists for round 1 |
| in-review → changes-requested | the latest verdict has open blockers |
| in-review → ci-green | the latest verdict has zero open blockers and CI reports success on the head SHA |
| ci-green → ready | an independent verdict on the current head SHA exists with zero open blockers, or config sets it optional |
| in-review, changes-requested, ci-green or ready → draft-pr | a new head SHA on the pull request (a fix push) |
| ready → merged | the pull request is merged (observed by CI sync or `slicekit status --sync`) |
| merged → released | the phase's release record names the pull request |

Scenario: GIVEN a slice at `building` WHEN the command tries to open a pull request while the test
command exits 1 THEN the transition is refused and the failing test summary is printed.

Cites: D-10, D-18, D-22.

Enforced by: `slicekit state set` (the only writer), which checks the precondition and refuses
otherwise.

## REQ-1.9 IDs

IDs SHALL be: `REQ-<section>.<n>`, `D-<n>`, `G-<n>`, `P<n>`, `S-<nn>`, `C-<n>` for contracts. A slice
is addressed as `P<n>/S-<nn>`. A slice branch is `slice/P<n>-S-<nn>-<descr>`. Every commit on a slice
branch carries the trailer `Slice: P<n>/S-<nn>`; every pull request title begins `[P<n>/S-<nn>]`.

Scenario: GIVEN a branch `slice/P1-S-03-config-schema` WHEN any commit is made THEN the
`prepare-commit-msg` hook appends `Slice: P1/S-03` if absent.

Cites: D-13, D-17, `../intake/2026-10-24-founding-requirement.md`.

Enforced by: `.githooks/prepare-commit-msg`, `slicekit check` (trailer rule on the slice branch), CI
(title rule).

## REQ-1.10 Shapes

`config.shape` SHALL be one of `backend` (also middleware and integration), `fullstack`, `data`. The
shape decides which agents, skills and checks are rendered (D-14). A capability that is off SHALL be
absent from `.claude/` and from the check list, never present and disabled.

| Capability | backend | fullstack | data |
|---|---|---|---|
| developer, reviewer, fixer, auditor, ops agents | on | on | on |
| designer agent and screen checks | off | on | off |
| migration and data-contract checks | on | on | on |
| pipeline and dataset lineage checks | off | off | on |
| infrastructure and observability files | on | on | on |

Scenario: GIVEN `shape: backend` WHEN init renders `.claude/agents/` THEN no `designer.md` exists.

Cites: D-14.

Enforced by: the renderer; `slicekit check` (rendered set matches shape).

## REQ-1.11 Platform, observability and runbook files

Init SHALL create `platform.md`, `observability.md` and `runbook.md` from templates with the sections
listed below, each section either filled from intake or holding the single line "Not yet known" so
that the gap scan can list it (D-20, D-21).

- `platform.md`: provider(s) and services, environments, how a change reaches each environment, who
  owns access, secrets handling, network boundaries.
- `observability.md`: dashboards, alert routes, log shape and required fields, trace and correlation
  IDs, the CI steps the monitoring setup requires, on-call contact.
- `runbook.md`: how to run it locally and in each environment, dependencies and their owners, known
  failure modes with the first thing to check, actions and who may take them, rollback.

Scenario: GIVEN `observability.md` with "Not yet known" under alert routes WHEN `slicekit gaps` runs
THEN G-NN "alert routes unknown" is listed.

Cites: D-20, D-21.

Enforced by: templates; `slicekit gaps`.
