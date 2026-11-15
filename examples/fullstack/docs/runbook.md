# Runbook: counter

## How to run it

Run `npm test`.

## Dependencies and their owners

Node 22 and nothing else.

## Known failure modes and the first thing to check

A failing test: read its message, then the code it tests. A test that cannot start the server: check that the loopback address accepts a listener.

## Actions and who may take them

None: nothing runs outside the tests.

## Rollback

Revert the pull request.
