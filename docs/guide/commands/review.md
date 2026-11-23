# slicekit review

Checks out a pull request's head for an independent review.

## Usage

```text
slicekit review start <PR>
```

`review start <PR>` checks out the pull request's head in a fresh worktree, `.worktrees/review-P<n>-S-<nn>`, on `slice/P<n>-S-<nn>-review`, which pushes to the slice branch. It prints four lines: `slice`, `worktree`, `round` and `verdict`.

It refuses a pull request that is not open, not a slice pull request or from a fork, and a review worktree with uncommitted changes. A refusal that the head `is not origin/<branch>` can be a push the git host has not seen yet: try once more after a minute.

It is step 2 of `/slicekit review`. The later steps use [`build`](build.md) subcommands with `--worktree <wt>`.

## The independent round budget

An independent review has one round. A second independent round starts only when the first round's verdict holds a blocker. `build verdict --independent` on a verdict with blockers prints `next: fix` and, last, `review: slicekit review start <PR>`, the command of the next independent round, while one is left; that round runs in a new session.

When the last allowed round still holds a blocker, the slice stops: `build verdict --independent` prints `next: stuck`, exits 1, records `changes-requested`, and prints the open blockers, each with its "what is wrong", and three choices. `review start` refuses with the same text, and refuses a further round after a round with no blocker. The person chooses one:

1. Fix the open blockers by hand in the slice worktree and push them with `slicekit build pr <id>`.
2. Re-scope the slice: amend the slice file so the blockers fall outside it, or move them to a new slice.
3. Allow one more round: record a decision row in `decisions.md` whose answer names the slice ID and says "one more round", commit it on the default branch and push it to origin, then run `slicekit review start <PR>` again. Each such row allows one more round, and the row is the record of it.

## What it reads and writes

Reads the pull request from the git host, the state file, the decision rows of `decisions.md` as committed on the default branch, and git. Fetches, and creates the review worktree and its branch.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | ready to review |
| 1 | refused, including no independent round left (D-101) |
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
