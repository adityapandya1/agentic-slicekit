---
slice: P3/S-17
name: Graph builder
repo: .
group: A
runbook: no
requirements: [REQ-4.1, REQ-4.2, REQ-4.3, REQ-4.4]
decisions: []
---

## Done when

1. REQ-4.1 to REQ-4.4 on the fixture repository: every node kind and edge kind, incremental rebuild, `gh` cache, offline build marks pull requests stale.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `graph/build.test.js » every node kind and edge kind on the fixture repository` | happy | REQ-4.1 |
| `graph/build.test.js » a test naming a requirement gets a covers edge with its file and line` | happy | REQ-4.3 |
| `graph/build.test.js » a second run walks only the new commit` | happy | REQ-4.4 |
| `graph/build.test.js » with no network the build marks pull requests stale` | negative | REQ-4.2 |

## Expected changes

`src/graph/`, `src/cli/graph.js`, tests.
