# Runbook: slicekit

## How to run it

From a clone: `node bin/slicekit.js <command>`. From npm: `npx slicekit <command>`. Node 22 or later and git are required; `gh` for the commands that reach the host (D-82).

## Dependencies and their owners

`gh` (GitHub CLI), authenticated (`gh auth status`), is needed by `slicekit pr open` and the build commands; tests use `SLICEKIT_GITHOST_FIXTURE` instead.

Declined should-haves become GitHub issues through `gh` (`slicekit build decline`), so its login needs permission to open issues in the repository; tests use `SLICEKIT_TRACKER_FIXTURE` instead.

With `tracker.kind` set to `jira`, declined should-haves go to Jira Cloud instead (D-74). The shell that runs `slicekit build decline` needs `JIRA_EMAIL` (the Atlassian account's email) and `JIRA_API_TOKEN` (an API token of that account) set; a missing one fails the command naming it. The kit never stores the token. A 401 means the token is wrong or revoked; a 403 or 404 on `open` means the account cannot create issues of `tracker.issueType` in `tracker.project`. See `docs/adapters.md`.

In a fork, run `gh repo set-default` so issues (and pull requests) go to the right repository.

## Known failure modes and the first thing to check

- The full test suite runs out of memory on a developer machine: run the targeted test files and let CI run the full suite (D-43).
- A command that reaches the host fails: check `gh auth status`.
- `slicekit check` fails the hooks rule: run `git config core.hooksPath .githooks` (03 REQ-3.9).

(D-82)

## Actions and who may take them

The author merges pull requests and publishes versions. Anyone may run `slicekit check` and the read-only queries (D-82).

## Rollback

A bad merge is reverted by a pull request like any other change. A bad version is marked with `npm deprecate` and replaced by a patch version (D-82).

## Keeping data and secret paths away from agents

A team lists the paths agents may not read or change in `.slicekit/config.json`, as glob patterns over repository-relative POSIX paths (REQ-3.13, D-72):

```json
"agents": { "denyPaths": ["data/**", "**/*.pem", ".env*", "secrets/"] }
```

`**` crosses directories; `*` and `?` stay inside one. A pattern with no `/` in it, such as `*.pem`, matches at any depth, and so does a directory name with only a trailing `/`; any other pattern starts at the repository root. A pattern that matches a directory covers everything under it, and pre-bash also refuses a command that names the directory a pattern starts with, such as `ls data` under `data/**`. Absent or empty, nothing is denied.

1. List the directories that hold real records (payment files, exports, customer extracts) and every file that holds a secret (keys, certificates, `.env` files).
2. Run `slicekit update`. It writes a `Read(<pattern>)` and an `Edit(<pattern>)` rule per pattern into `permissions.deny` of `.claude/settings.json`; Claude Code refuses a read under those rules, since no hook sees a read. The rules slicekit wrote are recorded in `_slicekit.deny` and replaced on the next update; the team's own deny entries stay.
3. Check: `slicekit hook pre-edit` refuses an Edit or Write to a listed path, and `slicekit hook pre-bash` refuses a command that names one, such as `cat data/pain001-sample.xml`; each refusal names the pattern.

pre-bash reads globs and brace expressions as the shell expands them (an expansion too wide to judge is refused), and follows `cd` and `pushd` along the command, so `cd data && ls` is refused. While the list is set, a `cd` it cannot resolve from the text, such as `cd -` or a `cd` to a variable, is refused too.

The list keeps paths out of the model's context; it does not scan file contents, and a command that reaches a listed file through a variable or a script is not seen. Nor is a recursive command on a parent of a listed directory, such as a recursive grep of the repository root. Keep real data out of the repository where you can.

## Going public as a preview

The repository goes public as a preview once P2/S-25 has merged and CI is green on `main` on Linux, macOS and Windows (D-28). The author changes the visibility by hand: Settings, General, Danger Zone, "Change repository visibility", Public. No command in the kit does this.

Preview versions reach npm from 0.1.1 (D-41); see "Releasing a preview".

After the switch, the README walkthrough is the first thing a visitor tries. A failure of `test/walkthrough.test.js` on `main` is a broken first impression: fix it before any other work.

## Releasing a preview

The author publishes, by hand, from their own npm account; no command in the kit and no CI job publishes. Until S-24 moves publishing into CI, a preview carries no provenance attestation (D-41).

1. The version's entry in `CHANGELOG.md` is written in the release slice, under New, Improved and Fixed with the issue numbers, and the same slice sets the version in `package.json`. So the entry is on `main` before the version is published. After the version changes in `package.json`, `build render` runs from the worktree's own `bin/` (`node bin/slicekit.js build render`), so `.slicekit/rendered/<version>/` and `.claude/` are rendered at the new version, not at the version of a `slicekit` installed elsewhere. CI on that merged `main` commit is green on Linux, macOS and Windows.
2. On an up-to-date `main` with a clean working tree, `npm test` passes, and `npm publish --dry-run` lists only `package.json`, `README.md`, `LICENSE` and files under `bin/`, `src/` and `templates/` (the package test checks the same list).
3. `npm login` once per machine, then `npm publish`. npm asks for the one-time code of the account's two-factor login.
4. Tag the commit and push the tag: `git tag v<version>` and `git push origin v<version>`.
5. `npm view slicekit version` prints the new version.
6. After the first preview only: `npm deprecate slicekit@0.0.0-stage "placeholder with no code; install slicekit@latest"` and `npm deprecate slicekit@0.0.1 "placeholder with no code; install slicekit@latest"`, so nobody installs either placeholder by pinning it.

## Rolling back a bad version on npm

A version number is never reused on npm, even after the version is removed, so a fix always ships as a new version.

- Within 72 hours of publishing, and when no other package depends on it, `npm unpublish slicekit@<version>` removes the version. Its number stays used.
- After that, `npm deprecate slicekit@<version> "<what is wrong>; use <fixed version>"` marks it: npm shows the message to anyone who installs it. Then publish the fix as the next patch version through "Releasing a preview".
- If the bad version carries the `latest` tag, point the tag back at the last good version until the fix is out: `npm dist-tag add slicekit@<good version> latest`.
