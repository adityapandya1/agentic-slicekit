# Runbook: slicekit

## How to run it

From a clone: `node bin/slicekit.js <command>`. From npm: `npx slicekit <command>`. Node 22 or later and git are required; `gh` for the commands that reach the host (D-82).

## Dependencies and their owners

`gh` (GitHub CLI), authenticated (`gh auth status`), is needed by `slicekit pr open` and the build commands; tests use `SLICEKIT_GITHOST_FIXTURE` instead.

Declined should-haves become GitHub issues through `gh` (`slicekit build decline`), so its login needs permission to open issues in the repository; tests use `SLICEKIT_TRACKER_FIXTURE` instead.

With `tracker.kind` set to `jira`, declined should-haves go to Jira Cloud instead (D-74). The shell that runs `slicekit build decline` needs `JIRA_EMAIL` (the Atlassian account's email) and `JIRA_API_TOKEN` (an API token of that account) set; a missing one fails the command naming it. The kit never stores the token. A 401 means the token is wrong or revoked; a 403 or 404 on `open` means the account cannot create issues of `tracker.issueType` in `tracker.project`. See `docs/adapters.md`.

In a fork, run `gh repo set-default` so issues (and pull requests) go to the right repository.

## The generated workflow's runners

Every job of the generated workflow runs on `ci.runsOn` from config: one runner label, or the list of labels a self-hosted runner carries; absent is `ubuntu-latest` (D-67). The kit's own test matrix on three operating systems is unchanged.

In a Java repository (`pom.xml`, `build.gradle` or `build.gradle.kts` at the root, or a declared command calling `mvn`, `gradle` or `./gradlew`) each team command job sets up a JDK of `ci.java` (default 25) through `actions/setup-java` with the Maven or Gradle cache (D-69, D-85). The kit adds no container step (D-86):

- Tests that use Testcontainers need Docker on the runner. GitHub-hosted Linux runners have it; a self-hosted runner must have Docker installed and reachable by the runner's user.
- On a GitHub Enterprise Server host the workflow's actions are pinned by SHA (`templates/workflow/pins.json`). The host reaches them through GitHub Connect, or an administrator mirrors each action into the host at the pinned SHA. A job that cannot resolve an action fails at its first step naming that action.

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

## The state sync pull request

After a pull request merges to the default branch, the workflow's `sync` job runs `slicekit status --sync --write`, then `slicekit journal heads "$GITHUB_SHA"`, then `slicekit sync open` (03 REQ-3.11). `journal heads` adds one line to `.slicekit/journal-heads.log` for each journal file whose last hash at the merge commit differs from the last hash the heads file already records for it; for a file the heads file does not name yet, from its last hash at the newest merge the heads file names. While the heads file names no merge, a merge commit with two parents compares against its first parent, and any other commit (a fast-forward, rebase or squash push) gets a line for every journal file it holds, since git alone cannot say where the push began. So a push of several commits and a merge whose sync pull request was superseded before it merged get their lines from the next sync. Each line holds the file, its last hash, the merge commit, and the run's id, workflow and actor from the run's environment: `GITHUB_ACTOR`, the person who started the run, which a re-run keeps; check compares it with the run's `actor` field, not `triggering_actor` (03 REQ-3.8). The job never pushes to the default branch and never sets `ALLOW_PROTECTED_COMMIT` (D-78). Its permissions are `contents: write`, `pull-requests: write` and `actions: write`. <!-- slicekit:example -->

- The repository setting the sync pull request needs: Settings, Actions, General, Workflow permissions, "Allow GitHub Actions to create and approve pull requests". While it is off, GitHub refuses the job's `gh pr create` and no sync pull request opens. A human with admin rights turns it on; neither `slicekit init --protect` nor any job changes it, and `init --protect` prints a `not set:` line naming it when it is off. Turning it on lets the workflow's token create a pull request; the ruleset still requires an approving review, the kit's workflow approves nothing, and GitHub does not let a pull request's author approve it, so a human approves and merges it. `slicekit check` reads the setting with the host-rules rule when the workflow has a sync job: off fails under `--ci` and is a note otherwise. The workflow's own token cannot read the setting (it needs administration read), so in the kit's CI the rule prints `the Actions pull request setting not checked` as a note; run `slicekit check --ci` with an admin's `gh` login to check it.

- When the sync changed a slice's state, `BUILD.md` or `.slicekit/journal-heads.log`, `sync open` commits only those files on a branch `sync/<short sha of the merge commit>`, pushes that branch with a lease on what origin holds for it (only a `sync/<short sha>` branch, never any other), and opens a pull request titled `[sync] state after <short sha>` with a Done when, Proof and Decisions body. When nothing changed it opens nothing. When a pull request for that sync branch is already open (a re-run of the job), it opens no second one and starts the workflow on that branch again, so a run that stopped before its dispatch still gets its checks. Once its pull request is open, `sync open` closes every open `[sync]` pull request on a `sync/<short sha>` branch whose commit is an ancestor of this run's merge commit (`git merge-base --is-ancestor`), with a comment `Superseded by #<n>`: the sync state is cumulative from the default branch's tip, so a sync pull request cut from a later merge carries every change an earlier one did. When an open sync pull request was cut from a later merge (a re-run of an older merge's job), `sync open` pushes and opens nothing, prints `nothing to open` naming that pull request, and exits 0. A sync pull request whose commit the clone does not hold is left as it is.
- A pull request opened with the workflow's own token starts no workflow, so `sync open` then starts the kit's workflow on the sync branch with workflow_dispatch (D-80). That run reports `gate` and `checks` on the sync branch's head, the two checks the ruleset requires. In it, `slicekit check --ci` reads the title and body of the branch's open pull request through the git host. The gate judges the sync commit as code, so every team command job runs. `ready-label` runs only on pull request events and does not run here.
- A human reviews and merges the sync pull request like any other pull request.
- First things to check: the `sync` job log shows the `sync open` output (`#<n> <url>` and `dispatched slicekit.yml on sync/<sha>`, or why nothing opened); the Actions tab shows a `workflow_dispatch` run on the sync branch. A sync pull request with no checks means the dispatch failed: start the workflow on that branch by hand (`gh workflow run slicekit.yml --ref sync/<sha>`). A `sync/<sha>` branch left on the remote by a run that stopped between its push and its pull request (the setting above off, a host error, a cancelled run) is replaced on a re-run of the job: the push carries a lease on the commit origin holds, read a moment before. A push the lease still refuses means the branch moved during the run: delete the stale `sync/<sha>` branch and re-run the job.

## Signed journal commits

The journal's hash chain carries no key, and its `actor` field is what the session reports; neither proves who wrote a line. What binds a journal to a person is the commit that carries it (03 REQ-3.8, D-71). The kit manages no keys.

- In CI, `slicekit check --ci` asks the git host about each commit of the pull request that changes a file under `.slicekit/journal/` (`git log <merge base>..<head> -- .slicekit/journal/`) and fails naming each one the host does not report as signed and verified: `commit <sha> changes a journal file and its signature is not verified by the host; journal commits must be signed`. <!-- slicekit:example -->
- The check covers only files under `.slicekit/journal/`, never `.slicekit/journal-heads.log`. The sync job's commits, made by the `github-actions[bot]` login without a signature, change only the heads file, the state and `BUILD.md`, so they pass. <!-- slicekit:example -->
- To sign your commits with an SSH key:
  1. `git config --global gpg.format ssh`
  2. `git config --global user.signingkey ~/.ssh/id_ed25519.pub` (the public key of the key you sign with)
  3. `git config --global commit.gpgsign true`
  4. On the host, add the same public key to your account as a signing key (on GitHub: Settings, SSH and GPG keys, New SSH key, key type "Signing Key"). A key added only as an authentication key does not verify signatures.
  5. Check: `git log --show-signature -1` locally, and the commit shows "Verified" on the host.
- A commit already pushed unsigned: re-sign the branch's commits (`git rebase --exec 'git commit --amend --no-edit -S' <merge base>`) and push the branch again with `--force-with-lease`.
- On the sync pull request, `slicekit check --ci` recomputes every line `.slicekit/journal-heads.log` gains from git and the host's record of the run the line names (C-1 `getRun`), and fails naming the line when one differs, when the file at the merge base is not a byte prefix of the file at the head, or when a pull request whose branch is not `sync/<short sha>` changes it (D-89). It recomputes against the heads file at the merge base, as the sync job computed against the file at its merge. On a `sync/<short sha>` pull request it also fails, naming the file and hash, for each journal file that merge owes a line and the heads file does not gain one for, including when the heads file is unchanged (03 REQ-3.8). Never edit the heads file by hand; a heads line is written only by `slicekit journal heads` in the sync job. <!-- slicekit:example -->

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

pre-bash reads the globs and brace expressions in a command's arguments as the shell expands them (an expansion too wide to judge is refused; `**` is read as recursive only after `shopt -s globstar` in the same command, or in a shell started with `-O globstar`, and as `*` otherwise, as Bash reads it by default; a globstar turned on in the user's shell profile cannot be seen from the command text), and follows `cd` and `pushd` along the command, so `cd data && ls` is refused. While the list is set, a `cd` to `-`, to a variable or to a command substitution (`$(...)` or backticks) is refused too. A `cd` whose target is a glob, such as `cd da*`, or a directory the same command creates first is not followed, and the commands after it are judged as if their directory were unknown, so a relative path they name is not checked (issue #118).

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
