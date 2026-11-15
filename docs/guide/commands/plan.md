# slicekit plan

Says whether planning may start.

## Usage

```text
slicekit plan check
```

`plan check` prints `ready to plan`, or one blocker per line: each clarification marker as `<file>:<line> clarification marker: …`, then the first earlier stage, up to the gap scan, that is not done. It is step 2 of `/slicekit plan`.

## What it reads and writes

Reads the spec, the decisions, the gaps file and the intake sidecars. It writes nothing.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | ready |
| 1 | blockers, one per line |
| 2 | bad usage or a config problem |

## Example

```console
$ slicekit plan check
ready to plan
```

[Back to the guide](../README.md#pages)
