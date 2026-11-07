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

## The git host's rules on the default branch

`slicekit check` reads the repository rulesets that apply to the default branch and fails naming each rule missing: a pull request before merge, one approving review (from a code owner when the repository has a CODEOWNERS file), the kit's CI checks, and force push refused (03 REQ-3.14). The CI checks required are two jobs of the generated workflow: `gate`, and `checks`, which needs every command and observability job and passes when each passed or was skipped because the gate judged the push to be bookkeeping. A command job's matrix names are never required: a job skipped by its own `if` reports none of them. It reads rulesets only; a branch on classic branch protection alone is told to move to a ruleset (D-84). In CI the gate's check step passes the workflow's own token as `GH_TOKEN` and `GH_ENTERPRISE_TOKEN` for the read: `gh` reads the first on github.com and the second on a GitHub Enterprise Server host.

- A human with admin rights on the repository runs `slicekit init --protect` from their own terminal, never from an agent session. It sets only the missing rules, as one repository ruleset named `slicekit`, and prints one `set <branch>: <rule>` line per rule. Run again, it prints `<branch> has every rule; nothing set`.
- The git host login the agent session uses must have no admin rights on the repository. That login, not the kit, is what keeps an agent from changing a host rule; the kit cannot see what a login may do (D-88). Use a separate `gh` login, or a token without admin rights, for the agent's shell.
- The ruleset requires one approving review and lists no one who may bypass it. On a repository with one maintainer, nobody can approve that maintainer's own pull request. The order for a sole maintainer:
  1. Run `node bin/slicekit.js init --protect` (or `npx slicekit init --protect`) from the repository root, in your own terminal, logged in to `gh` with admin rights.
  2. On the host, open the repository's Settings, Rules, Rulesets, the ruleset `slicekit`, and add "Repository admin" to its bypass list with the mode "For pull requests only", then save.
  3. Re-run the pull request's checks: `slicekit check` no longer names a missing rule.
  The bypass lets the admin merge their own pull request without an approval; a direct push to the default branch is still refused. Running `init --protect` again keeps the bypass list as it is.
- `init --protect` also takes out of the `slicekit` ruleset each required check that is not `gate` or `checks` (the matrix names an earlier version required, say) and prints one `removed <branch>: required check <name>` line for each. It never changes a ruleset with another name.
- When the host cannot be read (no network, `gh` not logged in, a token that may not read the rules), check fails in CI and, outside CI, prints `note: host-rules host rules not checked: <why>` and does not block (D-81). The first thing to check is `gh auth status`; in CI, that the check step has `GH_TOKEN` and `GH_ENTERPRISE_TOKEN`.

## Actions and who may take them

The author merges pull requests and publishes versions. Anyone may run `slicekit check` and the read-only queries (D-82).

## Rollback

A bad merge is reverted by a pull request like any other change. A bad version is marked with `npm deprecate` and replaced by a patch version (D-82).

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
