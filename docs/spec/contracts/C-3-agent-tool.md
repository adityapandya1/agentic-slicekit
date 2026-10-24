# C-3 Agent tool adapter

**Producer:** the kit (`src/render/` and `src/hooks/`). **Consumer:** the agent tool the team uses.
**Version one implementation:** Claude Code (D-05).

A renderer SHALL take the shape and config and produce, for its tool: the command files, the agent
briefs, the skills, and the hook registrations, each inside managed-block markers (03 REQ-3.12). The
hook handlers themselves are tool-neutral CLI subcommands that read JSON on stdin and write a JSON
decision on stdout; a renderer only decides which tool event calls which subcommand.

| Hook subcommand | Claude Code event | Needed for |
|---|---|---|
| `session-start` | SessionStart | 03 REQ-3.1 |
| `pre-bash` | PreToolUse (Bash) | 03 REQ-3.2 |
| `pre-edit` | PreToolUse (Edit, Write) | 03 REQ-3.3 |
| `subagent-start` | SubagentStart | 03 REQ-3.4 |
| `subagent-stop` | SubagentStop | 03 REQ-3.5 |
| `pre-compact` | PreCompact | 03 REQ-3.6 |
| `stop` | Stop | 03 REQ-3.7 |
| `session-end` | SessionEnd | 03 REQ-3.8 |

A tool that lacks an event SHALL get the nearest available one and a line in `docs/adapters.md`
saying which guarantee is weaker there. The git hooks (03 REQ-3.9) and CI (03 REQ-3.11) do not
depend on the agent tool and hold regardless.
