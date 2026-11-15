# slicekit trace

Traces a requirement down to its commits and tests, or a file up to its requirements.

## Usage

```text
slicekit trace <REQ-…> | trace --file <path> [--json]
```

For a requirement it prints the tree under it: its slices with their pull requests, commits and files, then the tests that cover it. With `--file <path>` it prints the tree above a file: the slices whose commits touched it, with the requirements and decisions above each.

- `--json`: prints one JSON document, also on an error.

It answers "what delivered this requirement?" and "why does this file exist?"

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
$ slicekit trace REQ-2.8
requirement REQ-2.8 `/slicekit review <PR>`
  slice P2/S-16 `/slicekit review` and `--parallel` (merged)
    pull request #19 https://github.com/adityapandya1/agentic-slicekit/pull/19
    commit af5e0d7 ci: the kit's own jobs get 60 minutes
      file .github/workflows/slicekit.yml
…
```

[Back to the guide](../README.md#pages)
