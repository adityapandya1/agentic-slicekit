# slicekit graph

Builds the traceability graph that the queries read.

## Usage

```text
slicekit graph [--full]
```

The graph is built from the kit's own IDs and from git: requirements, decisions, slices, tests, commits, pull requests and releases. It is not a code graph: it does not parse source code and infers no calls or imports.

The build is incremental: it walks only new commits and reads only changed files. `graph` is the only graph command that reads pull requests from the git host; without a host it skips them with a note. In a workspace of several repositories it walks each one. It prints the graph's path, the node and edge counts, what it walked and read, and each repository it could not reach.

- `--full`: rebuilds from scratch, ignoring the saved index.

Run it before any query and after merges. The generated workflow builds the graph on every pull request and keeps it as an artifact.

## A code graph alongside

For a code graph, [graphify](https://github.com/Graphify-Labs/graphify) or a similar tool sits alongside the kit. This line installs graphify and its Claude Code skill:

```sh
pip install graphifyy && graphify install
```

Then one Claude Code session runs both: `/graphify .` for the code graph, then `/slicekit build`.

## What it reads and writes

Reads the docs, the state files, the journal, git's history, the workspace file and, for pull requests, the git host. Writes `.slicekit/graph/graph.json` and its index beside it. <!-- slicekit:example -->

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | written |
| 1 | a schema problem, the default branch not present, or a bad workspace file |
| 2 | not a git repository, bad usage or a config problem |

## Example

```console
$ slicekit graph
.slicekit/graph/graph.json
nodes 1240 edges 3315
commits walked 12 of 412
files read 9 of 188
pull requests fetched 2, from the cache 31
```

[Back to the guide](../README.md#pages)
