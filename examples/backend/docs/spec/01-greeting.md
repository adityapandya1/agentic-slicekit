# 01 — Greeting

## REQ-1.1 Greet a name

`greet(name)` SHALL return `Hello, <name>!` and SHALL refuse an empty name with "a name is required".

Scenario: GIVEN the name Ada WHEN `greet` runs THEN it returns `Hello, Ada!`.

Scenario: GIVEN an empty name WHEN `greet` runs THEN it throws "a name is required".

Cites: D-01.

Enforced by: the tests of P1/S-01.
