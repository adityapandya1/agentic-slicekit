---
slice: P3/S-19
name: Visualize
repo: .
group: B
runbook: no
requirements: [REQ-4.7]
decisions: []
---

## Done when

1. REQ-4.7: six views from one static page, no external resource, works from disk.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `visualize.test.js » the page opened from disk with the graph inlined renders the six views` | happy | REQ-4.7 |
| `visualize.test.js » the page loads no external resource` | negative | REQ-4.7 |

## Expected changes

`src/visualize/`, `src/cli/visualize.js`, tests.
