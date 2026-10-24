---
slice: P2/S-10
name: `/slicekit intake`
repo: .
group: B
runbook: no
requirements: [REQ-1.2, REQ-2.2]
decisions: []
---

## Done when

1. REQ-1.2 and REQ-2.2 on the example: a snapshot with sidecar, two-pass interview, one D row per answer, no spec text written.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/intake.test.js » the snapshot and its sidecar are written and no spec file is created` | happy | REQ-1.2, REQ-2.2 |
| `commands/intake.test.js » a spec file at stage intake is a check finding` | negative | REQ-2.2 |

## Expected changes

`templates/claude-code/commands/slicekit-intake.md`, tests.
