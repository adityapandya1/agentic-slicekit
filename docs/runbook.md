# Runbook: slicekit

## How to run it

Not yet known

## Dependencies and their owners

`gh` (GitHub CLI), authenticated (`gh auth status`), is needed by `slicekit pr open` and the build commands; tests use `SLICEKIT_GITHOST_FIXTURE` instead.

Declined should-haves become GitHub issues through `gh` (`slicekit build decline`), so its login needs permission to open issues in the repository; tests use `SLICEKIT_TRACKER_FIXTURE` instead.

In a fork, run `gh repo set-default` so issues (and pull requests) go to the right repository.

## Known failure modes and the first thing to check

Not yet known

## Actions and who may take them

Not yet known

## Rollback

Not yet known
