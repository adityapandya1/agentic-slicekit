# slicekit baseline

Shows the ratchet baselines, or lowers them to today's counts.

## Usage

```text
slicekit baseline <update [--adopt]|show> [--json]
```

The ratchet rules are [`references`](../rules/references.md) and [`style`](../rules/style.md). Each keeps one count per file; `check` fails a file whose count is above its baseline.

`baseline update` lowers each baseline to today's count. It refuses to raise one: baselines only go down.

- `--adopt`: a first adoption in a repository that already has findings. It records higher counts and prints each with its previous value. It is refused when `CI` is set.
- `--json`: prints written, refused, adopted, rewrote and problems as JSON.

`baseline show` prints the baselines as JSON, with or without `--json`. Problems with a baseline file go to stderr.

## What it reads and writes

Reads the docs and the baseline files under `.slicekit/baselines/`. `baseline update` writes those files. `baseline show` writes nothing.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | done or printed; `baseline show` exits 0 even when a baseline file is damaged |
| 1 | `update`: a raise was refused, or a baseline file is damaged |
| 2 | bad usage, `--adopt` in CI, or a config problem |

## Example

```console
$ slicekit baseline update
baseline style docs/spec/refunds.md: 4 → 2
```

[Back to the guide](../README.md#pages)
