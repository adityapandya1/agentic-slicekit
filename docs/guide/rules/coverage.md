# Check rule: coverage

Once a program is planned, every requirement belongs to a slice and every slice can be built and judged.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `coverage <file>:<line> <message>`.

## What fails

- `<REQ> is named by no slice`.
- `slice <id> lists no expected changes`.
- `slice <id> has no happy test`, or `no negative test`.
- A phase's Order line that misses a group, repeats one or names a group no slice has; or a phase with more than one Order line.
- `slices <a> and <b> in <step> both expect <path>`: two slices that run at the same time expect to change one path.
- A state file that is not valid JSON.

## When it judges

On every run once the program is at the plan stage or any slice is past `todo`. Four shared roots are never an overlap: the repository root `.`, anything under `test/`, `src/cli/index.js` and the runbook.

## How to clear a finding

Correct the plan files: name the requirement in a slice, add the missing test row, or put two slices that change one file in groups of different Order steps. Then run `status --write`.

## The failure it prevents

A requirement is planned into no slice and is never built, or two slices built side by side change the same file and the second one to merge overwrites or conflicts with the first.
