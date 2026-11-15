# Check rule: ci-body

Under `--ci`, the pull request's body carries the sections the kit requires.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `ci-body <file>:<line> <message>`.

## What fails

- A slice pull request whose body lacks one of the nine sections: Done when, Proof, Decisions, Runbook, Infra / migration, Try it, Reviewer blocked, Should-haves declined, Skipped / not checked.
- A section that appears twice, is out of order or is empty.
- A body with no `## [P<n>/S-<nn>] <name>` heading naming the slice of the title: `pull request body heading does not name <slice>`.
- A `[spec]`, `[plan]`, `[sync]` or `[release]` pull request whose body lacks Done when, Proof or Decisions; the other six sections are not asked of it.

## When it judges

Only under `check --ci`, and only when the GitHub event holds a pull request. A pull request opened by an actor listed in `ci.botActors` is exempt. `pr open` and `build pr` refuse the same bodies before they push.

## How to clear a finding

Open slice pull requests with `build pr --notes <file>`, which builds the body. For a document pull request, write the three sections into the body file given to `pr open`.

## The failure it prevents

A pull request reaches review with no proof of what was run, no steps to try it and no word on what was skipped, so the reviewer and the person who merges cannot tell what the slice claims or what nobody checked.
