# /slicekit ops

Triages one symptom: the slices and pull requests that touched the files it names, the runbook's first checks, and the actions someone could take. It takes no action.

## What you type

`/slicekit ops <symptom>`, for example `/slicekit ops checkout returns 502`. With no symptom it asks for one.

## Agents it spawns

The ops agent, with the brief from `instructions ops`. It holds only read tools: no tool that writes a file or runs a command. Its reply is the report, and the session writes that reply to the report path unchanged.

## Commands its procedure runs

- [`graph`](../commands/graph.md), so the history holds the latest merged pull requests
- [`ops`](../commands/ops.md) as `ops context "<symptom>"`, with `--path <path>` for each file the person names when the words match none
- [`instructions`](../commands/instructions.md) as `instructions ops`
- [`ops`](../commands/ops.md) as `ops check <report>`; on findings the agent is sent back once

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## What it leaves behind

One report, `.slicekit/reports/ops-<k>.md`, with the sections Likely slices and pull requests, First checks and Proposed actions, each action marked by who may take it. The report folder is ignored by git, so no tracked file changes and nothing is committed. Each proposed action is the person's, or the named owner's, to take.

[Back to the guide](../README.md#pages)
