# slicekit spec

Checks that every requirement and interface in the spec is grounded.

## Usage

```text
slicekit spec verify
```

`spec verify` checks what the spec stands on: the earlier stages are done, every requirement cites a decision row or an intake file that exists, and every interface named at intake has a contract. It lists clarification markers but does not count them as findings. `/slicekit specify` runs it after the spec files are written, until it exits 0.

## What it reads and writes

Reads the spec files, the contracts, the decisions and the intake files. It writes nothing.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | prints the counts, then each clarification marker |
| 1 | one `<file>:<line> <message>` line per finding |
| 2 | bad usage or a config problem |

## Example

```console
$ slicekit spec verify
spec verified: 18 REQ, 2 contracts, 1 clarification markers
docs/spec/refunds.md:22 [NEEDS CLARIFICATION: who approves a refund over the limit?]
```

[Back to the guide](../README.md#pages)
