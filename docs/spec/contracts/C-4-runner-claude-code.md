# C-4 Benchmark runner to Claude Code

**Producer:** the kit's benchmark runner (`slicekit bench run`, 06 REQ-6.3). **Consumer:** Claude
Code, run headless, once per trial.

| Operation | Input | Output |
|---|---|---|
| Run a trial | `claude -p --model <full model id> --output-format json`, the agent's brief and the task, in a throwaway folder: a copy of the task's files, no `.git`, no remote | the run's JSON: result, duration, tokens, cost, turns, exit status |
| Read the version | `claude --version` | the Claude Code version the run record pins |
| Resolve an alias | the alias a person gave, such as `sonnet` | the full model ID the trial ran on, recorded in its place |

A trial whose run exits with an error SHALL be recorded as failed with its exit status, not retried
silently. The runner SHALL pass no key on the command line and write none to the run record
(06 REQ-6.9).

Cites: D-111, D-114, D-121.
