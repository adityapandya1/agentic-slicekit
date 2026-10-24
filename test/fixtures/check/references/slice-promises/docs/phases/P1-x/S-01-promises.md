---
slice: P1/S-01
name: Promises
repo: .
group: B
runbook: no
requirements: [REQ-1.1]
decisions: [D-01]
---

## Done when

1. It works, per [the core](../../spec/01-core.md).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `a.test.js » works` | happy | REQ-1.1 |

## Expected changes

`src/promised.js` and `test/promised.test.js`.

## Tasks

### Task 1

**Files:** Create `src/also-promised.js`, `docs/spec/promised.md`.
