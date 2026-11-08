# C-1 Git host adapter

**Producer:** the kit (`src/adapters/githost/`). **Consumers:** `/slicekit build`, `/slicekit review`,
`slicekit status --sync`, `slicekit graph`, the CI workflow generator, `slicekit check` (the
host-rules and journal rules) and `slicekit init --protect`. **Version one implementation:**
GitHub through the `gh` CLI (D-09). The host is the one the `origin` remote names: github.com, a
GitHub Enterprise Cloud host or a GitHub Enterprise Server hostname alike; no operation assumes
github.com (D-67, D-70).

The kit SHALL call a git host only through this interface, so GitLab, Bitbucket or Azure DevOps is a
second file, not a second kit.

| Operation | Input | Output |
|---|---|---|
| `openPullRequest` | branch, base, title, body, draft | number, url |
| `updatePullRequestBody` | number, body | — |
| `markReady` | number | — |
| `markDraft` | number | — (a ready pull request returns to draft when its slice returns to draft-pr) |
| `setLabel` / `removeLabel` | number, label | — |
| `pullRequestForBranch` | branch, base (optional) | number, url and base of its open pull request in this repository (never a fork's; the one into base first, else the newest), or none |
| `getPullRequest` | number | state, headSha, headRef, draft, mergedAt, url, title, body, labels |
| `listMergedSince` | isoDate | pull requests merged at or after that instant |
| `ciStatus` | sha | success, failure, pending, with run url |
| `renderWorkflow` | config | the CI file content for this host |
| `getCommit` | sha | signature verified (yes or no), signer |
| `dispatchWorkflow` | workflow file, ref | — (starts the workflow on that ref, 03 REQ-3.11) |
| `listOpenPullRequests` | — | every open pull request of this repository (never a fork's): number, url, title, head, base |
| `closePullRequest` | number, comment | — (closes it with that comment; the sync job closes the `[sync]` pull requests a newer one supersedes, 03 REQ-3.11) |
| `readWorkflowPermissions` | — | whether GitHub Actions may create pull requests, and the default token permissions, or none when the host does not say (03 REQ-3.11, REQ-3.14) |
| `getRun` | run id | workflow file, head sha, triggering actor, conclusion (03 REQ-3.8) |
| `readBranchRules` | branch | the repository rulesets that apply: pull request required, approvals, code-owner review, required checks, force push (D-84) |
| `readCodeowners` | — | the CODEOWNERS file's path and content, or none |
| `applyBranchRules` | branch, rules | the rules set (called only by `slicekit init --protect`, 03 REQ-3.14) |

A consumer that knows the last synced commit derives the date with `git show -s --format=%cI <sha>`.

Every operation SHALL be stubbable for tests (05 REQ-5.2) by an environment variable naming a
fixture directory. No operation SHALL merge a pull request; a human merges. The sync job opens its
pull request through `openPullRequest` (03 REQ-3.11, D-78), then starts the workflow on its branch
through `dispatchWorkflow`, so the required checks run on that head (D-80), and closes the older `[sync]`
pull requests it supersedes through `closePullRequest`. No operation changes the Actions setting
`readWorkflowPermissions` reads; a human does.

Cites: D-09, D-67, D-70, D-71, D-77, D-78, D-80, D-84.
