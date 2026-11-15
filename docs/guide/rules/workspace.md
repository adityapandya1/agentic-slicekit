# Check rule: workspace

A slice names a repository the workspace lists, and a contract names both of its parties.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `workspace <file>:<line> <message>`.

## What fails

- `slice <id> names repo <name>, which <workspace file> does not list`, or `; there is no workspace file`.
- `<contract> names no producer`, or `names no consumer`.
- A workspace file that cannot be read.

## When it judges

On every run. A slice file's `repo:` passes when it is `.` or the name of an entry of the workspace file. A contract's party is a slice address or, for one outside the program, any text.

## How to clear a finding

List the repository in the workspace file, or correct `repo:` in the slice file. Add the producer and the consumer to the contract.

## The failure it prevents

A slice is planned for a repository the graph never walks, or a contract has no named consumer, so `impact` reports that a change to the interface affects nobody.
