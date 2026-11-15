# /slicekit gaps

Finds each place where the spec is silent, vague or in conflict with the intake, asks the person about each, and closes every row.

## What you type

`/slicekit gaps`. Run it after the spec pull request merges, before planning.

## Agents it spawns

The auditor. Its brief is the output of `instructions auditor`. It reads the spec against the snapshots and the decisions, and records each gap a script cannot find.

## Commands its procedure runs

- [`branch`](../commands/branch.md) as `branch gaps <slug>`
- [`stage`](../commands/stage.md) as `stage require spec-review`
- [`gaps`](../commands/gaps.md) as `gaps scan`; the auditor runs `gaps add`; then `gaps close` per row and `gaps verify`
- [`instructions`](../commands/instructions.md) as `instructions auditor`
- [`decide`](../commands/decide.md) as `decide settle` or `decide add`, for each answer
- [`check`](../commands/check.md)
- [`pr`](../commands/pr.md) as `pr open --title "[spec] <program name>: gaps"`

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## What it leaves behind

The gaps file `<docsRoot>/spec/gaps.md` with every row closed by a decision or a requirement change. New or settled decision rows. Answers written into `platform.md`, `observability.md` or the runbook in place of "Not yet known". One commit and the gaps pull request. When the person cannot answer a row yet, the row stays open and no pull request is opened.

[Back to the guide](../README.md#pages)
