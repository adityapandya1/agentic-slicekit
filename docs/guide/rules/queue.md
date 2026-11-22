# Check rule: queue

`BUILD.md` reads exactly as the slice files and their state say.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `queue <file>:<line> <message>`.

## What fails

- `BUILD.md is missing`, or `has no generated region marker`.
- `BUILD.md row for <slice> says "<a>", state says "<b>"`.
- `BUILD.md row for <slice> has no slice file`, or `BUILD.md lacks a row for <slice>`.
- `BUILD.md is stale`: the generated region differs in order, position or a line outside the rows.

## When it judges

On every run once a slice file or a state file exists, on every branch but a slice branch (`slice/P<n>-S-<nn>-…`; with `--ci`, the pull request's head branch). A slice branch commits no change to `BUILD.md`, so there a `BUILD.md` that differs from state is no finding; the sync pull request after the merge rewrites it on the default branch (D-100). Only the generated region is compared; the text below the marker is the team's.

## How to clear a finding

Run `slicekit status --write`. Never edit the generated region by hand.

## The failure it prevents

The build queue a person reads says a slice is still to do when it is merged, or the reverse, so work is started twice or a release is planned on slices that are not done.
