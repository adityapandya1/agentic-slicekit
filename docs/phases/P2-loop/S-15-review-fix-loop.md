---
slice: P2/S-15
name: Reviewer, fixer, the loop cap, should-haves
repo: .
group: D
runbook: no
requirements: [REQ-2.6, REQ-2.11]
decisions: []
---

## Done when

1. REQ-2.6 steps 6 to 9, REQ-2.11: verdict files, two rounds then stop, should-have prompt, declined ones as issues through C-2.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/review-loop.test.js » each round writes a verdict file` | happy | REQ-2.11 |
| `commands/review-loop.test.js » a blocker that survives round two stops at changes-requested` | negative | REQ-2.6 |

## Expected changes

`templates/claude-code/commands/slicekit-build.md`, `templates/claude-code/agents/{reviewer,fixer}.md`, tests.
