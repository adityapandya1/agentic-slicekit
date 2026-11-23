# /slicekit next

Runs the one next step that `slicekit next` prints, then stops. Under `/loop`, it runs one step per iteration.

## What you type

`/slicekit next`, or `/slicekit-next`, in the main checkout. `/loop /slicekit next` runs it once per iteration in one session. Each run reads where the program is from the files, so a step resumes after a restart of the session or a compaction of its context.

## Agents it spawns

The agent the step names, when its command is `instructions <role> <id> --worktree <wt>`: the developer, the reviewer or the fixer, each with its brief as its whole prompt. A reviewer started from the main checkout by `review start`, given only the pull request and the brief, gives an independent verdict.

## Commands its procedure runs

- [`next`](../commands/next.md), once per run
- the one command `next` printed on its second line, and each `then:` line after it: a [`build`](../commands/build.md) step, [`review`](../commands/review.md) as `review start <PR>`, [`instructions`](../commands/instructions.md) for an agent's brief, or a slash command such as `/slicekit release P<n>`

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## A person's step

When the second line starts with `person:`, the procedure prints the step and stops, running nothing: a merge, the approval of a publish, an Open decision row the step depends on, or the review budget stop with its three choices. It never pushes with force; a command that refuses because a branch has diverged from origin goes to the person.

## What it leaves behind

What the one step leaves: a worktree, a commit, a verdict, a pull request. Nothing of its own.

[Back to the guide](../README.md#pages)
