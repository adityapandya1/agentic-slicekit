# Observability

## Dashboards

None. The Actions runs page of the repository is the only view of CI (D-79).

## Alert routes

None. A failed run on `main` notifies the author through GitHub's own notifications (D-79).

## Log shape and required fields

The CLI writes findings to stdout and errors to stderr as `slicekit: <message>`; it keeps no log file. The journal (03 REQ-3.8) is the record of agent sessions (D-79).

## Trace and correlation IDs

Slice IDs (`P<n>/S-<nn>`) in branch names, pull request titles and `Slice:` commit trailers join a change across git, the host and the graph (D-79).

## CI steps the monitoring setup requires

None (D-79).

## On-call contact

The author, through the repository's issues (D-79).
