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
| `setLabel` / `removeLabel` | number, label | — |
| `getPullRequest` | number | state, headSha, mergedAt, url, title, body, labels |
| `listMergedSince` | sha | pull requests merged after that commit |
| `ciStatus` | sha | success, failure, pending, with run url |
| `renderWorkflow` | config | the CI file content for this host |

Every operation SHALL be stubbable for tests (05 REQ-5.2) by an environment variable naming a
fixture directory. No operation SHALL merge a pull request; a human merges.
