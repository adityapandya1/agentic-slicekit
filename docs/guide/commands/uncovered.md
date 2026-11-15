# slicekit uncovered

Lists untested requirements, unlinked tests and commits outside a slice.

## Usage

```text
slicekit uncovered [--json]
```

It prints three lists: requirements no test covers, test files that name no requirement, and commits on the default branch with no `Slice:` trailer, merge commits left out.

- `--json`: prints one JSON document, also on an error.

Run it before a release, or to find work done outside the loop.

## What it reads and writes

Reads only `.slicekit/graph/graph.json`. It runs no git and calls no host. It writes nothing. <!-- slicekit:example -->

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | answered |
| 1 | no graph (`run slicekit graph`), or a graph of an older schema |
| 2 | bad usage, an ID or path the graph does not hold, or a config problem |

## Example

```console
$ slicekit uncovered
requirements with no covering test: 1
  REQ-3.2 …
tests naming no requirement: 0
commits on main with no slice trailer: 2
…
```

[Back to the guide](../README.md#pages)
