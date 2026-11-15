# Check rule: commands

Every command the team declared in the config can be found on this machine.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `commands <file>:<line> <message>`.

## What fails

- `commands.<name>: "<word>" not found on PATH or under node_modules/.bin`, for `test`, `lint`, `build` and `e2e`.
- A local settings file that is tracked by git: it holds one machine's settings and would change every clone's test command.
- A local settings file that cannot be read.

## When it judges

On every run. Nothing is executed. The command is split on `&&`, `||`, `;` and the pipe sign outside quotes; in each part the leading `NAME=value` words are skipped and the first word is looked up, unless it is a shell builtin such as `cd`, `export` or `echo`. A word with a path separator must be a file. An empty command means "not declared" and is not a finding. Outside CI the test command judged is the local one when a local settings file sets it; `check --ci` judges the committed command.

## How to clear a finding

Install the tool, or correct the command in `.slicekit/config.json` and commit it with `build config`.

## The failure it prevents

A typo in the test command, or a tool that is not installed, makes every build step and CI job fail at its first run, long after the config was written, with an error that does not point back at the config.
