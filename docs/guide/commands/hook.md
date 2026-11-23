# slicekit hook

Runs one Claude Code hook handler. Claude Code calls it; a person pipes JSON into it only to test a guard.

## Usage

```text
slicekit hook <name>
```

It reads a JSON object on stdin and prints one JSON decision.

| Name | Claude Code event | On an error |
|---|---|---|
| `session-start` | SessionStart | answers `{}` |
| `pre-bash` | PreToolUse for Bash | denies the tool call |
| `pre-edit` | PreToolUse for Edit, Write, MultiEdit and NotebookEdit | denies the tool call |
| `subagent-start` | SubagentStart | answers `{}` |
| `subagent-stop` | SubagentStop | blocks the stop |
| `pre-compact` | PreCompact | answers `{}` |
| `stop` | Stop | blocks the stop |
| `session-end` | SessionEnd | answers `{}` |

## The pre-edit rules

`pre-edit` judges every path the tool call names, and the first deny wins:

1. A kit-owned file, such as a journal file, a state file or a baseline under `.slicekit/`, is always denied.
2. A path that matches a pattern of `agents.denyPaths` in the config is always denied.
3. While the file's own root has a slice at `tests-red` or `building`, a change to a frozen test of that slice is denied unless `build amend` unfroze it. A test is frozen by its name: the call is denied when it changes the test's text against the red commit, removes it or renames it, and another test or line of the same file may change. A file frozen whole, by a state file written before P8/S-60, is denied for any change.
4. While that slice is at `tests-red` or `building`, a new file under the docs root is denied, except the runbook, a file in the slice's own phase directory, and a path the slice file's `## Expected changes` names. The Expected changes are read from the slice file as committed at `HEAD`, not the working copy, so an edit of the slice file that is not committed by `build amend` adds no exception.

Outside a slicekit project every hook answers `{}`. `init` writes these commands into `.claude/settings.json`.

A hook never rewrites the config: one with an older `configVersion` is read as migrated, and the file is left as it is.

## What it reads and writes

Reads stdin, the config, the state files and git. `stop` runs `check`. `session-end` appends one line to this clone's journal file. No hook writes the config.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | for every known name; the decision is in the JSON |
| 2 | no name, or an unknown name |

## Example

```console
$ echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"},"cwd":"."}' | slicekit hook pre-bash
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"push to protected branch main"}}
```

[Back to the guide](../README.md#pages)
