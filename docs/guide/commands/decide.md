# slicekit decide

Writes a decision row outside the interview, or settles an open one.

## Usage

```text
slicekit decide add (--type <T> --question <q> --answer <a> | --open [--type <T>] --question <q> --why <w> --recommendation <r>) [--who <w>] [--replaces D-<n>] [--interface <name> [--source <file>:<line>]]
slicekit decide settle D-<n> --answer <a> [--type <T>] [--who <w>]
```

`decide add` writes one row to `<docsRoot>/decisions.md` and prints its ID. A settled row is never rewritten: changing your mind is a new row with `--replaces`.

- `--type <T>`: one of `Decision`, `Action`, `Information`, `Counsel`, `Open`. Required unless `--open` is given.
- `--question <q>`: the question. Required.
- `--answer <a>`: the answer, for a settled row.
- `--open`: puts the row in the Open table; needs `--why` and `--recommendation`.
- `--who <w>`: who decided. Default: git `user.name`, else `unknown`.
- `--replaces D-<n>`: the settled row this one reverses.
- `--interface <name>`: marks the row as naming an interface, so `spec verify` expects a contract for it. `--source <file>:<line>` says where the snapshot names it.

`decide settle D-<n> --answer <a>` moves an open row to the Settled table with its answer, keeping the same ID. `--type <T>` is required when the row's Type is `Open`.

## What it reads and writes

Reads and writes `<docsRoot>/decisions.md`. It commits nothing.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | prints the D-ID |
| 1 | a file problem (a missing file or table, wrong columns), or `settle` on a row already settled |
| 2 | bad usage, bad input or an unknown ID |

## Example

```console
$ slicekit decide add --type Decision --question "Which database?" --answer "Postgres 16"
D-14
$ slicekit decide settle D-09 --answer "Stripe" --type Decision
D-09
```

[Back to the guide](../README.md#pages)
