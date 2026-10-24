---
slice: P2/S-14
name: `/slicekit build`, developer, red-then-green
repo: .
group: C
runbook: no
requirements: [REQ-2.6, REQ-2.10]
decisions: []
---

## Done when

1. REQ-2.6 steps 1 to 5 on `examples/backend`: worktree, failing tests committed, freeze, green, draft pull request with the REQ-2.10 body.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/build.test.js » the draft pull request body carries every section` | happy | REQ-2.10 |
| `commands/build.test.js » tests that pass before the build are refused` | negative | REQ-2.6 |

## Expected changes

`templates/claude-code/commands/slicekit-build.md`, `templates/claude-code/agents/developer.md`, `examples/backend/`, tests.
