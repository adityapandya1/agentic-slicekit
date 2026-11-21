# slicekit guide

A closed-loop framework for spec-driven development with coding agents.

This guide has one page for every `slicekit` command, every `/slicekit` slash command and every check rule. A command's page gives its usage, what it reads and writes, its exit codes and an example; a check rule's page says what fails and the failure the rule prevents. This index links the pages and holds what no single page does: the stages from intake to release and the conventions the pages share.

The same guide is one web page with a contents sidebar and a dark theme: [open it in the browser](https://htmlpreview.github.io/?https://github.com/adityapandya1/agentic-slicekit/blob/main/docs/guide/slicekit-guide.html), or download [`slicekit-guide.html`](slicekit-guide.html) and open it. The web page is generated from this index and the pages it links; after a change to either, `node scripts/guide-html.js` writes it again, and a test of the kit fails while the two differ. The PDF copies for print are rendered from the web page outside the repository, so this folder holds none.

## Contents

- [Pages](#pages)
  - [Slash commands](#slash-commands)
  - [Commands](#commands)
  - [Check rules](#check-rules)
- [Overview](#overview)
- [Stages](#stages)
- [Command groups](#command-groups)
  - [Setup](#setup)
  - [Intake and spec](#intake-and-spec)
  - [Plan](#plan)
  - [Build loop](#build-loop)
  - [Review and release](#review-and-release)
  - [CI and hooks](#ci-and-hooks)
  - [The graph and queries](#the-graph-and-queries)
  - [Maintenance](#maintenance)
  - [Ops and audit](#ops-and-audit)
- [Conventions](#conventions)

## Pages

Every `slicekit` command, every `/slicekit` slash command and every rule of `slicekit check` has a page of its own. A test of the kit fails, naming the page, when a command, a slash command or a rule has none. The pages are written from the current CLI. Each command page gives the usage, the options, what the command reads and writes, its exit codes and an example; each slash command page gives what you type, the agents it spawns, the commands its procedure runs and what it leaves behind; each rule page gives what the rule checks and the failure it prevents.

### Slash commands

| Page | What it does |
|---|---|
| [`/slicekit`](slash/slicekit.md) | Runs any of the ten procedures by name. It is the one slash command a person needs to remember. |
| [`/slicekit brief`](slash/brief.md) | Interviews a person who has only an idea, one topic per question, and writes the brief that `/slicekit intake` takes as its source. |
| [`/slicekit intake`](slash/intake.md) | Brings a requirement document into the project and interviews the person about it. |
| [`/slicekit specify`](slash/specify.md) | Writes the spec from the intake snapshots and the decisions, then opens the spec pull request. |
| [`/slicekit gaps`](slash/gaps.md) | Finds each place where the spec is silent, vague or in conflict with the intake, asks the person about each, and closes every row. |
| [`/slicekit plan`](slash/plan.md) | Writes the stack, the phases and the slice files from the spec, then opens the plan pull request. |
| [`/slicekit build`](slash/build.md) | Builds one slice from `todo` to a pull request ready for a person to merge: failing tests first, then code, at most two review rounds, then green CI. |
| [`/slicekit review`](slash/review.md) | Gives a slice pull request its independent verdict, from a session that holds no context of the build. |
| [`/slicekit release`](slash/release.md) | Writes the release record of a phase whose slices are all merged, and opens the release pull request. It deploys nothing. |
| [`/slicekit ops`](slash/ops.md) | Triages one symptom: the slices and pull requests that touched the files it names, the runbook's first checks, and the actions someone could take. It takes no action. |
| [`/slicekit audit`](slash/audit.md) | Compares what the spec and the runbook claim with what the code, the tests and the CI history show. |

### Commands

| Page | What it does |
|---|---|
| [`slicekit audit`](commands/audit.md) | The two steps of `/slicekit audit` that the CLI takes: the claims handed to the auditor, and the check of the report it writes. |
| [`slicekit baseline`](commands/baseline.md) | Shows the ratchet baselines, or lowers them to today's counts. |
| [`slicekit branch`](commands/branch.md) | Puts the session on the work branch of a document pull request. |
| [`slicekit brief`](commands/brief.md) | The steps of `/slicekit brief` that the CLI takes: open the brief, record each question and answer in the order of the topics, and commit the brief. |
| [`slicekit build`](commands/build.md) | The steps of `/slicekit build` and `/slicekit review` that the CLI takes for one slice. The agent runs each; a person types one only to resume or inspect. |
| [`slicekit check`](commands/check.md) | The kit's one gate: runs every check rule and prints each finding. |
| [`slicekit ci`](commands/ci.md) | Decides whether a push changes only the kit's bookkeeping, so CI can skip the team's commands. |
| [`slicekit decide`](commands/decide.md) | Writes a decision row outside the interview, or settles an open one. |
| [`slicekit gaps`](commands/gaps.md) | The steps of `/slicekit gaps` that the CLI takes: find gaps, record them, close them and verify the file. |
| [`slicekit graph`](commands/graph.md) | Builds the traceability graph that the queries read. |
| [`slicekit history`](commands/history.md) | Lists the slices whose commits touched the given paths. |
| [`slicekit hook`](commands/hook.md) | Runs one Claude Code hook handler. Claude Code calls it; a person pipes JSON into it only to test a guard. |
| [`slicekit impact`](commands/impact.md) | Lists what shares files or contracts with a target. |
| [`slicekit init`](commands/init.md) | Adds the kit to a repository. Run it once at the repository root; running it again is safe. |
| [`slicekit instructions`](commands/instructions.md) | Prints an agent's brief or a slash command's procedure. The rules of every agent and command live here, not in a prompt. |
| [`slicekit intake`](commands/intake.md) | The steps of `/slicekit intake` that the CLI takes: freeze the source document, then record each interview question and its answer. |
| [`slicekit journal`](commands/journal.md) | Verifies or prints the session journal, and records the journal heads after a merge. |
| [`slicekit ops`](commands/ops.md) | The two steps of `/slicekit ops` that the CLI takes: what the ops agent is handed for a symptom, and the check of the report it replies with. |
| [`slicekit plan`](commands/plan.md) | Says whether planning may start. |
| [`slicekit pr`](commands/pr.md) | Commits, pushes and opens or updates a document pull request. |
| [`slicekit ready-label`](commands/ready-label.md) | Decides whether a slice pull request gets the `ready` label, and sets it. The generated workflow runs it. |
| [`slicekit release`](commands/release.md) | Writes a phase's release record and sets its slices released. It commits nothing and deploys nothing. |
| [`slicekit review`](commands/review.md) | Checks out a pull request's head for an independent review. |
| [`slicekit shipped`](commands/shipped.md) | Prints a phase's release record. |
| [`slicekit spec`](commands/spec.md) | Checks that every requirement and interface in the spec is grounded. |
| [`slicekit stage`](commands/stage.md) | Checks, from the files, that a stage and every stage before it are complete. |
| [`slicekit state`](commands/state.md) | Reads or writes one slice's state file. The build commands call it; a person types it rarely. |
| [`slicekit status`](commands/status.md) | Lists every slice's state, syncs merges from the git host and regenerates `BUILD.md`. |
| [`slicekit sync`](commands/sync.md) | Opens the pull request that carries the state change after a merge. The CI sync job runs it; a person does not type it. |
| [`slicekit trace`](commands/trace.md) | Traces a requirement down to its commits and tests, or a file up to its requirements. |
| [`slicekit uncovered`](commands/uncovered.md) | Lists untested requirements, unlinked tests and commits outside a slice. |
| [`slicekit update`](commands/update.md) | Compares the files the kit renders with what the installed version would write, and updates them. |
| [`slicekit visualize`](commands/visualize.md) | Shows the graph as one self-contained page. |
| [`slicekit workflow`](commands/workflow.md) | Prints, writes or checks the GitHub Actions workflow that the config renders. |

### Check rules

| Page | What it checks | The failure it prevents |
|---|---|---|
| [`ci-body`](rules/ci-body.md) | Under `--ci`, the pull request's body carries the sections the kit requires. | A pull request reaches review with no proof of what was run, no steps to try it and no word on what was skipped, so the reviewer and the person who merges cannot tell what the slice claims or what nobody checked. |
| [`ci-title`](rules/ci-title.md) | Under `--ci`, the pull request's title begins with the slice it delivers, and that slice was opened through the build loop. | A pull request opened by hand skips the red tests, the frozen tests and the recorded verdicts, and once it merges no state file or graph edge links its commits to a slice or a requirement. |
| [`citations`](rules/citations.md) | Every requirement cites a source that exists, every slice file names requirements and decisions that exist, and no ID is defined twice. | A requirement appears in the spec with nothing behind it, so nobody can say who asked for it or why, and a test exists that covers no requirement, so the graph cannot say what the test proves. |
| [`commands`](rules/commands.md) | Every command the team declared in the config can be found on this machine. | A typo in the test command, or a tool that is not installed, makes every build step and CI job fail at its first run, long after the config was written, with an error that does not point back at the config. |
| [`coverage`](rules/coverage.md) | Once a program is planned, every requirement belongs to a slice and every slice can be built and judged. | A requirement is planned into no slice and is never built, or two slices built side by side change the same file and the second one to merge overwrites or conflicts with the first. |
| [`frozen`](rules/frozen.md) | On a slice branch, a test of the evaluation set stays as it was at the red commit. | An agent that cannot make a failing test pass edits the test until it does, and the slice merges green while the behaviour the evaluation set asked for was never built. |
| [`hooks`](rules/hooks.md) | The git hooks the kit installs are present, executable and the ones git runs. | Git hooks do not survive a clone, so in a fresh clone nothing refuses a commit on the protected branch or adds the slice trailer, and nobody notices until the trailer rule fails in CI. |
| [`host-rules`](rules/host-rules.md) | The git host's rulesets on the default branch hold every rule the kit relies on. | The default branch accepts a direct push or a merge with red CI, so every check the kit runs on a pull request can be bypassed by anyone with write access, and the kit's gate is advice only. |
| [`journal`](rules/journal.md) | The session journal is an unbroken, append-only record, and under `--ci` its commits are signed. | Someone edits or deletes the record of what a session did, such as a declined finding or an amended test, and nothing shows the record was changed after the fact. |
| [`layout`](rules/layout.md) | Every file and folder `slicekit init` lays down is still there, and `.claude/` holds no file of another shape. | A deleted or renamed part of the layout, such as the decisions file or the state folder, makes a later command fail in the middle of a build or read an empty folder as "nothing planned". |
| [`managed`](rules/managed.md) | Every file the kit renders still holds the block the kit wrote. | Someone weakens a hook command, an agent's tool list or a slash command by editing the rendered file, and every later session runs with the weaker rule while the kit still appears installed. |
| [`queue`](rules/queue.md) | `BUILD.md` reads exactly as the slice files and their state say. | The build queue a person reads says a slice is still to do when it is merged, or the reverse, so work is started twice or a release is planned on slices that are not done. |
| [`references`](rules/references.md) | Every path, anchor and ID a doc names exists. | A spec, a runbook or a slice file points at a file that was renamed or a decision that was never recorded, and the person or agent who follows the reference at the moment it matters finds nothing there. |
| [`runbook`](rules/runbook.md) | A slice that says it changes operations changes the runbook, or says why not. | A slice adds a queue, a migration or an alert and merges with the runbook unchanged, so the person on call meets the new failure with no first check written down. |
| [`style`](rules/style.md) | No doc uses a phrase from the team's filler list. | Specs, verdicts and runbooks fill with phrases that state no fact, and a reader cannot tell a checked claim from decoration. |
| [`sync-release`](rules/sync-release.md) | Under `--ci` on a sync pull request, the version, the changelog and the rendered files are exactly what CI computes for that merge. | A sync pull request, which a person approves as routine bookkeeping, carries a hand-set version number or an edited rendered hook, and that change ships in the next published version without a slice or a review. |
| [`trailer`](rules/trailer.md) | On a slice branch, every commit the branch adds names the slice in a `Slice:` trailer. | A commit lands on the default branch that belongs to no slice, so `trace`, `history` and `uncovered` cannot say which requirement it serves or whether anyone reviewed it. |
| [`workspace`](rules/workspace.md) | A slice names a repository the workspace lists, and a contract names both of its parties. | A slice is planned for a repository the graph never walks, or a contract has no named consumer, so `impact` reports that a change to the interface affects nobody. |

## Overview

The guide covers the slicekit command-line interface and the slash commands that drive it from Claude Code. A person types the slash commands; each one's procedure runs the CLI commands. Where the agent, CI or a Claude Code hook usually runs a command, the first lines of its page under [Commands](#commands) say so.

In your project the kit runs as `npx slicekit`, or through the `cli` value in `.slicekit/config.json`. With a local install that is `node node_modules/slicekit/bin/slicekit.js`. The examples write it as `slicekit`. Run every command from the repository root.

## Stages

A program moves through these stages in this order. A stage command refuses to start until the files show the stage before it is complete. `slicekit stage require <stage>` is that check at the start of specify, gaps and build; plan uses `slicekit plan check`, and release uses `slicekit release P<n> --dry-run`. The stage names in the code are `intake`, `clarify`, `specify`, `spec-review`, `gap-scan`, `stack`, `plan`, `build` and `release`. Merging a pull request is always a person's act. The optional stage `brief` comes before `intake` and is judged alone: `slicekit stage require brief` checks it, no later stage requires it, and `intake` takes it as its source when it exists.

| Stage | Slash command | What happens | CLI steps |
|---|---|---|---|
| 0. Brief (optional) | `/slicekit brief [<slug>]` | For a person with no requirement document. The agent asks one question per topic and writes `<docsRoot>/brief/<slug>.md` from the answers alone; a topic the person cannot answer becomes an open question. The last line printed is the intake command that takes the brief as its source. Intake does not require it. | `branch spec`, `brief start`, `brief ask`, `brief answer`, `brief done`, `stage require brief` |
| Setup |  | Once per repository. Adds the config, docs layout, Claude Code files, git hooks and the CI workflow. | `init`, `status --write`, `workflow --write` |
| 1. Intake | `/slicekit intake <file or URL>` | The source document is snapshotted and frozen. The agent asks one question at a time, and each answer becomes a numbered decision row. | `branch spec`, `intake snapshot`, `intake ask`, `intake answer`, `intake done`, `workflow --write` |
| 2. Clarify | no command of its own | Questions intake left open are answered. The stage is complete when `decisions.md` exists and the spec cites no blocking Open row. An open row of type `Action` or `Information` is listed as pending and does not block. | `decide settle`, `decide add` |
| 3. Specify, then spec review | `/slicekit specify` | One spec file per capability, every requirement citing its source, a contract per interface. Then the spec pull request; merging it is the spec review. | `branch spec`, `stage require clarify`, `spec verify`, `check`, `pr open` |
| 4. Gaps | `/slicekit gaps` | After the spec merges: every place the spec is silent, vague or in conflict with intake becomes a G row, and each row is closed by a decision or a requirement change. | `branch gaps`, `stage require spec-review`, `gaps scan`, `instructions auditor`, `gaps add`, `decide settle`, `decide add`, `gaps close`, `gaps verify`, `check`, `pr open` |
| 5. Plan | `/slicekit plan` | The stack, the phases and the slice files, then `BUILD.md` and the plan pull request. | `branch plan`, `plan check`, `decide add`, `status --write`, `check`, `pr open` |
| 6. Build | `/slicekit build [P<n>/S-<nn>]` | One slice: start, failing tests, code until green, a draft pull request, at most two review rounds, green CI. Side by side: `/slicekit build --parallel P<n>` uses `build parallel`. Occasional: `build amend`, `build render`, `build config`, `build sync`. | `stage require plan`, `build next`, `build start`, `instructions developer`, `build red`, `build commit`, `build pr`, `instructions reviewer`, `build verdict`, `instructions fixer`, `build decline`, `build finish` |
| 7. Independent review, then merge | `/slicekit review <PR>` | In a new Claude Code session with no memory of the build. On blockers, and when the person says yes, a fixer's commits go to the slice branch. When it reports `ready`, a person merges. The CI sync job then runs `status --sync --write` and `journal heads`, and `sync open` opens a `[sync]` pull request; when a person merges that one, the slice is `merged` on the default branch. | `review start`, `instructions reviewer`, `build verdict --independent`, `instructions fixer`, `build decline`, `build commit --require-green`, `build pr`, `build sync`, `build finish`; then in CI `status --sync --write`, `journal heads`, `sync open` |
| 8. Release | `/slicekit release P<n>` | Once every slice of the phase is `merged`: writes the release record `releases/P<n>.md`, sets each slice `released`, rewrites `BUILD.md` and opens the `[release] P<n>` pull request. `release --undo` removes a record that is not committed, when `check` finds a fault in it. It does not deploy. | `release --dry-run`, `branch release`, `release`, `check`, `release --undo`, `pr open` |
| 9. The graph and its queries | any time | Build the traceability graph from the docs and git, then ask it questions. | `graph`, `trace`, `impact`, `history`, `shipped`, `uncovered`, `visualize` |
| 10. Ops and audit | `/slicekit ops <symptom>`, `/slicekit audit [area]` | Any time after the first merge. Ops triages a symptom; audit compares the spec and runbook claims with the code. Each leaves one report and changes no tracked file. | `graph`, `ops context`, `instructions ops`, `ops check`, `audit context`, `instructions auditor`, `audit check --every-claim` |

## Command groups

The table under [Commands](#commands) lists the pages by name. This section lists them by the work they belong to, with what the commands of a group share.

### Setup

Adding the kit to a repository and keeping its own files current: [`init`](commands/init.md), [`update`](commands/update.md) and [`workflow`](commands/workflow.md).

### Intake and spec

The steps of `/slicekit intake`, `/slicekit specify` and `/slicekit gaps`: [`branch`](commands/branch.md), [`intake`](commands/intake.md), [`decide`](commands/decide.md), [`stage`](commands/stage.md), [`spec`](commands/spec.md), [`gaps`](commands/gaps.md) and [`pr`](commands/pr.md). The agent runs nearly all of them. You type `decide` and `stage require` yourself now and then. Before intake, `/slicekit brief` ([page](slash/brief.md)) runs the steps of [`brief`](commands/brief.md) for a person who has only an idea.

### Plan

[`plan`](commands/plan.md) holds one step, `plan check`. `/slicekit plan` also runs `branch plan`, `decide add`, [`status --write`](commands/status.md), [`check`](commands/check.md) and `pr open`.

### Build loop

[`build`](commands/build.md) holds the deterministic steps that `/slicekit build` and `/slicekit review` share, and [`instructions`](commands/instructions.md) prints the brief of each agent they spawn. Each `build` subcommand but `build next` and `build parallel` takes the slice ID, `P<n>/S-<nn>`. A slice's worktree is `.worktrees/P<n>-S-<nn>` on the branch `slice/P<n>-S-<nn>-<descr>`. The agent runs every step; you type one only to resume or inspect by hand.

**Shared by the `build` subcommands.** `--worktree <p>` names the worktree to act in. Without it the build worktree is used, never the review one, so the building session needs no flag while a review session runs; the review session always passes it. Exit codes: **0** done; **1** refused (the slice's state, a failing command or check, a frozen test, a state file hidden from git or changed on disk, git, the git host, the tracker or a held lock); **2** bad usage, an unknown slice ID, a missing required option or a config problem.

### Review and release

`/slicekit review <PR>` starts with [`review start`](commands/review.md), then uses the [`build`](commands/build.md) steps with `--worktree <wt>`: `build verdict --independent`, `build decline`, `build commit --require-green` and `build pr` for a fix, `build sync` and `build finish`. [`release`](commands/release.md) writes a phase's release record once every slice of the phase is merged.

### CI and hooks

The gate, and the commands the generated workflow and Claude Code's hooks call: [`check`](commands/check.md), [`ci`](commands/ci.md), [`ready-label`](commands/ready-label.md), [`sync`](commands/sync.md) and [`hook`](commands/hook.md). You type `check` often; the other four you would rarely type.

### The graph and queries

[`graph`](commands/graph.md) builds `.slicekit/graph/graph.json` from the kit's IDs and from git: requirements, decisions, slices, tests, commits, pull requests and releases. It is not a code graph. The five queries, [`trace`](commands/trace.md), [`impact`](commands/impact.md), [`history`](commands/history.md), [`shipped`](commands/shipped.md) and [`uncovered`](commands/uncovered.md), read only that file; they run no git and no host call. [`visualize`](commands/visualize.md) shows the same file as one page. <!-- slicekit:example -->

**Shared by the five queries.** `--json` prints one JSON document, also on an error (`{"error": …}`). Exit codes: **0** answered; **1** no graph (`run slicekit graph`), a graph of an older schema, or for `shipped` a phase with no release record; **2** bad usage, an ID or path not in the graph, or a config problem.

### Maintenance

The slices' state, the ratchet baselines and the session journal: [`status`](commands/status.md), [`state`](commands/state.md), [`baseline`](commands/baseline.md) and [`journal`](commands/journal.md).

### Ops and audit

The steps of `/slicekit ops` and `/slicekit audit` that the CLI takes: [`ops`](commands/ops.md) and [`audit`](commands/audit.md). Each has a `context` step, which prints what the agent is handed, and a `check` step, which judges the report.

## Conventions

### Global options

- `slicekit --help`: Prints the usage of every command on standard output and exits 0, so `slicekit --help | less` shows it. An unknown command prints the usage on standard error and exits 2.
- `slicekit <command> --help`: Prints that command's usage on standard output and exits 0, for example `slicekit build --help`.
- `slicekit --version`: Prints the installed version on standard output and exits 0.

### Help

Every command takes `--help`: `slicekit build --help` prints the usage of `build` and its subcommands and exits 0. Running `slicekit` with no command, or an unknown one, prints the usage of every command and exits 2.

### A value that starts with a dash

Write it as `--option=<text>`, with the equals sign. Otherwise the value is read as another option. This holds for every option; the procedures always use this form for free text.

```console
$ slicekit decide settle D-09 --answer="-1 means no limit" --type Decision
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. For a gate, the thing checked is ready or clean. |
| 1 | Refused or not ready: a finding, a blocker, a state the step does not run from, or git, the git host or the tracker said no. The message says what to fix. |
| 2 | Cannot run: bad usage, an unknown ID, slice, stage or role, or a missing or invalid `.slicekit/config.json`. |

Five commands differ on purpose: `ci bookkeeping` and `ready-label` exit 0 whatever they decide, `hook` exits 0 for every known hook and puts its decision in the JSON, `baseline show` exits 0 even when a baseline file is damaged, and `status` has no exit 1: it exits 2 for a git host error too.

A held lock on a state file is exit 2 for `state` and `status`, and exit 1 for `build`. Each page's Exit codes section is the full list for its command.

### Config version

`.slicekit/config.json` carries `configVersion`. A config with an older one is migrated on the first command that is not `hook`: the file is written once and each change is printed on stderr. A hook reads the config as migrated and writes nothing. A `configVersion` newer than the kit's is refused with a message naming both versions.

In two cases a command reads the config as migrated, writes nothing and prints one line on stderr saying the config is at the older version and is read as the newer one, unwritten (D-93, D-94):

- `slicekit branch`, of every kind, because it refuses a changed tracked file. The branch is cut first, and the next command writes the migration on it.
- Every command on a slice branch or a slice's review branch, because no build step commits a config change there. The slice whose Expected changes name `.slicekit/config.json` is the exception; its slice branch and its review branch are written and `slicekit build config` commits the change.

A team commits the migration on a plan branch with three commands, run from the default branch after the newer kit is installed:

1. `slicekit branch plan <slug>` cuts the branch and leaves the config as it is.
2. Any command that is not `hook` or `branch`, for example `slicekit status`, writes the migrated config there and prints each change.
3. `slicekit pr open --title <title> --body-file <file> --commit <message> --paths .slicekit/config.json` commits it and opens the pull request, which a human reviews and merges.

If another command ran on the default branch first, for example `slicekit release P<n> --dry-run`, the config is already written there. `slicekit branch`, of every kind, still cuts the branch when the only uncommitted change to a tracked file is the config and it equals what the migration writes from the committed config; the change is carried to the new branch, where `pr open` commits it. Where the branch already holds the migrated config, with equal content, `slicekit branch` drops its own copy of the change and switches; where the branch holds a config that differs, it exits 1 with one line naming the file, the branch and the fields that differ, and the change is left where it is. Any other uncommitted change is refused with `commit or stash your changes first`. A kit before config version 2 refuses a migrated config with `configVersion: must be 1`.

### Other conventions

- Slice IDs are `P<n>/S-<nn>`, for example `P1/S-02`. Decisions are `D-<n>`, gaps `G-<n>`, blockers `B-<n>`, should-haves `H-<n>`, contracts `C-<n>`.
- The commands own git. The developer, the fixer, the reviewer and the auditor write files and report; the ops agent holds read tools only, and its reply is the report. The CLI commits, pushes and opens pull requests. The pre-bash hook refuses git writes from a subagent.
- The git host is GitHub through the `gh` CLI. `SLICEKIT_GITHOST_FIXTURE` and `SLICEKIT_TRACKER_FIXTURE` point the kit at fixture folders instead, as the README walkthrough does.
- Where a command prints a path, it uses forward slashes on every platform.
