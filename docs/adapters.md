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
`ciStatus`, `setLabel` (which adds or removes) and `ensureLabel`; `renderWorkflow` is `src/workflow.js`.
Setting `SLICEKIT_GITHOST_FIXTURE` to a directory replaces the host with `fixture.js`, which reads
answers from that directory, so tests never reach the network.

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

## Agent tool (C-3)

The renderer in `src/render/` reads `templates/claude-code/manifest.json`, renders the files the
shape selects into `.claude/`, keeps a reference copy under `.slicekit/rendered/<version>/`, and
merges `templates/claude-code/hooks.json` into `.claude/settings.json`. The hook handlers are
tool-neutral `slicekit hook <name>` subcommands; a renderer only decides which tool event calls
which subcommand.

Every Claude Code event that C-3 lists exists, so no guarantee is weaker on Claude Code. A tool that
lacks one of those events gets the nearest available event and a row here naming the guarantee that
is weaker.

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
