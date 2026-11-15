# Check rule: trailer

On a slice branch, every commit the branch adds names the slice in a `Slice:` trailer.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `trailer <file>:<line> <message>`.

## What fails

- `commit <sha7> has no Slice trailer`.
- `commit <sha7> names <other>, branch is <slice>`.

## When it judges

On a slice branch. The commits judged are the first-parent line of the tip, leaving out everything the default branch already holds. A merge commit is exempt, since git writes its message. Under `--ci` the tip is the pull request's head.

## How to clear a finding

Commit through `build commit`, which adds the trailer; the `prepare-commit-msg` hook adds it to a commit made by hand on a slice branch.

## The failure it prevents

A commit lands on the default branch that belongs to no slice, so `trace`, `history` and `uncovered` cannot say which requirement it serves or whether anyone reviewed it.
