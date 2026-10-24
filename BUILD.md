# BUILD — the queue

One slice, one branch, one pull request. A slice is done when a human has merged it. Status is
`Todo`, `PR #n`, or `Done`. Until S-03 lands this file is kept by hand; after it, `slicekit status
--write` regenerates it from `.slicekit/state/`.

Spec: `docs/spec/`. Decisions: `docs/decisions.md`. Slice files: `docs/phases/`.

## Phase 1 — Spine

Everything later depends on this. After Phase 1 a team can install the kit, and the kit can enforce
its own rules on itself.

| Slice | Name | Done when | Group | Status |
|---|---|---|---|---|
| S-01 | CLI skeleton, config, init | `npx slicekit init --shape backend` writes the layout of REQ-1.1 and REQ-1.11 into an empty repo; `config.json` validates; existing files are never overwritten; `package.json` has no dependencies; npm name reserved (D-26). | A | Todo |
| S-02 | Claude Code renderer and update | Commands, agents, skills and hook registrations render per shape inside managed blocks (REQ-1.10, REQ-3.12); `slicekit update` changes only inside markers and shows a diff; golden files per shape. | A | Todo |
| S-03 | State files, status, BUILD.md | `slicekit state set` is the only writer and refuses a transition whose precondition fails (REQ-1.8); `slicekit status --write` regenerates BUILD.md; `--sync` reads merged pull requests through the stubbed git host (C-1). | A | Todo |
| S-04 | Check: references and style ratchets | The references and style rules of REQ-3.7 with baselines that only go down; `baseline update` refuses to raise a count; the seed filler list (REQ-3.10). | B | Todo |
| S-05 | Check: citations, coverage, queue, commands, layout, managed | The remaining rules of REQ-3.7 except trailer, runbook, hooks and journal, plus the managed-block rule of REQ-3.12; each with a passing and a failing fixture. | B | Todo |
| S-06 | Hooks: session, bash and edit guards, git hooks | REQ-3.1, REQ-3.2, REQ-3.3, REQ-3.9; tested by piping Claude Code's JSON; the hooks and trailer rules join `check`. | C | Todo |
| S-07 | Hooks: subagent shape, compaction handoff, journal | REQ-3.4, REQ-3.5, REQ-3.6, REQ-3.8; the journal rule joins `check`; a hand-edited line breaks the chain in the test. | C | Todo |
| S-08 | CI workflow generator | `slicekit.yml` per REQ-3.11 with SHA-pinned actions, title and body rules, label gate, merge sync; `check --ci` mode. | C | Todo |

Groups: A first (S-01, then S-02 and S-03 in parallel); B and C in parallel after A.

## Phase 2 — Loop

The commands and agents. After Phase 2 a team can go from a requirement document to merged slices.

| Slice | Name | Done when | Group | Status |
|---|---|---|---|---|
| S-09 | `instructions` and the agent briefs | `slicekit instructions <role> [slice]` returns the brief for each of the six roles from one template set, with the slice file, cited REQ and D rows and the writing rules inlined (REQ-2.12). | A | Todo |
| S-10 | `/slicekit intake` | REQ-1.2 and REQ-2.2 on the example: a snapshot with sidecar, two-pass interview, one D row per answer, no spec text written. | B | Todo |
| S-11 | `/slicekit specify` | REQ-2.3: spec files in the REQ-1.3 shape, contracts for each interface named at intake, a spec pull request through C-1. | B | Todo |
| S-12 | `/slicekit gaps` and the auditor | REQ-2.4: the five gap classes, each closed by a D row or a REQ change, a pull request. | B | Todo |
| S-13 | `/slicekit plan` | REQ-2.5: refuses on markers or open gaps; stack; phases; slice files with evaluation sets; overlap and coverage rules in `check`. | B | Todo |
| S-14 | `/slicekit build`, developer, red-then-green | REQ-2.6 steps 1 to 5 on `examples/backend`: worktree, failing tests committed, freeze, green, draft pull request with the REQ-2.10 body. | C | Todo |
| S-15 | Reviewer, fixer, the loop cap, should-haves | REQ-2.6 steps 6 to 9, REQ-2.11: verdict files, two rounds then stop, should-have prompt, declined ones as issues through C-2. | C | Todo |
| S-16 | `/slicekit review` and `--parallel` | REQ-2.7 and REQ-2.8: independent verdict marked as such and required by the label gate; parallel worktrees with overlap detection. | D | Todo |

Groups: A, then B and C in parallel, then D.

## Phase 3 — Trace

| Slice | Name | Done when | Group | Status |
|---|---|---|---|---|
| S-17 | Graph builder | REQ-4.1 to REQ-4.4 on the fixture repository: every node kind and edge kind, incremental rebuild, `gh` cache, offline build marks pull requests stale. | A | Todo |
| S-18 | Queries | REQ-4.5: trace, history, impact, uncovered, shipped, each under two seconds on the 10,000-commit fixture; test-to-REQ linking (REQ-4.3) in `check`. | B | Todo |
| S-19 | Visualize | REQ-4.7: six views from one static page, no external resource, works from disk. | B | Todo |
| S-20 | Workspace and contracts | REQ-4.6: multi-repo build, `produces` and `consumes` edges, `impact` across repositories. | B | Todo |

## Phase 4 — Ops

| Slice | Name | Done when | Group | Status |
|---|---|---|---|---|
| S-21 | Runbook rule and `/slicekit release` | REQ-3.7 runbook rule in `check`; REQ-2.9 release records; slices move to `released`. | A | Todo |
| S-22 | Observability steps in CI | REQ-3.11: steps from `observability.md` and config become workflow jobs; the example carries one. | A | Todo |
| S-23 | `/slicekit ops` and `/slicekit audit` | REQ-2.13 and REQ-2.14 on the example with a seeded regression. | B | Todo |
| S-24 | Examples, walkthrough, publish 0.1 | `examples/fullstack` and `examples/data`; the ten-minute walkthrough runs verbatim in CI on three operating systems; REQ-5.5 to REQ-5.8; repository public (D-28). | C | Todo |
