# Check rule: host-rules

The git host's rulesets on the default branch hold every rule the kit relies on.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `host-rules <file>:<line> <message>`.

## What fails

- `a pull request is not required before merge`.
- `no approving review is required`; with a CODEOWNERS file, `the approving review is not required to come from a code owner`.
- `the kit's CI checks are not required: <names>`: the gate and checks jobs of the generated workflow.
- `force push is not refused`.
- Under `--ci`: `host rules not checked: <why>`, when the host cannot be read.
- Under `--ci`, when the workflow has a sync job: GitHub Actions may not create pull requests.

## When it judges

On every run in a repository with an origin remote. Only rulesets are read; a branch on classic branch protection alone is told to move to a ruleset. Outside CI, a host that cannot be read is a note, `host rules not checked`, that is printed and does not block; so is the Actions setting when it is off or cannot be read. The rule never writes a host setting.

## How to clear a finding

A person with admin rights runs `slicekit init --protect`, which sets the missing rules as one ruleset named `slicekit`. The Actions setting is turned on by hand under Settings, Actions, General, Workflow permissions.

## The failure it prevents

The default branch accepts a direct push or a merge with red CI, so every check the kit runs on a pull request can be bypassed by anyone with write access, and the kit's gate is advice only.
