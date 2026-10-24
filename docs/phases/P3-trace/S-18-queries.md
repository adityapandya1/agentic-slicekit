---
slice: P3/S-18
name: Queries
repo: .
group: B
runbook: no
requirements: [REQ-4.5, REQ-4.3]
decisions: []
---

## Done when

1. REQ-4.5: trace, history, impact, uncovered, shipped, each under two seconds on the 10,000-commit fixture; test-to-REQ linking (REQ-4.3) in `check`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `graph/queries.test.js » history lists the slices that touched a path, newest first` | happy | REQ-4.5 |
| `check/citations.test.js » a new test file on a slice branch naming no requirement is a finding` | negative | REQ-4.3 |

## Expected changes

`src/graph/queries.js`, `src/cli/{trace,history,impact,uncovered,shipped}.js`, `src/check/rules/citations.js`, tests.
