# C-1 Git host adapter

**Producer:** the kit (`src/adapters/githost/`). **Consumers:** `/slicekit build`, `/slicekit review`,
`slicekit status --sync`, `slicekit graph`, the CI workflow generator. **Version one implementation:**
GitHub through the `gh` CLI (D-09).

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

A consumer that knows the last synced commit derives the date with `git show -s --format=%cI <sha>`.

Every operation SHALL be stubbable for tests (05 REQ-5.2) by an environment variable naming a
fixture directory. No operation SHALL merge a pull request; a human merges.
