# Adapters

The kit talks to the outside through three contracts. Each contract is a file in
`docs/spec/contracts/`; each implementation is code behind one entry point. A new git host, tracker
or agent tool is a new implementation of an existing contract, not a change to the kit.

| Contract | What it covers | Where the code lives | Version one |
|---|---|---|---|
| `docs/spec/contracts/C-1-git-host.md` | pull requests, labels, merged-since, CI status, the CI file | `src/adapters/githost/` | GitHub through `gh` |
| `docs/spec/contracts/C-2-tracker.md` | open, comment on and find a ticket | arrives with S-15 | GitHub Issues |
| `docs/spec/contracts/C-3-agent-tool.md` | commands, agent briefs, skills, hook registrations | `src/render/` and `templates/claude-code/` | Claude Code |

## Git host (C-1)

`src/adapters/githost/index.js` exports `getHost(cfg, env, root)`, the only door to a git host. It
picks the implementation from `cfg.gitHost.kind`. Today `github.js` implements `getPullRequest`,
`listMergedSince` and `ciStatus`; the remaining C-1 operations arrive with the slices that call them.
Setting `SLICEKIT_GITHOST_FIXTURE` to a directory replaces the host with `fixture.js`, which reads
answers from that directory, so tests never reach the network.

## Tracker (C-2)

Not built yet. S-15 adds `src/adapters/tracker/` with the three operations of C-2 behind one entry <!-- slicekit:example -->
point chosen by `cfg.tracker.kind`, the same pattern as the git host.

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
