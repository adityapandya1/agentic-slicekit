# slicekit review

Checks out a pull request's head for an independent review.

## Usage

```text
slicekit review start <PR>
```

`review start <PR>` checks out the pull request's head in a fresh worktree, `.worktrees/review-P<n>-S-<nn>`, on `slice/P<n>-S-<nn>-review`, which pushes to the slice branch. It prints four lines: `slice`, `worktree`, `round` and `verdict`.

It refuses a pull request that is not open, not a slice pull request or from a fork, and a review worktree with uncommitted changes. A refusal that the head `is not origin/<branch>` can be a push the git host has not seen yet: try once more after a minute.

It is step 2 of `/slicekit review`. The later steps use [`build`](build.md) subcommands with `--worktree <wt>`.

## What it reads and writes

Reads the pull request from the git host, the state file and git. Fetches, and creates the review worktree and its branch.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | ready to review |
| 1 | refused |
| 2 | the pull request number is not a positive whole number, or a config problem |

## Example

```console
$ slicekit review start 14
slice P1/S-02
worktree C:/work/orders/.worktrees/review-P1-S-02
round 2
verdict C:/work/orders/P1-S-02-r2.md
```

[Back to the guide](../README.md#pages)
