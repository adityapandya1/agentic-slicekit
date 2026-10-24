---
slice: P4/S-22
name: Observability steps in CI
repo: .
group: A
runbook: yes
requirements: [REQ-3.11]
decisions: []
---

## Done when

1. REQ-3.11: steps from `observability.md` and config become workflow jobs; the example carries one.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `workflow.test.js » observability steps from observability.md and config become jobs` | happy | REQ-3.11 |
| `workflow.test.js » an observability step with an empty command renders no job` | negative | REQ-3.11 |

## Expected changes

`src/workflow.js`, `templates/workflow/slicekit.yml`, tests.
