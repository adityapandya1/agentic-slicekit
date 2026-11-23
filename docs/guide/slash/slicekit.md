# /slicekit

Runs any of the eleven procedures by name. It is the one slash command a person needs to remember.

## What you type

`/slicekit <command> [args]`, where the command is one of `brief`, `intake`, `specify`, `gaps`, `plan`, `build`, `review`, `release`, `ops`, `audit` and `next`. For example `/slicekit build` or `/slicekit review 14`. Each procedure also has a file of its own, so `/slicekit-build` is the same command as `/slicekit build`.

## Agents it spawns

None of its own. The procedure it prints says which agents to spawn; see that procedure's page.

## Commands its procedure runs

- [`instructions`](../commands/instructions.md) as `instructions --command <command> [args]`, then every command the printed procedure names.

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## What it leaves behind

What the named procedure leaves. The command file in `.claude/commands/` holds no rule: it runs `instructions --command` and follows what prints, so an upgrade of the kit changes the procedure without changing the file.

[Back to the guide](../README.md#pages)
