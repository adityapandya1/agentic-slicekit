# Check rule: ci-title

Under `--ci`, the pull request's title begins with the slice it delivers, and that slice was opened through the build loop.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `ci-title <file>:<line> <message>`.

## What fails

- `title must begin with [P<n>/S-<nn>]`.
- `slice <id> has no slice file`, or `has no state file`.
- `slice <id> is <state>; open the pull request through /slicekit build`: the slice is before `draft-pr`, so the pull request was opened by hand.
- `slice <id> is <state>; a change after merge needs its own slice`: the slice is `merged` or `released`.
- `a [sync] title belongs to a sync/<short sha> branch`: a `[sync]` title on any other branch.

## When it judges

Only under `check --ci`, and only when the GitHub event holds a pull request. A title that begins `[spec] `, `[plan] ` or `[release] ` is exempt, and so is `[sync] ` on a sync branch. Draft and closed pull requests are judged alike. A pull request opened by an actor listed in `ci.botActors` is exempt.

## How to clear a finding

Open the pull request with `build pr`. For a change to a slice that already merged, plan a new slice.

## The failure it prevents

A pull request opened by hand skips the red tests, the frozen tests and the recorded verdicts, and once it merges no state file or graph edge links its commits to a slice or a requirement.
