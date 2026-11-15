# slicekit stage

Checks, from the files, that a stage and every stage before it are complete.

## Usage

```text
slicekit stage require <stage>
```

The stages, in order: `intake`, `clarify`, `specify`, `spec-review`, `gap-scan`, `stack`, `plan`, `build`, `release`. On success `stage require <stage>` prints `ready: <stage>`. Otherwise it prints the first blocker and the command that clears it on stderr, followed by pending items that do not block.

It is the gate at the start of specify (`clarify`), gaps (`spec-review`) and build (`plan`). Type it to see where the program stands.

## What it reads and writes

Reads the intake sidecars, the decisions, the spec, the gaps file, the phase and slice files and the state files. It writes nothing.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | ready |
| 1 | a blocker |
| 2 | bad usage, an unknown stage, or a config problem |

## Example

```console
$ slicekit stage require plan
gap scan not done: docs/spec/gaps.md has no Scanned: line; gaps scan has not run; run /slicekit gaps
```

[Back to the guide](../README.md#pages)
