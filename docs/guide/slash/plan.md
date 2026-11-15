# /slicekit plan

Writes the stack, the phases and the slice files from the spec, then opens the plan pull request.

## What you type

`/slicekit plan`. Run it after the gaps pull request merges.

## Agents it spawns

None. The session asks the person one question per stack choice the sources leave open.

## Commands its procedure runs

- [`branch`](../commands/branch.md) as `branch plan <slug>`
- [`plan`](../commands/plan.md) as `plan check`
- [`decide`](../commands/decide.md) as `decide add`, for each stack choice
- [`status`](../commands/status.md) as `status --write`, after each change to a slice file
- [`check`](../commands/check.md), until it reports `0 findings`
- [`pr`](../commands/pr.md) as `pr open --title "[plan] <program name>"`

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## What it leaves behind

The stack file `<docsRoot>/spec/stack.md`. One phase file per milestone with its `**Order:**` line, and the slice files beside it, each with its Done when list, its evaluation set and its expected changes. `BUILD.md` regenerated. One commit and the `[plan] <program name>` pull request. Merging it approves the plan.

[Back to the guide](../README.md#pages)
