---
slice: P2/S-16
name: `/slicekit review` and `--parallel`
repo: .
group: E
runbook: no
requirements: [REQ-2.7, REQ-2.8]
decisions: []
---

## Done when

1. REQ-2.7 and REQ-2.8: independent verdict marked as such and required by the label gate; parallel worktrees with overlap detection.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/review.test.js » the verdict of an independent review is marked independent` | happy | REQ-2.8 |
| `commands/review.test.js » the ready label is withheld without an independent verdict` | negative | REQ-2.8 |
| `commands/build-parallel.test.js » a second run changing the same path stops as a plan defect` | negative | REQ-2.7 |

## Expected changes

`templates/claude-code/commands/slicekit-review.md`, `templates/claude-code/commands/slicekit-build.md`, tests.
