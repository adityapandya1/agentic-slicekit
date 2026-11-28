# C-6 Task picker to the plan

**Producer:** `slicekit bench pick` (06 REQ-6.2). **Consumers:** the benchmark runner (C-4) and the
scorer (06 REQ-6.4). It reads the plan: the slice files, their state, and the red commit and frozen
tests each merged slice recorded.

| Operation | Input | Output |
|---|---|---|
| Suggest tasks | the merged slices with frozen tests | a list of tasks covering each agent's work and both lanes, each with its slice ID and kind |
| Build a task | a slice | the slice file, the files at its red commit and its frozen tests; the merged change kept apart as the hidden reference answer |
| Plant a defect | a reviewer, auditor or ops task | the merged change with one defect from the fixed list planted, or none, and a record of it |
| Replay a blocker | a fixer task | a past verdict with a blocker and the files at that point |
| Confirm | the person's yes | the confirmed task list the runner may use |
| Fall back | a project with no merged slice | the built-in pack made from `examples/` |

Cites: D-110, D-116, D-123, D-127, D-129.
