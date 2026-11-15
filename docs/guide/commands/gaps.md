# slicekit gaps

The steps of `/slicekit gaps` that the CLI takes: find gaps, record them, close them and verify the file.

## Usage

```text
slicekit gaps scan
slicekit gaps verify
slicekit gaps add --class <c> --where <file>:<line> --what <text>
slicekit gaps close G-<n> (--decision D-<n> | --req <REQ>)
```

| Subcommand | What it does |
|---|---|
| `gaps scan` | Adds a row to `<docsRoot>/spec/gaps.md` for each gap a script can find: each "Not yet known" section, each open decision, each requirement that cites one, each interface with no contract. Prints the rows it added, or `no new gaps`. |
| `gaps add` | Writes one open row and prints its G-ID. The auditor agent runs it for each gap a script cannot find. `--class` is one of `missing`, `unsupported`, `contradiction`, `unknown`, `unrequested`; `--where` is `<file>:<line>`; `--what` is one line. All three are required. |
| `gaps close G-<n>` | Closes a row by naming what answered it: `--decision D-<n>`, a settled decision row, or `--req <REQ>`, a requirement changed on this branch that differs from the merged spec. Exactly one of the two. |
| `gaps verify` | Checks that every row is closed and no findable gap is missing. Prints `ready: gap-scan`, or one line per problem. |

## What it reads and writes

Reads the spec, the decisions, `platform.md`, `observability.md` and the runbook. `scan`, `add` and `close` write `<docsRoot>/spec/gaps.md`; `verify` writes nothing. None commits.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | scanned, added, closed, or ready |
| 1 | a file problem, a row already closed, or a finding of `gaps verify` |
| 2 | bad usage, bad input, an unknown ID, or not exactly one of `--decision` and `--req` |

## Example

```console
$ slicekit gaps scan
G-3 unknown D-09 is open: Which payment provider do refunds go through?
$ slicekit gaps close G-3 --decision D-09
G-3 closed by D-09
$ slicekit gaps verify
ready: gap-scan
```

[Back to the guide](../README.md#pages)
