# slicekit release

Writes a phase's release record and sets its slices released. It commits nothing and deploys nothing.

## Usage

```text
slicekit release P<n> [--dry-run | --undo]
```

It writes the record `<docsRoot>/releases/P<n>.md`, sets each slice of the phase `released` and rewrites `BUILD.md`. It prints the record's path, then one `released <slice>` line per slice. [`pr open`](pr.md) then commits the three and opens the `[release] P<n>` pull request; merging that pull request is the release.

It refuses, with one line per reason and nothing written:

- a slice that is not `merged`;
- a slice with no recorded pull request;
- a slice that says `runbook: yes` and neither changed a section of the runbook nor gave a Runbook line that begins "no operational change";
- a record that already exists;
- a run that is not on a `release/<slug>` branch at the tip of the default branch.

Options:

- `--dry-run`: prints the record it would write, and writes nothing. It runs on any branch.
- `--undo`: releases nothing. It removes a record that is not committed, puts the phase's state files and `BUILD.md` back as the last commit has them, and prints `removed <record>`. It refuses a record the last commit holds, and when there is no record. It cannot be given with `--dry-run`.

## What it reads and writes

Reads the phase's slice files and state files, the runbook, git and the git host's pull requests. Writes the release record, the state files of the phase and `BUILD.md`.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | the record written, printed (`--dry-run`) or removed (`--undo`) |
| 1 | refused, one line per reason; or a git or git host error |
| 2 | bad usage, both flags, an argument that is not a phase, or a config problem |

## Example

```console
$ slicekit release P1 --dry-run
$ slicekit branch release p1
release/p1
$ slicekit release P1
docs/releases/P1.md
released P1/S-01
released P1/S-02
```

[Back to the guide](../README.md#pages)
