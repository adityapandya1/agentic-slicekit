# slicekit history

Lists the slices whose commits touched the given paths.

## Usage

```text
slicekit history <path> [<path>…] [--json]
```

Newest first, each slice with its pull request, its last verdict and its release. Commits in no slice are not listed. A directory matches every file under it.

- `--json`: prints one JSON document, also on an error (`{"error": …}`).

It answers "who changed this, under which slice, and was it reviewed?"

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
$ slicekit history src/orders/place.js
P1/S-02  PR #14  APPROVE  unreleased
```

[Back to the guide](../README.md#pages)
