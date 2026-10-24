---
slice: P1/S-07
name: Sample slice for the parser
repo: .
group: B
runbook: no
requirements: [REQ-9.1, REQ-9.2]
decisions: [D-90]
---

## Done when

1. The sample command prints `ok` and exits 0.
2. A bad argument exits 2 with the field name.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `sample.test.js » prints ok` | happy | REQ-9.1 |
| `sample.test.js » bad argument exits 2` | negative | REQ-9.1, REQ-9.2 |
| `sample.test.js » end to end run` | e2e | REQ-9.2 |

## Expected changes

`src/sample.js`, `src/cli/`, `test/sample.test.js`.

## Tasks

### Task 1: Sample

- [ ] **Step 1:** nothing.
