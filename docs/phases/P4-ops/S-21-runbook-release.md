---
slice: P4/S-21
name: Runbook rule and `/slicekit release`
repo: .
group: A
runbook: yes
requirements: [REQ-3.7, REQ-2.9]
decisions: []
---

## Done when

1. REQ-3.7 runbook rule in `check`; REQ-2.9 release records; slices move to `released`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `check/runbook.test.js » a runbook flag with no runbook section changed is a finding` | negative | REQ-3.7 |
| `commands/release.test.js » refuses while a slice of the phase is not merged, naming it` | negative | REQ-2.9 |
| `commands/release.test.js » writes the release record and sets each slice released` | happy | REQ-2.9 |

## Expected changes

`src/check/rules/runbook.js`, `templates/claude-code/commands/slicekit-release.md`, tests.
