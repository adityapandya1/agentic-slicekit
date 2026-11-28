# C-5 Model setter to the agent files

**Producer:** `slicekit models apply` (06 REQ-6.7). **Consumers:** the agent files in
`.claude/agents/`, read by Claude Code; `slicekit update`, which renders those files.

| Operation | Input | Output |
|---|---|---|
| Read the map | `models` in `.slicekit/config.json`: role to model ID | the roles and models to write |
| Write an agent's model | a role among auditor, designer, developer, fixer, ops, reviewer, and its model | the `model:` field of `.claude/agents/<role>.md` set to that model |
| Keep the default | a role with no entry | `model: inherit` |
| Keep a choice on update | `slicekit update` over an agent file whose `model:` the map sets | the same `model:` value after the update |
| Configure a main-session role | brief, intake, specify, plan or the step runner, and its model | the `model:` field in the frontmatter of that command's slicekit command or skill file (D-130) |

The change SHALL reach the default branch in a pull request (D-109).

Cites: D-109, D-115, D-130.
