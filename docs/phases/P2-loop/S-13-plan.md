---
slice: P2/S-13
name: `/slicekit plan`
repo: .
group: B
runbook: no
requirements: [REQ-2.5]
decisions: []
---

## Done when

1. REQ-2.5: refuses on markers or open gaps; stack; phases; slice files with evaluation sets; overlap and coverage rules in `check`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/plan.test.js » every requirement is named by a slice and BUILD.md is regenerated` | happy | REQ-2.5 |
| `commands/plan.test.js » refuses while a clarification marker or an open gap exists` | negative | REQ-2.5 |

## Expected changes

`templates/claude-code/commands/slicekit-plan.md`, tests.
