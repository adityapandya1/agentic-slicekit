---
slice: P4/S-24
name: Examples, walkthrough, publish 0.1
repo: .
group: C
runbook: no
requirements: [REQ-4.8, REQ-5.4, REQ-5.5, REQ-5.6, REQ-5.7, REQ-5.8]
decisions: [D-28]
---

## Done when

1. `examples/fullstack` and `examples/data`; the ten-minute walkthrough runs verbatim in CI on three operating systems; REQ-5.5 to REQ-5.8; repository public (D-28).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `walkthrough.test.js » the README walkthrough's commands exit 0 on examples/backend` | e2e | REQ-5.7 |
| `examples.test.js » every example checks green` | happy | REQ-5.5 |
| `examples.test.js » a rendered adapter file that differs from its template fails, naming the file` | negative | REQ-5.5 |
| `runbook.test.js » the kit's runbook naming a missing file fails references` | negative | REQ-5.8 |

## Expected changes

`examples/fullstack/`, `examples/data/`, `README.md`, `docs/`, tests.
