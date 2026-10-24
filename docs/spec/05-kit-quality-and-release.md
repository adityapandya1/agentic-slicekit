# 05 — How the kit tests itself and ships

## REQ-5.1 Repository layout of the kit

The kit's own repository SHALL have this layout:

```
bin/slicekit.js          entry; dispatches subcommands
src/
  cli/                   one file per subcommand
  check/                 one file per rule in 03 REQ-3.7
  state/                 the only writer of .slicekit/state and BUILD.md
  journal/               append and verify
  render/                templates → adapter files, managed blocks, update
  graph/                 build, cache, queries
  visualize/             server and the single page
  hooks/                 the handlers each hook line calls
templates/
  claude-code/           commands/, agents/, skills/, settings.hooks.json
  docs/                  the skeletons from 01 REQ-1.1 and REQ-1.11
  workflow/slicekit.yml
  githooks/
  style.json             the filler seed list
examples/
  backend/               a tiny service with two slices, used by the end-to-end test
  fullstack/
  data/
test/                    node:test; fixtures beside the tests
docs/                    this spec, the decisions, the kit's own runbook, the user guide
BUILD.md                 the kit's own queue
```

Scenario: GIVEN a slice in the kit's `BUILD.md` WHEN it adds a module THEN the module sits in the
directory above that names its job.

Cites: D-04, D-05, D-16, D-29.

Enforced by: advisory; no script checks the kit's own layout yet.

## REQ-5.2 Tests

Every check rule SHALL have a passing fixture and a failing fixture. The renderer SHALL have golden
files per shape. Every hook SHALL be tested by piping the JSON Claude Code sends on stdin and
asserting the JSON decision on stdout. The graph SHALL be tested against a fixture repository built
in a temporary directory with real commits, branches and trailers, including the 10,000-commit
performance case of 04 REQ-4.5. The end-to-end test SHALL run on each `examples/*`: init, check
green, a scripted slice through `tests-red → building → draft-pr` with a stubbed `gh`, graph, and
every query. The suite SHALL pass on Windows, macOS and Linux in CI.

Scenario: GIVEN the PreToolUse handler WHEN its test pipes the JSON Claude Code sends for
`git commit` on `main` THEN stdout carries a deny decision.

Cites: D-16, D-29.

Enforced by: the kit's own `slicekit.yml`.

## REQ-5.3 Zero dependencies, verified

`package.json` SHALL have no `dependencies`. CI SHALL fail if one appears. Development dependencies
are permitted only for the optional headless-browser check of visualize.

Scenario: GIVEN `package.json` with an entry under `dependencies` WHEN the kit's CI runs THEN it
fails naming that entry.

Cites: D-04.

Enforced by: a check in the kit's own CI.

## REQ-5.4 The kit builds itself

From its first slice, the kit's own development SHALL run on the kit: this spec in its format, its
phases in `BUILD.md`, its slices through `/slicekit build`, its pull requests with the body of 02
REQ-2.10, its journal and its graph (D-16). Until Phase 1 produces a working `check`, the Stop hook
runs the pieces that exist; the first slice to land is the one that makes the rest enforceable.

Scenario: GIVEN a slice of the kit WHEN its pull request opens THEN the body carries the sections of
02 REQ-2.10 and every commit on the branch carries the `Slice:` trailer.

Cites: D-16.

Enforced by: the kit's own `.claude/` and workflow, rendered from its own templates.

## REQ-5.5 The kit's own CI holds itself to its rules

In addition to REQ-5.2: rendered adapter files in `examples/*` SHALL match the templates; actions
SHALL be pinned by SHA; a release SHALL carry provenance attestations; `slicekit check` SHALL run on
the kit's own repository; and the filler ratchet applies to the kit's own docs and README.

Scenario: GIVEN a rendered adapter file in an example that differs from its template WHEN the kit's
CI runs THEN it fails naming the file.

Cites: D-16, D-25.

Enforced by: the kit's own workflow.

## REQ-5.6 Versioning and update

The package SHALL follow semantic versioning. `config.json` SHALL carry `configVersion`, and the CLI
SHALL migrate an older config forward on first run, printing what changed. `slicekit update` SHALL
re-render managed blocks only (03 REQ-3.12) and print a diff per file before writing, with `--yes`
to skip the prompt in CI.

Scenario: GIVEN a config with an older `configVersion` WHEN the CLI first runs THEN it migrates the
config forward and prints each change.

Cites: `../intake/2026-10-24-founding-requirement.md`.

Enforced by: `slicekit update`; a test per config migration.

## REQ-5.7 Distribution

The package SHALL be published to npm as `slicekit` (D-02, D-26), runnable as `npx slicekit init`
with Node 22 or later (D-29). The repository is `github.com/adityapandya1/agentic-slicekit` under MIT
(D-03). The README SHALL open with what the kit is in two sentences, then a ten-minute walkthrough on
`examples/backend`, then the scope line from 04 REQ-4.8. The repository stays private until Phase 1
passes its own check and the walkthrough works (D-28).

Scenario: GIVEN the README WHEN the CI step runs the ten-minute walkthrough's commands verbatim on
`examples/backend` THEN every command exits 0.

Cites: D-02, D-03, D-26, D-28, D-29.

Enforced by: the release workflow; a CI step that runs the walkthrough's commands verbatim.

## REQ-5.8 The kit's own runbook and docs

The kit SHALL keep `docs/runbook.md` for itself (how to release, how to roll back a bad version on
npm, how to debug a hook on Windows), a user guide with one page per command and one page per check
rule stating the failure that justifies it, and `docs/adapters.md` describing the contracts in
`spec/contracts/` for anyone adding a git host, tracker or agent tool.

Scenario: GIVEN `docs/runbook.md` naming a file that no longer exists WHEN `slicekit check` runs on
the kit THEN the references rule fails naming the line.

Cites: D-09, D-21.

Enforced by: the references and style rules of `slicekit check` on the kit's own repository.
