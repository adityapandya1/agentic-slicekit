# slicekit ops

The two steps of `/slicekit ops` that the CLI takes: what the ops agent is handed for a symptom, and the check of the report it replies with.

## Usage

```text
slicekit ops context <symptom> [--path <p>]… [--json]
slicekit ops check <report>
```

`ops context <symptom>` prints the report path on its first line, then `symptom:`, one `file:` line per file the symptom's words match, the history of those files as [`history`](history.md) prints it, the runbook, `observability.md` and the last release record. The words of a symptom typed without quotes are one symptom.

A word is a run of three or more letters and digits. It names each file one of whose path segments equals it. A word that matches more than fifty files is printed on a `too broad:` line and names none. A word that matches no file is printed on a `no file:` line.

- `--path <p>`: also takes the files `history` would match for this path. It may be given several times.
- `--json`: prints one JSON document.

`ops check <report>` prints `ok <report>`, or one `<report>:<line> <message>` line per problem:

- a missing or empty section among `## Likely slices and pull requests`, `## First checks` and `## Proposed actions`;
- a slice or pull request named in the first section that the graph does not hold;
- a `<file>:<line>` cited in First checks that is not a line of a file in the repository;
- a proposed action not marked by who may take it: `(anyone)`, `(on-call)` or `(owner: <name>)`. A section that proposes nothing is the one line `None.`;
- a missing `Skipped:` or `Not checked:` closing line.

## What it reads and writes

Reads the graph file and files of the repository. `ops context` creates the empty report file `.slicekit/reports/ops-<k>.md`, which the ignore rules that `init` writes cover. Neither runs git, calls the host, takes an action or changes a tracked file.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | `context`: printed. `check`: the report has no problem |
| 1 | `context`: the symptom names no file in the graph. `check`: at least one problem. Either: no graph, or a graph of an older schema |
| 2 | bad usage, a missing symptom, a `--path` that is not in the graph, a report path that is not a file, or a config problem |

## Example

```console
$ slicekit ops context "checkout returns 502" --path src/orders/
.slicekit/reports/ops-1.md
symptom: checkout returns 502
file: src/orders/place.js
history:
P1/S-02  PR #14  APPROVE  unreleased
runbook: docs/runbook.md
observability: docs/observability.md
last release: none
$ slicekit ops check .slicekit/reports/ops-1.md
ok .slicekit/reports/ops-1.md
```

[Back to the guide](../README.md#pages)
