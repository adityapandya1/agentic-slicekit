---
slice: P2/S-11
name: `/slicekit specify`
repo: .
group: B
runbook: no
requirements: [REQ-2.3]
decisions: []
---

## Done when

1. REQ-2.3: spec files in the REQ-1.3 shape, contracts for each interface named at intake, a spec pull request through C-1.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/specify.test.js » one spec file per capability and one contract per interface named at intake` | happy | REQ-2.3 |
| `commands/specify.test.js » a claim no intake sentence or decision supports is written as a clarification marker, not guessed` | negative | REQ-2.3 |

## Expected changes

`templates/claude-code/commands/slicekit-specify.md`, tests.
