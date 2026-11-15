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
