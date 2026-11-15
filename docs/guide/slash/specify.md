# /slicekit specify

Writes the spec from the intake snapshots and the decisions, then opens the spec pull request.

## What you type

`/slicekit specify`. Run it after intake, once the open questions are settled.

## Agents it spawns

None. The session writes the spec files from the snapshots and the decision rows only. Where no source supports a claim it writes a `[NEEDS CLARIFICATION: …]` marker and does not guess.

## Commands its procedure runs

- [`branch`](../commands/branch.md) as `branch spec <slug>`
- [`stage`](../commands/stage.md) as `stage require clarify`
- [`spec`](../commands/spec.md) as `spec verify`, until it exits 0
- [`check`](../commands/check.md)
- [`pr`](../commands/pr.md) as `pr open --title "[spec] <program name>"`

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## What it leaves behind

One file per capability under `<docsRoot>/spec/`, each requirement citing its source, and one contract per interface named at intake under `<docsRoot>/spec/contracts/`. One commit and the `[spec] <program name>` pull request. Merging it approves the spec.

[Back to the guide](../README.md#pages)
