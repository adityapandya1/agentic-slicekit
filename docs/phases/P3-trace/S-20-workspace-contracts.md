---
slice: P3/S-20
name: Workspace and contracts
repo: .
group: B
runbook: no
requirements: [REQ-4.6]
decisions: []
---

## Done when

1. REQ-4.6: multi-repo build, `produces` and `consumes` edges, `impact` across repositories.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `graph/workspace.test.js » impact on a contract lists its producer and consumer slices and both repositories` | happy | REQ-4.6 |
| `graph/workspace.test.js » a listed repository that is not on disk is reported` | negative | REQ-4.6 |

## Expected changes

`src/graph/workspace.js`, tests.
