# slicekit shipped

Prints a phase's release record.

## Usage

```text
slicekit shipped P<n> [--json]
```

It prints the record's path, the requirements the phase delivered and its pull requests with their URLs. Release records come from [`release`](release.md). For a phase with no record it answers `P<n> has no release record` and exits 1.

- `--json`: prints one JSON document, also on an error.

## What it reads and writes

Reads only `.slicekit/graph/graph.json`. It runs no git and calls no host. It writes nothing. <!-- slicekit:example -->

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | answered |
| 1 | no graph, a graph of an older schema, or a phase with no release record |
| 2 | bad usage, a phase the graph does not hold, or a config problem |

## Example

```console
$ slicekit shipped P1
slicekit: P1 has no release record
```

[Back to the guide](../README.md#pages)
