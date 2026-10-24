---
slice: P2/S-09
name: `instructions` and the agent briefs
repo: .
group: A
runbook: no
requirements: [REQ-2.12]
decisions: []
---

## Done when

1. `slicekit instructions <role> [slice]` returns the brief for each of the six roles from one template set, with the slice file, cited REQ and D rows and the writing rules inlined (REQ-2.12).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `instructions.test.js » each role's brief inlines the slice file, its REQ and D rows and the writing rules` | happy | REQ-2.12 |
| `instructions.test.js » an unknown role exits 2` | negative | REQ-2.12 |

## Expected changes

`src/cli/instructions.js`, `templates/claude-code/agents/`, tests.
