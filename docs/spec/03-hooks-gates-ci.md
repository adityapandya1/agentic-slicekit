# 03 — Hooks, gates, and CI

Every hook is one line that calls the CLI, so the logic is tested in one place. Each hook states
whether it fails open (reports, never blocks) or closed (blocks, with a one-line reason). Decisions
cited: D-05, D-10, D-12, D-19, D-21, D-25.

## REQ-3.1 SessionStart (startup, resume, clear, compact) — fail open

SHALL fetch the default branch and print one line of divergence; print the active slice and its
state; after `compact`, re-inject the active slice's brief from `slicekit instructions`. It SHALL
never pull, merge, or block, and SHALL exit 0 on every failure path saying why.

Scenario: GIVEN no network WHEN a session starts THEN the hook prints "could not fetch origin" and
the session continues.

Enforced by: `slicekit hook session-start`.

## REQ-3.2 PreToolUse on Bash — fail closed

SHALL deny: a commit on a protected branch; a push to a protected branch; any force push; a commit
that changes a file under `intake/`; `git commit`, `git push` or `gh pr` issued while a subagent marker
is active (REQ-2.1); and any command matching the destructive list in config (default: recursive
delete outside the worktree, database drop and truncate statements, history rewrites on shared
branches). Each denial SHALL state the rule and the file or command.

Scenario: GIVEN the current branch is `main` WHEN `git commit` is attempted THEN the hook returns a
deny decision with "commit on protected branch main; create a slice branch".

Enforced by: `slicekit hook pre-bash`.

## REQ-3.3 PreToolUse on Edit and Write — fail closed

SHALL deny an edit to a test file listed as frozen in the active slice's state file unless the slice
file was amended after the freeze (D-10); deny creation of a new file under the docs root while a
slice is `tests-red` or `building`, except the runbook and the slice's own pull request notes; deny
an edit to `journal.log`, `baselines/` or any `state/` file by anything other than the CLI.

Scenario: GIVEN frozen `test/billing.test.js` WHEN the developer edits it THEN the hook denies with
"frozen for P1/S-03; amend the slice file to change the evaluation set".

Enforced by: `slicekit hook pre-edit`.

## REQ-3.4 SubagentStart — fail open

SHALL set the subagent marker for the session and inject the role's brief from
`slicekit instructions <role>`, the writing rules, and the sentence "You never run git; report and
the command commits."

Enforced by: `slicekit hook subagent-start`.

## REQ-3.5 SubagentStop — fail closed, one retry

SHALL check the agent's output shape by role: reviewer produced a verdict file with a verdict line,
findings with "how verified", checklists run and "Not checked"; developer reported each command run
with its summary line and ended with "Skipped:" and "Not checked:"; fixer named each finding ID it
answered. A wrong shape SHALL re-prompt once with the missing parts; a second failure SHALL stop the
loop and report.

Enforced by: `slicekit hook subagent-stop`.

## REQ-3.6 PreCompact — fail open

SHALL write into the active slice's state file: stage, open findings by ID, the last command run and
its result, and the next step, so that REQ-3.1 can restore the loop after compaction.

Enforced by: `slicekit hook pre-compact`.

## REQ-3.7 Stop — fail closed: `slicekit check`

The Stop hook SHALL run `slicekit check`, which exits non-zero on any of:

| Rule | What fails |
|---|---|
| references | a reference in any doc to a file, heading or ID that does not exist, above the baseline; in a slice file whose slice is not yet merged or released, a code-span path on a `**Files:**` line or under `## Expected changes` is a promise and is checked only once the slice merges, while every other path, link and ID in it is checked now |
| style | a phrase from the filler list in any doc, verdict or pull request body, above the baseline (D-25) |
| queue | `BUILD.md` disagrees with `state/` (REQ-1.6) |
| citations | a REQ cites a missing D or intake; a slice names a missing REQ or D; a test in an evaluation set names no REQ |
| coverage | at plan stage or later, a REQ named by no slice |
| trailer | on a slice branch, a commit without the `Slice:` trailer |
| runbook | the slice file's runbook flag is set and the branch changes no section of `runbook.md`, and the pull request body's Runbook line does not begin "no operational change" (D-21) |
| commands | a command declared in config does not exist or exits with "not found" |
| hooks | `.githooks/` is not the configured hooks path, or a rendered hook is missing |
| journal | the hash chain in `journal.log` is broken |
| layout | a path from REQ-1.1 is missing, or a rendered file exists that the shape does not include |

Baselines SHALL only go down: `slicekit baseline update` refuses to raise any count. The one exception is a first adoption: `slicekit baseline update --adopt` records higher counts, prints each one with its previous value, is refused in CI, and a reviewer treats an adopted raise like any other finding. Fixing a
finding by weakening a rule, raising a baseline or deleting a reference target SHALL be a reviewer
blocker.

Scenario: GIVEN a doc that cites `docs/spec/07-nothing.md` WHEN the turn ends THEN the Stop hook
fails with the file, the line and the missing target, and the agent must fix it before the turn is
accepted.

Enforced by: `slicekit check`; the reviewer's brief for the weakening case.

## REQ-3.8 SessionEnd — fail open: the journal

SHALL append one line to `.slicekit/journal.log` in the form
`<iso time> <actor> <slice or "-"> <stage> commits=<shas> verdicts=<ids> decisions=<ids> prev=<hash> hash=<sha256 of this line without the hash field>`.
The first line's `prev` is `genesis`. CI SHALL verify the chain. The file is appended by the CLI only
(REQ-3.3). A broken chain is a check failure and a reviewer blocker; it is never auto-repaired.

Scenario: GIVEN a journal line edited by hand WHEN `slicekit check` runs THEN it fails with "journal
chain broken at line <n>".

Enforced by: `slicekit hook session-end`; `slicekit check` (journal rule).

## REQ-3.9 Git hooks — two layers

Init SHALL write `.githooks/prepare-commit-msg` (adds the `Slice:` trailer from the branch name) and
`.githooks/pre-commit` (refuses a commit on a protected branch), set `core.hooksPath` to `.githooks`,
and `slicekit check` SHALL fail when the hooks path is not set, because git hooks do not survive a
clone. The Claude Code PreToolUse guard covers tool-issued commands; the git hooks cover plain git.
Each alone fails silently.

Enforced by: `slicekit init`, `slicekit check` (hooks rule).

## REQ-3.10 The filler list
<!-- slicekit:style-catalogue -->

`config.style.banned` SHALL be a list of phrases, seeded by the kit with the author's examples and a
short list of agent fillers ("it's worth noting", "robust", "seamlessly", "at the boundary of",
"minting at the gate", "leverage", "delve"), case-insensitive, matched in every markdown file, verdict
and pull request body, counted per file against `baselines/style.json`. The team extends the list in
config; a removal from the list SHALL be a decision row. The files that define the list (config, the
seed template, and this requirement) are exempt, and the check SHALL verify that they still contain
it, so the catalogue cannot be emptied by accident.

Enforced by: `slicekit check` (style rule).

## REQ-3.11 CI: `slicekit.yml`

Init SHALL write a GitHub Actions workflow that, on every pull request: runs `slicekit check --ci`;
runs the team's test, lint, build and e2e commands as declared; runs the observability steps listed in
`observability.md` and config as additional jobs (D-20); fails if the title lacks a slice ID or the
slice's state is before `draft-pr`; fails if the body lacks a section from REQ-2.10; and grants the
`ready` label only when the latest verdict file has zero open blockers and, if required, an
independent verdict exists (REQ-2.8). On merge to the default branch it SHALL run
`slicekit status --sync --write` and commit the state and `BUILD.md` change as a bot commit (D-12).
Actions SHALL be pinned by SHA.

Scenario: GIVEN a pull request titled `Fix billing` WHEN CI runs THEN it fails with "title must begin
with [P<n>/S-<nn>]".

Enforced by: the generated workflow; `slicekit check --ci`.

## REQ-3.12 Rendered files and updates

Every file the kit renders into `.claude/`, `.githooks/` and `.github/workflows/` SHALL carry the
kit version in one of two forms. A file with front matter carries `slicekit-managed: v<version>` in
that front matter and is managed whole, because Claude Code reads front matter only when it starts on
line 1, so no marker may come before it. Any other file SHALL sit between
`<!-- slicekit:managed:start v<version> -->` and `<!-- slicekit:managed:end -->` markers (or the
comment syntax of the file type), and `slicekit update` SHALL replace only the content between the
markers and leave everything outside untouched. `slicekit update` SHALL show the diff for both forms. `slicekit check` SHALL fail when a managed
block's content differs from the installed version's template (drift of the kit's own files).

Enforced by: the renderer; `slicekit check` (managed rule).
