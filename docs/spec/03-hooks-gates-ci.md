# 03 — Hooks, gates, and CI

Every hook is one line that calls the CLI, so the logic is tested in one place. Each hook states
whether it fails open (reports, never blocks) or closed (blocks, with a one-line reason).

## REQ-3.1 SessionStart (startup, resume, clear, compact) — fail open

SHALL fetch the default branch and print one line of divergence; print the active slice and its
state; after `compact`, re-inject the active slice's brief from `slicekit instructions`. It SHALL
never pull, merge, or block, and SHALL exit 0 on every failure path saying why.

Scenario: GIVEN no network WHEN a session starts THEN the hook prints "could not fetch origin" and
the session continues.

Cites: D-05, `../intake/2026-10-24-founding-requirement.md`.

Enforced by: `slicekit hook session-start`.

## REQ-3.2 PreToolUse on Bash — fail closed

SHALL deny: a commit on a protected branch; a push to a protected branch; any force push; a commit
that changes a file under `<docsRoot>/intake/`; `git commit`, `git push` or `gh pr` issued from inside a subagent, which
the hook knows by the `agent_id` field Claude Code sends on every tool call a subagent makes (REQ-2.1); and any command matching the destructive list in config (default: recursive
delete outside the worktree, database drop and truncate statements, history rewrites on shared
branches). Each denial SHALL state the rule and the file or command.

Scenario: GIVEN the current branch is `main` WHEN `git commit` is attempted THEN the hook returns a
deny decision with "commit on protected branch main; create a slice branch".

Cites: D-05, D-08, D-19.

Enforced by: `slicekit hook pre-bash`.

## REQ-3.3 PreToolUse on Edit and Write — fail closed

SHALL deny an edit to a test file listed as frozen in the active slice's state file unless the slice
file was amended after the freeze (D-10); deny creation of a new file under the docs root while a
slice is `tests-red` or `building`, except the runbook and the slice's own pull request notes; deny
an edit to `.slicekit/baselines/`, any `.slicekit/state/` file or any file under the journal
directory (`.slicekit/journal/<branch>.log`, REQ-3.8) by anything other than the CLI.

Scenario: GIVEN frozen `test/billing.test.js` WHEN the developer edits it THEN the hook denies with <!-- slicekit:example -->
"frozen for P1/S-03; amend the slice file to change the evaluation set".

Cites: D-05, D-10, D-22.

Enforced by: `slicekit hook pre-edit`.

## REQ-3.4 SubagentStart — fail open

SHALL set the subagent marker for the session and inject the role's brief from
`slicekit instructions <role>`, the writing rules, and the sentence "You never run git; report and
the command commits."

Scenario: GIVEN the build command spawns the developer WHEN SubagentStart fires THEN the subagent
marker is set and the injected context ends with "You never run git; report and the command
commits."

Cites: D-05, D-19.

Enforced by: `slicekit hook subagent-start`.

## REQ-3.5 SubagentStop — fail closed, one retry

SHALL check the agent's output shape by role: reviewer produced a verdict file with a verdict line,
findings with "how verified", checklists run and "Not checked"; developer reported each command run
with its summary line and ended with "Skipped:" and "Not checked:"; fixer named each finding ID it
answered. A wrong shape SHALL re-prompt once with the missing parts; a second failure SHALL stop the
loop and report.

Scenario: GIVEN a developer reply with no "Skipped:" line WHEN SubagentStop fires THEN the agent is
re-prompted once with the missing line, and a second reply without it stops the loop with a report.

Cites: D-05, `../intake/2026-10-24-founding-requirement.md`.

Enforced by: `slicekit hook subagent-stop`.

## REQ-3.6 PreCompact — fail open

SHALL write into the active slice's state file: stage, open findings by ID, the last command run and
its result, and the next step, so that REQ-3.1 can restore the loop after compaction.

Scenario: GIVEN an active slice at `building` with open finding B-1 WHEN PreCompact fires THEN the
slice's state file holds the stage, B-1, the last command and its result, and the next step.

Cites: D-05, D-22.

Enforced by: `slicekit hook pre-compact`.

## REQ-3.7 Stop — fail closed: `slicekit check`

The Stop hook SHALL run `slicekit check`, which exits non-zero on any of:

| Rule | What fails |
|---|---|
| references | a reference in any doc to a file, heading or ID that does not exist, above the baseline; in a slice file whose slice is not yet merged or released, a code-span path on a `**Files:**` line or under `## Expected changes` is a promise and is checked only once the slice merges, while every other path, link and ID in it is checked now; a link resolves against its doc's directory (or the root when it starts with `/`), a backticked path also against the root, and a reference-style link at its definition line; a file under `<docsRoot>/intake/` whose sidecar's SHA-256 matches its bytes is exempt because it is frozen (REQ-1.2), while one without a valid sidecar is checked like any doc and is itself a finding; and in `BUILD.md` the generated region's paths are not checked because it is a view of the slice files, which are checked themselves (IDs in it are still checked) |
| style | a phrase from the filler list in any doc, verdict or pull request body, above the baseline (D-25); a file under `<docsRoot>/intake/` whose sidecar's SHA-256 matches its bytes is exempt because it is frozen (REQ-1.2), and one without a valid sidecar is checked like any doc |
| queue | `BUILD.md` disagrees with `.slicekit/state/` (REQ-1.6) |
| citations | a REQ cites a missing D or intake; a slice names a missing REQ or D; a test in an evaluation set names no REQ |
| coverage | at plan stage or later, a REQ named by no slice, a slice listing no expected changes, or two slices in one parallel group expecting the same path (REQ-2.5) |
| trailer | on a slice branch, a first-parent commit not reachable from the default branch, local or on origin, whose `Slice:` trailer, as git reads it, is missing or names another slice; merge commits are exempt |
| runbook | the slice file's runbook flag is set and the branch changes no section of `runbook.md`, and the pull request body's Runbook line does not begin "no operational change" (D-21) |
| commands | a command declared in config does not exist or exits with "not found" |
| hooks | `core.hooksPath` does not resolve to `.githooks`, or one of the three slicekit git hooks is missing or not executable |
| journal | the hash chain in any `.slicekit/journal/<branch>.log` is broken |
| layout | a path from REQ-1.1 is missing, or a rendered file exists that the shape does not include |

For `references`, a line carrying `<!-- slicekit:pending P<n>/S-<nn> -->` (outside a code span) names the slice that will create its paths: they are not checked while that slice is neither merged nor released, and once it is they are checked and the marker itself is a finding until removed; `<!-- slicekit:example -->` marks a true illustration only.

Baselines SHALL only go down: `slicekit baseline update` refuses to raise any count. The one exception is a first adoption: `slicekit baseline update --adopt` records higher counts, prints each one with its previous value, is refused in CI, and a reviewer treats an adopted raise like any other finding. Fixing a
finding by weakening a rule, raising a baseline or deleting a reference target SHALL be a reviewer
blocker.

Scenario: GIVEN a doc that cites `docs/spec/07-nothing.md` WHEN the turn ends THEN the Stop hook <!-- slicekit:example -->
fails with the file, the line and the missing target, and the agent must fix it before the turn is
accepted.

Cites: D-21, D-25, D-31, `../intake/2026-10-24-founding-requirement.md`.

Enforced by: `slicekit check`; the reviewer's brief for the weakening case.

## REQ-3.8 SessionEnd — fail open: the journal

SHALL append one line to the current branch's file, `.slicekit/journal/<branch>.log` (`/` in the
branch name becomes `__`), in the form <!-- slicekit:example -->
`<iso time> actor=<actor> slice=<slice or "-"> stage=<stage> commits=<shas> verdicts=<ids> decisions=<ids> prev=<hash> hash=<sha256 of this line without the hash field>`.
There is one file per branch, each its own chain whose first line's `prev` is `genesis`, because two
branches appending to one file would both chain from the same line and break it at merge (D-34). CI SHALL verify the chain. The file is appended by the CLI only
(REQ-3.3). A broken chain is a check failure and a reviewer blocker; it is never auto-repaired.

Scenario: GIVEN a journal line edited by hand WHEN `slicekit check` runs THEN it fails with "journal
chain broken at line <n> of <file>".

Cites: D-32, D-34, `../intake/2026-10-24-founding-requirement.md`.

Enforced by: `slicekit hook session-end`; `slicekit check` (journal rule).

## REQ-3.9 Git hooks — two layers

Init SHALL write `.githooks/prepare-commit-msg` (adds the `Slice:` trailer from the branch name) and
`.githooks/pre-commit` and `.githooks/pre-merge-commit` (refuse a commit on a protected branch; the
same check runs in `prepare-commit-msg`, so cherry-pick, revert and rebase are covered), set `core.hooksPath` to `.githooks`,
and `slicekit check` SHALL fail when the hooks path is not set, because git hooks do not survive a
clone. The Claude Code PreToolUse guard covers tool-issued commands; the git hooks cover plain git.
Each alone fails silently. Because the protected-branch check also runs from `prepare-commit-msg`,
`git commit --no-verify` does not bypass it; `ALLOW_PROTECTED_COMMIT=1` is the one escape.

Scenario: GIVEN a fresh clone in which `core.hooksPath` is not set WHEN `slicekit check` runs THEN
the hooks rule fails and says the hooks path is not `.githooks`.

Cites: D-05, `../intake/2026-10-24-founding-requirement.md`.

Enforced by: `slicekit init`, `slicekit check` (hooks rule).

## REQ-3.10 The filler list
<!-- slicekit:style-catalogue -->

`config.style.banned` SHALL be a list of phrases, seeded by the kit with the author's examples and a
short list of agent fillers ("it's worth noting", "robust", "seamlessly", "at the boundary of",
"minting at the gate", "leverage", "delve"), case-insensitive, matched in every markdown file, verdict
and pull request body, counted per file against `.slicekit/baselines/style.json`. The team extends the list in
config; a removal from the list SHALL be a decision row. The files that define the list (config and
the seed template) are exempt, and the check SHALL verify that the configured list still contains
every seed phrase; a document that carries `<!-- slicekit:style-catalogue -->` is exempt from the
ratchet within the marked section and SHALL contain every seed phrase, so the catalogue cannot be
emptied by accident. A missing seed phrase is a catalogue finding, and `slicekit baseline update
--adopt` SHALL refuse to adopt one.

Scenario: GIVEN a doc that holds one more banned phrase than its style baseline allows WHEN
`slicekit check` runs THEN the style rule fails naming the file and the line.

Cites: D-25.

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

Scenario: GIVEN a pull request titled `Fix billing` WHEN CI runs THEN it fails with "title must
begin with [P<n>/S-<nn>]".

Cites: D-12, D-18, D-20.

Enforced by: the generated workflow; `slicekit check --ci`.

## REQ-3.12 Rendered files and updates

Every file the kit renders into `.claude/`, `.githooks/` and
`.github/workflows/` SHALL carry the <!-- slicekit:pending P1/S-08 -->
kit version in one of two forms. A file with front matter carries `slicekit-managed: v<version>` in
that front matter and is managed whole, because Claude Code reads front matter only when it starts on
line 1, so no marker may come before it. Any other file SHALL sit between
`<!-- slicekit:managed:start v<version> -->` and `<!-- slicekit:managed:end -->` markers (or the
comment syntax of the file type), and `slicekit update` SHALL replace only the content between the
markers and leave everything outside untouched. `slicekit update` SHALL show the diff for both forms. `slicekit check` SHALL fail when a managed
block's content differs from the installed version's template (drift of the kit's own files).

Scenario: GIVEN a rendered file with markers and a line the team added outside them WHEN
`slicekit update` runs THEN the added line is kept and only the content between the markers is
replaced.

Cites: D-05.

Enforced by: the renderer; `slicekit check` (managed rule).
