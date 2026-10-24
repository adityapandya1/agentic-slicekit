---
slice: P2/S-12
name: `/slicekit gaps` and the auditor
repo: .
group: B
runbook: no
requirements: [REQ-2.4]
decisions: []
---

## Done when

1. REQ-2.4: the five gap classes, each closed by a D row or a REQ change, a pull request.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/gaps.test.js » each of the five gap classes is written as a G row` | happy | REQ-2.4 |
| `commands/gaps.test.js » an interface named at intake and in no contract is a missing row naming the intake line` | negative | REQ-2.4 |

## Expected changes

`templates/claude-code/commands/slicekit-gaps.md`, `templates/claude-code/agents/auditor.md`, tests.
