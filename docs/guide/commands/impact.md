# slicekit impact

Lists what shares files or contracts with a target.

## Usage

```text
slicekit impact <REQ-…|C-…|P<n>/S-<nn>|path> [--json]
```

The target is a requirement, a contract, a slice or a path; a directory matches every file under it. The answer lists the contracts, slices, files and repositories that share files or contracts with it. The kit's bookkeeping files never count, since every slice touches them.

- `--json`: prints one JSON document, also on an error.

It answers "what else could this change break?"

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
$ slicekit impact src/orders/
contracts:
  C-1 payments-api
slices:
  P1/S-02  repo .  touched 4 shared files
files:
  src/orders/place.js
```

[Back to the guide](../README.md#pages)
