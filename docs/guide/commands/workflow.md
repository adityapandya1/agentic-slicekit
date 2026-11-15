# slicekit workflow

Prints, writes or checks the GitHub Actions workflow that the config renders.

## Usage

```text
slicekit workflow [--write | --check]
```

The workflow holds a gate job, a job per team command, a job per observability step, the ready label and the sync job that runs after a merge. With no option it prints the workflow.

- `--write`: writes `.github/workflows/slicekit.yml`. It warns when the test command never reads `SLICEKIT_SHARD`, since it then runs whole in every shard.
- `--check`: compares that file with the render.

Run it after changing the team commands or the CI settings in the config. The generated workflow runs `workflow --check` on every pull request.

## What it reads and writes

Reads the config, `observability.md` and the action pins in `templates/workflow/pins.json`. With `--write` it writes the workflow file.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | printed, written, or matching |
| 1 | with `--check`, the file is missing or differs from the render |
| 2 | both flags, bad usage or a config problem |

## Example

```console
$ slicekit workflow --write
updated .github/workflows/slicekit.yml
```

[Back to the guide](../README.md#pages)
