# slicekit visualize

Shows the graph as one self-contained page.

## Usage

```text
slicekit visualize [--port <n>] [--write <file>]
```

By default it serves the page and the graph file on 127.0.0.1 only, prints the URL, opens nothing, and runs until Ctrl-C.

- `--port <n>`: the port, 0 to 65535. Default: 0, any free port.
- `--write <file>`: writes the page to a file instead of serving it, and prints its path.

## What it reads and writes

Reads `.slicekit/graph/graph.json`. With `--write` it writes the one file named. <!-- slicekit:example -->

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | written, or served and stopped |
| 1 | no graph, or the file cannot be written or its folder does not exist |
| 2 | both options, a bad port, bad usage or a config problem |

## Example

```console
$ slicekit visualize --write graph.html
graph.html
```

[Back to the guide](../README.md#pages)
