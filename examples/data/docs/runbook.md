# Runbook: sales

## How to run it

Run `npm test`.

## Dependencies and their owners

Node 22 and nothing else.

## Known failure modes and the first thing to check

A failing test: read its message, then the code it tests. A total that is off: check `data/sales.csv` still holds its five rows.

## Actions and who may take them

None: nothing runs outside the tests.

## Rollback

Revert the pull request.
