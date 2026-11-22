# slicekit init

Adds the kit to a repository. Run it once at the repository root; running it again is safe.

## Usage

```text
slicekit init --shape <backend|fullstack|data> [--name <n>] [--docs <dir>] [--cli <command>] [--default-branch <name>] [--test <cmd>] [--lint <cmd>] [--build <cmd>] [--e2e <cmd>] [--protect]
```

It writes `.slicekit/config.json`, the docs layout, the Claude Code commands, agents and hooks, the git hooks (it sets `core.hooksPath` to `.githooks`) and the CI workflow when there is none yet. It prints `created`, `updated` or `skipped` for each file, then `hooks run: <cli>`. An existing config wins, so `--shape` is then optional.

It also writes `BUILD.md merge=slicekit-build` to `.gitattributes` and sets `merge.slicekit-build.driver` in the clone's git config to `<cli> status --merge-driver %O %A %B`, so a local merge regenerates `BUILD.md` from the merged state files instead of leaving a conflict (D-100). Run again, it adds neither twice. The git config is not part of a clone: in a clone made after init, run `slicekit init` once; it changes no committed file.

- `--shape <backend|fullstack|data>`: the project's shape; it decides which files are rendered. `fullstack` adds the designer agent. Required unless a config exists.
- `--name <n>`: the program name. Default: the folder's name.
- `--docs <dir>`: the docs root. Default: `docs`.
- `--cli <command>`: how the hooks and the workflow run the kit. Default: `node node_modules/slicekit/bin/slicekit.js` with a local install, else `slicekit`. Init warns when the command does not answer `--version`.
- `--default-branch <name>`: the default branch of a new config. Without it, init takes the branch origin's HEAD points at, else the first of `main`, `master` and git's `init.defaultBranch` that is a local branch.
- `--test`, `--lint`, `--build`, `--e2e <cmd>`: the team's commands. CI runs one job per declared command. No defaults.
- `--protect`: after the files are written, sets on the git host each rule the default branch lacks, as one ruleset named `slicekit`: a pull request before merge, one approving review, the kit's CI checks required, and force push refused. It needs admin rights on the repository. It is the only place where the kit changes a host setting. It prints `set <branch>: <rule>` per rule, or `host rules: <branch> has every rule; nothing set`.

## What it reads and writes

Reads the repository, an existing config and, with `--protect`, the git host's rulesets. Writes the config, the docs layout, `.claude/`, `.githooks/`, the workflow file, the rendered copies under `.slicekit/rendered/`, `.gitattributes`, and git's `core.hooksPath` and `merge.slicekit-build.driver`. It commits nothing. With `--protect` it writes one ruleset on the host.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | done; warnings go to stderr |
| 1 | `--protect`: the git host refused or could not be reached; the files are already written |
| 2 | bad usage, not run from the repository root, no `--shape` and no config, or a config problem, including a flag that disagrees with the existing config |

## Example

```console
$ npm install --save-dev slicekit
$ npx slicekit init --shape backend --name orders --test "npm test" --lint "npm run lint"
created .slicekit/config.json
…
hooks run: node node_modules/slicekit/bin/slicekit.js
```

[Back to the guide](../README.md#pages)
