# slicekit update

Compares the files the kit renders with what the installed version would write, and updates them.

## Usage

```text
slicekit update [--yes] [--check] [--force]
```

It prints each file that differs, with a status and a diff. Without `--yes` it writes nothing. Only the managed block of a file is re-rendered; text a team added outside it is kept.

| Status | Meaning |
|---|---|
| `changed` | the kit ships a newer template |
| `missing` | the file is not there |
| `drifted` | someone edited the managed block by hand |

Options:

- `--yes`: writes the files whose status is `changed` or `missing`.
- `--check`: writes nothing; exits 1 when any file is `drifted` or `missing`.
- `--force`: with `--yes`, also overwrites `drifted` files.

Run it after upgrading the slicekit package. The [`managed`](../rules/managed.md) rule of `check` reports the same drift.

## What it reads and writes

Reads the config, the kit's templates, the rendered files and their reference copies under `.slicekit/rendered/`. With `--yes` it writes the rendered files and the reference copies.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | done, or a dry run |
| 1 | with `--check`, a file drifted or is missing; with `--yes`, a drifted file was left in place |
| 2 | bad usage or a config problem |

## Example

```console
$ npx slicekit update
changed .claude/commands/slicekit-build.md
…
run again with --yes to apply
$ npx slicekit update --yes
```

[Back to the guide](../README.md#pages)
