# slicekit audit

The two steps of `/slicekit audit` that the CLI takes: the claims handed to the auditor, and the check of the report it writes.

## Usage

```text
slicekit audit context [area] [--all] [--no-report] [--json]
slicekit audit check <report> [area] [--every-claim]
```

`audit context [area]` prints the report path on its first line. Then, for each claim of the area, it prints the claim's ID, its `<file>:<line>` and its title, a `files:` line naming the files the claim names, and one `candidate <sha7> <date> <subject>` line for each commit that touched one of those files after the claim's heading was last changed. A claim is a REQ block of the spec or a `##` section of the runbook.

The area is a spec file's name without `.md` or its path, a REQ prefix such as `REQ-2`, one REQ ID, the word `runbook`, or a path. With no area, every claim is listed.

- `--all`: prints every candidate. Without it a claim shows its ten newest candidates, then one line that counts the older ones and names the command that prints them: `audit context <area> --all --no-report`, written with the kit's command prefix (`cli` in the config).
- `--no-report`: prints the context alone. No report path is printed and no report file is created. Use it with `--all` to read the older candidates of a claim during an audit; the report of that audit stays the one its first `audit context` created.
- `--json`: prints one JSON document that holds every candidate. With `--no-report` its `report` is `null`.

`audit check <report> [area]` reads the area's claims again from the spec and the runbook and prints `ok <report>`, or one `<report>:<line> <message>` line per problem:

- no `## Claims` section, no table in it, or a table whose columns are not Claim, Where, Evidence, Found at, Status, Commit;
- a row for a claim that is not in the area, or a second row for one claim;
- a status that is not `holds`, `drifted` or `unverifiable`;
- a `drifted` row whose commit is not one of the claim's candidates;
- a missing `Skipped:` or `Not checked:` closing line;
- with `--every-claim`, a claim of the area that has no row.

## What it reads and writes

Reads the spec, the runbook, the graph file and git's history. `audit context` creates the empty report file `.slicekit/reports/audit-<k>.md`, which the ignore rules that `init` writes cover; with `--no-report` it creates none. `audit check` writes nothing. Neither changes a tracked file.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | `context`: printed. `check`: the report has no problem |
| 1 | `check`: at least one problem. Either: no graph, a graph of an older schema, or a git error |
| 2 | bad usage, an unknown subcommand, an area that names no claim, a report path that is not a file, or a config problem |

## Example

```console
$ slicekit audit context runbook
.slicekit/reports/audit-1.md
runbook#how-to-run-it docs/runbook.md:3 How to run it
  files: bin/slicekit.js
  candidate 8b41d07 2026-11-02 fix(cli): --help prints on stdout
$ slicekit audit context runbook --all --no-report
runbook#how-to-run-it docs/runbook.md:3 How to run it
  files: bin/slicekit.js
  candidate 8b41d07 2026-11-02 fix(cli): --help prints on stdout
$ slicekit audit check .slicekit/reports/audit-1.md runbook --every-claim
ok .slicekit/reports/audit-1.md
```

[Back to the guide](../README.md#pages)
