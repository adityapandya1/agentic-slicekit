# Check rule: runbook

A slice that says it changes operations changes the runbook, or says why not.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `runbook <file>:<line> <message>`.

## What fails

- `runbook: the slice says runbook: yes, <runbook> changed no section, and the Runbook line does not begin "no operational change"`, reported at the slice file's `runbook:` line.

## When it judges

On a slice branch whose slice file says `runbook: yes` and whose state is from `draft-pr` to `ready`. The pull request body comes from the CI event or from `SLICEKIT_PR_BODY`; with neither the rule does not judge, because `build pr` already refuses to open such a pull request. The branch passes when it changes a `##` section of the runbook, or when the body's Runbook line begins "no operational change". `release` applies the same judgement to every `runbook: yes` slice of the phase.

## How to clear a finding

Add or change the runbook section the slice calls for, or give the reason in the notes file: `"runbook": "no operational change: <reason>"`.

## The failure it prevents

A slice adds a queue, a migration or an alert and merges with the runbook unchanged, so the person on call meets the new failure with no first check written down.
