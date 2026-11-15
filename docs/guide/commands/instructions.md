# slicekit instructions

Prints an agent's brief or a slash command's procedure. The rules of every agent and command live here, not in a prompt.

## Usage

```text
slicekit instructions <role> [P<n>/S-<nn>] [--worktree <path> | --summary]
slicekit instructions --command <name> [args...]
```

The first form prints an agent's brief: its rules, the slice file's summary, the cited requirements and decisions, the team's commands, the writing rules and the slice's tasks. Roles: `developer`, `reviewer`, `fixer`, `auditor`, `ops`, `designer`. Without a slice ID it takes the slice from the current branch.

- `--worktree <path>`: the worktree the agent works in; the brief's Where section names it.
- `--summary`: the short form of the brief, which the subagent-start hook injects. It takes no `--worktree`.

The second form prints a slash command's procedure. `--command` must come first; the name is one of `intake`, `specify`, `gaps`, `plan`, `build`, `review`, `release`, `ops`, `audit`. Everything after the name is passed to the procedure unparsed.

Each slash command file runs the second form and follows what it prints; see [the slash commands](../README.md#pages).

## What it reads and writes

Reads the config, the templates the kit ships, the slice file, the spec, the decisions and the current branch. It writes nothing.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | printed |
| 1 | a template the kit does not ship |
| 2 | bad usage, an unknown role, an unknown command name, an argument that is not a slice address, or a config problem |

## Example

```console
$ slicekit instructions developer P1/S-02 --worktree .worktrees/P1-S-02
# Brief: developer
…
$ slicekit instructions --command review 19
# /slicekit review
…
```

[Back to the guide](../README.md#pages)
