# Adapters

The kit talks to the outside through three contracts. Each contract is a file in
`docs/spec/contracts/`; each implementation is code behind one entry point. A new git host, tracker
or agent tool is a new implementation of an existing contract, not a change to the kit.

| Contract | What it covers | Where the code lives | Version one |
|---|---|---|---|
| `docs/spec/contracts/C-1-git-host.md` | pull requests, labels, merged-since, CI status, the CI file | `src/adapters/githost/` | GitHub through `gh` |
| `docs/spec/contracts/C-2-tracker.md` | open, comment on and find a ticket | `src/adapters/tracker/` | GitHub Issues through `gh` |
| `docs/spec/contracts/C-3-agent-tool.md` | commands, agent briefs, skills, hook registrations | `src/render/` and `templates/claude-code/` | Claude Code |

## Git host (C-1)

`src/adapters/githost/index.js` exports `getHost(cfg, env, root)`, the only door to a git host. It
picks the implementation from `cfg.gitHost.kind`. Today `github.js` implements `openPullRequest`,
`updatePullRequestBody`, `markReady`, `markDraft`, `pullRequestForBranch`, `getPullRequest`, `listMergedSince`,
`ciStatus`, `setLabel` (which adds or removes), `ensureLabel`, `dispatchWorkflow`, `listOpenPullRequests`, `closePullRequest`, `readWorkflowPermissions`, `getCommit`, `getRun`, `readBranchRules`, `readCodeowners` and
`applyBranchRules`; `renderWorkflow` is `src/workflow.js`.
Setting `SLICEKIT_GITHOST_FIXTURE` to a directory replaces the host with `fixture.js`, which reads
answers from that directory, so tests never reach the network.

`dispatchWorkflow(file, ref)` runs `gh workflow run <file> --ref=<ref>`; the sync job calls it once its
`[sync]` pull request is open, because a pull request opened with the workflow's own token starts no
workflow (D-80). The fixture records each call as `{op: 'dispatchWorkflow', file, ref}` in
`pr-calls.jsonl` and refuses while `dispatch-error.txt` exists.

`listOpenPullRequests()` runs `gh pr list --state open --limit 200 --json number,url,title,isCrossRepository,baseRefName,headRefName`
and drops a fork's; `closePullRequest(n, comment)` runs `gh pr close <n> --comment=<comment>`. The fixture lists
the `pr-<n>.json` files whose state is `OPEN`, and a close sets that file's state to `CLOSED`, records
`{op: 'closePullRequest', number, comment}` in `pr-calls.jsonl` and refuses while `pr-close-error.txt` exists.

`readWorkflowPermissions()` is `GET repos/{owner}/{repo}/actions/permissions/workflow`, whose
`can_approve_pull_request_reviews` is the setting "Allow GitHub Actions to create and approve pull requests" the
sync job's `gh pr create` needs. Reading it needs administration read, which the workflow's own token lacks, so
in CI the read is refused and the host-rules rule prints a note. The fixture reads `workflow-permissions.json`
(missing: the setting is not known, `null`) and refuses while `workflow-permissions-error.txt` exists.

`getCommit(sha)` is `GET repos/{owner}/{repo}/commits/{sha}`; it returns `{verified, signer}`, where `verified` is
the host's `commit.verification.verified` and `signer` the committer's login when verified, else null.
`getRun(id)` is `GET repos/{owner}/{repo}/actions/runs/{id}`; it returns `{workflow, headSha, actor, conclusion}`
from the run's `name`, `head_sha`, `triggering_actor` (else `actor`) and `conclusion`. The journal rule calls both
under `check --ci` only (03 REQ-3.8, D-71, D-89). The fixture reads `commit-<sha>.json` and `run-<id>.json`,
each what `gh api` prints for that call; a missing file is a commit or run the host does not have.

The three rule operations (03 REQ-3.14) go through `gh api`. `gh api` does not take the host from the
remote, so `github.js` reads `git remote get-url origin`, takes the host, owner and repository from it
(an `https://`, `ssh://` or `user@host:` URL) and passes `--hostname <host>` on every call: github.com,
a GitHub Enterprise Cloud host and a GitHub Enterprise Server hostname alike (D-70). A remote that
names no host, such as a local path, is a `GitHostError` before any call.

| Operation | Request |
|---|---|
| `readBranchRules(branch)` | `GET repos/{owner}/{repo}/rules/branches/{branch}` (rulesets only, D-84), folded into the strictest value of each rule: `{pullRequest, approvals, codeOwnerReview, requiredChecks, refuseForcePush}`; and `GET repos/{owner}/{repo}/branches/{branch}`, whose `protection.enabled` gives `classic` |
| `readCodeowners()` | `GET repos/{owner}/{repo}/contents/{path}` for `.github/CODEOWNERS`, `CODEOWNERS` and `docs/CODEOWNERS`, in that order; the first present is `{path, text}`, none is null |
| `applyBranchRules(branch, rules)` | `GET repos/{owner}/{repo}/rulesets`; then `POST repos/{owner}/{repo}/rulesets` for a new active branch ruleset named `slicekit` on `refs/heads/<branch>`, or, when one named `slicekit` exists, `PUT repos/{owner}/{repo}/rulesets/{id}` with the rules folded into its own, each required check not in `rules.kitChecks` taken out, and its bypass list kept; nothing is written when nothing changes. Returns the checks it took out as `removedChecks` |

`slicekit init --protect` is the one caller of `applyBranchRules`, which a test asserts. The fixture
reads `branch-rules-<branch>.json` (missing: the rules cannot be read), `branch-<branch>.json` and `codeowners.json`, refuses the read
while `branch-rules-error.txt` exists and the write while `ruleset-apply-error.txt` exists, records
each write in `ruleset-calls.jsonl` and adds the rules set to `branch-rules-<branch>.json`.

## Tracker (C-2)

`src/adapters/tracker/index.js` exports `getTracker(cfg, env, root)`, the only door to a tracker. It
picks the implementation from `cfg.tracker.kind`, the same pattern as the git host. Today
`github-issues.js` implements the three operations of C-2 through `gh`, spawned the way the git host
spawns it: `open` is `gh issue create` (the body on stdin, the id read from the printed URL),
`comment` is `gh issue comment`, and `find` searches for the exact title phrase, oldest first, and
keeps the first whose title begins `[<slice>] <finding>:`, returning its state too. Nothing closes
an issue. `slicekit build decline` is the one caller: it opens an issue for a declined should-have,
or finds the one already filed (open or closed, never reopened), and lists its URL under
"Should-haves declined" in the pull request body. The title is cut to GitHub's 256 characters, and
every `@name` in the title and body is wrapped in backticks so agent-written text notifies no one.

When `SLICEKIT_TRACKER_FIXTURE` names a directory, `fixture.js` answers from its `issues.json`,
records each write in `issue-calls.jsonl`, and refuses `open` while `issue-create-error.txt` exists,
so tests never reach the network.

## Tracker: Jira Cloud (C-2)

`src/adapters/tracker/jira.js` implements C-2 for Jira Cloud only, through its REST API v3 (D-74).
`getTracker` selects it when `tracker.kind` is `jira`. Config:

```json
"tracker": { "kind": "jira", "baseUrl": "https://acme.atlassian.net", "project": "SK", "issueType": "Task" }
```

`getTracker` calls the adapter's `validate(cfg)`, which refuses a missing `tracker.baseUrl`,
`tracker.project` or `tracker.issueType`, and a base URL that is not `https`, naming the key.
`src/config.js` checks only that `tracker.kind` is a string.

Credentials come from two environment variables, read at each call and never written anywhere:

| Variable | Holds |
|---|---|
| `JIRA_EMAIL` | the Atlassian account's email |
| `JIRA_API_TOKEN` | an API token of that account |

A missing variable fails the call with an error naming it, before any request. Every error the
adapter raises has the token and the `Authorization` value replaced by `***`.

| Operation | Request |
|---|---|
| `open` | `POST /rest/api/3/issue` with the project key, issue type, summary, labels and the body as an Atlassian Document Format description; returns the numeric issue id and `<baseUrl>/browse/<key>` |
| `comment` | `POST /rest/api/3/issue/{id}/comment` |
| `find` | `GET /rest/api/3/search/jql` with `project = "<key>" AND summary ~ "<prefix>" ORDER BY created ASC`; keeps the oldest issue whose summary begins `[<slice>] <finding>:`, `closed` when its status category is done, else `open` |

The Jira operations return promises; `slicekit build decline` awaits them. With `tracker.kind` unset
or `github-issues`, the GitHub Issues adapter answers as before.

## Agent tool (C-3)

The renderer in `src/render/` reads `templates/claude-code/manifest.json`, renders the files the
shape selects into `.claude/`, keeps a reference copy under `.slicekit/rendered/<version>/`, and
merges `templates/claude-code/hooks.json` into `.claude/settings.json`. The hook handlers are
tool-neutral `slicekit hook <name>` subcommands; a renderer only decides which tool event calls
which subcommand.

Every Claude Code event that C-3 lists exists, so no guarantee is weaker on Claude Code. A tool that
lacks one of those events gets the nearest available event and a row here naming the guarantee that
is weaker.

## A second agent tool: the exit path (C-3)

The kit ships no GitHub Copilot adapter (D-75, amending D-68): the teams use Claude Code from a
terminal or the IntelliJ extension. A team that needs another agent tool writes a second renderer
under C-3. This section lists what that renderer must produce and what it can reuse unchanged.

### Files a renderer writes

| Claude Code file | Source | What it holds |
|---|---|---|
| `.claude/commands/slicekit*.md` | `templates/claude-code/commands/` | one command per kit stage (intake, specify, gaps, plan, build, review, release, ops) |
| `.claude/agents/<role>.md` | `templates/claude-code/agents/` | the role briefs: auditor, designer, developer, fixer, ops, reviewer |
| `.claude/skills/<name>/` | `templates/claude-code/skills/` | slicekit-ids, slicekit-loop, slicekit-writing |
| `.claude/settings.json` | `templates/claude-code/hooks.json` | the hook registrations below, merged in |
| `.slicekit/rendered/<version>/` | the same | a reference copy, so an update can tell a user edit from a kit change |

`templates/claude-code/manifest.json` lists each source, its destination and the shapes that select
it. Each rendered file sits inside managed-block markers (03 REQ-3.12). A second renderer gets its
own template directory and manifest beside `templates/claude-code/`.

### Hook subcommands

Each hook is `slicekit hook <name>`. It reads one JSON object on stdin and writes one JSON object on
stdout. The renderer only maps the tool's event to the subcommand.

| Subcommand | Claude Code event | Reads (stdin) | Writes (stdout) | On failure |
|---|---|---|---|---|
| `hook session-start` | SessionStart | `cwd`, `source` (`startup`, `resume`, `clear`, `compact`) | `hookSpecificOutput.additionalContext`: branch status, active slice, handoff | fails open |
| `hook pre-bash` | PreToolUse, matcher `Bash` | `cwd`, `tool_input.command`, `agent_id` | `{}`, or `hookSpecificOutput.permissionDecision: "deny"` with a reason | denies |
| `hook pre-edit` | PreToolUse, matcher `Edit\|Write\|MultiEdit\|NotebookEdit` | `cwd`, `tool_input.file_path` or `tool_input.notebook_path` | `{}`, or the same deny | denies |
| `hook subagent-start` | SubagentStart | `session_id`, `agent_id`, `agent_type` | `hookSpecificOutput.additionalContext`: the role brief and the writing rules | fails open |
| `hook subagent-stop` | SubagentStop | `session_id`, `agent_id`, `agent_type`, `last_assistant_message`, `stop_hook_active` | `{}`, or `{"decision": "block", "reason": ...}` when the reply lacks its role's shape | blocks |
| `hook pre-compact` | PreCompact | `cwd`, `transcript_path` | `{}`; writes the handoff into the slice's state file | fails open |
| `hook stop` | Stop | `cwd`, `transcript_path`, `stop_hook_active` | `{}`, or a block naming the first ten failing `slicekit check` findings | blocks |
| `hook session-end` | SessionEnd | `cwd` | `{}`; appends one line to the clone's journal | fails open |

### Deny rules

The deny rules sit in the subcommands, not in the tool's settings, so a second tool gets them by
calling the same subcommands before a shell command or a file edit runs:

- `hook pre-bash` denies a commit or push on a protected branch, any force push, a commit that
  changes a frozen intake snapshot, any git write or `gh pr` write from a subagent, and a command
  matching `destructive` in `.slicekit/config.json`.
- `hook pre-edit` denies an edit to a kit-owned file (`.slicekit/state/`,
  `.slicekit/baselines/` and the session journal), to a frozen test of the active slice, and the creation of a new file
  under the docs root outside the slice's phase directory and the runbook.

A tool that cannot deny a tool call before it runs cannot carry these guarantees; list that tool's
gap in the Agent tool section above.

### Already tool-neutral

These parts are tool-neutral and need no change for a second tool: the `slicekit` CLI and every
`slicekit hook <name>` handler under `src/hooks/`, the JSON protocol in `src/hooks/io.js`, the role
briefs printed by `slicekit instructions <role>`, `slicekit check`, the state files, the journal,
the git hooks under `.githooks/` and the CI workflow. Only the template directory, its manifest and
the event mapping are tool-specific.

## Adding an implementation

1. Read the contract in `docs/spec/contracts/` and implement every operation it lists, with the same
   inputs and outputs.
2. Put the code next to the existing implementation (`src/adapters/<contract>/<name>.js`, or a
   template directory beside `templates/claude-code/` for an agent tool) and add one branch to the
   entry point that selects it from config.
3. Make it stubbable: the fixture variable must replace it in tests, as `SLICEKIT_GITHOST_FIXTURE`
   does for the git host.
4. Add tests under `test/` that run it against fixtures on Windows, macOS and Linux.
5. For an agent tool, list any event it lacks in the section above.
