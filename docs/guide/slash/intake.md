# /slicekit intake

Brings a requirement document into the project and interviews the person about it.

## What you type

`/slicekit intake <file or URL>`. Run it first, with the requirement document, and again for each new source.

## Agents it spawns

None. The session itself asks the questions, one at a time: a product pass (purpose, users, components, existing systems, constraints, out of scope, interfaces), then a platform pass that fills `platform.md` and `observability.md`.

## Commands its procedure runs

- [`branch`](../commands/branch.md) as `branch spec <slug>`
- [`intake`](../commands/intake.md) as `intake snapshot`, then `intake ask` before each question and `intake answer` after each answer, then `intake done`
- [`workflow`](../commands/workflow.md) as `workflow --write`, after the table of CI steps in `observability.md` changes

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## What it leaves behind

The branch `spec/<slug>`. A frozen snapshot of the source and its sidecar under `<docsRoot>/intake/`, committed. One decision row per answer in `<docsRoot>/decisions.md`, with `platform.md` and `observability.md` filled in, committed. The list of questions still open, printed. No spec file and no pull request.

[Back to the guide](../README.md#pages)
