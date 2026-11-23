# /slicekit review

Gives a slice pull request its independent verdict, from a session that holds no context of the build.

## What you type

`/slicekit review <PR>`, in a new Claude Code session, after `/slicekit build` reports `ready: waiting for an independent review`. The kit cannot check that the session is new; that is left to the person who starts it.

## Agents it spawns

The reviewer, in a fresh worktree of the pull request's head, with the brief from `instructions reviewer <id> --worktree <wt>`. On blockers, and only when the person says yes, the fixer.

## Commands its procedure runs

- [`review`](../commands/review.md) as `review start <PR>`
- [`instructions`](../commands/instructions.md) as `instructions reviewer` and, for a fix, `instructions fixer`
- [`build`](../commands/build.md) with `--worktree <wt>`: `build verdict --independent`; `build decline`; for a fix `build commit --require-green` and `build pr`; `build sync`; `build finish`

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## The round budget

One independent round. A second independent round only when the first one's verdict holds a blocker: after a fix, `build verdict --independent` prints a `review:` line, `review: slicekit review start <PR>`, and the person runs `/slicekit review <PR>` again in a new session. When the last allowed round still holds a blocker the slice stops at `changes-requested`: the procedure prints the open blockers and three choices and stops. The person fixes the blockers by hand and pushes them with `build pr`, re-scopes the slice, or allows one more round with a decision row whose answer names the slice ID and says "one more round", committed and pushed on the default branch. The reviewer reports no style findings and writes no finding when it has none.

## What it leaves behind

The review worktree `.worktrees/review-P<n>-S-<nn>`. A verdict file marked independent, committed and pushed to the slice branch; it does not count against the build's two rounds. After a fix, new commits on the slice branch and a new independent verdict on the new head. The slice at `ready` when CI is green and the verdict has no open blocker. A person merges.

[Back to the guide](../README.md#pages)
