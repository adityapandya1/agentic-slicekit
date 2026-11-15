# /slicekit audit

Compares what the spec and the runbook claim with what the code, the tests and the CI history show.

## What you type

`/slicekit audit [area]`. The area is a spec file's name without `.md`, a REQ prefix such as `REQ-2`, the word `runbook`, or a path. With no area, every claim is audited.

## Agents it spawns

The auditor, in audit mode, with the brief from `instructions auditor`. It is given the claims and writes the report at the report path.

## Commands its procedure runs

- [`graph`](../commands/graph.md), so the files the claims name are read from the latest history
- [`audit`](../commands/audit.md) as `audit context [area]`
- [`instructions`](../commands/instructions.md) as `instructions auditor`
- [`audit`](../commands/audit.md) as `audit check <report> [area] --every-claim`; on findings the auditor is sent back once

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## What it leaves behind

One report, `.slicekit/reports/audit-<k>.md`, with a Claims table: one row per claim, its evidence, where it was found, and a status of `holds`, `drifted` or `unverifiable`. The report folder is ignored by git, so no tracked file changes. The audit changes nothing: each `drifted` row becomes a slice or a decision by a person's hand, and each `unverifiable` row is a claim with no test or check behind it.

[Back to the guide](../README.md#pages)
