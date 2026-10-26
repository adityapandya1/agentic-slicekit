---
slice: P1/S-01
name: Greet a name
repo: .
group: A
runbook: no
requirements: [REQ-1.1]
decisions: [D-01]
---

## Done when

1. `greet('Ada')` returns `Hello, Ada!`.
2. `greet('')` throws "a name is required".

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `greet.test.js » greets a name` | happy | REQ-1.1 |
| `greet-empty.test.js » refuses an empty name` | negative | REQ-1.1 |

## Expected changes

`src/greet.js`, `test/greet.test.js`, `test/greet-empty.test.js`.
