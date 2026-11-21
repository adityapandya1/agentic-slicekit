## Problem and who has it

Callers of the greeting service need one way to greet a person by name.

## What they do today

Each caller builds the greeting text itself.

## Use cases

A caller passes a name to `greet(name)` and gets back `Hello, <name>!`.

## Out of scope

Greetings in another language, and any greeting other than `Hello`.

## Success measures

`greet("Ada")` returns `Hello, Ada!`, and an empty name is refused.

## Constraints

An empty name is a mistake by the caller, so the service refuses it instead of greeting nobody.

## Open questions

Whether a name made only of spaces counts as empty.
