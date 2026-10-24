# 02 — Commands, agents, and the build loop

The commands a human runs, the agents those commands spawn, and the loop that turns a slice into a
merged pull request. Decisions cited: D-06, D-07, D-09, D-10, D-18, D-19, D-25.

## REQ-2.1 Commands own git; agents never do

Every git operation (branch, commit, push, pull request, label, issue) SHALL be performed by the
command running in the human's session or by CI. An agent SHALL write files and return a report
(D-19). The SubagentStart hook injects this rule; the PreToolUse guard refuses `git commit`, `git
push` and `gh pr` from a subagent's tool calls.

Scenario: GIVEN the developer agent WHEN it runs `git commit` THEN the guard denies it with "agents
do not run git; report and let the command commit".

Enforced by: PreToolUse guard (03 REQ-3.2) using the subagent marker from SubagentStart.

## REQ-2.2 `/slicekit intake <file or URL>`

SHALL snapshot the source (REQ-1.2), read it, and interview the human in two passes, one topic per
question, offering choices where choices exist: first the product (purpose, users, components,
existing systems, constraints, what is out of scope), then the platform and observability (REQ-1.11).
Every answer SHALL be written as a D-NN row before the next question is asked. The command SHALL not
write any spec text. It ends by printing the open questions it could not get answered.

Scenario: GIVEN a Word document WHEN intake runs THEN `intake/<date>-<slug>.docx` and its sidecar
exist, `decisions.md` has one row per answered question, and no file under `<docsRoot>/spec/` was created.

Enforced by: the command brief; `slicekit check` (no spec files at stage intake).

## REQ-2.3 `/slicekit specify`

SHALL write `spec/<capability>.md` files in the shape of REQ-1.3 from the intake snapshots and
decisions, one capability per file, with `contracts/` entries for every interface between components
or repositories named at intake, then open a pull request titled `[spec] <program name>` (D-07). It
SHALL write `[NEEDS CLARIFICATION: …]` rather than guess. It SHALL not invent a requirement that no
intake sentence or decision supports; each REQ's `Cites:` line is checked.

Scenario: GIVEN a REQ whose `Cites:` names nothing WHEN `slicekit check` runs THEN it fails naming
the REQ.

Enforced by: `slicekit check` (citation rule); the reviewer's brief for the spec pull request.

## REQ-2.4 `/slicekit gaps`

After the spec pull request is merged, SHALL spawn the **auditor** with the spec as claims and the
intake and decisions as evidence, and write `<docsRoot>/spec/gaps.md` with one `G-<n>` row per gap, classified
`missing` (intake says, spec does not), `unsupported` (spec says, nothing supports), `contradiction`,
`unknown` (a "Not yet known" section or an Open decision), or `unrequested`. For each gap it SHALL
ask the human and close the row with a new D-NN or a REQ change, then open a pull request.

Scenario: GIVEN intake names a Kafka topic that no contract file mentions WHEN gaps runs THEN a
`missing` row names the intake line and the topic.

Enforced by: the auditor's brief; `slicekit check` (every G row closed before plan).

## REQ-2.5 `/slicekit plan`

SHALL refuse while any clarification marker or open gap exists. It SHALL write `<docsRoot>/spec/stack.md` if
absent (taking the stack from intake when given, otherwise asking), then phases from the milestones
in intake or decisions, then slice files (REQ-1.5) such that every REQ is named by at least one slice,
no two slices in the same parallel group expect to change the same file or package, and each slice's
evaluation set has at least one `happy` and one `negative` test. It SHALL regenerate `BUILD.md` and
open a pull request titled `[plan] <program name>`.

Scenario: GIVEN two slices in parallel group A both listing `src/billing/` WHEN check runs on the plan <!-- slicekit:example -->
branch THEN it fails naming both slices.

Enforced by: `slicekit check` (coverage rule, overlap rule, evaluation-set rule).

## REQ-2.6 `/slicekit build [P<n>/S-<nn>]`

With no argument SHALL take the first `todo` slice whose parallel-group predecessors are `merged`.
It SHALL then, in order:

1. Create a worktree and the branch `slice/P<n>-S-<nn>-<descr>` from the up-to-date default branch.
2. Spawn **developer** with `slicekit instructions developer P<n>/S-<nn>` (the slice file, the cited
   REQ and D rows, the team's commands, the writing rules). Nothing else.
3. Receive the test files. Run the test command. Require a non-zero exit. Commit. Record the SHA and
   the test file list in the state file; set `tests-red`. If `freezeTests`, the files are now refused
   to Edit and Write for this slice (D-10).
4. Set `building`. Spawn **developer** again (same context if alive, fresh otherwise) to make the
   tests pass. Commit each time the test command's exit code flips to 0 for a new test, with the
   trailer. The developer may ask for a slice-file amendment if a test is wrong; the command asks the
   human, amends the slice file, unfreezes that one file, and records it.
5. Run the test, lint and build commands and `slicekit check`. Push. Open a draft pull request with
   the body of REQ-2.10. Set `draft-pr`.
6. Spawn **reviewer** with the pull request number. Receive the verdict file (REQ-2.11). Set
   `in-review`.
7. If blockers: spawn **fixer** with the verdict, repeat step 5 without reopening the pull request,
   spawn reviewer again. At most two rounds (D-18). A blocker that survives round two stops the loop:
   state `changes-requested`, the pull request stays draft, the command prints what is stuck.
8. For should-haves: ask the human once per round, fix or decline. A decline SHALL be written under
   "Should-haves declined" in the pull request body and opened as a GitHub issue titled
   `[P<n>/S-<nn>] <finding>` with the verdict excerpt (D-09).
9. When the verdict has zero open blockers: mark the pull request ready for review, set `ci-green`
   when CI reports success. Stop. A human merges.

Scenario: GIVEN a developer that returns tests which all pass immediately WHEN step 3 runs THEN the
command refuses to continue and sends the developer back with "the evaluation set must fail before
the build".

Scenario: GIVEN round two's verdict still holds blocker B-1 WHEN step 7 completes THEN the state is
`changes-requested`, no third reviewer is spawned, and the pull request body's "Reviewer blocked"
line names B-1.

Enforced by: the command; `slicekit state set` preconditions (REQ-1.8).

## REQ-2.7 `/slicekit build --parallel P<n>`

SHALL run step 1 to step 5 of REQ-2.6 for every `todo` slice in one parallel group at once, each in
its own worktree, then run steps 6 to 9 for each in turn (D-06). State files are per slice so the
runs never write the same file. If two runs modify the same path despite the plan, the second to
push SHALL stop and report the overlap as a plan defect.

Enforced by: the command; per-slice state files (D-22).

## REQ-2.8 `/slicekit review <PR>`

SHALL be run in a session with no context from the building session, by default required before
merge (D-18). It spawns **reviewer** in a fresh worktree of the pull request head, writes a verdict
file marked `independent`, and, on blockers, offers to spawn **fixer** in that worktree; the command
then commits and pushes to the slice branch. This round does not count against REQ-2.6's two.

Scenario: GIVEN `review.independent: required` and no independent verdict WHEN CI evaluates the
`ready` label THEN the label is withheld with "independent review missing".

Enforced by: CI label rule (03 REQ-3.11).

## REQ-2.9 `/slicekit release P<n>`

SHALL refuse unless every slice in the phase is `merged` and the runbook rule (03 REQ-3.7) is green
for each. It writes `releases/P<n>.md` listing every REQ delivered, every pull request, every decision
taken in those pull requests, the commit SHA of the default branch at that moment, and the rollback
note from the runbook. It sets each slice `released`. It does not deploy (D-12).

Enforced by: the command; `slicekit state set`.

## REQ-2.10 The pull request body

Every pull request the kit opens SHALL carry exactly these sections, in this order, none empty:

```
## [P<n>/S-<nn>] <slice name>
**Done when:** <the checks from the slice file>
**Proof:** <test command and its summary line> · <CI run link>
**Decisions:** <one line each, or "none">
**Runbook:** <section changed, or "no operational change: <reason>">
**Infra / migration:** none | <file> — <how it is applied, and in what order with the code>
**Try it:** <three steps a human does>
**Reviewer blocked:** <finding and what fixed it — or "nothing">
**Should-haves declined:** <issue links — or "none">
**Skipped / not checked:** <what the agents did not verify>
```

Enforced by: CI (body rule), `slicekit check --ci`.

## REQ-2.11 The verdict file

A reviewer SHALL write `.slicekit/reviews/P<n>-S-<nn>-r<k>.md` (committed with the slice) containing a
verdict line `BLOCK | CHANGES | APPROVE`, a table of findings each with ID `B-<n>` (blocker) or
`H-<n>` (should-have), file and line, what is wrong, why it matters, and how it was verified (a
command run and its output, or "read only"), then the list of checklists run, then "Not checked".
A finding without a "how verified" entry SHALL fail the SubagentStop shape check.

Enforced by: SubagentStop hook (03 REQ-3.5).

## REQ-2.12 The agents

Six agents, rendered according to shape (REQ-1.10). Each is read from `slicekit instructions <role>`
so the rules have one home.

| Agent | Writes | Never |
|---|---|---|
| developer | tests, then code, in the worktree; a report of commands run and their summary lines | git; files outside the slice's expected set without saying so; a document |
| reviewer | a verdict file | code; questions; praise |
| fixer | code changes answering named findings | new features; tests the verdict did not ask for |
| auditor | a gaps file or an audit report with a citation on both sides | code |
| ops | a proposed-actions report | any change to infrastructure or code |
| designer (fullstack only) | a verdict on a screen against the team's design rules | code |

Every agent's reply SHALL end with "Skipped:" and "Not checked:" lines (ponytail's footer).

Enforced by: SubagentStop shape check; SubagentStart injection.

## REQ-2.13 `/slicekit ops <symptom>`

SHALL spawn **ops** with the runbook, `observability.md`, the output of `slicekit history` for the
files or services named in the symptom, and the last release record. It returns the likely slices
and pull requests, the first checks from the runbook, and proposed actions marked by who may take
them. It never executes an action.

Enforced by: the agent's tool list (read only).

## REQ-2.14 `/slicekit audit [area]`

SHALL spawn **auditor** with the spec and runbook as claims and the code, tests and CI history as
evidence, and write a report listing each claim as `holds`, `drifted` (with the commit that broke it,
from `slicekit history`) or `unverifiable`. It is the code-to-spec direction of drift checking. It
changes nothing.

Enforced by: advisory, by design; its findings become slices or decisions.
