# slicekit ready-label

Decides whether a slice pull request gets the `ready` label, and sets it. The generated workflow runs it.

## Usage

```text
slicekit ready-label
```

Ready means: the title names a slice, `SLICEKIT_CHECKS_OK=true`, the latest verdict on the current head has no open blocker, and neither has the latest independent verdict, unless `review.independent` on the base branch makes that review optional. It prints the decision and its reason. With `GH_TOKEN` set it adds or removes the label, creating it when needed.

The label is information. Merging stays a person's act.

## What it reads and writes

Reads the pull request from `GITHUB_EVENT_PATH`, the base from `GITHUB_BASE_REF`, the state files and the verdicts. With `GH_TOKEN` it writes the label on the git host.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | always, even on bad usage or a failed label call, which becomes a GitHub warning |

## Example

```console
$ SLICEKIT_CHECKS_OK=true slicekit ready-label
ready-label: P1/S-02 not ready: independent review missing
ready-label: GH_TOKEN not set; label left unchanged
```

[Back to the guide](../README.md#pages)
