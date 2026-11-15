# Observability

The example runs only as its tests, so the test output is all there is to observe, and a TAP report of that output is the one step CI runs for it.

## Dashboards

None.

## Alert routes

None.

## Log shape and required fields

None: the server writes no log.

## Trace and correlation IDs

None.

## CI steps the monitoring setup requires

| Step | Command |
|---|---|
| Test report as TAP | `node --test --test-reporter=tap` |

## On-call contact

None.
