# Slicekit: overview

Slicekit is a way of building software with AI coding agents where the specification stays true
because a machine checks it, not because anyone remembers to update it. It turns a requirement
document into a spec, the spec into phases and slices, each slice into tests and then code through a
build loop with adversarial review, and it keeps a traceable line from every requirement to every
commit, pull request and release.

Source: `../intake/2026-10-24-founding-requirement.md`. Decisions: `../decisions.md`.

## The thesis

Eight well-known kits were studied (OpenSpec, ECC, graphify, ponytail, GSD Core, superpowers,
spec-kit, BMAD). Each is good at one layer: artefact discipline, hook enforcement, context indexing,
behaviour prompts, planning hierarchy, verification habits. None of them does these five things,
and these five are what an enterprise team is missing:

1. Traceability from requirement to test to commit to pull request to release.
2. Test evidence captured where the merge happens, not asserted in chat.
3. A tamper-evident record of what agents did and decided.
4. Drift detection that runs every session and in CI and can fail, not a report someone must ask for.
5. The code checked against the spec, not only the spec against the code.

## Principles

- **Scripts decide, prompts advise.** A rule that lives only in a prompt is a suggestion. Every rule
  in this spec names the script that enforces it or says plainly that it is advisory.
- **One gate, two callers.** The Stop hook and CI run the same `slicekit check`.
- **A document changes only in the pull request whose code made it wrong.** No slice starts a document.
- **Ratchets, not warnings.** A count that may only go down. A warning nobody enforces is a warning
  nobody reads.
- **Absent, not disabled.** A capability a team did not choose is not installed.
- **Agents never run git.** The human's session commits; agents write files and report.
- **State is files.** Nothing the loop needs lives only in a model's context.
- **Adapt, do not build.** Platform, monitoring, tracker and deploy belong to the team.
- **No filler.** Writing says the fact and stops.

## What exists, and what was taken

| Kit | Taken into slicekit |
|---|---|
| OpenSpec | Requirements with SHALL and scenarios; a validator with exit codes; the agent asks the CLI for its brief |
| ECC | Hook-enforced gates outside the prompt; fresh-context review; the harness itself as attack surface |
| graphify | Fail-open hooks with a budget; provenance on derived facts; the lesson not to commit the graph |
| ponytail | A "what I skipped, what I did not check" footer; subagents re-inherit rules |
| GSD Core | Fresh-context executor fed only its brief; numbered decisions a verifier checks; a handoff before compaction |
| superpowers | No completion claim without fresh evidence; spec review separate from quality review |
| spec-kit | A hard marker for unresolved questions; a gap class for code nobody asked for |
| BMAD | Machine-readable state per unit of work; provenance lines carrying the commit they were verified at |
| Redelio | The queue, the fixed pull request body, the decisions inbox, the ratchets, the two-layer branch guard, the independent second-session review, the audit with citations on both sides, skills that carry the scar and end in a checklist |

## Sections

- `01-layout-and-state.md` — what lands in a team's repository and the states work moves through
- `02-commands-agents-loop.md` — the commands, the agents, and the build loop
- `03-hooks-gates-ci.md` — what runs on every tool call, every stop, and in CI
- `04-traceability-graph.md` — the graph, its queries, multi-repo, visualize
- `05-kit-quality-and-release.md` — how the kit tests itself and ships
- `stack.md` — what the kit is written in and why
- `contracts/` — interfaces between the kit and the outside: adapters for git host, tracker, agent tool

## Writing rules for everything the kit produces

These are enforced by the filler ratchet (`03`, REQ-3.10) where a phrase can be matched, and by
the reviewer's brief where it cannot.

- State the fact, the consequence, the check. Not the importance.
- No metaphor in a requirement, a verdict or a runbook.
- A number goes in a table or on its own line.
- Every claim of "done" names the command that proved it and quotes its summary line.
- Every agent reply ends with what it skipped and what it did not check.
