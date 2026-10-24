---
slice: P4/S-23
name: `/slicekit ops` and `/slicekit audit`
repo: .
group: B
runbook: no
requirements: [REQ-2.13, REQ-2.14]
decisions: []
---

## Done when

1. REQ-2.13 and REQ-2.14 on the example with a seeded regression.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/ops.test.js » the report lists the slices and pull requests that touched the named files, and nothing else changes` | happy | REQ-2.13 |
| `commands/audit.test.js » a runbook claim a later commit made false is drifted, with that commit` | negative | REQ-2.14 |

## Expected changes

`templates/claude-code/commands/slicekit-{ops,audit}.md`, `templates/claude-code/agents/{ops,auditor}.md`, tests.
